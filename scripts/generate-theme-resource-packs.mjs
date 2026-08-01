#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractProjectAudioData,
  extractSpeechUsages,
  loadRuntimeAudioMap,
  root,
} from "./lib/mobile-audio-pipeline.mjs";

const THEME_ID = "zoo";
const OUTPUT_PATHS = [
  resolve(root, "assets/theme-resource-packs.js"),
  resolve(root, "deploy-cn/assets/theme-resource-packs.js"),
];
const HTML_PATHS = [resolve(root, "index.html"), resolve(root, "deploy-cn/index.html")];
const SERVICE_WORKER_PATHS = [resolve(root, "service-worker.js"), resolve(root, "deploy-cn/service-worker.js")];

function extractCssUrl(value) {
  const match = String(value || "").match(/url\(['\"]?([^'\")]+)['\"]?\)/);
  return match?.[1] || null;
}

function fileDetails(resourcePath) {
  const sourceFile = resolve(root, resourcePath);
  const deployFile = resolve(root, "deploy-cn", resourcePath);
  if (!existsSync(sourceFile)) throw new Error(`Missing source resource: ${resourcePath}`);
  if (!existsSync(deployFile)) throw new Error(`Missing deploy-cn resource: ${resourcePath}`);
  const stat = statSync(sourceFile);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`Invalid source resource: ${resourcePath}`);
  return { bytes: stat.size, sourceFile, deployFile };
}

export function buildZooResourcePack() {
  const data = extractProjectAudioData();
  const audioMap = loadRuntimeAudioMap();
  const usages = extractSpeechUsages(data).usages.filter((usage) => usage.themeId === THEME_ID);
  const zooCard = data.sceneCards.find((card) => card.chapter === THEME_ID);
  const sceneOrder = new Map(data.scenes.map((scene, index) => [scene.id, index]));
  const resourcesByUrl = new Map();

  function addResource(url, values) {
    if (!url) return;
    const existing = resourcesByUrl.get(url);
    if (existing) {
      for (const sceneId of values.sceneIds || []) {
        if (sceneId && !existing.sceneIds.includes(sceneId)) existing.sceneIds.push(sceneId);
      }
      for (const category of values.categories || []) {
        if (category && !existing.categories.includes(category)) existing.categories.push(category);
      }
      return;
    }
    const details = fileDetails(url);
    resourcesByUrl.set(url, {
      url,
      type: values.type,
      sceneIds: [...new Set((values.sceneIds || []).filter(Boolean))],
      categories: [...new Set((values.categories || []).filter(Boolean))],
      bytes: details.bytes,
      sourceFile: details.sourceFile,
      deployFile: details.deployFile,
    });
  }

  addResource(extractCssUrl(zooCard?.image), {
    type: "image",
    sceneIds: [],
    categories: ["cover"],
  });
  for (const scene of data.scenes) {
    addResource(scene.bg, {
      type: "image",
      sceneIds: [scene.id],
      categories: ["sceneBackground"],
    });
  }

  for (const usage of usages) {
    const audioUrl = audioMap[usage.originalText];
    if (!audioUrl) {
      throw new Error(`Zoo speech text is missing from the mobile audio map: ${usage.originalText}`);
    }
    addResource(audioUrl, {
      type: "audio",
      sceneIds: [usage.sceneId],
      categories: [usage.type],
    });
  }

  const resources = [...resourcesByUrl.values()]
    .sort((left, right) => {
      const leftCover = left.categories.includes("cover") ? -1 : 0;
      const rightCover = right.categories.includes("cover") ? -1 : 0;
      const leftScene = Math.min(...left.sceneIds.map((id) => sceneOrder.get(id) ?? 999), 999);
      const rightScene = Math.min(...right.sceneIds.map((id) => sceneOrder.get(id) ?? 999), 999);
      return leftCover - rightCover || leftScene - rightScene || left.type.localeCompare(right.type) || left.url.localeCompare(right.url);
    });

  const versionHash = createHash("sha256");
  for (const resource of resources) {
    versionHash
      .update(resource.url)
      .update("\0")
      .update(readFileSync(resource.sourceFile))
      .update("\0")
      .update(readFileSync(resource.deployFile))
      .update("\0");
  }
  const version = `zoo-${versionHash.digest("hex").slice(0, 12)}`;
  const publicResources = resources.map(({ sourceFile: _sourceFile, deployFile: _deployFile, ...resource }) => resource);

  return {
    id: THEME_ID,
    version,
    cacheName: `real-scene-theme-${version}`,
    totalBytes: publicResources.reduce((total, resource) => total + resource.bytes, 0),
    resources: publicResources,
  };
}

function updateHtmlVersion(htmlPath, version) {
  const source = readFileSync(htmlPath, "utf8");
  const pattern = /const THEME_RESOURCE_PACKS_SCRIPT_URL = "assets\/theme-resource-packs\.js(?:\?v=[^\"]+)?";/g;
  if (!pattern.test(source)) {
    throw new Error(`Missing deferred theme resource pack URL in ${htmlPath}`);
  }
  writeFileSync(htmlPath, source.replace(pattern, `const THEME_RESOURCE_PACKS_SCRIPT_URL = "assets/theme-resource-packs.js?v=${version}";`));
}

function updateServiceWorkerVersion(serviceWorkerPath, version) {
  const source = readFileSync(serviceWorkerPath, "utf8");
  const pattern = /const THEME_PACK_VERSION = "[^"]+";/;
  if (!pattern.test(source)) {
    throw new Error(`Missing theme pack version marker in ${serviceWorkerPath}`);
  }
  writeFileSync(serviceWorkerPath, source.replace(pattern, `const THEME_PACK_VERSION = ${JSON.stringify(version)};`));
}

export function writeThemeResourcePacks() {
  const zoo = buildZooResourcePack();
  const payload = `window.RealSceneThemeResourcePacks = Object.freeze(${JSON.stringify({ zoo }, null, 2)});\n`;
  for (const outputPath of OUTPUT_PATHS) writeFileSync(outputPath, payload);
  for (const htmlPath of HTML_PATHS) updateHtmlVersion(htmlPath, zoo.version);
  for (const serviceWorkerPath of SERVICE_WORKER_PATHS) updateServiceWorkerVersion(serviceWorkerPath, zoo.version);
  return {
    version: zoo.version,
    resourceCount: zoo.resources.length,
    imageCount: zoo.resources.filter((resource) => resource.type === "image").length,
    audioCount: zoo.resources.filter((resource) => resource.type === "audio").length,
    totalBytes: zoo.totalBytes,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(writeThemeResourcePacks(), null, 2));
}
