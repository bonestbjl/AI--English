#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildManifest,
  deploySourcePath,
  loadRuntimeAudioMap,
  manifestJsonPath,
  mobileAudioMapPath,
  mobileAudioMapVersion,
  root,
  sourcePath,
} from "./lib/mobile-audio-pipeline.mjs";
import { runRuntimeAudioTests } from "./test-mobile-audio-runtime.mjs";

function parseArgs(args) {
  const options = { allowMissing: false, quick: false, themes: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-missing") { options.allowMissing = true; continue; }
    if (argument === "--quick") { options.quick = true; continue; }
    if (argument === "--theme") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--theme requires a value.");
      options.themes.push(value);
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function readSynchsafe(buffer, offset) {
  return ((buffer[offset] & 0x7f) << 21) | ((buffer[offset + 1] & 0x7f) << 14) | ((buffer[offset + 2] & 0x7f) << 7) | (buffer[offset + 3] & 0x7f);
}

function inspectMp3(path) {
  const input = readFileSync(path);
  let offset = 0;
  if (input.subarray(0, 3).toString("ascii") === "ID3") offset = 10 + readSynchsafe(input, 6) + ((input[5] & 0x10) ? 10 : 0);
  const bitrateTables = {
    mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  };
  const baseSampleRates = [44100, 48000, 32000];
  let frames = 0;
  let duration = 0;
  let sampleRate = null;
  let channels = null;
  let bitrate = null;
  while (offset + 4 <= input.length) {
    if (input[offset] !== 0xff || (input[offset + 1] & 0xe0) !== 0xe0) throw new Error(`Invalid MP3 frame sync at byte ${offset}.`);
    const versionBits = (input[offset + 1] >> 3) & 3;
    const layerBits = (input[offset + 1] >> 1) & 3;
    const bitrateIndex = (input[offset + 2] >> 4) & 15;
    const sampleRateIndex = (input[offset + 2] >> 2) & 3;
    const padding = (input[offset + 2] >> 1) & 1;
    const channelMode = (input[offset + 3] >> 6) & 3;
    if (layerBits !== 1 || sampleRateIndex === 3 || versionBits === 1) throw new Error(`Unsupported MP3 frame at byte ${offset}.`);
    const isMpeg1 = versionBits === 3;
    const divisor = versionBits === 2 ? 2 : versionBits === 0 ? 4 : 1;
    const frameSampleRate = baseSampleRates[sampleRateIndex] / divisor;
    const frameBitrate = bitrateTables[isMpeg1 ? "mpeg1" : "mpeg2"][bitrateIndex];
    if (!frameBitrate) throw new Error(`Invalid bitrate at byte ${offset}.`);
    const samplesPerFrame = isMpeg1 ? 1152 : 576;
    const frameLength = Math.floor(((isMpeg1 ? 144 : 72) * frameBitrate * 1000) / frameSampleRate) + padding;
    if (offset + frameLength > input.length) throw new Error("Truncated MP3 frame.");
    sampleRate ||= frameSampleRate;
    bitrate ||= frameBitrate;
    channels ||= channelMode === 3 ? 1 : 2;
    if (sampleRate !== frameSampleRate) throw new Error("MP3 sample rate changes between frames.");
    duration += samplesPerFrame / frameSampleRate;
    frames += 1;
    offset += frameLength;
  }
  if (!frames || offset !== input.length) throw new Error("MP3 has no complete frames or has trailing bytes.");
  return { duration, frames, sampleRate, channels, bitrateKbps: bitrate };
}

function commandPath(command) {
  const candidates = command === "afconvert" ? ["/usr/bin/afconvert"] : ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
  return candidates.find(existsSync) || null;
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectRun);
    child.on("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(stderr.trim() || `${command} exited ${code}`)));
  });
}

function readWavPcm(path) {
  const buffer = readFileSync(path);
  const dataMarker = buffer.indexOf(Buffer.from("data"));
  if (dataMarker < 0) throw new Error("Decoded WAV has no data chunk.");
  const dataSize = buffer.readUInt32LE(dataMarker + 4);
  const start = dataMarker + 8;
  const end = Math.min(buffer.length, start + dataSize);
  const samples = [];
  for (let offset = start; offset + 1 < end; offset += 2) samples.push(buffer.readInt16LE(offset));
  return samples;
}

function pcmMetrics(samples, sampleRate = 16000) {
  if (!samples.length) throw new Error("Decoded audio has no PCM samples.");
  const threshold = 32768 * 10 ** (-50 / 20);
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) < threshold) first += 1;
  let last = samples.length - 1;
  while (last >= 0 && Math.abs(samples[last]) < threshold) last -= 1;
  let sumSquares = 0;
  let peak = 0;
  let clipped = 0;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    peak = Math.max(peak, absolute);
    if (absolute >= 32760) clipped += 1;
  }
  const rms = Math.sqrt(sumSquares / samples.length) / 32768;
  return {
    leadingSilence: first / sampleRate,
    trailingSilence: (samples.length - 1 - last) / sampleRate,
    rmsDbfs: rms ? 20 * Math.log10(rms) : -Infinity,
    peakDbfs: peak ? 20 * Math.log10(peak / 32768) : -Infinity,
    clippedRatio: clipped / samples.length,
  };
}

async function deepInspect(path, workDirectory, index, decoder) {
  const wav = resolve(workDirectory, `${index}.wav`);
  if (decoder.endsWith("afconvert")) {
    await run(decoder, ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", path, wav]);
  } else {
    await run(decoder, ["-hide_banner", "-loglevel", "error", "-y", "-i", path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  }
  const metrics = pcmMetrics(readWavPcm(wav));
  rmSync(wav, { force: true });
  return metrics;
}

function sourceChecks(issues) {
  const source = readFileSync(sourcePath, "utf8");
  const deploy = readFileSync(deploySourcePath, "utf8");
  if (source !== deploy) issues.push("index.html and deploy-cn/index.html differ.");
  const required = [
    "if (!isMobileAudioPreferred()) return null;",
    "window.FullMobileAudioUrls?.[text] || null",
    "if (!(\"speechSynthesis\" in window)) return;",
    "window.speechSynthesis.cancel();",
    "new SpeechSynthesisUtterance(text)",
    "utterance.lang = \"en-US\"",
    "audio.onerror = fallBackToSpeech;",
    "playPromise.catch(fallBackToSpeech);",
    "stopLearningAudio();",
    "activeLearningAudio = audio;",
    "speechBrowser === \"Safari\" && (name.includes(\"karen\")",
    "\"google us english\"",
  ];
  for (const needle of required) if (!source.includes(needle)) issues.push(`Protected speech behavior marker missing: ${needle}`);
  const mapSource = resolve(root, "assets/audio/full-mobile-audio.js");
  const mapDeploy = resolve(root, "deploy-cn/assets/audio/full-mobile-audio.js");
  if (!existsSync(mapSource) || !existsSync(mapDeploy) || readFileSync(mapSource, "utf8") !== readFileSync(mapDeploy, "utf8")) {
    issues.push("Mobile audio maps are missing or not synchronized.");
  } else {
    const runtimeMap = loadRuntimeAudioMap(mapSource);
    const version = mobileAudioMapVersion(runtimeMap);
    const versionedReference = `const MOBILE_AUDIO_MAP_SCRIPT_URL = "${mobileAudioMapPath}?v=${version}";`;
    const mapVersionMarker = `window.FullMobileAudioMapVersion = ${JSON.stringify(version)};`;
    if (!source.includes(versionedReference) || !deploy.includes(versionedReference)) {
      issues.push("HTML files do not reference the current deferred content-versioned mobile audio map.");
    }
    if (source.includes(`<script src="${mobileAudioMapPath}?v=${version}"></script>`) || deploy.includes(`<script src="${mobileAudioMapPath}?v=${version}"></script>`)) {
      issues.push("Mobile audio map is still parser-blocking.");
    }
    if (!readFileSync(mapSource, "utf8").includes(mapVersionMarker)) {
      issues.push("Mobile audio map version marker does not match its content hash.");
    }
  }
}

function baselineChecks(issues) {
  const path = resolve(root, "mobile-audio-protected-baseline.json");
  if (!existsSync(path)) { issues.push("Protected Zoo/Fruit Shop audio baseline is missing."); return; }
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  for (const file of baseline.files) {
    const absolute = resolve(root, file.path);
    if (!existsSync(absolute)) { issues.push(`Protected audio missing: ${file.path}`); continue; }
    if (statSync(absolute).size !== file.bytes || hash(absolute) !== file.sha256) issues.push(`Protected audio changed: ${file.path}`);
    const deploy = resolve(root, `deploy-cn/${file.path}`);
    if (!existsSync(deploy) || hash(deploy) !== file.sha256) issues.push(`Protected deploy mirror changed: deploy-cn/${file.path}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = buildManifest();
  const loadedManifest = JSON.parse(readFileSync(manifestJsonPath, "utf8"));
  const scope = manifest.assets.filter((asset) => !options.themes.length || asset.usages.some((usage) => options.themes.includes(usage.themeId)));
  const issues = [];
  const warnings = [];
  const metadata = [];
  if (JSON.stringify(manifest.assets.map(({ key, expectedFile, status, mirrorState }) => ({ key, expectedFile, status, mirrorState }))) !== JSON.stringify(loadedManifest.assets.map(({ key, expectedFile, status, mirrorState }) => ({ key, expectedFile, status, mirrorState })))) {
    issues.push("mobile-audio-manifest.json is stale; rebuild it.");
  }
  const missing = scope.filter((asset) => !asset.existing);
  if (missing.length && !options.allowMissing) issues.push(`${missing.length} manifest audio assets are missing.`);
  const hashes = new Map();
  for (const asset of scope.filter((entry) => entry.existing)) {
    const source = resolve(root, asset.expectedFile);
    const deploy = resolve(root, asset.deployCnFile);
    if (!existsSync(source) || !existsSync(deploy)) { issues.push(`Missing mirrored file: ${asset.expectedFile}`); continue; }
    if (statSync(source).size < 512) issues.push(`Audio file is too small: ${asset.expectedFile}`);
    const sourceHash = hash(source);
    if (sourceHash !== hash(deploy)) issues.push(`Deploy mirror mismatch: ${asset.expectedFile}`);
    const duplicate = hashes.get(sourceHash);
    if (duplicate && duplicate !== asset.expectedFile) issues.push(`Duplicate audio bytes: ${duplicate} and ${asset.expectedFile}`);
    hashes.set(sourceHash, asset.expectedFile);
    try {
      const info = inspectMp3(source);
      metadata.push({ key: asset.key, path: asset.expectedFile, ...info });
      if (info.duration <= 0.05) issues.push(`Audio duration is zero/too short: ${asset.expectedFile}`);
      if (info.duration > 90) warnings.push(`Audio is unusually long (${info.duration.toFixed(1)}s): ${asset.expectedFile}`);
    } catch (error) {
      issues.push(`Invalid MP3 ${asset.expectedFile}: ${error.message}`);
    }
  }

  const legacyAllowlistPath = resolve(root, "mobile-audio-legacy-allowlist.json");
  const legacyAllowlist = existsSync(legacyAllowlistPath)
    ? JSON.parse(readFileSync(legacyAllowlistPath, "utf8")).files || []
    : [];
  const expectedPaths = new Set([...manifest.assets.flatMap((asset) => [asset.expectedFile, ...(asset.legacyFiles || [])]), ...legacyAllowlist]);
  const audioFiles = walk(resolve(root, "assets/audio")).map((path) => path.replace(`${root}/`, ""));
  const orphanMp3 = audioFiles.filter((path) => path.endsWith(".mp3") && !expectedPaths.has(path));
  if (orphanMp3.length) issues.push(`${orphanMp3.length} orphan MP3 files are not referenced by the manifest.`);
  const retainedLegacyMp3 = legacyAllowlist.filter((path) => audioFiles.includes(path));
  const missingLegacyMp3 = legacyAllowlist.filter((path) => !audioFiles.includes(path));
  if (missingLegacyMp3.length) issues.push(`${missingLegacyMp3.length} legacy allowlist paths no longer exist; clean the allowlist.`);
  if (retainedLegacyMp3.length) warnings.push(`${retainedLegacyMp3.length} pre-workflow orphan MP3 files are retained by the explicit legacy allowlist.`);
  const legacyM4a = audioFiles.filter((path) => path.endsWith(".m4a"));
  if (legacyM4a.length) warnings.push(`${legacyM4a.length} legacy M4A pilot files are outside the current MP3 runtime map.`);

  const runtimeMap = loadRuntimeAudioMap();
  for (const asset of scope.filter((entry) => entry.existing)) {
    for (const usage of asset.usages.filter((entry) => entry.requiredByUi)) {
      const allowedPaths = new Set([asset.expectedFile, ...(asset.legacyFiles || [])]);
      if (!allowedPaths.has(runtimeMap[usage.originalText])) issues.push(`Runtime map mismatch for ${JSON.stringify(usage.originalText)}.`);
    }
  }
  const usageTexts = new Set(manifest.assets.flatMap((asset) => asset.usages.map((usage) => usage.originalText)));
  const orphanMappings = Object.keys(runtimeMap).filter((text) => !usageTexts.has(text));
  if (orphanMappings.length) issues.push(`${orphanMappings.length} runtime map entries no longer match project speech text.`);
  for (const asset of manifest.assets) {
    if (asset.expectedFile.startsWith("/") || asset.expectedFile.includes("..") || !asset.expectedFile.startsWith("assets/audio/")) {
      issues.push(`Unsafe/non-portable audio path: ${asset.expectedFile}`);
    }
  }

  sourceChecks(issues);
  baselineChecks(issues);
  try {
    await runRuntimeAudioTests();
  } catch (error) {
    issues.push(`Mobile/desktop audio runtime regression: ${error.message}`);
  }

  const deep = [];
  if (!options.quick) {
    const decoder = commandPath("ffmpeg") || commandPath("afconvert");
    if (!decoder) issues.push("No ffmpeg or afconvert decoder is available for silence/loudness validation.");
    else {
      const workDirectory = mkdtempSync(join(tmpdir(), "rse-mobile-audio-validate-"));
      let cursor = 0;
      const ready = scope.filter((asset) => asset.existing);
      async function worker() {
        while (cursor < ready.length) {
          const index = cursor++;
          const asset = ready[index];
          try {
            const metrics = await deepInspect(resolve(root, asset.expectedFile), workDirectory, index, decoder);
            deep[index] = { key: asset.key, path: asset.expectedFile, ...metrics };
            if (metrics.leadingSilence > 1.25 || metrics.trailingSilence > 1.25) issues.push(`Overlong edge silence: ${asset.expectedFile}`);
            if (metrics.rmsDbfs < -45) issues.push(`Audio is effectively silent: ${asset.expectedFile}`);
            if (metrics.clippedRatio > 0.02) issues.push(`Audio has excessive clipping: ${asset.expectedFile}`);
          } catch (error) {
            issues.push(`Could not decode ${asset.expectedFile}: ${error.message}`);
          }
        }
      }
      await Promise.all(Array.from({ length: 4 }, worker));
      rmSync(workDirectory, { recursive: true, force: true });
    }
  }

  const report = {
    ok: issues.length === 0,
    releaseReady: issues.length === 0 && missing.length === 0,
    mode: options.quick ? "quick" : "deep",
    scope: options.themes.length ? options.themes : "all",
    allowMissing: options.allowMissing,
    summary: manifest.summary,
    checkedReady: metadata.length,
    formats: Object.fromEntries([...metadata.reduce((counts, item) => {
      const key = `${item.sampleRate}Hz/${item.channels}ch/${item.bitrateKbps}kbps`;
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map())].sort(([left], [right]) => left.localeCompare(right))),
    missing: missing.length,
    orphanMp3: orphanMp3.length,
    retainedLegacyMp3: retainedLegacyMp3.length,
    legacyM4a: legacyM4a.length,
    issues,
    warnings,
  };
  writeFileSync(resolve(root, "mobile-audio-validation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Mobile audio validation failed: ${error.message}`);
  process.exit(1);
});
