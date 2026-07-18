#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildManifest, filterAssets, root } from "./lib/mobile-audio-pipeline.mjs";

function csv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function srtTime(totalSeconds) {
  const milliseconds = Math.round(totalSeconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

function parseArgs(args) {
  const options = { all: false, themes: [], output: "audio-workbench/jianying", cueSeconds: 8 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--all") { options.all = true; continue; }
    if (argument === "--theme") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--theme requires a value.");
      options.themes.push(value);
      continue;
    }
    if (argument === "--output") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--output requires a value.");
      options.output = value;
      continue;
    }
    if (argument === "--cue-seconds") {
      const value = Number(args[++index]);
      if (!Number.isFinite(value) || value < 2) throw new Error("--cue-seconds must be a number >= 2.");
      options.cueSeconds = value;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  if (options.all === Boolean(options.themes.length)) throw new Error("Choose either --all or one or more --theme values.");
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const manifest = buildManifest();
  const assets = filterAssets(manifest, { themes: options.all ? [] : options.themes, onlyMissing: true })
    .sort((left, right) => left.key.localeCompare(right.key));
  const outputDirectory = resolve(root, options.output);
  mkdirSync(outputDirectory, { recursive: true });
  const headers = ["index", "key", "text", "expectedFile", "deployCnFile", "targetExportName", "themes"];
  const rows = assets.map((asset, index) => ({
    index: String(index + 1).padStart(4, "0"),
    key: asset.key,
    text: asset.originalText,
    expectedFile: asset.expectedFile,
    deployCnFile: asset.deployCnFile,
    targetExportName: `${String(index + 1).padStart(4, "0")}.mp3`,
    themes: [...new Set(asset.usages.map((usage) => usage.themeId))].join("|"),
  }));
  const csvPath = resolve(outputDirectory, "jianying-audio-manifest.csv");
  const textPath = resolve(outputDirectory, "jianying-audio-text.txt");
  const srtPath = resolve(outputDirectory, "jianying-audio-source.srt");
  const exportDirectory = resolve(outputDirectory, "exports");
  mkdirSync(exportDirectory, { recursive: true });
  writeFileSync(csvPath, `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csv(row[header])).join(",")).join("\n")}\n`, "utf8");
  writeFileSync(textPath, `${rows.map((row) => row.text).join("\n\n")}\n`, "utf8");
  writeFileSync(srtPath, `${rows.map((row, index) => {
    const start = index * options.cueSeconds;
    const end = start + options.cueSeconds;
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${row.text}`;
  }).join("\n\n")}\n`, "utf8");
  writeFileSync(resolve(exportDirectory, ".gitkeep"), "", "utf8");
  console.log(JSON.stringify({
    count: rows.length,
    characters: rows.reduce((sum, row) => sum + row.text.length, 0),
    csv: csvPath.replace(`${root}/`, ""),
    text: textPath.replace(`${root}/`, ""),
    srt: srtPath.replace(`${root}/`, ""),
    exportDirectory: exportDirectory.replace(`${root}/`, ""),
    next: "Generate the list once in Jianying/CapCut, export numbered MP3 files or one MP3 plus matching SRT, then run import-jianying-audio.mjs.",
  }, null, 2));
} catch (error) {
  console.error(`Jianying preparation failed: ${error.message}`);
  process.exit(1);
}
