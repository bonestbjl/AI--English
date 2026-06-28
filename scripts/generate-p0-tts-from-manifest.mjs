#!/usr/bin/env node

import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredHeaders = [
  "priority",
  "chapterId",
  "sceneIdOrPageId",
  "itemType",
  "audioType",
  "textToSpeak",
  "targetFileName",
  "assetsPath",
  "deployCnPath",
  "currentExists",
  "notes",
];

class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function printHelp() {
  console.log(`Usage: node scripts/generate-p0-tts-from-manifest.mjs [options]

Options:
  --manifest <path>  CSV input path. Default: p0-audio-manifest.csv
  --limit <count>    Generate at most this many missing P0 records. Default: 10
  --all              Generate every selected missing record.
  --all-priorities   Select P0, P1, and P2 records. Default: P0 only.
  --audio-type <type> Select only one audio type: word, sentence, or dialogue.
  --replace-manifest-existing
                      Replace P0 records marked currentExists=true.
  --dry-run          Print the plan and write a report without calling a TTS API.
  --retries <count>  Retry 429 and 5xx provider errors. Default: 3
  --concurrency <n>  Maximum simultaneous provider requests. Default: 1
  --report <path>    JSON report path. Default: tts-generation-report.json
  --help             Show this help.

Supported providers through environment variables:
  TTS_PROVIDER=openai      TTS_API_KEY, TTS_VOICE_ID, TTS_MODEL
  TTS_PROVIDER=elevenlabs  TTS_API_KEY, TTS_VOICE_ID, TTS_MODEL
  TTS_PROVIDER=volcengine  VOLCENGINE_TTS_APP_ID, VOLCENGINE_TTS_TOKEN,
                            VOLCENGINE_TTS_CLUSTER, VOLCENGINE_TTS_VOICE_TYPE
                            or Seed TTS v3 HTTP: VOLCENGINE_API_KEY,
                            VOLCENGINE_RESOURCE_ID, VOLCENGINE_ENDPOINT,
                            VOLCENGINE_SPEAKER, VOLCENGINE_WORD_SPEAKER

The script always uses CSV textToSpeak as the API input. It never uses a
filename, assets path, or displayWord as a substitute for speech text.
`);
}

function parsePositiveInteger(value, option) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative integer.`);
  return parsed;
}

function parseArgs(args) {
  const options = {
    manifest: "p0-audio-manifest.csv",
    limit: 10,
    dryRun: false,
    retries: 3,
    concurrency: 1,
    report: "tts-generation-report.json",
    replaceManifestExisting: false,
    allPriorities: false,
    audioType: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      printHelp();
      process.exit(0);
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--all") {
      options.limit = Infinity;
      continue;
    }
    if (argument === "--replace-manifest-existing") {
      options.replaceManifestExisting = true;
      continue;
    }
    if (argument === "--all-priorities") {
      options.allPriorities = true;
      continue;
    }
    if (["--manifest", "--limit", "--retries", "--concurrency", "--report", "--audio-type"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--manifest") options.manifest = value;
      if (argument === "--report") options.report = value;
      if (argument === "--limit") options.limit = parsePositiveInteger(value, "--limit");
      if (argument === "--retries") options.retries = parsePositiveInteger(value, "--retries");
      if (argument === "--concurrency") options.concurrency = parsePositiveInteger(value, "--concurrency");
      if (argument === "--audio-type") {
        if (!["word", "sentence", "dialogue"].includes(value)) throw new Error("--audio-type must be word, sentence, or dialogue.");
        options.audioType = value;
      }
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

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

async function readManifest(path) {
  const raw = await readFile(resolve(root, path), "utf8");
  const lines = raw.trimEnd().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  if (requiredHeaders.some((header) => !headers.includes(header))) {
    throw new Error("Manifest does not include the required audio fields.");
  }

  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    if (values.length !== headers.length) throw new Error("Malformed CSV: unexpected column count.");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function providerConfig() {
  const provider = process.env.TTS_PROVIDER?.trim().toLowerCase();

  if (provider === "volcengine") {
    const apiKey = process.env.VOLCENGINE_API_KEY?.trim();
    const resourceId = process.env.VOLCENGINE_RESOURCE_ID?.trim();
    const speaker = process.env.VOLCENGINE_SPEAKER?.trim();
    const wordSpeaker = process.env.VOLCENGINE_WORD_SPEAKER?.trim() || speaker;
    const audioFormat = (process.env.VOLCENGINE_AUDIO_FORMAT?.trim() || "mp3").toLowerCase();
    const sampleRate = Number.parseInt(process.env.VOLCENGINE_SAMPLE_RATE?.trim() || "24000", 10);
    const v3Endpoint = process.env.VOLCENGINE_ENDPOINT?.trim();
    const uid = process.env.VOLCENGINE_TTS_UID?.trim() || "real-scene-english";

    if (apiKey || resourceId || speaker || v3Endpoint?.includes("/api/v3/")) {
      if (!apiKey || !resourceId || !speaker || !v3Endpoint) {
        throw new Error("Set VOLCENGINE_API_KEY, VOLCENGINE_RESOURCE_ID, VOLCENGINE_ENDPOINT, and VOLCENGINE_SPEAKER for Seed TTS v3 HTTP.");
      }
      if (audioFormat !== "mp3") throw new Error("VOLCENGINE_AUDIO_FORMAT must be mp3 because this manifest targets .mp3 files.");
      if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error("VOLCENGINE_SAMPLE_RATE must be a positive integer.");

      return {
        provider,
        apiVersion: "v3",
        apiKey,
        resourceId,
        speaker,
        wordSpeaker,
        audioFormat,
        sampleRate,
        endpoint: v3Endpoint,
        uid,
      };
    }

    const appId = process.env.VOLCENGINE_TTS_APP_ID?.trim();
    const token = process.env.VOLCENGINE_TTS_TOKEN?.trim();
    const cluster = process.env.VOLCENGINE_TTS_CLUSTER?.trim();
    const voiceType = process.env.VOLCENGINE_TTS_VOICE_TYPE?.trim();
    const encoding = (process.env.VOLCENGINE_TTS_ENCODING?.trim() || "mp3").toLowerCase();
    const speedRatio = Number.parseFloat(process.env.VOLCENGINE_TTS_SPEED_RATIO?.trim() || "0.9");
    const endpoint = process.env.VOLCENGINE_TTS_ENDPOINT?.trim() || "https://openspeech.bytedance.com/api/v1/tts";

    if (!appId || !token || !cluster || !voiceType) {
      throw new Error("Set VOLCENGINE_TTS_APP_ID, VOLCENGINE_TTS_TOKEN, VOLCENGINE_TTS_CLUSTER, and VOLCENGINE_TTS_VOICE_TYPE before generating audio.");
    }
    if (encoding !== "mp3") throw new Error("VOLCENGINE_TTS_ENCODING must be mp3 because this manifest targets .mp3 files.");
    if (!Number.isFinite(speedRatio) || speedRatio <= 0) throw new Error("VOLCENGINE_TTS_SPEED_RATIO must be a positive number.");

    return { provider, apiVersion: "v1", appId, token, cluster, voiceType, encoding, speedRatio, endpoint, uid };
  }

  const apiKey = process.env.TTS_API_KEY?.trim();
  const voiceId = process.env.TTS_VOICE_ID?.trim();
  const model = process.env.TTS_MODEL?.trim();

  if (!provider || !apiKey || !voiceId || !model) {
    throw new Error("Set TTS_PROVIDER, TTS_API_KEY, TTS_VOICE_ID, and TTS_MODEL before generating audio.");
  }
  if (!["openai", "elevenlabs"].includes(provider)) {
    throw new Error(`Unsupported TTS_PROVIDER: ${provider}. Supported providers: openai, elevenlabs, volcengine.`);
  }

  return { provider, apiKey, voiceId, model };
}

function summarizeProviderError(provider, response, detail, secrets = []) {
  let compactDetail = detail.replace(/\s+/g, " ").slice(0, 500);
  for (const secret of secrets.filter(Boolean)) compactDetail = compactDetail.replaceAll(secret, "[redacted]");
  return new ProviderError(`${provider} TTS failed (${response.status}): ${compactDetail || response.statusText}`, response.status);
}

async function synthesizeOpenAi(text, config) {
  const payload = {
    model: config.model,
    voice: config.voiceId,
    input: text,
    response_format: "mp3",
  };

  if (config.model.includes("gpt-4o-mini-tts")) {
    payload.instructions = "Speak clear, natural American English at a calm learning pace. Avoid dramatic delivery.";
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw summarizeProviderError("OpenAI", response, await response.text(), [config.apiKey]);
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeElevenLabs(text, config) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": config.apiKey,
      },
      body: JSON.stringify({ text, model_id: config.model }),
      signal: AbortSignal.timeout(90_000),
    },
  );
  if (!response.ok) throw summarizeProviderError("ElevenLabs", response, await response.text(), [config.apiKey]);
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeVolcengineV1(text, config) {
  const requestId = randomUUID().replaceAll("-", "");
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer;${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app: {
        appid: config.appId,
        token: config.token,
        cluster: config.cluster,
      },
      user: { uid: config.uid },
      audio: {
        voice_type: config.voiceType,
        encoding: config.encoding,
        speed_ratio: config.speedRatio,
        volume_ratio: 1,
        pitch_ratio: 1,
      },
      request: {
        reqid: requestId,
        text,
        text_type: "plain",
        operation: "query",
        with_frontend: 1,
        frontend_type: "unitTson",
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  const body = await response.text();
  if (!response.ok) throw summarizeProviderError("Volcengine", response, body, [config.token]);

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ProviderError("Volcengine TTS returned an invalid JSON response.");
  }
  if (![0, 3000].includes(payload.code) || !payload.data) {
    const code = payload.code ?? "unknown";
    const message = String(payload.message || "No audio data returned.").replaceAll(config.token, "[redacted]");
    throw new ProviderError(`Volcengine TTS failed (code ${code}): ${message}`, response.status);
  }

  return Buffer.from(payload.data, "base64");
}

async function synthesizeVolcengineV3(text, config, speaker) {
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
      user: { uid: config.uid },
      req_params: {
        text,
        speaker,
        audio_params: {
          format: config.audioFormat,
          sample_rate: config.sampleRate,
        },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) throw summarizeProviderError("Volcengine", response, await response.text(), [config.apiKey]);

  const body = await response.text();
  const audioChunks = [];

  for (const line of body.split(/\r?\n/).filter(Boolean)) {
    const payloadText = line.startsWith("data:") ? line.slice(5).trim() : line;
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      throw new ProviderError("Volcengine TTS returned an invalid streaming JSON response.", response.status);
    }

    if (payload.code === 0 && typeof payload.data === "string" && payload.data) {
      audioChunks.push(Buffer.from(payload.data, "base64"));
      continue;
    }
    if (payload.code === 0 || payload.code === 20_000_000) continue;

    throw new ProviderError(
      `Volcengine TTS failed (code ${payload.code ?? "unknown"}): ${String(payload.message || "No audio data returned.")}`,
      response.status,
    );
  }

  const audio = Buffer.concat(audioChunks);
  const hasMp3Header = audio.subarray(0, 3).toString("ascii") === "ID3" || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0);
  if (audio.byteLength < 512 || !hasMp3Header) {
    throw new ProviderError("Volcengine TTS did not return a valid MP3 audio stream.", response.status);
  }

  return audio;
}

async function synthesizeVolcengine(text, config, record) {
  if (config.apiVersion === "v3") {
    const speaker = record.audioType === "word" ? config.wordSpeaker : config.speaker;
    return synthesizeVolcengineV3(text, config, speaker);
  }
  return synthesizeVolcengineV1(text, config);
}

async function synthesize(text, config, record) {
  if (config.provider === "openai") return synthesizeOpenAi(text, config);
  if (config.provider === "elevenlabs") return synthesizeElevenLabs(text, config);
  return synthesizeVolcengine(text, config, record);
}

function isRetryable(error) {
  return error instanceof TypeError || error.name === "TimeoutError" || error.name === "AbortError" || (error.status === 429 && !error.message.includes("insufficient_quota")) || error.status >= 500;
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function synthesizeWithRetries(record, config, retries) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return { audio: await synthesize(record.textToSpeak, config, record), attempts: attempt + 1 };
    } catch (error) {
      if (attempt === retries || !isRetryable(error)) throw error;
      await wait(750 * 2 ** attempt);
    }
  }
}

async function copyAtomically(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const temporaryDestination = `${destination}.${process.pid}.tmp.mp3`;
  try {
    await copyFile(source, temporaryDestination);
    await rename(temporaryDestination, destination);
  } finally {
    await rm(temporaryDestination, { force: true });
  }
}

async function renderRecord(record, config, retries, { replaceExisting = false } = {}) {
  const assetsPath = resolve(root, record.assetsPath);
  const deployCnPath = resolve(root, record.deployCnPath);
  const sourceExists = await fileExists(assetsPath);
  const deployExists = await fileExists(deployCnPath);

  if (!replaceExisting && sourceExists && deployExists) return { status: "skipped-existing-file", record };
  if (!replaceExisting && sourceExists) {
    await copyAtomically(assetsPath, deployCnPath);
    return { status: "repaired-deploy-copy", record };
  }
  if (!replaceExisting && deployExists) {
    await copyAtomically(deployCnPath, assetsPath);
    return { status: "repaired-assets-copy", record };
  }

  await mkdir(dirname(assetsPath), { recursive: true });
  const temporaryAssetsPath = `${assetsPath}.${process.pid}.tmp.mp3`;
  try {
    const { audio, attempts } = await synthesizeWithRetries(record, config, retries);
    if (audio.byteLength < 512) throw new Error("Provider returned an unexpectedly small MP3 response.");
    await writeFile(temporaryAssetsPath, audio);
    if ((await stat(temporaryAssetsPath)).size < 512) throw new Error("Generated MP3 file is unexpectedly small.");
    await rename(temporaryAssetsPath, assetsPath);
    await copyAtomically(assetsPath, deployCnPath);
    return { status: "generated", record, attempts };
  } catch (error) {
    await rm(temporaryAssetsPath, { force: true });
    return { status: "failed", record, error: error.message };
  }
}

function recordSummary(record) {
  return {
    chapterId: record.chapterId,
    sceneIdOrPageId: record.sceneIdOrPageId,
    itemType: record.itemType,
    audioType: record.audioType,
    textToSpeak: record.textToSpeak,
    assetsPath: record.assetsPath,
    deployCnPath: record.deployCnPath,
  };
}

function reportProviderConfig(config) {
  if (config.provider === "volcengine") {
    if (config.apiVersion === "v3") {
      return {
        provider: config.provider,
        apiVersion: config.apiVersion,
        resourceId: config.resourceId,
        speaker: config.speaker,
        wordSpeaker: config.wordSpeaker,
        audioFormat: config.audioFormat,
        sampleRate: config.sampleRate,
        endpoint: config.endpoint,
        uid: config.uid,
      };
    }
    return {
      provider: config.provider,
      apiVersion: config.apiVersion,
      cluster: config.cluster,
      voiceType: config.voiceType,
      encoding: config.encoding,
      speedRatio: config.speedRatio,
      endpoint: config.endpoint,
      uid: config.uid,
    };
  }
  return { provider: config.provider, model: config.model, voiceId: config.voiceId };
}

async function writeReport(path, report) {
  await writeFile(resolve(root, path), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allRecords = await readManifest(options.manifest);
  const scopedRecords = options.allPriorities ? allRecords : allRecords.filter((record) => record.priority === "P0");
  const typedRecords = options.audioType ? scopedRecords.filter((record) => record.audioType === options.audioType) : scopedRecords;
  const manifestExisting = typedRecords.filter((record) => record.currentExists === "true");
  const selected = typedRecords
    .filter((record) => record.currentExists !== "true" || options.replaceManifestExisting)
    .slice(0, options.limit);

  if (selected.some((record) => !record.textToSpeak.trim())) {
    throw new Error("Manifest contains an empty textToSpeak value in the selected records.");
  }

  if (options.dryRun) {
    const report = {
      mode: "dry-run",
      manifest: options.manifest,
      allPriorities: options.allPriorities,
      audioType: options.audioType,
      provider: null,
      manifestExisting: manifestExisting.length,
      skippedManifestExisting: options.replaceManifestExisting ? 0 : manifestExisting.length,
      selected: selected.map(recordSummary),
      generated: 0,
      failed: [],
    };
    for (const record of selected) {
      console.log(`[dry-run] ${record.audioType} | ${JSON.stringify(record.textToSpeak)} | ${record.assetsPath}`);
    }
    await writeReport(options.report, report);
    console.log(JSON.stringify({ mode: report.mode, selected: selected.length, report: options.report }, null, 2));
    return;
  }

  const config = providerConfig();
  if (options.concurrency < 1) throw new Error("--concurrency must be at least 1.");
  const results = new Array(selected.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= selected.length) return;
      const record = selected[index];
      results[index] = await renderRecord(record, config, options.retries, {
        replaceExisting: options.replaceManifestExisting && record.currentExists === "true",
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, selected.length) }, worker));
  const report = {
    mode: "generate",
    manifest: options.manifest,
    allPriorities: options.allPriorities,
    audioType: options.audioType,
    concurrency: options.concurrency,
    ...reportProviderConfig(config),
    manifestExisting: manifestExisting.length,
    skippedManifestExisting: options.replaceManifestExisting ? 0 : manifestExisting.length,
    replacedManifestExisting: results
      .filter((result) => result.status === "generated" && result.record.currentExists === "true")
      .map(({ record, attempts }) => ({ ...recordSummary(record), attempts })),
    selected: selected.map(recordSummary),
    generated: results.filter((result) => result.status === "generated").map(({ record, attempts }) => ({ ...recordSummary(record), attempts })),
    repaired: results.filter((result) => result.status.startsWith("repaired-")).map(({ record, status }) => ({ ...recordSummary(record), status })),
    skippedExistingFile: results.filter((result) => result.status === "skipped-existing-file").map(({ record }) => recordSummary(record)),
    failed: results.filter((result) => result.status === "failed").map(({ record, error }) => ({ ...recordSummary(record), error })),
  };
  await writeReport(options.report, report);
  console.log(JSON.stringify({
    mode: report.mode,
    provider: report.provider,
    selected: selected.length,
    generated: report.generated.length,
    repaired: report.repaired.length,
    skippedExistingFile: report.skippedExistingFile.length,
    replacedManifestExisting: report.replacedManifestExisting.length,
    failed: report.failed.length,
    report: options.report,
  }, null, 2));
  if (report.failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`P0 TTS generation failed: ${error.message}`);
  process.exit(1);
});
