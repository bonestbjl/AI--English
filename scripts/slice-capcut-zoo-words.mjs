#!/usr/bin/env node

import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(root, "capcut-zoo-words-full.mp3");
const mapPath = resolve(root, "capcut-words-zoo-map.csv");
const wavPath = "/tmp/capcut-zoo-words-full.wav";
const temporaryDirectory = `/tmp/capcut-zoo-word-slices-${process.pid}`;
const thresholdDb = -45;
const paddingMs = 50;
const windowMs = 10;
const minGapMs = 200;

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
    if (row.index !== expectedIndex || row.chapterId !== "zoo" || !row.textToSpeak) throw new Error(`Invalid map row ${index + 1}.`);
    if (!row.assetsPath.startsWith("assets/audio/words/zoo/") || !row.deployCnPath.startsWith("deploy-cn/assets/audio/words/zoo/")) {
      throw new Error(`Map row ${row.index} is outside the Zoo word audio allowlist.`);
    }
    if (expectedPaths.has(row.assetsPath)) throw new Error(`Duplicate target path: ${row.assetsPath}`);
    expectedPaths.add(row.assetsPath);
  }
  return rows;
}

function findWavData(buffer) {
  const dataMarker = buffer.indexOf(Buffer.from("data"));
  if (dataMarker < 0) throw new Error("Decoded WAV has no data chunk.");
  const dataOffset = dataMarker + 8;
  const dataSize = buffer.readUInt32LE(dataMarker + 4);
  return { dataOffset, dataSize };
}

function detectSegments() {
  const wav = readFileSync(wavPath);
  const { dataOffset, dataSize } = findWavData(wav);
  const sampleRate = 44100;
  const channels = 2;
  const bytesPerFrame = channels * 2;
  const windowFrames = Math.round(sampleRate * windowMs / 1000);
  const values = [];
  for (let offset = dataOffset; offset < dataOffset + dataSize; offset += windowFrames * bytesPerFrame) {
    const end = Math.min(offset + windowFrames * bytesPerFrame, dataOffset + dataSize);
    let sum = 0;
    let count = 0;
    for (let cursor = offset; cursor + 1 < end; cursor += 2) {
      const sample = wav.readInt16LE(cursor);
      sum += sample * sample;
      count += 1;
    }
    values.push(Math.sqrt(sum / count));
  }

  const threshold = 32768 * Math.pow(10, thresholdDb / 20);
  const active = values.map((value) => value >= threshold);
  const minGapWindows = Math.ceil(minGapMs / windowMs);
  for (let index = 0; index < active.length;) {
    if (active[index]) {
      index += 1;
      continue;
    }
    const gapStart = index;
    while (index < active.length && !active[index]) index += 1;
    if (gapStart > 0 && index < active.length && index - gapStart < minGapWindows) {
      active.fill(true, gapStart, index);
    }
  }

  const segments = [];
  let start = null;
  for (let index = 0; index < active.length; index += 1) {
    if (active[index] && start === null) start = index;
    if (start !== null && (!active[index + 1] || index === active.length - 1)) {
      segments.push({ start: Math.max(0, (start * windowMs - paddingMs) / 1000), end: ((index + 1) * windowMs + paddingMs) / 1000 });
      start = null;
    }
  }
  return segments;
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
  while (offset + 4 <= input.length) {
    if (input[offset] !== 0xff || (input[offset + 1] & 0xe0) !== 0xe0) throw new Error(`Invalid MP3 frame sync at byte ${offset}.`);
    const version = (input[offset + 1] >> 3) & 3;
    const layer = (input[offset + 1] >> 1) & 3;
    const bitrateIndex = (input[offset + 2] >> 4) & 15;
    const sampleRateIndex = (input[offset + 2] >> 2) & 3;
    const padding = (input[offset + 2] >> 1) & 1;
    if (version !== 3 || layer !== 1 || !bitrateTable[bitrateIndex] || sampleRateIndex === 3) throw new Error(`Unsupported MP3 frame at byte ${offset}.`);
    const length = Math.floor((144 * bitrateTable[bitrateIndex] * 1000) / sampleRates[sampleRateIndex]) + padding;
    if (offset + length > input.length) throw new Error("Truncated MP3 frame.");
    frames.push({ offset, length });
    offset += length;
  }
  if (offset !== input.length) throw new Error("Unexpected trailing MP3 bytes.");
  return { id3, frames, sampleRate: 44100, samplesPerFrame: 1152 };
}

function buildTemporarySegments(rows, segments) {
  if (segments.length !== rows.length) throw new Error(`Segment count mismatch: detected ${segments.length}, expected ${rows.length}. No target files were changed.`);
  const input = readFileSync(inputPath);
  const { id3, frames, sampleRate, samplesPerFrame } = readMp3Frames(input);
  mkdirSync(temporaryDirectory, { recursive: true });
  const outputPaths = [];
  for (const [index, segment] of segments.entries()) {
    const first = Math.max(0, Math.floor(segment.start * sampleRate / samplesPerFrame));
    const last = Math.min(frames.length, Math.ceil(segment.end * sampleRate / samplesPerFrame));
    if (last <= first) throw new Error(`Empty segment at index ${index + 1}.`);
    const output = resolve(temporaryDirectory, `${String(index + 1).padStart(3, "0")}.mp3`);
    const chunks = [id3, ...frames.slice(first, last).map((frame) => input.subarray(frame.offset, frame.offset + frame.length))];
    writeFileSync(output, Buffer.concat(chunks));
    if (statSync(output).size < 512) throw new Error(`Temporary segment ${index + 1} is unexpectedly small.`);
    outputPaths.push(output);
  }
  return outputPaths;
}

function atomicCopy(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp.mp3`;
  copyFileSync(source, temporary);
  renameSync(temporary, destination);
}

const rows = readMap();
const segments = detectSegments();
const temporarySegments = buildTemporarySegments(rows, segments);
for (const [index, row] of rows.entries()) {
  atomicCopy(temporarySegments[index], resolve(root, row.assetsPath));
  atomicCopy(temporarySegments[index], resolve(root, row.deployCnPath));
}
const mismatchedMirrors = rows.filter((row) => createHash("sha256").update(readFileSync(resolve(root, row.assetsPath))).digest("hex") !== createHash("sha256").update(readFileSync(resolve(root, row.deployCnPath))).digest("hex"));
rmSync(temporaryDirectory, { recursive: true, force: true });
console.log(JSON.stringify({
  expected: rows.length,
  detected: segments.length,
  overwritten: rows.length,
  thresholdDb,
  minGapMs,
  paddingMs,
  mirrorMismatches: mismatchedMirrors.length,
  firstSegment: segments[0],
  lastSegment: segments.at(-1),
}, null, 2));
if (mismatchedMirrors.length) process.exit(1);
