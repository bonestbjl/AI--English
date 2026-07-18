#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { root } from "./lib/mobile-audio-pipeline.mjs";

if (!process.argv.includes("--confirm-reset")) {
  console.error("Refusing to overwrite the protected audio baseline without --confirm-reset.");
  process.exit(1);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const protectedFiles = walk(resolve(root, "assets/audio"))
  .filter((path) => /\/(?:words|sentences|dialogues)\/(?:zoo|fruitShop)\//.test(path))
  .filter((path) => /\.(?:mp3|m4a)$/i.test(path))
  .sort();
const baseline = {
  schemaVersion: 1,
  purpose: "Protect the approved Zoo and Fruit Shop mobile audio from accidental deletion, regeneration, or degradation.",
  files: protectedFiles.map((path) => ({
    path: path.replace(`${root}/`, ""),
    bytes: statSync(path).size,
    sha256: sha256(path),
  })),
};
const output = resolve(root, "mobile-audio-protected-baseline.json");
writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: output.replace(`${root}/`, ""), files: baseline.files.length }, null, 2));
