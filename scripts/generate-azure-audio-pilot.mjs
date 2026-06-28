#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePage = join(root, "index.html");
const deployPage = join(root, "deploy-cn", "index.html");
const voice = "en-US-JennyNeural";
const outputFormat = "audio-24khz-48kbitrate-mono-mp3";
const rate = "-8%";

const pilots = [
  {
    sceneId: "entrance",
    hotspotId: "gate",
    slug: "zoo-gate",
    word: "zoo gate",
  },
  {
    sceneId: "monkey",
    hotspotId: "monkey",
    slug: "monkey",
    word: "monkey",
  },
  {
    sceneId: "elephant",
    hotspotId: "elephant",
    slug: "elephant",
    word: "elephant",
  },
];

const key = process.env.AZURE_SPEECH_KEY?.trim();
const region = process.env.AZURE_SPEECH_REGION?.trim().toLowerCase();

if (!key || !region) {
  console.error(
    "Missing Azure Speech credentials. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, then run this script again.",
  );
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(region)) {
  console.error("AZURE_SPEECH_REGION must be a simple Azure region name, such as eastus.");
  process.exit(1);
}

function escapeXml(value) {
  return value.replace(/[&<>\"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character];
  });
}

function extractExample(page, sceneId, hotspotId) {
  const scenesStart = page.indexOf("const scenes = [");
  const sceneStart = page.indexOf(`id: \"${sceneId}\"`, scenesStart);
  const nextScene = page.indexOf("\n        {\n          id:", sceneStart + 1);

  if (scenesStart === -1 || sceneStart === -1 || nextScene === -1) {
    throw new Error(`Could not find scene ${sceneId} in index.html.`);
  }

  const scene = page.slice(sceneStart, nextScene);
  const hotspotsStart = scene.indexOf("hotspots: [");
  const hotspotStart = scene.indexOf(`id: \"${hotspotId}\"`, hotspotsStart);
  const nextHotspot = scene.indexOf("\n            {", hotspotStart + 1);

  if (hotspotsStart === -1 || hotspotStart === -1 || nextHotspot === -1) {
    throw new Error(`Could not find hotspot ${sceneId}:${hotspotId} in index.html.`);
  }

  const hotspot = scene.slice(hotspotStart, nextHotspot);
  const match = hotspot.match(/example:\s*\"((?:\\.|[^\"])*)\"/);
  if (!match) {
    throw new Error(`Could not find the example sentence for ${sceneId}:${hotspotId}.`);
  }

  return JSON.parse(`\"${match[1]}\"`);
}

function createSsml(text) {
  return [
    '<speak version="1.0" xml:lang="en-US" xmlns="http://www.w3.org/2001/10/synthesis">',
    `<voice name="${voice}"><prosody rate="${rate}">${escapeXml(text)}</prosody></voice>`,
    "</speak>",
  ].join("");
}

function convertMp3ToM4a(source, destination) {
  try {
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-q", "127", source, destination], {
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(
      `afconvert failed while creating ${destination}. This pilot requires macOS afconvert to preserve the existing M4A paths. ${error.message}`,
    );
  }
}

async function synthesize(text, temporaryDirectory, filename) {
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/ssml+xml",
      "Ocp-Apim-Subscription-Key": key,
      "X-Microsoft-OutputFormat": outputFormat,
      "User-Agent": "real-scene-english-audio-pilot/1.0",
    },
    body: createSsml(text),
  });

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 400);
    throw new Error(`Azure synthesis failed (${response.status}): ${detail || response.statusText}`);
  }

  const mp3Path = join(temporaryDirectory, `${filename}.mp3`);
  const m4aPath = join(temporaryDirectory, `${filename}.m4a`);
  const audio = Buffer.from(await response.arrayBuffer());

  if (audio.byteLength < 1024) {
    throw new Error(`Azure returned an unexpectedly small audio response for ${filename}.`);
  }

  await writeFile(mp3Path, audio);
  convertMp3ToM4a(mp3Path, m4aPath);

  if ((await stat(m4aPath)).size < 1024) {
    throw new Error(`M4A conversion produced an unexpectedly small file for ${filename}.`);
  }

  return m4aPath;
}

async function stageReplacement(source, destination) {
  const stagedPath = `${destination}.azure-pilot-${process.pid}`;
  await writeFile(stagedPath, await readFile(source));
  return stagedPath;
}

async function main() {
  const [page, deployedPage] = await Promise.all([readFile(sourcePage, "utf8"), readFile(deployPage, "utf8")]);
  if (page !== deployedPage) {
    throw new Error("index.html and deploy-cn/index.html are not synchronized. Sync them before generating pilot audio.");
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "real-scene-azure-audio-"));
  const stagedFiles = [];

  try {
    for (const pilot of pilots) {
      const sentence = extractExample(page, pilot.sceneId, pilot.hotspotId);
      const wordAudio = await synthesize(pilot.word, temporaryDirectory, `word-${pilot.slug}`);
      const sentenceAudio = await synthesize(sentence, temporaryDirectory, `sentence-${pilot.slug}`);

      const destinations = [
        join(root, "assets", "audio", "words", "zoo", `${pilot.slug}.m4a`),
        join(root, "assets", "audio", "sentences", "zoo", `${pilot.slug}.m4a`),
        join(root, "deploy-cn", "assets", "audio", "words", "zoo", `${pilot.slug}.m4a`),
        join(root, "deploy-cn", "assets", "audio", "sentences", "zoo", `${pilot.slug}.m4a`),
      ];

      stagedFiles.push(
        [wordAudio, destinations[0]],
        [sentenceAudio, destinations[1]],
        [wordAudio, destinations[2]],
        [sentenceAudio, destinations[3]],
      );
      console.log(`Generated ${pilot.slug}: \"${pilot.word}\" and its source example.`);
    }

    const replacements = await Promise.all(stagedFiles.map(([source, destination]) => stageReplacement(source, destination)));
    await Promise.all(replacements.map((stagedPath, index) => rename(stagedPath, stagedFiles[index][1])));
    console.log(`Generated and synchronized ${stagedFiles.length} Azure ${voice} pilot files.`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Azure audio pilot generation failed: ${error.message}`);
  process.exit(1);
});
