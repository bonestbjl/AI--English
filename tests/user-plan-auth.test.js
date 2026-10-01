const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const Babel = require("../vendor/babel.min.js");
const handler = require("../api/get-user-plan.js");

const secret = "user-plan-auth-test-only";
const phones = { free: "13000000000", monthly: "13000000001", lifetime: "13000000002", expired: "13000000003", developer: "13000000004" };
const future = new Date(Date.now() + 86400000).toISOString();
const envNames = ["AUTH_TOKEN_SECRET", "SMS_CODE_SECRET", "SMS_MODE", "NODE_ENV", "VERCEL_ENV", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
let rows, calls, oldFetch, oldEnv;
function token(phone = phones.free, exp = Math.floor(Date.now() / 1000) + 600, key = secret) {
  const payload = Buffer.from(JSON.stringify({ phone, iat: Math.floor(Date.now() / 1000), exp })).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", key).update(payload).digest("base64url")}`;
}
async function request(authToken, body = {}, query = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; } };
  await handler({ method: "POST", headers: authToken ? { authorization: `Bearer ${authToken}` } : {}, body, query }, res);
  return res;
}
test.beforeEach(() => {
  oldEnv = Object.fromEntries(envNames.map((k) => [k, process.env[k]])); oldFetch = global.fetch;
  Object.assign(process.env, { AUTH_TOKEN_SECRET: secret, SMS_CODE_SECRET: secret, SMS_MODE: "mock", NODE_ENV: "production", SUPABASE_URL: "https://user-plan-test.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only" });
  rows = new Map(Object.entries(phones).map(([plan, phone]) => [phone, { phone, role: plan === "developer" ? "developer" : plan === "free" ? "free" : "premium", plan: plan === "expired" ? "premium" : plan, premium_until: plan === "monthly" ? future : plan === "expired" ? "2020-01-01T00:00:00Z" : null, lifetime_access: plan === "lifetime" }]));
  calls = [];
  global.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://user-plan-test.invalid"); assert.equal(url.pathname, "/rest/v1/users");
    calls.push({ url, init });
    assert.equal(init.method, "GET", "membership lookup must never write users");
    const row = rows.get(url.searchParams.get("phone")?.slice(3));
    return new Response(JSON.stringify(row ? [row] : []));
  };
});
test.afterEach(() => {
  global.fetch = oldFetch;
  for (const [k, v] of Object.entries(oldEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
test("missing, forged, malformed and expired tokens return 401 without database access", async () => {
  for (const value of [null, "invalid", token(phones.free, 1), token(phones.free, undefined, "wrong-secret"), `${token()}.extra`]) {
    const result = await request(value, { phone: phones.lifetime });
    assert.equal(result.statusCode, 401); assert.equal(result.body.error, "unauthorized");
  }
  assert.equal(calls.length, 0);
});
test("body/query phone cannot override the verified Free token owner", async () => {
  const r = await request(token(), { phone: phones.lifetime }, { phone: phones.lifetime });
  assert.equal(r.statusCode, 200); assert.equal(r.body.user.phone, phones.free); assert.equal(r.body.user.plan, "free");
  assert.equal(calls[0].url.searchParams.get("phone"), `eq.${phones.free}`); assert.match(r.headers["cache-control"], /no-store/);
});
test("real Node route preserves Bearer identity and ignores body/query phone", async () => {
  const { createApiServer } = require("../server.js");
  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/get-user-plan?phone=${phones.lifetime}`;
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phones.lifetime }) };
    assert.equal((await oldFetch(url, init)).status, 401);
    const result = await oldFetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token()}` } });
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(body.user.phone, phones.free); assert.equal(body.user.plan, "free");
    assert.equal(calls.length, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
for (const [kind, phone] of Object.entries(phones)) {
  test(`authenticated ${kind} uses existing membership rules`, async () => {
    const r = await request(token(phone));
    assert.equal(r.statusCode, 200); assert.equal(r.body.user.plan, kind === "expired" ? "free" : kind);
    assert.equal(r.body.user.isPremium, !["free", "expired"].includes(kind));
    assert.ok(r.body.authExpiresAt > Math.floor(Date.now() / 1000)); assert.equal(calls.length, 1);
  });
}
test("unknown token owner returns user_not_found without creating a user", async () => {
  const r = await request(token("13000000009"));
  assert.equal(r.statusCode, 404); assert.equal(r.body.error, "user_not_found"); assert.equal(calls.length, 1);
});
test("existing login token generator and SMS_CODE_SECRET fallback are compatible", async () => {
  const source = readFileSync(path.join(__dirname, "../api/verify-login-code.js"), "utf8");
  const c = vm.createContext({ crypto, Buffer, AUTH_TOKEN_TTL_SECONDS: 2592000 });
  vm.runInContext(source.slice(source.indexOf("function createAuthToken("), source.indexOf("function safeEqualHex(")), c);
  delete process.env.AUTH_TOKEN_SECRET;
  const r = await request(c.createAuthToken(phones.monthly, secret));
  assert.equal(r.statusCode, 200); assert.equal(r.body.user.plan, "monthly");
});
test("development mock secret is never accepted as a production fallback", async () => {
  delete process.env.AUTH_TOKEN_SECRET; delete process.env.SMS_CODE_SECRET;
  process.env.NODE_ENV = "development"; delete process.env.VERCEL_ENV;
  const value = token(phones.free, undefined, "development_sms_code_secret");
  assert.equal((await request(value)).statusCode, 200);
  process.env.NODE_ENV = "production";
  assert.equal((await request(value)).statusCode, 401);
});

const source = readFileSync(path.join(__dirname, "../src/app.jsx"), "utf8");
let syncSource;
Babel.transform(source, { presets: ["react"], code: false, ast: false, plugins: [() => ({ visitor: {
  FunctionDeclaration({ node }) { if (node.id.name === "syncUserPlan") syncSource = source.slice(node.start, node.end); },
} })] });
function frontend(storage = new Map()) {
  const c = vm.createContext({ AUTH_STORAGE_KEY: "realSceneEnglishUser", window: { localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) } }, showAuthToast() {},
    fetch: async (url, init) => {
      assert.equal(url, "/api/get-user-plan");
      const r = await request(init.headers.Authorization?.replace(/^Bearer /, ""), JSON.parse(init.body || "{}"));
      return new Response(JSON.stringify(r.body), { status: r.statusCode });
    },
  });
  c.setAuthenticatedUser = (user) => { c.currentUser = user; };
  const start = source.includes("let verifiedUserPlan") ? source.indexOf("let verifiedUserPlan") : source.indexOf("const LOCAL_TEST_ACCOUNT_PROFILES");
  vm.runInContext(source.slice(start, source.indexOf("const LEARNING_DATA_GUEST_KEY")) + "\n" + syncSource, c);
  return { c, storage, save: (user) => storage.set("realSceneEnglishUser", JSON.stringify({ ...user, isLoggedIn: true })), access: () => c.canAccessTheme("campus"), sync: () => c.syncUserPlan(c.getCurrentUser(), { silent: true }) };
}
test("test phones and client-only role, lifetime or future expiry never grant Premium", async () => {
  const h = frontend();
  for (const user of [{ phone: "19999999999" }, { phone: "16666666666" }, { phone: phones.free, role: "developer", plan: "developer" }, { phone: phones.free, plan: "lifetime", lifetimeAccess: true }, { phone: phones.free, role: "premium", premiumUntil: future }, { phone: phones.lifetime, lifetime_access: true, authToken: "forged" }]) {
    h.save(user); assert.equal(h.access(), false); assert.equal(h.c.getCurrentUser().role, "free");
    await h.sync(); assert.equal(h.access(), false);
  }
  assert.equal(h.c.canAccessTheme("zoo"), true); assert.equal(h.c.canAccessTheme("fruitShop"), true);
});
for (const [kind, phone] of Object.entries(phones)) {
  test(`${kind} access restores only after verification on refresh, relogin and another device`, async () => {
    const expected = !["free", "expired"].includes(kind), h = frontend(), session = { phone, authToken: token(phone) };
    h.c.setCurrentUser(session); assert.equal(h.access(), false); await h.sync(); assert.equal(h.access(), expected);
    const refreshed = frontend(h.storage); assert.equal(refreshed.access(), false); await refreshed.sync(); assert.equal(refreshed.access(), expected);
    refreshed.c.logoutUser(); assert.equal(refreshed.access(), false); refreshed.c.setCurrentUser(session); assert.equal(refreshed.access(), false); await refreshed.sync(); assert.equal(refreshed.access(), expected);
    const device = frontend(); device.c.setCurrentUser(session); await device.sync(); assert.equal(device.access(), expected);
  });
}
test("verified Free token plus tampered local fields or phone stays Free", async () => {
  const h = frontend(); h.c.setCurrentUser({ phone: phones.free, authToken: token() }); await h.sync();
  const user = h.c.getCurrentUser();
  h.save({ ...user, role: "developer", plan: "lifetime", lifetimeAccess: true, premiumUntil: future }); assert.equal(h.access(), false);
  h.save({ ...user, phone: phones.lifetime, plan: "lifetime" }); await h.sync(); assert.equal(h.access(), false);
});
test("existing payment refresh sees server upgrade using only membership reads", async () => {
  const h = frontend(); h.c.setCurrentUser({ phone: phones.free, authToken: token() }); await h.sync(); assert.equal(h.access(), false);
  rows.set(phones.free, { phone: phones.free, role: "premium", plan: "lifetime", lifetime_access: true });
  const user = await h.sync(); assert.equal(h.access(), true); assert.equal(user.plan, "lifetime"); assert.equal(user.lifetimeAccess, true);
  assert.ok(calls.every(({ init }) => init.method === "GET"));
});
test("failed refresh never falls back to locally cached Premium", async () => {
  const h = frontend(); h.c.setCurrentUser({ phone: phones.lifetime, authToken: token(phones.lifetime) }); await h.sync(); assert.equal(h.access(), true);
  h.c.fetch = async () => { throw new Error("offline"); }; await h.sync(); assert.equal(h.access(), false); assert.equal(h.c.currentUser.role, "free");
});
test("membership and token expiration revoke access without a reload", async () => {
  for (const kind of ["monthly", "lifetime"]) {
    const h = frontend(); h.c.setCurrentUser({ phone: phones[kind], authToken: token(phones[kind]) });
    await h.sync(); assert.equal(h.access(), true);
    const expiry = kind === "monthly" ? Date.now() + 86400001 : Date.now() + 601000;
    // Keep the monthly token valid long enough to isolate membership expiration.
    if (kind === "monthly") {
      h.c.setCurrentUser({ phone: phones[kind], authToken: token(phones[kind], Math.floor(Date.now() / 1000) + 172800) });
      await h.sync();
    }
    vm.runInContext(`Date.now = () => ${expiry}`, h.c);
    assert.equal(h.access(), false);
  }
});
test("logout between verification and UI continuation cannot resurrect a session", async () => {
  const h = frontend(); h.c.setCurrentUser({ phone: phones.lifetime, authToken: token(phones.lifetime) });
  const original = h.c.fetchUserPlanFromServer;
  h.c.fetchUserPlanFromServer = async (...args) => {
    const result = await original(...args);
    h.c.logoutUser();
    return result;
  };
  await h.sync(); assert.equal(h.c.getCurrentUser(), null); assert.equal(h.access(), false);
});
test("late response cannot restore a logged-out or different session", async () => {
  const h = frontend(), fetchPlan = h.c.fetch; let finish;
  h.c.fetch = (url, init) => new Promise((resolve) => { finish = async () => resolve(await fetchPlan(url, init)); });
  h.c.setCurrentUser({ phone: phones.lifetime, authToken: token(phones.lifetime) }); const pending = h.sync();
  h.c.logoutUser(); h.c.setCurrentUser({ phone: phones.free, authToken: token() }); await finish(); await pending;
  assert.equal(h.c.getCurrentUser().phone, phones.free); assert.equal(h.access(), false);
});
test("superseded response cannot overwrite newer server Free status", async () => {
  const h = frontend(); h.c.setCurrentUser({ phone: phones.lifetime, authToken: token(phones.lifetime) });
  const fetchPlan = h.c.fetch; let finish;
  h.c.fetch = async (url, init) => { const response = await fetchPlan(url, init); return new Promise((resolve) => { finish = () => resolve(response); }); };
  const pending = h.sync(); while (!finish) await new Promise((resolve) => setImmediate(resolve));
  rows.set(phones.lifetime, { phone: phones.lifetime, role: "free", plan: "free" }); h.c.fetch = fetchPlan;
  await h.sync(); finish(); await pending; assert.equal(h.access(), false); assert.equal(h.c.currentUser.role, "free");
});
