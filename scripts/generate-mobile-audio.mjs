#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  AUDIO_PROFILE,
  buildManifest,
  filterAssets,
  root,
  summarizeAssets,
  writeManifestArtifacts,
  writeRuntimeAudioMaps,
} from "./lib/mobile-audio-pipeline.mjs";

function help() {
  console.log(`Usage: node scripts/generate-mobile-audio.mjs [scope] [options]

Scope (one required):
  --all                       Scan every theme.
  --theme <themeId>           Limit to one theme; may be repeated.

Options:
  --provider <name>           existing, doubao, or jianying-import. Default: existing.
  --dry-run                   Report work without generating or copying audio.
  --only-missing              Skip ready assets.
  --include-optional          Include currently non-spoken action feedback.
  --concurrency <n>           Provider requests in flight. Default: 1.
  --retries <n>               Retry transient provider errors. Default: 3.
  --max-api-calls <n>         Hard cap including retry attempts. Default: 500.
  --max-characters <n>        Hard cap for unique input characters. Default: 20000.
  --confirm-paid-api          Required for an actual Doubao request.
  --help                      Show this help.

Doubao environment variables:
  VOLCENGINE_API_KEY
  VOLCENGINE_RESOURCE_ID
  VOLCENGINE_ENDPOINT
  VOLCENGINE_SPEAKER
  VOLCENGINE_VOICE_PROFILE   Must match the versioned manifest voice profile.
  VOLCENGINE_WORD_SPEAKER     Optional word voice; defaults to VOLCENGINE_SPEAKER.
  VOLCENGINE_SAMPLE_RATE      Optional; defaults to 24000.

No API key is accepted on the command line or written to a report.`);
}

function integer(value, option, minimum = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${option} must be an integer >= ${minimum}.`);
  return parsed;
}

function parseArgs(args) {
  const options = {
    all: false,
    themes: [],
    provider: "existing",
    dryRun: false,
    onlyMissing: false,
    includeOptional: false,
    concurrency: 1,
    retries: 3,
    maxApiCalls: 500,
    maxCharacters: 20_000,
    confirmPaidApi: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") { help(); process.exit(0); }
    if (argument === "--all") { options.all = true; continue; }
    if (argument === "--dry-run") { options.dryRun = true; continue; }
    if (argument === "--only-missing") { options.onlyMissing = true; continue; }
    if (argument === "--include-optional") { options.includeOptional = true; continue; }
    if (argument === "--confirm-paid-api") { options.confirmPaidApi = true; continue; }
    if (["--theme", "--provider", "--concurrency", "--retries", "--max-api-calls", "--max-characters"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--theme") options.themes.push(value);
      if (argument === "--provider") options.provider = value;
      if (argument === "--concurrency") options.concurrency = integer(value, argument, 1);
      if (argument === "--retries") options.retries = integer(value, argument, 0);
      if (argument === "--max-api-calls") options.maxApiCalls = integer(value, argument, 1);
      if (argument === "--max-characters") options.maxCharacters = integer(value, argument, 1);
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  if (options.all === Boolean(options.themes.length)) throw new Error("Choose either --all or one or more --theme values.");
  if (!["existing", "doubao", "jianying-import"].includes(options.provider)) {
    throw new Error("--provider must be existing, doubao, or jianying-import.");
  }
  return options;
}

function redact(value, secrets) {
  let result = String(value || "").replace(/\s+/g, " ").slice(0, 400);
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(secret, "[redacted]");
  return result;
}

function doubaoConfig() {
  const config = {
    apiKey: process.env.VOLCENGINE_API_KEY?.trim(),
    resourceId: process.env.VOLCENGINE_RESOURCE_ID?.trim(),
    endpoint: process.env.VOLCENGINE_ENDPOINT?.trim(),
    speaker: process.env.VOLCENGINE_SPEAKER?.trim(),
    voiceProfile: process.env.VOLCENGINE_VOICE_PROFILE?.trim(),
    wordSpeaker: process.env.VOLCENGINE_WORD_SPEAKER?.trim() || process.env.VOLCENGINE_SPEAKER?.trim(),
    sampleRate: integer(process.env.VOLCENGINE_SAMPLE_RATE?.trim() || "24000", "VOLCENGINE_SAMPLE_RATE", 1),
  };
  if (!config.apiKey || !config.resourceId || !config.endpoint || !config.speaker || !config.voiceProfile) {
    throw new Error("Doubao requires VOLCENGINE_API_KEY, VOLCENGINE_RESOURCE_ID, VOLCENGINE_ENDPOINT, VOLCENGINE_SPEAKER, and VOLCENGINE_VOICE_PROFILE.");
  }
  if (config.voiceProfile !== AUDIO_PROFILE.voice) throw new Error(`VOLCENGINE_VOICE_PROFILE must match manifest profile ${AUDIO_PROFILE.voice}.`);
  return config;
}

function isWordAsset(asset) {
  return asset.usages.some((usage) => ["hotspotWord", "actionWord", "moreWord"].includes(usage.type));
}

async function synthesizeDoubao(asset, config) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "keep-alive",
      "X-Api-Key": config.apiKey,
      "X-Api-Resource-Id": config.resourceId,
      "X-Api-Request-Id": randomUUID(),
    },
    body: JSON.stringify({
      user: { uid: "real-scene-english-offline-audio" },
      req_params: {
        text: asset.originalText,
        speaker: isWordAsset(asset) ? config.wordSpeaker : config.speaker,
        audio_params: { format: "mp3", sample_rate: config.sampleRate },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Doubao HTTP ${response.status}: ${redact(body, [config.apiKey])}`);
  const chunks = [];
  for (const line of body.split(/\r?\n/).filter(Boolean)) {
    const payloadText = line.startsWith("data:") ? line.slice(5).trim() : line;
    const payload = JSON.parse(payloadText);
    if (payload.code === 0 && payload.data) chunks.push(Buffer.from(payload.data, "base64"));
    else if (![0, 20_000_000].includes(payload.code)) throw new Error(`Doubao code ${payload.code}: ${redact(payload.message, [])}`);
  }
  const audio = Buffer.concat(chunks);
  const mp3 = audio.subarray(0, 3).toString("ascii") === "ID3" || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0);
  if (audio.byteLength < 512 || !mp3) throw new Error("Doubao did not return a valid MP3 stream.");
  return audio;
}

function transient(error) {
  return error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError || /HTTP (429|5\d\d)/.test(error.message);
}

async function withRetries(operation, retries) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return { value: await operation(), attempts: attempt + 1 }; }
    catch (error) {
      if (attempt === retries || !transient(error)) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 750 * 2 ** attempt));
    }
  }
}

async function writeMirroredAudio(asset, audio) {
  const assetsPath = resolve(root, asset.expectedFile);
  const deployPath = resolve(root, asset.deployCnFile);
  await mkdir(dirname(assetsPath), { recursive: true });
  await mkdir(dirname(deployPath), { recursive: true });
  const sourceTemporary = `${assetsPath}.${process.pid}.tmp.mp3`;
  const deployTemporary = `${deployPath}.${process.pid}.tmp.mp3`;
  try {
    await writeFile(sourceTemporary, audio);
    if ((await stat(sourceTemporary)).size < 512) throw new Error("Generated MP3 is unexpectedly small.");
    await copyFile(sourceTemporary, deployTemporary);
    if ((await stat(deployTemporary)).size !== (await stat(sourceTemporary)).size) throw new Error("Generated mirror size mismatch.");
    await rename(sourceTemporary, assetsPath);
    await rename(deployTemporary, deployPath);
  } finally {
    await rm(sourceTemporary, { force: true });
    await rm(deployTemporary, { force: true });
  }
}

async function repairMirror(asset) {
  const assetsPath = resolve(root, asset.expectedFile);
  const deployPath = resolve(root, asset.deployCnFile);
  const source = asset.mirrorState === "assets-only" ? assetsPath : deployPath;
  const target = asset.mirrorState === "assets-only" ? deployPath : assetsPath;
  const label = asset.mirrorState === "assets-only" ? "repaired-deploy" : "repaired-assets";
  if (!["assets-only", "deploy-only"].includes(asset.mirrorState)) return "ready";
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.repair.tmp`;
  try {
    await copyFile(source, temporary);
    if ((await stat(temporary)).size < 512) throw new Error("Mirror repair source is unexpectedly small.");
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return label;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = buildManifest();
  const unknownThemes = options.themes.filter((theme) => !manifest.themes.some((entry) => entry.themeId === theme));
  if (unknownThemes.length) throw new Error(`Unknown theme(s): ${unknownThemes.join(", ")}.`);
  const selected = filterAssets(manifest, {
    themes: options.all ? [] : options.themes,
    onlyMissing: options.onlyMissing,
    includeOptional: options.includeOptional,
  });
  const summary = summarizeAssets(selected);
  const generationCandidates = selected.filter((asset) => !asset.existing && asset.mirrorState === "missing");
  const plannedCalls = options.provider === "doubao" ? generationCandidates.length : 0;
  const plannedCharacters = generationCandidates.reduce((sum, asset) => sum + asset.originalText.length, 0);
  const maximumCalls = plannedCalls * (options.retries + 1);
  console.log(JSON.stringify({ mode: options.dryRun ? "dry-run" : "execute", provider: options.provider, scope: options.all ? "all" : options.themes, ...summary, plannedExternalApiCalls: plannedCalls, plannedCharacters, maximumExternalApiAttempts: maximumCalls, apiCallBudget: options.maxApiCalls, characterBudget: options.maxCharacters }, null, 2));
  if (options.dryRun) return;
  if (options.provider === "jianying-import") {
    throw new Error("Use scripts/prepare-jianying-audio.mjs, export once in Jianying/CapCut, then use scripts/import-jianying-audio.mjs.");
  }
  if (options.provider === "doubao" && !options.confirmPaidApi) {
    throw new Error("Refusing paid API calls without --confirm-paid-api. Run --dry-run first.");
  }
  if (plannedCalls > options.maxApiCalls) throw new Error(`Planned API calls (${plannedCalls}) exceed --max-api-calls ${options.maxApiCalls}.`);
  if (plannedCharacters > options.maxCharacters) throw new Error(`Planned characters (${plannedCharacters}) exceed --max-characters ${options.maxCharacters}.`);
  const config = options.provider === "doubao" && generationCandidates.length ? doubaoConfig() : null;
  const results = new Array(selected.length);
  let actualExternalApiCalls = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const index = cursor;
      cursor += 1;
      const asset = selected[index];
      try {
        if (asset.existing) {
          results[index] = { key: asset.key, status: await repairMirror(asset) };
          continue;
        }
        if (["assets-only", "deploy-only"].includes(asset.mirrorState)) {
          results[index] = { key: asset.key, status: await repairMirror(asset) };
          continue;
        }
        if (asset.mirrorState === "divergent") {
          throw new Error("Source and deploy audio mirrors differ; refusing automatic repair or paid regeneration.");
        }
        if (options.provider === "existing") {
          results[index] = { key: asset.key, status: "missing-no-provider-call" };
          continue;
        }
        const { value, attempts } = await withRetries(() => {
          actualExternalApiCalls += 1;
          if (actualExternalApiCalls > options.maxApiCalls) throw new Error("External API call budget exhausted.");
          return synthesizeDoubao(asset, config);
        }, options.retries);
        await writeMirroredAudio(asset, value);
        asset.existing = true;
        asset.status = "ready";
        asset.sourceProvider = "doubao";
        asset.providerVoice = isWordAsset(asset) ? config.wordSpeaker : config.speaker;
        asset.generatedAt = new Date().toISOString();
        results[index] = { key: asset.key, status: "generated", attempts };
      } catch (error) {
        results[index] = { key: asset.key, status: "failed", error: redact(error.message, [config?.apiKey]) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, selected.length || 1) }, worker));
  writeManifestArtifacts(manifest);
  const refreshedManifest = buildManifest();
  writeManifestArtifacts(refreshedManifest);
  writeRuntimeAudioMaps(refreshedManifest);
  const failed = results.filter((result) => result?.status === "failed");
  console.log(JSON.stringify({ generated: results.filter((result) => result?.status === "generated").length, repaired: results.filter((result) => result?.status.startsWith("repaired")).length, actualExternalApiCalls, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Mobile audio generation failed: ${error.message}`);
  process.exit(1);
});
