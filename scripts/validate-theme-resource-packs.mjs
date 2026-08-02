#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { buildThemeResourcePacks } from "./generate-theme-resource-packs.mjs";
import { root } from "./lib/mobile-audio-pipeline.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadRuntimeValue(path, key) {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  return JSON.parse(JSON.stringify(context.window[key]));
}

const { packs: expected, indexVersion } = buildThemeResourcePacks();
const sourceIndex = loadRuntimeValue(resolve(root, "assets/theme-resource-packs.js"), "RealSceneThemeResourcePackScripts");
const deployIndex = loadRuntimeValue(resolve(root, "deploy-cn/assets/theme-resource-packs.js"), "RealSceneThemeResourcePackScripts");
const sourcePack = {};
const deployPack = {};
for (const pack of Object.values(expected)) {
  const expectedScript = `assets/theme-resource-packs/${pack.id}.js?v=${pack.version}`;
  assert(sourceIndex[pack.id] === expectedScript, `Stale source pack script URL for ${pack.id}.`);
  assert(deployIndex[pack.id] === expectedScript, `Stale deploy pack script URL for ${pack.id}.`);
  sourcePack[pack.id] = loadRuntimeValue(
    resolve(root, `assets/theme-resource-packs/${pack.id}.js`),
    "RealSceneThemeResourcePacks",
  )[pack.id];
  deployPack[pack.id] = loadRuntimeValue(
    resolve(root, `deploy-cn/assets/theme-resource-packs/${pack.id}.js`),
    "RealSceneThemeResourcePacks",
  )[pack.id];
}

assert(JSON.stringify(sourceIndex) === JSON.stringify(deployIndex), "Theme resource pack indexes are not synchronized.");
assert(JSON.stringify(sourcePack) === JSON.stringify(deployPack), "Theme resource pack files are not synchronized.");
assert(JSON.stringify(sourcePack) === JSON.stringify(expected), "Generated theme resource packs are stale.");
assert(Object.keys(sourcePack).length === 14, "Expected all 14 learning themes to have resource packs.");

for (const pack of Object.values(sourcePack)) {
  assert(pack.version.startsWith(`${pack.id}-`), `Invalid cache version for ${pack.id}.`);
  assert(pack.cacheName === `real-scene-theme-${pack.version}`, `Invalid cache name for ${pack.id}.`);
  assert(Array.isArray(pack.sceneOrder) && pack.sceneOrder.length > 0, `Missing scene order for ${pack.id}.`);
  assert(new Set(pack.resources.map((resource) => resource.url)).size === pack.resources.length, `${pack.id} resource URLs are not unique.`);
  assert(pack.resources.some((resource) => resource.categories.includes("cover")), `${pack.id} cover is missing.`);
  assert(pack.resources.some((resource) => resource.type === "image"), `${pack.id} images are missing.`);
  assert(pack.resources.some((resource) => resource.type === "audio"), `${pack.id} audio is missing.`);
  for (const resource of pack.resources) {
    assert(statSync(resolve(root, resource.url)).size > 0, `Missing source resource: ${resource.url}`);
    assert(statSync(resolve(root, "deploy-cn", resource.url)).size > 0, `Missing deploy resource: ${resource.url}`);
  }
}

for (const htmlPath of [resolve(root, "index.html"), resolve(root, "deploy-cn/index.html")]) {
  const html = readFileSync(htmlPath, "utf8");
  assert(html.includes(`const THEME_RESOURCE_PACKS_SCRIPT_URL = "assets/theme-resource-packs.js?v=${indexVersion}";`), `Stale deferred pack URL in ${htmlPath}`);
  assert(!html.includes(`<script src="assets/theme-resource-packs.js?v=${indexVersion}"></script>`), `Theme pack is still parser-blocking in ${htmlPath}`);
}

for (const serviceWorkerPath of [resolve(root, "service-worker.js"), resolve(root, "deploy-cn/service-worker.js")]) {
  const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
  assert(serviceWorker.includes(`const THEME_PACK_VERSION = ${JSON.stringify(indexVersion)};`), `Stale pack version in ${serviceWorkerPath}`);
  assert(!serviceWorker.includes("`./assets/theme-resource-packs.js?v=${THEME_PACK_VERSION}`"), `Theme pack must not be installed with the app shell in ${serviceWorkerPath}`);
}

console.log(JSON.stringify({
  valid: true,
  version: indexVersion,
  themeCount: Object.keys(expected).length,
  resourceCount: Object.values(expected).reduce((total, pack) => total + pack.resources.length, 0),
  themes: Object.values(expected).map((pack) => ({
    id: pack.id,
    version: pack.version,
    resourceCount: pack.resources.length,
    imageCount: pack.resources.filter((resource) => resource.type === "image").length,
    audioCount: pack.resources.filter((resource) => resource.type === "audio").length,
    totalBytes: pack.totalBytes,
  })),
}, null, 2));
