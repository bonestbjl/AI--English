#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import {
  buildManifest,
  filterAssets,
  root,
  writeManifestArtifacts,
} from "./lib/mobile-audio-pipeline.mjs";

function parseArgs(args) {
  const options = { all: false, themes: [], dryRun: false, forceExisting: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--all") { options.all = true; continue; }
    if (argument === "--dry-run") { options.dryRun = true; continue; }
    if (argument === "--force-existing") { options.forceExisting = true; continue; }
    if (argument === "--theme") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--theme requires a value.");
      options.themes.push(value);
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  if (options.all === Boolean(options.themes.length)) throw new Error("Choose either --all or one or more --theme values.");
  return options;
}

function commandExists(command) {
  return spawnSync("/usr/bin/env", ["which", command], { encoding: "utf8" }).status === 0;
}

function processAsset(asset) {
  const source = resolve(root, asset.expectedFile);
  const deploy = resolve(root, asset.deployCnFile);
  const temporary = `${source}.${process.pid}.normalized.mp3`;
  const deployTemporary = `${deploy}.${process.pid}.normalized.mp3`;
  const sourceBackup = `${source}.${process.pid}.backup.mp3`;
  const deployBackup = `${deploy}.${process.pid}.backup.mp3`;
  mkdirSync(dirname(source), { recursive: true });
  const filters = [
    "silenceremove=start_periods=1:start_duration=0.03:start_threshold=-50dB:start_silence=0.06:stop_periods=-1:stop_duration=0.08:stop_threshold=-50dB:stop_silence=0.10",
    "loudnorm=I=-18:TP=-2:LRA=7",
  ].join(",");
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-af", filters, "-ar", "24000", "-ac", "1", "-b:a", "64k", temporary,
  ], { encoding: "utf8" });
  if (result.status !== 0 || !existsSync(temporary)) {
    rmSync(temporary, { force: true });
    throw new Error(`ffmpeg failed for ${asset.expectedFile}: ${(result.stderr || "unknown error").trim()}`);
  }
  mkdirSync(dirname(deploy), { recursive: true });
  copyFileSync(temporary, deployTemporary);
  copyFileSync(source, sourceBackup);
  copyFileSync(deploy, deployBackup);
  try {
    renameSync(temporary, source);
    renameSync(deployTemporary, deploy);
    asset.processedAt = new Date().toISOString();
  } catch (error) {
    copyFileSync(sourceBackup, source);
    copyFileSync(deployBackup, deploy);
    throw error;
  } finally {
    rmSync(temporary, { force: true });
    rmSync(deployTemporary, { force: true });
    rmSync(sourceBackup, { force: true });
    rmSync(deployBackup, { force: true });
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const manifest = buildManifest();
  const scoped = filterAssets(manifest, { themes: options.all ? [] : options.themes })
    .filter((asset) => asset.existing)
    .filter((asset) => options.forceExisting || asset.sourceProvider !== "existing")
    .filter((asset) => options.forceExisting || !asset.processedAt);
  console.log(JSON.stringify({
    mode: options.dryRun ? "dry-run" : "execute",
    selected: scoped.length,
    protectedExistingSkipped: manifest.assets.filter((asset) => asset.sourceProvider === "existing").length,
    output: { sampleRate: 24000, channels: 1, bitrateKbps: 64, integratedLoudnessLufs: -18, truePeakDb: -2 },
  }, null, 2));
  if (!options.dryRun) {
    if (!commandExists("ffmpeg")) throw new Error("ffmpeg is required for post-processing. Install it, or run --dry-run to inspect the plan.");
    for (const asset of scoped) processAsset(asset);
    writeManifestArtifacts(manifest);
    writeManifestArtifacts(buildManifest());
  }
} catch (error) {
  console.error(`Mobile audio post-processing failed: ${error.message}`);
  process.exit(1);
}
