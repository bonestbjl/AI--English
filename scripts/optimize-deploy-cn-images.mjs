#!/usr/bin/env node

import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { root } from "./lib/mobile-audio-pipeline.mjs";

const DEPLOY_ASSETS = resolve(root, "deploy-cn/assets");
const MIN_BYTES = 1024 * 1024;
const dryRun = process.argv.includes("--dry-run");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function requirePngquant() {
  const result = spawnSync("pngquant", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("pngquant is required for deploy-cn image preparation. Install it before uploading the staging directory.");
  }
  return String(result.stdout || result.stderr).trim();
}

const candidates = walk(DEPLOY_ASSETS).filter((path) =>
  extname(path).toLowerCase() === ".png" && statSync(path).size > MIN_BYTES
);

if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, candidateCount: candidates.length, files: candidates.map((path) => path.slice(root.length + 1)) }, null, 2));
  process.exit(0);
}

const pngquantVersion = requirePngquant();
const tempDirectory = mkdtempSync(join(tmpdir(), "rse-pngquant-"));
const results = [];

try {
  for (const inputPath of candidates) {
    const beforeBytes = statSync(inputPath).size;
    const outputPath = join(tempDirectory, `${results.length}-${basename(inputPath)}`);
    const result = spawnSync("pngquant", [
      "--quality=70-90",
      "--speed=1",
      "--strip",
      "--force",
      "--output",
      outputPath,
      inputPath,
    ], { encoding: "utf8" });

    if (result.status !== 0) {
      results.push({ file: inputPath.slice(root.length + 1), status: "preserved", reason: "pngquant_failed", beforeBytes });
      continue;
    }
    const afterBytes = statSync(outputPath).size;
    if (afterBytes >= beforeBytes) {
      results.push({ file: inputPath.slice(root.length + 1), status: "preserved", reason: "not_smaller", beforeBytes, afterBytes });
      continue;
    }
    copyFileSync(outputPath, inputPath);
    results.push({ file: inputPath.slice(root.length + 1), status: "optimized", beforeBytes, afterBytes });
  }
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  pngquantVersion,
  candidateCount: candidates.length,
  optimizedCount: results.filter((item) => item.status === "optimized").length,
  preservedCount: results.filter((item) => item.status === "preserved").length,
  results,
}, null, 2));
