#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceManifestPath = resolve(root, "assets/theme-covers/manifest.json");
const deployManifestPath = resolve(root, "deploy-cn/assets/theme-covers/manifest.json");
const sourceManifest = readFileSync(sourceManifestPath, "utf8");
const deployManifest = readFileSync(deployManifestPath, "utf8");
if (sourceManifest !== deployManifest) throw new Error("Theme cover manifests differ.");
const manifest = JSON.parse(sourceManifest);
const themes = Object.entries(manifest.themes || {});
if (themes.length !== 14) throw new Error(`Expected 14 theme covers, found ${themes.length}.`);

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

for (const [theme, item] of themes) {
  const source = resolve(root, item.webp);
  const deploy = resolve(root, "deploy-cn", item.webp);
  if (!existsSync(source) || !existsSync(deploy)) throw new Error(`Missing WebP cover for ${theme}.`);
  if (statSync(source).size !== item.bytes || hash(source) !== item.sha256 || hash(source) !== hash(deploy)) {
    throw new Error(`Invalid or divergent WebP cover for ${theme}.`);
  }
  if (item.bytes < 10000 || item.bytes > 120000) throw new Error(`Cover budget exceeded for ${theme}: ${item.bytes} bytes.`);
  if (!existsSync(resolve(root, item.fallback)) || !existsSync(resolve(root, "deploy-cn", item.fallback))) {
    throw new Error(`Missing fallback cover for ${theme}.`);
  }
  const info = spawnSync("webpinfo", [source], { encoding: "utf8" });
  if (info.status !== 0 || !info.stdout.includes(`Width: ${item.width}`) || !info.stdout.includes(`Height: ${item.height}`)) {
    throw new Error(`Unexpected WebP dimensions for ${theme}.`);
  }
}

const totalBytes = themes.reduce((sum, [, item]) => sum + item.bytes, 0);
const firstRowBytes = themes.slice(0, 3).reduce((sum, [, item]) => sum + item.bytes, 0);
if (firstRowBytes > 500 * 1024) throw new Error(`First-row cover budget exceeded: ${firstRowBytes} bytes.`);
console.log(JSON.stringify({ valid: true, themeCount: themes.length, totalBytes, firstRowBytes }, null, 2));
