#!/usr/bin/env node

import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(root, "capcut-fruit-shop-words-full.mp3");
const srtPath = resolve(root, "capcut-fruit-shop-words.srt");
const mapPath = resolve(root, "capcut-words-fruit-shop-map.csv");
const temporaryDirectory = `/tmp/capcut-fruit-shop-word-slices-${process.pid}`;

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

function readMap() {
  const lines = readFileSync(mapPath, "utf8").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])));
  const expectedPaths = new Set();
  for (const [index, row] of rows.entries()) {
    const expectedIndex = String(index + 1).padStart(3, "0");
    if (row.index !== expectedIndex || row.chapterId !== "fruitShop" || !row.textToSpeak) throw new Error(`Invalid map row ${index + 1}.`);
    if (!row.assetsPath.startsWith("assets/audio/words/fruitShop/") || !row.deployCnPath.startsWith("deploy-cn/assets/audio/words/fruitShop/")) {
      throw new Error(`Map row ${row.index} is outside the Fruit Shop word audio allowlist.`);
    }
    if (expectedPaths.has(row.assetsPath)) throw new Error(`Duplicate target path: ${row.assetsPath}`);
    expectedPaths.add(row.assetsPath);
  }
  return rows;
}

function parseTimecode(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid SRT timecode: ${value}`);
  return Number(match[1]) * 3600000 + Number(match[2]) * 60000 + Number(match[3]) * 1000 + Number(match[4]);
}

function readSrt(rows) {
  const blocks = readFileSync(srtPath, "utf8").trim().split(/\r?\n\s*\r?\n/);
  const entries = blocks.map((block) => {
    const [index, timing, ...textLines] = block.split(/\r?\n/);
    const match = /^(.*?)\s+-->\s+(.*?)$/.exec(timing ?? "");
    if (!match) throw new Error(`Invalid SRT timing line: ${timing}`);
    return { index, startMs: parseTimecode(match[1]), endMs: parseTimecode(match[2]), text: textLines.join(" ").trim() };
  });
  if (entries.length !== rows.length) throw new Error(`SRT count mismatch: found ${entries.length}, expected ${rows.length}. No target files were changed.`);
  for (const [index, entry] of entries.entries()) {
    if (entry.index !== String(index + 1) || entry.text !== rows[index].textToSpeak || entry.endMs <= entry.startMs) {
      throw new Error(`SRT row ${index + 1} does not match the CSV. No target files were changed.`);
    }
  }
  return entries;
}

function readMp3Frames(input) {
  let offset = 0;
  if (input.subarray(0, 3).toString("ascii") === "ID3") {
    const size = ((input[6] & 0x7f) << 21) | ((input[7] & 0x7f) << 14) | ((input[8] & 0x7f) << 7) | (input[9] & 0x7f);
    offset = 10 + size + ((input[5] & 0x10) ? 10 : 0);
  }
  const id3 = input.subarray(0, offset);
  const bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const sampleRates = [44100, 48000, 32000];
  const frames = [];
  let sampleRate = null;
  while (offset + 4 <= input.length) {
    if (input[offset] !== 0xff || (input[offset + 1] & 0xe0) !== 0xe0) throw new Error(`Invalid MP3 frame sync at byte ${offset}.`);
    const version = (input[offset + 1] >> 3) & 3;
    const layer = (input[offset + 1] >> 1) & 3;
    const bitrateIndex = (input[offset + 2] >> 4) & 15;
    const sampleRateIndex = (input[offset + 2] >> 2) & 3;
    const padding = (input[offset + 2] >> 1) & 1;
    const frameSampleRate = sampleRates[sampleRateIndex];
    if (version !== 3 || layer !== 1 || !bitrateTable[bitrateIndex] || !frameSampleRate) throw new Error(`Unsupported MP3 frame at byte ${offset}.`);
    if (sampleRate && sampleRate !== frameSampleRate) throw new Error("MP3 sample rate changes between frames.");
    sampleRate = frameSampleRate;
    const length = Math.floor((144 * bitrateTable[bitrateIndex] * 1000) / frameSampleRate) + padding;
    if (offset + length > input.length) throw new Error("Truncated MP3 frame.");
    frames.push({ offset, length });
    offset += length;
  }
  if (offset !== input.length) throw new Error("Unexpected trailing MP3 bytes.");
  return { id3, frames, sampleRate, samplesPerFrame: 1152 };
}

function buildTemporarySegments(entries) {
  const input = readFileSync(inputPath);
  const { id3, frames, sampleRate, samplesPerFrame } = readMp3Frames(input);
  const durationMs = frames.length * samplesPerFrame / sampleRate * 1000;
  if (entries.at(-1).endMs > durationMs) throw new Error(`SRT ends at ${entries.at(-1).endMs}ms but audio duration is only ${Math.floor(durationMs)}ms. No target files were changed.`);
  mkdirSync(temporaryDirectory, { recursive: true });
  const outputPaths = [];
  for (const [index, entry] of entries.entries()) {
    const first = Math.max(0, Math.floor(entry.startMs / 1000 * sampleRate / samplesPerFrame));
    const last = Math.min(frames.length, Math.ceil(entry.endMs / 1000 * sampleRate / samplesPerFrame));
    if (last <= first) throw new Error(`Empty SRT segment at index ${index + 1}.`);
    const output = resolve(temporaryDirectory, `${String(index + 1).padStart(3, "0")}.mp3`);
    writeFileSync(output, Buffer.concat([id3, ...frames.slice(first, last).map((frame) => input.subarray(frame.offset, frame.offset + frame.length))]));
    if (statSync(output).size < 512) throw new Error(`Temporary segment ${index + 1} is unexpectedly small.`);
    outputPaths.push(output);
  }
  return { outputPaths, durationMs };
}

function atomicCopy(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp.mp3`;
  copyFileSync(source, temporary);
  renameSync(temporary, destination);
}

const rows = readMap();
const entries = readSrt(rows);
const { outputPaths, durationMs } = buildTemporarySegments(entries);
for (const [index, row] of rows.entries()) {
  atomicCopy(outputPaths[index], resolve(root, row.assetsPath));
  atomicCopy(outputPaths[index], resolve(root, row.deployCnPath));
}
const mismatchedMirrors = rows.filter((row) => createHash("sha256").update(readFileSync(resolve(root, row.assetsPath))).digest("hex") !== createHash("sha256").update(readFileSync(resolve(root, row.deployCnPath))).digest("hex"));
rmSync(temporaryDirectory, { recursive: true, force: true });
console.log(JSON.stringify({
  expected: rows.length,
  srtEntries: entries.length,
  overwritten: rows.length,
  mirrorMismatches: mismatchedMirrors.length,
  audioDurationMs: Math.round(durationMs),
  firstSegment: entries[0],
  lastSegment: entries.at(-1),
}, null, 2));
if (mismatchedMirrors.length) process.exit(1);
