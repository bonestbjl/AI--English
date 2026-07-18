#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { buildManifest, root, writeManifestArtifacts, writeRuntimeAudioMaps } from "./lib/mobile-audio-pipeline.mjs";

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { values.push(value); value = ""; }
    else value += character;
  }
  if (quoted) throw new Error("Malformed CSV: unmatched quote.");
  values.push(value);
  return values;
}

function readRows(path) {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const required = ["index", "key", "text", "expectedFile", "deployCnFile", "targetExportName"];
  if (required.some((header) => !headers.includes(header))) throw new Error("Jianying manifest is missing required columns.");
  return lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])));
}

function validateRows(rows, manifest) {
  const byKey = new Map(manifest.assets.map((asset) => [asset.key, asset]));
  const seenKeys = new Set();
  const seenTargets = new Set();
  for (const [index, row] of rows.entries()) {
    const expectedIndex = String(index + 1).padStart(4, "0");
    if (row.index !== expectedIndex || row.targetExportName !== `${expectedIndex}.mp3`) {
      throw new Error(`Jianying manifest index/export name mismatch at row ${index + 1}.`);
    }
    const asset = byKey.get(row.key);
    if (!asset) throw new Error(`Jianying key no longer exists in project data: ${row.key}`);
    if (seenKeys.has(row.key) || seenTargets.has(row.expectedFile)) throw new Error(`Duplicate Jianying target at row ${index + 1}.`);
    seenKeys.add(row.key);
    seenTargets.add(row.expectedFile);
    if (row.text !== asset.originalText || row.expectedFile !== asset.expectedFile || row.deployCnFile !== asset.deployCnFile) {
      throw new Error(`Jianying manifest is stale or edited at row ${index + 1}; regenerate it before importing.`);
    }
    if (!row.expectedFile.startsWith("assets/audio/generated/") || row.deployCnFile !== `deploy-cn/${row.expectedFile}`) {
      throw new Error(`Unsafe Jianying output path at row ${index + 1}.`);
    }
    if (asset.existing || asset.mirrorState !== "missing") {
      throw new Error(`Jianying target is no longer missing at row ${index + 1}; regenerate the import manifest.`);
    }
  }
  return byKey;
}

function parseTimecode(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid SRT timecode: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function readSrt(path, rows) {
  const blocks = readFileSync(path, "utf8").trim().split(/\r?\n\s*\r?\n/);
  if (blocks.length !== rows.length) throw new Error(`SRT has ${blocks.length} entries; expected ${rows.length}.`);
  return blocks.map((block, index) => {
    const [number, timing, ...textLines] = block.split(/\r?\n/);
    const match = /^(.*?)\s+-->\s+(.*?)$/.exec(timing || "");
    if (!match) throw new Error(`Invalid SRT timing at entry ${index + 1}.`);
    const text = textLines.join(" ").trim().replace(/^\[\d+\]\s*/, "");
    if (number !== String(index + 1) || text !== rows[index].text) throw new Error(`SRT text/order mismatch at entry ${index + 1}.`);
    const start = parseTimecode(match[1]);
    const end = parseTimecode(match[2]);
    if (end <= start) throw new Error(`Invalid SRT duration at entry ${index + 1}.`);
    return { start, end };
  });
}

function parseArgs(args) {
  const options = { manifest: "audio-workbench/jianying/jianying-audio-manifest.csv", inputDir: null, audio: null, srt: null, dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") { options.dryRun = true; continue; }
    if (["--manifest", "--input-dir", "--audio", "--srt"].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--manifest") options.manifest = value;
      if (argument === "--input-dir") options.inputDir = value;
      if (argument === "--audio") options.audio = value;
      if (argument === "--srt") options.srt = value;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  const combinedExport = Boolean(options.audio || options.srt);
  if (Boolean(options.inputDir) === combinedExport) throw new Error("Use either --input-dir, or both --audio and --srt.");
  if (combinedExport && (!options.audio || !options.srt)) throw new Error("--audio and --srt must be provided together.");
  return options;
}

function ensureFfmpeg() {
  if (spawnSync("/usr/bin/env", ["which", "ffmpeg"], { encoding: "utf8" }).status !== 0) {
    throw new Error("ffmpeg is required to import, trim, normalize, and encode Jianying audio.");
  }
}

function transcode(input, row, timing = null) {
  const output = resolve(root, row.expectedFile);
  const deploy = resolve(root, row.deployCnFile);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(deploy), { recursive: true });
  const temporary = `${output}.${process.pid}.jianying.mp3`;
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (timing) args.push("-ss", timing.start.toFixed(3), "-to", timing.end.toFixed(3));
  args.push(
    "-i", input,
    "-af", "silenceremove=start_periods=1:start_duration=0.03:start_threshold=-50dB:start_silence=0.06:stop_periods=-1:stop_duration=0.08:stop_threshold=-50dB:stop_silence=0.10,loudnorm=I=-18:TP=-2:LRA=7",
    "-ar", "24000", "-ac", "1", "-b:a", "64k", temporary,
  );
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0 || !existsSync(temporary)) {
    rmSync(temporary, { force: true });
    throw new Error(`ffmpeg failed for row ${row.index}: ${(result.stderr || "unknown error").trim()}`);
  }
  renameSync(temporary, output);
  copyFileSync(output, deploy);
}

try {
  const options = parseArgs(process.argv.slice(2));
  const rows = readRows(resolve(root, options.manifest));
  const manifest = buildManifest();
  const byKey = validateRows(rows, manifest);
  const timings = options.audio ? readSrt(resolve(root, options.srt), rows) : null;
  const inputs = rows.map((row) => options.inputDir ? resolve(root, options.inputDir, row.targetExportName) : resolve(root, options.audio));
  const missingInputs = options.inputDir ? inputs.filter((path) => !existsSync(path)) : inputs.filter((path, index) => index === 0 && !existsSync(path));
  if (missingInputs.length) throw new Error(`Missing Jianying export: ${missingInputs[0]}`);
  console.log(JSON.stringify({ mode: options.dryRun ? "dry-run" : "import", rows: rows.length, source: options.inputDir ? "numbered-files" : "single-audio-plus-srt" }, null, 2));
  if (!options.dryRun) {
    ensureFfmpeg();
    rows.forEach((row, index) => transcode(inputs[index], row, timings?.[index]));
    const importedAt = new Date().toISOString();
    for (const row of rows) {
      const asset = byKey.get(row.key);
      if (!asset) throw new Error(`Imported key no longer exists in project data: ${row.key}`);
      asset.existing = true;
      asset.status = "ready";
      asset.sourceProvider = "jianying-import";
      asset.generatedAt = importedAt;
      asset.processedAt = importedAt;
    }
    writeManifestArtifacts(manifest);
    const refreshedManifest = buildManifest();
    writeManifestArtifacts(refreshedManifest);
    writeRuntimeAudioMaps(refreshedManifest);
  }
} catch (error) {
  console.error(`Jianying import failed: ${error.message}`);
  process.exit(1);
}
