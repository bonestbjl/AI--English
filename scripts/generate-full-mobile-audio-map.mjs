#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "full-audio-manifest.csv");
const outputs = [
  resolve(root, "assets/audio/full-mobile-audio.js"),
  resolve(root, "deploy-cn/assets/audio/full-mobile-audio.js"),
];

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("Malformed CSV: unmatched quote.");
  values.push(value);
  return values;
}

const lines = readFileSync(manifestPath, "utf8").trim().split(/\r?\n/);
const headers = parseCsvLine(lines[0]);
const required = ["textToSpeak", "assetsPath", "currentExists"];
if (required.some((header) => !headers.includes(header))) throw new Error("Full manifest is missing audio mapping columns.");

const entries = new Map();
for (const line of lines.slice(1)) {
  const values = parseCsvLine(line);
  const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  if (record.currentExists !== "true") continue;
  if (!record.textToSpeak) throw new Error(`Empty audio map text for ${record.assetsPath}.`);
  if (!entries.has(record.textToSpeak)) entries.set(record.textToSpeak, record.assetsPath);
}

const map = Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right, "en")));
const content = `// Generated from full-audio-manifest.csv. Mobile only: desktop never looks up these paths.\nwindow.FullMobileAudioUrls = Object.freeze(${JSON.stringify(map, null, 2)});\n`;
for (const output of outputs) writeFileSync(output, content, "utf8");
console.log(JSON.stringify({ entries: entries.size, outputs: outputs.map((output) => output.replace(`${root}/`, "")) }, null, 2));
