const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const origin = "https://rse.test";
const root = path.resolve(__dirname, "..");
const workers = ["service-worker.js", "deploy-cn/service-worker.js"];

function response(body, init = {}) {
  const result = new Response(body, init);
  Object.defineProperty(result, "type", { value: "basic" });
  result.clone = () => response(body, init);
  return result;
}

function loadWorker(filename) {
  const listeners = new Map();
  const stores = new Map();
  const cacheCalls = [];
  const networkCalls = [];
  let network = () => response("network");
  let claimed = 0;
  let skipped = 0;
  const key = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }
  const context = vm.createContext({
    URL,
    self: {
      location: { origin },
      registration: { scope: `${origin}/` },
      addEventListener: (name, callback) => listeners.set(name, callback),
      skipWaiting: async () => { skipped += 1; },
      clients: { claim: async () => { claimed += 1; } },
    },
    fetch: async (request) => {
      networkCalls.push(request);
      return network(request);
    },
    caches: {
      open: async (name) => {
        cacheCalls.push(["open", name]);
        const entries = store(name);
        return {
          addAll: async (urls) => {
            cacheCalls.push(["addAll", ...urls]);
            for (const url of urls) entries.set(key(url), response("shell"));
          },
          put: async (request, value) => {
            cacheCalls.push(["put", key(request)]);
            entries.set(key(request), value.clone());
          },
        };
      },
      match: async (request) => {
        cacheCalls.push(["match", key(request)]);
        for (const entries of stores.values()) {
          if (entries.has(key(request))) return entries.get(key(request)).clone();
        }
      },
      keys: async () => Array.from(stores.keys()),
      delete: async (name) => {
        cacheCalls.push(["delete", name]);
        return stores.delete(name);
      },
    },
  });
  vm.runInContext(readFileSync(path.join(root, filename), "utf8"), context);
  return {
    cacheCalls, networkCalls, stores,
    currentCache: vm.runInContext("APP_CACHE", context),
    prefix: vm.runInContext("CACHE_PREFIX", context),
    artifactVersion: vm.runInContext("CACHE_VERSION", context),
    setNetwork: (callback) => { network = callback; },
    seed: (name, url, body) => store(name).set(key(url), response(body)),
    lifecycle: async (name) => {
      let work;
      listeners.get(name)({ waitUntil: (promise) => { work = promise; } });
      await work;
      return { claimed, skipped };
    },
    dispatch: async (url, options = {}) => {
      const request = { url: key(url), method: "GET", mode: "cors", ...options };
      let work;
      listeners.get("fetch")({ request, respondWith: (promise) => { work = promise; } });
      const value = await work;
      // Existing static cache writes are deliberately not awaited by respondWith.
      await new Promise((resolve) => setImmediate(resolve));
      return value;
    },
  };
}

for (const filename of workers) {
  test(`${filename}: payment status requests reach the network twice (pending then paid)`, async () => {
    const worker = loadWorker(filename);
    worker.setNetwork(() => response(JSON.stringify({ status: worker.networkCalls.length === 1 ? "pending" : "paid" })));
    const url = "/api/alipay/order-status?orderNo=local-test";
    assert.equal((await (await worker.dispatch(url)).json()).status, "pending");
    assert.equal((await (await worker.dispatch(url)).json()).status, "paid");
    assert.equal(worker.networkCalls.length, 2);
    assert.deepEqual(worker.cacheCalls, []);
  });

  test(`${filename}: all API methods bypass even pre-existing cached responses`, async () => {
    const worker = loadWorker(filename);
    for (const url of ["/api/alipay/order-status", "/api/get-user-plan", "/api/learning-data", "/api/send-login-code"]) {
      worker.seed(worker.currentCache, url, "stale");
      for (const options of [{}, { method: "POST", body: "test", headers: { Authorization: "Bearer test" } }, { mode: "navigate" }]) {
        const result = await worker.dispatch(url, options);
        assert.equal(await result.text(), "network");
        assert.equal(worker.networkCalls.at(-1).method, options.method || "GET");
        if (options.body) assert.equal(worker.networkCalls.at(-1).body, options.body);
      }
    }
    assert.equal(worker.networkCalls.length, 12);
    assert.deepEqual(worker.cacheCalls, []);
    worker.setNetwork(() => { throw new Error("offline"); });
    await assert.rejects(worker.dispatch("/api/get-user-plan"), /offline/);
    assert.deepEqual(worker.cacheCalls, []);
  });

  test(`${filename}: JS, CSS, images and audio remain cache-first`, async () => {
    const worker = loadWorker(filename);
    for (const url of ["/assets/app/test.js", "/assets/app/test.css", "/assets/cover.webp", "/assets/audio/test.mp3"]) {
      const before = worker.networkCalls.length;
      assert.equal(await (await worker.dispatch(url)).text(), "network");
      worker.setNetwork(() => response("changed"));
      assert.equal(await (await worker.dispatch(url)).text(), "network");
      assert.equal(worker.networkCalls.length, before + 1);
      worker.setNetwork(() => response("network"));
    }
  });

  test(`${filename}: navigation stays network-first with offline index fallback`, async () => {
    const worker = loadWorker(filename);
    worker.seed(worker.currentCache, "/index.html", "old index");
    worker.setNetwork(() => response("new index"));
    assert.equal(await (await worker.dispatch("/", { mode: "navigate" })).text(), "new index");
    worker.setNetwork(() => { throw new Error("offline"); });
    assert.equal(await (await worker.dispatch("/", { mode: "navigate" })).text(), "new index");
    assert.equal(worker.networkCalls.length, 2);
  });

  test(`${filename}: activation removes old app cache, not theme or unrelated caches`, async () => {
    const worker = loadWorker(filename);
    const oldCache = `${worker.prefix}-${worker.artifactVersion}`;
    assert.notEqual(worker.currentCache, oldCache, "cache policy upgrade must retire the previous cache");
    worker.seed(oldCache, "/api/alipay/order-status", "pending");
    worker.seed("theme-resources-zoo-v1", "/assets/zoo.png", "theme");
    worker.seed("unrelated-app-v1", "/other", "other");
    assert.equal((await worker.lifecycle("install")).skipped, 1);
    assert.equal((await worker.lifecycle("activate")).claimed, 1);
    assert.equal(worker.stores.has(oldCache), false);
    assert.equal(worker.stores.has(worker.currentCache), true);
    assert.equal(worker.stores.has("theme-resources-zoo-v1"), true);
    assert.equal(worker.stores.has("unrelated-app-v1"), true);
    assert.deepEqual(worker.cacheCalls.filter(([action]) => action === "delete"), [["delete", oldCache]]);
  });

  test(`${filename}: cross-origin requests and non-API POST remain outside interception`, async () => {
    const worker = loadWorker(filename);
    assert.equal(await worker.dispatch("https://other.test/api/status"), undefined);
    assert.equal(await worker.dispatch("/other", { method: "POST" }), undefined);
    assert.deepEqual(worker.cacheCalls, []);
    assert.deepEqual(worker.networkCalls, []);
  });
}

test("root and deploy-cn workers differ only in their existing cache prefix", () => {
  const normalize = (filename) => readFileSync(path.join(root, filename), "utf8").replace(/real-scene-(root|cn)/, "real-scene-test");
  assert.equal(normalize(workers[0]), normalize(workers[1]));
});
