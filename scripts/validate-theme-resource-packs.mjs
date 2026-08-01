#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { buildZooResourcePack } from "./generate-theme-resource-packs.mjs";
import { root } from "./lib/mobile-audio-pipeline.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPack(path) {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  return JSON.parse(JSON.stringify(context.window.RealSceneThemeResourcePacks));
}

const sourcePackPath = resolve(root, "assets/theme-resource-packs.js");
const deployPackPath = resolve(root, "deploy-cn/assets/theme-resource-packs.js");
const sourcePack = loadPack(sourcePackPath);
const deployPack = loadPack(deployPackPath);
const expected = buildZooResourcePack();

assert(JSON.stringify(sourcePack) === JSON.stringify(deployPack), "Theme resource pack files are not synchronized.");
assert(sourcePack.zoo.version === expected.version, "Generated Zoo resource version is stale.");
assert(sourcePack.zoo.resources.length === expected.resources.length, "Generated Zoo resource count is stale.");
assert(new Set(sourcePack.zoo.resources.map((resource) => resource.url)).size === sourcePack.zoo.resources.length, "Zoo resource URLs are not unique.");
assert(sourcePack.zoo.resources.some((resource) => resource.categories.includes("cover")), "Zoo cover is missing.");
assert(sourcePack.zoo.resources.filter((resource) => resource.type === "image").length === 12, "Zoo image count changed unexpectedly.");
assert(sourcePack.zoo.resources.filter((resource) => resource.type === "audio").length === 275, "Zoo audio count changed unexpectedly.");

for (const resource of sourcePack.zoo.resources) {
  assert(statSync(resolve(root, resource.url)).size > 0, `Missing source resource: ${resource.url}`);
  assert(statSync(resolve(root, "deploy-cn", resource.url)).size > 0, `Missing deploy resource: ${resource.url}`);
}

for (const htmlPath of [resolve(root, "index.html"), resolve(root, "deploy-cn/index.html")]) {
  const html = readFileSync(htmlPath, "utf8");
  assert(html.includes(`const THEME_RESOURCE_PACKS_SCRIPT_URL = "assets/theme-resource-packs.js?v=${expected.version}";`), `Stale deferred pack URL in ${htmlPath}`);
  assert(!html.includes(`<script src="assets/theme-resource-packs.js?v=${expected.version}"></script>`), `Theme pack is still parser-blocking in ${htmlPath}`);
}

for (const serviceWorkerPath of [resolve(root, "service-worker.js"), resolve(root, "deploy-cn/service-worker.js")]) {
  const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
  assert(serviceWorker.includes(`const THEME_PACK_VERSION = ${JSON.stringify(expected.version)};`), `Stale pack version in ${serviceWorkerPath}`);
  assert(!serviceWorker.includes("`./assets/theme-resource-packs.js?v=${THEME_PACK_VERSION}`"), `Theme pack must not be installed with the app shell in ${serviceWorkerPath}`);
}

console.log(JSON.stringify({
  valid: true,
  theme: "zoo",
  version: expected.version,
  resourceCount: expected.resources.length,
  imageCount: expected.resources.filter((resource) => resource.type === "image").length,
  audioCount: expected.resources.filter((resource) => resource.type === "audio").length,
  totalBytes: expected.totalBytes,
}, null, 2));
