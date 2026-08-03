#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { extractProjectAudioData } from "./lib/mobile-audio-pipeline.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const width = 768;
const height = 432;
const quality = 78;
const outputRelativeDirectory = "assets/theme-covers";
const manifestPaths = [
  resolve(root, outputRelativeDirectory, "manifest.json"),
  resolve(root, "deploy-cn", outputRelativeDirectory, "manifest.json"),
];

function commandExists(command) {
  return spawnSync(command, ["-version"], { encoding: "utf8" }).status === 0;
}

function cssUrl(value) {
  return String(value || "").match(/url\(['"]?([^'")]+)['"]?\)/)?.[1] || null;
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (!commandExists("cwebp")) {
  throw new Error("cwebp is required to generate repeatable theme cover thumbnails.");
}

const source = extractProjectAudioData();
const themes = {};
const results = [];

for (const card of source.sceneCards.filter((item) => item?.chapter)) {
  const original = cssUrl(card.image);
  if (!original) throw new Error(`Theme ${card.chapter} does not have a cover image URL.`);
  const originalPath = resolve(root, original);
  if (!existsSync(originalPath)) throw new Error(`Missing source cover: ${original}`);
  const identity = createHash("sha256")
    .update(readFileSync(originalPath))
    .update(`\0${width}x${height}\0q${quality}`)
    .digest("hex")
    .slice(0, 12);
  const outputFile = `${card.chapter}-cover-${identity}.webp`;
  const relativeOutput = `${outputRelativeDirectory}/${outputFile}`;
  const outputPath = resolve(root, relativeOutput);
  mkdirSync(dirname(outputPath), { recursive: true });
  const conversion = spawnSync("cwebp", [
    "-quiet",
    "-mt",
    "-m", "6",
    "-q", String(quality),
    "-resize", String(width), String(height),
    originalPath,
    "-o", outputPath,
  ], { encoding: "utf8" });
  if (conversion.status !== 0) {
    throw new Error(`cwebp failed for ${original}: ${conversion.stderr || conversion.stdout}`);
  }
  const deployOutputPath = resolve(root, "deploy-cn", relativeOutput);
  mkdirSync(dirname(deployOutputPath), { recursive: true });
  copyFileSync(outputPath, deployOutputPath);
  const webpBytes = statSync(outputPath).size;
  const originalBytes = statSync(resolve(root, "deploy-cn", original)).size;
  const sha256 = hashFile(outputPath);
  if (sha256 !== hashFile(deployOutputPath)) throw new Error(`Cover mirror mismatch: ${relativeOutput}`);
  themes[card.chapter] = {
    webp: relativeOutput,
    fallback: original,
    width,
    height,
    bytes: webpBytes,
    sha256,
  };
  results.push({
    theme: card.chapter,
    source: original,
    sourceBytes: originalBytes,
    output: relativeOutput,
    outputBytes: webpBytes,
    savingsPercent: Number((100 - (webpBytes / originalBytes) * 100).toFixed(1)),
  });
}

const manifest = {
  generatedBy: basename(fileURLToPath(import.meta.url)),
  format: "webp",
  optionalAvif: false,
  avifReason: "avifenc_not_available",
  settings: { width, height, quality },
  themes,
};
for (const path of manifestPaths) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  themeCount: results.length,
  totalSourceBytes: results.reduce((sum, item) => sum + item.sourceBytes, 0),
  totalOutputBytes: results.reduce((sum, item) => sum + item.outputBytes, 0),
  settings: manifest.settings,
  results,
}, null, 2));
