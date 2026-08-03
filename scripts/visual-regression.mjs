#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import WebSocket from "ws";

const command = process.argv[2];
const options = Object.fromEntries(process.argv.slice(3).map((item) => {
  const [key, ...value] = item.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const desktopUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151 Safari/537.36";
const mobileUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const styleProperties = [
  "display", "position", "width", "height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft", "color", "backgroundColor", "borderTopWidth",
  "borderTopStyle", "borderTopColor", "borderRadius", "fontSize", "lineHeight", "fontWeight", "boxShadow",
  "opacity", "transform",
];

const cases = [
  { id: "desktop-home", width: 1440, height: 900, page: "home" },
  { id: "desktop-scene-select", width: 1440, height: 900, page: "scene-select" },
  { id: "desktop-fruit-welcome", width: 1440, height: 900, page: "fruit-welcome" },
  { id: "desktop-zoo-page", width: 1440, height: 900, page: "zoo-page" },
  { id: "portrait-home", width: 390, height: 844, page: "home", mobile: true },
  { id: "portrait-scene-select", width: 390, height: 844, page: "scene-select", mobile: true },
  { id: "portrait-fruit-welcome", width: 390, height: 844, page: "fruit-welcome", mobile: true },
  { id: "landscape-home", width: 844, height: 390, page: "home", mobile: true },
  { id: "landscape-scene-select", width: 844, height: 390, page: "scene-select", mobile: true },
];

const selectorsByPage = {
  home: [
    ["page", "main.home-page"],
    ["hero", ".home-hero-section"],
    ["nav", ".home-page nav"],
    ["title", ".home-page h1"],
    ["start", ".home-page button.hud-float"],
    ["footer", ".home-page .home-legal-footer"],
    ["footerPanel", ".home-page .home-legal-footer-panel"],
  ],
  "scene-select": [
    ["page", "main.scene-select-page"],
    ["hero", ".scene-select-hero-card"],
    ["title", ".scene-select-hero-card h1"],
    ["firstCard", ".scene-select-page section article"],
    ["firstCover", "[data-scene-cover]"],
    ["firstCardTitle", ".scene-select-page section article h2"],
    ["firstCardButton", ".scene-select-page section article button"],
  ],
  "fruit-welcome": [
    ["page", "main.scene-page"],
    ["overlay", ".welcome-intro-overlay"],
    ["card", ".welcome-intro-card"],
    ["title", ".welcome-intro-title"],
    ["text", ".welcome-intro-text"],
    ["action", ".welcome-intro-action"],
  ],
  "zoo-page": [
    ["page", "main.scene-page"],
    ["scene", ".scene-reveal"],
    ["firstHotspot", ".hotspot-sign"],
    ["observe", "aside"],
    ["walkForward", "button.hud-float"],
  ],
};

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolveOpen, reject) => {
      this.socket.once("open", resolveOpen);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (data) => {
      const message = JSON.parse(String(data));
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
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), listener]);
  }

  close() {
    this.socket.close();
  }
}

async function launchChrome() {
  if (!existsSync(chromePath)) throw new Error(`Chrome executable not found: ${chromePath}`);
  const profile = mkdtempSync(join(tmpdir(), "rse-visual-chrome-"));
  const process = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "about:blank",
  ], { stdio: "ignore" });
  const activePortPath = join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 200 && !existsSync(activePortPath); attempt += 1) await delay(50);
  if (!existsSync(activePortPath)) {
    process.kill("SIGTERM");
    throw new Error("Chrome did not expose a DevTools port.");
  }
  const [port] = readFileSync(activePortPath, "utf8").trim().split("\n");
  return {
    endpoint: `http://127.0.0.1:${port}`,
    stop: async () => {
      process.kill("SIGTERM");
      await Promise.race([
        new Promise((resolveExit) => process.once("exit", resolveExit)),
        delay(3000),
      ]);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function waitFor(client, expression, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

function outputPaths(directory, id) {
  return {
    screenshot: resolve(directory, `${id}.png`),
    snapshot: resolve(directory, `${id}.json`),
  };
}

async function clickButton(client, label) {
  const clicked = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent.includes(${JSON.stringify(label)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${label}`);
}

async function openSceneSelect(client) {
  await clickButton(client, "Start Journey");
  await waitFor(client, `Boolean(document.querySelector("main.scene-select-page"))`);
}

async function enterTheme(client, label) {
  await openSceneSelect(client);
  await clickButton(client, label);
  await waitFor(client, `Boolean(document.querySelector(".welcome-intro-overlay"))`);
}

async function prepareCase(client, testCase, baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set("visual-regression", testCase.id);
  await client.send("Page.navigate", { url: url.href });
  await waitFor(client, `Boolean(document.querySelector("main.home-page"))`);
  if (testCase.page === "scene-select") await openSceneSelect(client);
  if (testCase.page === "fruit-welcome") await enterTheme(client, "Enter Fruit Shop");
  if (testCase.page === "zoo-page") {
    await enterTheme(client, "Enter Zoo");
    await evaluate(client, `(document.querySelector(".welcome-intro-action")?.click(), true)`);
    await waitFor(client, `!document.querySelector(".welcome-intro-overlay")`);
    await waitFor(client, `Boolean(document.querySelector(".hotspot-sign"))`);
  }
  const stabilizingStyles = `
    *, *::before, *::after {
      animation-delay: 0s !important;
      animation-duration: 0s !important;
      transition-delay: 0s !important;
      transition-duration: 0s !important;
      caret-color: transparent !important;
    }
    [data-scene-cover] {
      background-color: #21392d !important;
      background-image: none !important;
    }
    [data-scene-cover] img,
    .scene-reveal > img {
      opacity: 0 !important;
    }
    ${testCase.mobile && testCase.page === "home" ? ".home-page .home-legal-footer { display: none !important; }" : ""}
  `;
  await evaluate(client, `(() => {
    const style = document.createElement("style");
    style.dataset.visualRegression = "true";
    style.textContent = ${JSON.stringify(stabilizingStyles)};
    document.head.appendChild(style);
    return true;
  })()`);
  await evaluate(client, `(async () => { if (document.fonts?.ready) await document.fonts.ready; return true; })()`);
  await delay(800);
}

async function snapshotPage(client, testCase) {
  const selectors = selectorsByPage[testCase.page];
  return evaluate(client, `(() => {
    const selectors = ${JSON.stringify(selectors)};
    const styleProperties = ${JSON.stringify(styleProperties)};
    const values = {};
    for (const [key, selector] of selectors) {
      const element = document.querySelector(selector);
      if (!element) {
        values[key] = null;
        continue;
      }
      const box = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      values[key] = {
        selector,
        text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 160),
        box: {
          x: Number(box.x.toFixed(2)),
          y: Number(box.y.toFixed(2)),
          width: Number(box.width.toFixed(2)),
          height: Number(box.height.toFixed(2)),
        },
        styles: Object.fromEntries(styleProperties.map((property) => [property, computed[property]])),
      };
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      values,
    };
  })()`);
}

async function capture() {
  const baseUrl = options.url;
  const directory = resolve(options.out || "tmp/visual-regression/current");
  if (!baseUrl) throw new Error("capture requires --url=http://...");
  mkdirSync(directory, { recursive: true });
  const chrome = await launchChrome();
  const targets = await fetch(`${chrome.endpoint}/json/list`).then((response) => response.json());
  const pageTarget = targets.find((target) => target.type === "page");
  if (!pageTarget) throw new Error("Chrome did not expose a page target.");
  const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await client.open();
  await Promise.all([
    client.send("Page.enable"),
    client.send("Runtime.enable"),
    client.send("Network.enable"),
    client.send("Log.enable"),
  ]);
  await client.send("Network.setBypassServiceWorker", { bypass: true });
  let activeErrors = [];
  client.on("Runtime.exceptionThrown", (event) => {
    activeErrors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || "Runtime exception");
  });
  client.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error") activeErrors.push(event.args?.map((argument) => argument.value || argument.description).join(" ") || "Console error");
  });
  client.on("Log.entryAdded", (event) => {
    if (event.entry?.level !== "error") return;
    if (String(event.entry.url || "").endsWith("/favicon.ico")) return;
    activeErrors.push(event.entry.text);
  });
  const results = [];
  try {
    for (const testCase of cases) {
      activeErrors = [];
      const origin = new URL(baseUrl).origin;
      await client.send("Network.clearBrowserCache");
      await client.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
      await client.send("Emulation.setUserAgentOverride", {
        userAgent: testCase.mobile ? mobileUserAgent : desktopUserAgent,
        platform: testCase.mobile ? "iPhone" : "MacIntel",
      });
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: testCase.width,
        height: testCase.height,
        screenWidth: testCase.width,
        screenHeight: testCase.height,
        deviceScaleFactor: 1,
        mobile: Boolean(testCase.mobile),
        screenOrientation: {
          type: testCase.width > testCase.height ? "landscapePrimary" : "portraitPrimary",
          angle: testCase.width > testCase.height ? 90 : 0,
        },
      });
      await client.send("Emulation.setTouchEmulationEnabled", {
        enabled: Boolean(testCase.mobile),
        maxTouchPoints: testCase.mobile ? 5 : 1,
      });
      await prepareCase(client, testCase, baseUrl);
      const snapshot = await snapshotPage(client, testCase);
      snapshot.consoleErrors = [...new Set(activeErrors)];
      const paths = outputPaths(directory, testCase.id);
      const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      writeFileSync(paths.screenshot, Buffer.from(screenshot.data, "base64"));
      writeFileSync(paths.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      results.push({ id: testCase.id, ...snapshot });
    }
  } finally {
    client.close();
    await chrome.stop();
  }
  writeFileSync(resolve(directory, "manifest.json"), `${JSON.stringify({ baseUrl, cases: results }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, directory, cases: results.length }, null, 2));
}

function compareSnapshots(baseline, current, testCase) {
  const differences = [];
  for (const [key, baselineValue] of Object.entries(baseline.values)) {
    const currentValue = current.values[key];
    if (!baselineValue || !currentValue) {
      if (baselineValue !== currentValue) differences.push(`${key}: element presence changed`);
      continue;
    }
    for (const property of styleProperties) {
      if (baselineValue.styles[property] !== currentValue.styles[property]) {
        differences.push(`${key}.${property}: ${baselineValue.styles[property]} -> ${currentValue.styles[property]}`);
      }
    }
    for (const dimension of ["x", "y", "width", "height"]) {
      if (Math.abs(baselineValue.box[dimension] - currentValue.box[dimension]) > 0.5) {
        differences.push(`${key}.box.${dimension}: ${baselineValue.box[dimension]} -> ${currentValue.box[dimension]}`);
      }
    }
  }
  if (baseline.overflowX !== current.overflowX) differences.push(`overflowX: ${baseline.overflowX} -> ${current.overflowX}`);
  if (current.consoleErrors.length) differences.push(`console errors: ${current.consoleErrors.join(" | ")}`);
  return differences;
}

function compareImages(baselinePath, currentPath, diffPath) {
  const baseline = PNG.sync.read(readFileSync(baselinePath));
  const current = PNG.sync.read(readFileSync(currentPath));
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return { pixels: baseline.width * baseline.height, ratio: 1, sizeMismatch: true };
  }
  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const pixels = pixelmatch(baseline.data, current.data, diff.data, baseline.width, baseline.height, {
    threshold: 0.02,
    includeAA: false,
  });
  writeFileSync(diffPath, PNG.sync.write(diff));
  return { pixels, ratio: pixels / (baseline.width * baseline.height), sizeMismatch: false };
}

function compare() {
  const baselineDirectory = resolve(options.baseline || "");
  const currentDirectory = resolve(options.current || "");
  const reportDirectory = resolve(options.report || "tmp/visual-regression/report");
  if (!existsSync(baselineDirectory) || !existsSync(currentDirectory)) {
    throw new Error("compare requires existing --baseline and --current directories");
  }
  mkdirSync(reportDirectory, { recursive: true });
  const results = cases.map((testCase) => {
    const baselinePaths = outputPaths(baselineDirectory, testCase.id);
    const currentPaths = outputPaths(currentDirectory, testCase.id);
    const baseline = JSON.parse(readFileSync(baselinePaths.snapshot, "utf8"));
    const current = JSON.parse(readFileSync(currentPaths.snapshot, "utf8"));
    const styleDifferences = compareSnapshots(baseline, current, testCase);
    const image = compareImages(
      baselinePaths.screenshot,
      currentPaths.screenshot,
      resolve(reportDirectory, `${testCase.id}-diff.png`),
    );
    return { id: testCase.id, styleDifferences, image };
  });
  const failed = results.filter((result) => result.styleDifferences.length || result.image.ratio > 0.0005);
  const payload = { ok: failed.length === 0, allowedPixelRatio: 0.0005, results };
  writeFileSync(resolve(reportDirectory, "report.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (failed.length) process.exitCode = 1;
}

if (command === "capture") await capture();
else if (command === "compare") compare();
else throw new Error("Usage: visual-regression.mjs capture|compare [--key=value]");
