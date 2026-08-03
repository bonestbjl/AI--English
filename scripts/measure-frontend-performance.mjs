#!/usr/bin/env node

const endpoint = process.env.CHROME_DEBUG_URL || "http://127.0.0.1:9223";
const targetUrl = process.argv[2] || "http://127.0.0.1:4186/";
const cold = process.argv.includes("--cold");
const viewport = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const network = {
  offline: false,
  latency: 100,
  downloadThroughput: 200000,
  uploadThroughput: 93750,
  connectionType: "cellular4g",
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPageTarget() {
  const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("No Chrome page target is available.");
  return page;
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeoutMs = 90000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
        resolve(params);
      };
      this.listeners.set(method, [...(this.listeners.get(method) || []), listener]);
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result?.value;
}

async function waitFor(client, expression, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return;
    await delay(100);
  }
  throw new Error(`Condition timed out: ${expression}`);
}

function metricsObject(metrics) {
  return Object.fromEntries((metrics || []).map((item) => [item.name, item.value]));
}

const page = await getPageTarget();
const client = new CdpClient(page.webSocketDebuggerUrl);
await client.open();

try {
  await Promise.all([
    client.send("Page.enable"),
    client.send("Runtime.enable"),
    client.send("Network.enable"),
    client.send("Performance.enable"),
  ]);
  await client.send("Emulation.setDeviceMetricsOverride", viewport);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await client.send("Network.emulateNetworkConditions", network);
  await client.send("Network.setCacheDisabled", { cacheDisabled: cold });
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__rseLcp = null;
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) {
          const entry = entries[entries.length - 1];
          window.__rseLcp = { startTime: entry.startTime, size: entry.size, url: entry.url || "", tagName: entry.element?.tagName || "" };
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    `,
  });

  const origin = new URL(targetUrl).origin;
  if (cold) {
    await client.send("Network.clearBrowserCache");
    await client.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  }

  const loadEvent = client.once("Page.loadEventFired");
  await client.send("Page.navigate", { url: `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}perf=${Date.now()}` });
  await loadEvent;
  await waitFor(client, `Boolean(document.querySelector('.home-page'))`);
  await delay(1200);

  const home = await evaluate(client, `(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      startTime: entry.startTime,
      responseEnd: entry.responseEnd,
      duration: entry.duration,
    }));
    return {
      navigation: nav ? {
        transferSize: nav.transferSize,
        encodedBodySize: nav.encodedBodySize,
        decodedBodySize: nav.decodedBodySize,
        responseStart: nav.responseStart,
        responseEnd: nav.responseEnd,
        domInteractive: nav.domInteractive,
        domContentLoaded: nav.domContentLoadedEventEnd,
        loadEventEnd: nav.loadEventEnd,
      } : null,
      paints: Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime])),
      lcp: window.__rseLcp,
      resources,
    };
  })()`);
  home.chromeMetrics = metricsObject((await client.send("Performance.getMetrics")).metrics);

  await evaluate(client, `performance.clearResourceTimings(); window.__rseLcp = null; true`);
  const sceneSelectStartedAt = await evaluate(client, `performance.now()`);
  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('Start Journey'));
    if (!button) throw new Error('Start Journey button not found');
    button.click();
    return true;
  })()`);
  await waitFor(client, `Boolean(document.querySelector('.scene-select-page'))`);
  await waitFor(client, `document.querySelectorAll('[data-scene-cover][data-cover-loaded="true"]').length >= 2`);
  const coversReadyMs = (await evaluate(client, `performance.now()`)) - sceneSelectStartedAt;
  await delay(1800);

  const sceneSelect = await evaluate(client, `(() => {
    const now = performance.now();
    const cards = [...document.querySelectorAll('[data-scene-cover]')].map((node) => ({
      id: node.dataset.sceneCover,
      loaded: node.dataset.coverLoaded,
      backgroundImage: getComputedStyle(node).backgroundImage,
    }));
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      startTime: entry.startTime,
      responseEnd: entry.responseEnd,
      duration: entry.duration,
    }));
    return {
      readyMs: now - ${sceneSelectStartedAt},
      coversReadyMs: ${coversReadyMs},
      cards,
      resources,
      visibleLoadedCards: cards.filter((card) => card.loaded === 'true').length,
    };
  })()`);

  const payload = {
    mode: cold ? "cold" : "warm",
    targetUrl,
    emulation: { viewport, network, cpuSlowdown: 4 },
    home,
    sceneSelect,
  };
  console.log(JSON.stringify(payload, null, 2));
} finally {
  client.close();
}
