import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const manifestJsonPath = resolve(root, "mobile-audio-manifest.json");
export const manifestCsvPath = resolve(root, "mobile-audio-manifest.csv");
export const sourcePath = resolve(root, "index.html");
export const deploySourcePath = resolve(root, "deploy-cn/index.html");
export const mobileAudioMapPath = "assets/audio/full-mobile-audio.js";

export const AUDIO_PROFILE = Object.freeze({
  language: "en-US",
  voice: "mobile-en-learning-v1",
  rate: 1,
  tone: "clear-neutral-learning",
});
const LEGACY_RUNTIME_PROFILE = "mobile-en-learning-v1";

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function mobileAudioMapVersion(map) {
  return sha256(JSON.stringify(map)).slice(0, 16);
}

export function audioIdentity(text, profile = AUDIO_PROFILE) {
  const normalizedText = normalizeText(text);
  const identity = [normalizedText, profile.voice, profile.language, profile.rate, profile.tone].join("\u0001");
  return { normalizedText, textHash: sha256(normalizedText), key: sha256(identity) };
}

function staticDataNames(source) {
  const matches = [...source.matchAll(/^      const ([A-Za-z0-9_]+)\s*=\s*(?:\[|\{)/gm)].map((match) => match[1]);
  return [...new Set(matches.filter((name) =>
    name === "scenes" ||
    name === "dialogues" ||
    name === "sceneCards" ||
    name.endsWith("Scenes") ||
    name.endsWith("Dialogues") ||
    /^more[A-Za-z0-9]+Pages$/.test(name)
  ))];
}

export function extractProjectAudioData(source = readFileSync(sourcePath, "utf8")) {
  const start = source.indexOf("      const scenes = [");
  const end = source.indexOf("      const sceneSelectCards = [");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not locate the static scene data in index.html.");
  }

  const names = staticDataNames(source.slice(start, end));
  const capture = `\nglobalThis.__mobileAudioData = { ${names.join(", ")} };\n`;
  const context = vm.createContext({ console });
  vm.runInContext(source.slice(start, end) + capture, context, { filename: "index.html:scene-data" });
  const data = context.__mobileAudioData;
  if (!Array.isArray(data.sceneCards)) throw new Error("sceneCards could not be extracted.");
  return data;
}

function pascalCase(value) {
  return String(value).replace(/(^|[-_])([a-z])/g, (_match, _prefix, letter) => letter.toUpperCase());
}

function chapterData(data, chapterId) {
  const scenesName = chapterId === "zoo" ? "scenes" : `${chapterId}Scenes`;
  const dialoguesName = chapterId === "zoo" ? "dialogues" : `${chapterId}Dialogues`;
  const moreName = chapterId === "zoo"
    ? "moreAnimalPages"
    : chapterId === "fruitShop"
      ? "moreFruitPages"
      : `more${pascalCase(chapterId)}Pages`;
  const scenes = data[scenesName];
  const dialogues = data[dialoguesName];
  const morePages = data[moreName] || [];
  if (!Array.isArray(scenes)) throw new Error(`Missing ${scenesName} for ${chapterId}.`);
  if (!dialogues || typeof dialogues !== "object") throw new Error(`Missing ${dialoguesName} for ${chapterId}.`);
  if (!Array.isArray(morePages)) throw new Error(`Invalid ${moreName} for ${chapterId}.`);
  return { scenes, dialogues, morePages, names: { scenesName, dialoguesName, moreName } };
}

function addUsage(usages, { themeId, sceneId, type, key, text, runtimeRates, requiredByUi = true }) {
  if (typeof text !== "string" || !text.trim()) return;
  usages.push({
    themeId,
    sceneId,
    type,
    key,
    originalText: text.trim(),
    runtimeRates: [...new Set(runtimeRates)],
    requiredByUi,
  });
}

export function extractSpeechUsages(data = extractProjectAudioData()) {
  const usages = [];
  const themes = data.sceneCards.filter((card) => card && card.chapter).map((card) => card.chapter);
  const chapterMetadata = {};

  for (const themeId of themes) {
    const { scenes, dialogues, morePages, names } = chapterData(data, themeId);
    chapterMetadata[themeId] = { sceneCount: scenes.length, morePageCount: morePages.length, ...names };

    for (const scene of scenes) {
      addUsage(usages, {
        themeId, sceneId: scene.id, type: "sceneIntro", key: `${scene.id}-intro`,
        text: scene.intro?.text, runtimeRates: [0.9],
      });
      for (const hotspot of scene.hotspots || []) {
        const prefix = hotspot.type === "action" ? "action" : "hotspot";
        addUsage(usages, {
          themeId, sceneId: scene.id, type: `${prefix}Word`, key: `${scene.id}:${hotspot.id}:word`,
          text: hotspot.word, runtimeRates: [0.9, 0.65],
        });
        addUsage(usages, {
          themeId, sceneId: scene.id, type: `${prefix}Sentence`, key: `${scene.id}:${hotspot.id}:sentence`,
          text: hotspot.example, runtimeRates: [0.86],
        });
        addUsage(usages, {
          themeId, sceneId: scene.id, type: "actionFeedback", key: `${scene.id}:${hotspot.id}:action-feedback`,
          text: hotspot.actionMessageEn, runtimeRates: [0.9], requiredByUi: false,
        });
      }

      if (scene.npc && dialogues[scene.npc]) {
        const dialogue = dialogues[scene.npc];
        addUsage(usages, {
          themeId, sceneId: scene.id, type: "npcDialogue", key: `${scene.npc}:line`,
          text: dialogue.text, runtimeRates: [0.9],
        });
        (dialogue.options || []).forEach((option, index) => {
          addUsage(usages, {
            themeId, sceneId: scene.id, type: "dialogueOption", key: `${scene.npc}:option:${index + 1}`,
            text: option.text, runtimeRates: [0.9],
          });
          addUsage(usages, {
            themeId, sceneId: scene.id, type: "dialogueReply", key: `${scene.npc}:reply:${index + 1}`,
            text: option.reply, runtimeRates: [0.86],
          });
        });
      }
    }

    for (const page of morePages) {
      const words = page.words || page.animals || page.fruits || [];
      for (const word of words) {
        addUsage(usages, {
          themeId, sceneId: page.id, type: "moreWord", key: `${page.id}:${word.id}:word`,
          text: word.word, runtimeRates: [0.9, 0.65],
        });
        addUsage(usages, {
          themeId, sceneId: page.id, type: "moreWordSentence", key: `${page.id}:${word.id}:sentence`,
          text: word.example, runtimeRates: [0.86],
        });
      }
    }
  }

  return { themes, chapterMetadata, usages };
}

export function loadRuntimeAudioMap(path = resolve(root, "assets/audio/full-mobile-audio.js")) {
  if (!existsSync(path)) return {};
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  return context.window.FullMobileAudioUrls || {};
}

export function loadPreviousManifest() {
  if (!existsSync(manifestJsonPath)) return null;
  return JSON.parse(readFileSync(manifestJsonPath, "utf8"));
}

function readableAudio(path) {
  if (!path) return null;
  try {
    const absolute = resolve(root, path);
    if (statSync(absolute).size <= 512) return null;
    return { path, absolute, hash: sha256(readFileSync(absolute)) };
  } catch {
    return null;
  }
}

function inspectMirror(assetsPath) {
  const source = readableAudio(assetsPath);
  const deploy = readableAudio(assetsPath ? `deploy-cn/${assetsPath}` : null);
  if (source && deploy) {
    return source.hash === deploy.hash
      ? { state: "ready", contentHash: source.hash }
      : { state: "divergent", contentHash: null };
  }
  if (source) return { state: "assets-only", contentHash: source.hash };
  if (deploy) return { state: "deploy-only", contentHash: deploy.hash };
  return { state: "missing", contentHash: null };
}

function validMirroredFile(assetsPath) {
  return inspectMirror(assetsPath).state === "ready";
}

function hasAudioFile(assetsPath) {
  if (!assetsPath) return false;
  return [assetsPath, `deploy-cn/${assetsPath}`].some((path) => {
    try { return statSync(resolve(root, path)).size > 512; }
    catch { return false; }
  });
}

function generatedPath(key) {
  return `assets/audio/generated/${key.slice(0, 2)}/${key}.mp3`;
}

export function buildManifest() {
  const extracted = extractSpeechUsages();
  const runtimeMap = loadRuntimeAudioMap();
  const previous = loadPreviousManifest();
  const previousByKey = new Map((previous?.assets || []).map((asset) => [asset.key, asset]));
  const assetsByKey = new Map();

  for (const usage of extracted.usages) {
    const identity = audioIdentity(usage.originalText);
    let asset = assetsByKey.get(identity.key);
    if (!asset) {
      const previousAsset = previousByKey.get(identity.key);
      const mappedPath = runtimeMap[usage.originalText];
      const expectedFile = AUDIO_PROFILE.voice === LEGACY_RUNTIME_PROFILE && hasAudioFile(mappedPath)
        ? mappedPath
        : hasAudioFile(previousAsset?.expectedFile)
          ? previousAsset.expectedFile
          : generatedPath(identity.key);
      const mirror = inspectMirror(expectedFile);
      const existing = mirror.state === "ready";
      asset = {
        key: identity.key,
        originalText: usage.originalText,
        normalizedText: identity.normalizedText,
        textHash: identity.textHash,
        voice: AUDIO_PROFILE.voice,
        language: AUDIO_PROFILE.language,
        rate: AUDIO_PROFILE.rate,
        tone: AUDIO_PROFILE.tone,
        expectedFile,
        deployCnFile: `deploy-cn/${expectedFile}`,
        sourceProvider: existing ? (previousAsset?.sourceProvider || "existing") : (previousAsset?.sourceProvider || "pending"),
        providerVoice: previousAsset?.providerVoice || null,
        status: existing ? "ready" : mirror.state === "divergent" ? "mirror-mismatch" : mirror.state === "missing" ? "missing" : "repairable",
        existing,
        mirrorState: mirror.state,
        generatedAt: existing ? (previousAsset?.generatedAt || null) : null,
        processedAt: existing ? (previousAsset?.processedAt || null) : null,
        contentHash: mirror.contentHash,
        legacyFiles: previousAsset?.legacyFiles || [],
        usages: [],
      };
      assetsByKey.set(identity.key, asset);
    }
    const usageRuntimeFile = runtimeMap[usage.originalText];
    if (validMirroredFile(usageRuntimeFile) && usageRuntimeFile !== asset.expectedFile && !asset.legacyFiles.includes(usageRuntimeFile)) {
      asset.legacyFiles.push(usageRuntimeFile);
    }
    asset.usages.push(usage);
  }

  const assets = [...assetsByKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  const themes = extracted.themes.map((themeId) => {
    const themeAssets = assets.filter((asset) => asset.usages.some((usage) => usage.themeId === themeId));
    return {
      themeId,
      usages: extracted.usages.filter((usage) => usage.themeId === themeId).length,
      uniqueAudio: themeAssets.length,
      ready: themeAssets.filter((asset) => asset.existing).length,
      missing: themeAssets.filter((asset) => !asset.existing).length,
      missingCharacters: themeAssets.filter((asset) => !asset.existing).reduce((sum, asset) => sum + asset.originalText.length, 0),
      ...extracted.chapterMetadata[themeId],
    };
  });

  return {
    schemaVersion: 1,
    source: "index.html",
    profile: AUDIO_PROFILE,
    summary: {
      themes: themes.length,
      usages: extracted.usages.length,
      uniqueAudio: assets.length,
      ready: assets.filter((asset) => asset.existing).length,
      missing: assets.filter((asset) => !asset.existing).length,
      missingCharacters: assets.filter((asset) => !asset.existing).reduce((sum, asset) => sum + asset.originalText.length, 0),
    },
    themes,
    assets,
  };
}

function csv(value) {
  if (Array.isArray(value)) value = value.join("|");
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function writeManifestArtifacts(manifest) {
  writeFileSync(manifestJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const headers = [
    "key", "originalText", "normalizedText", "textHash", "voice", "language", "rate", "tone",
    "expectedFile", "deployCnFile", "sourceProvider", "providerVoice", "status", "existing", "mirrorState", "generatedAt", "processedAt",
    "legacyFiles", "themes", "types", "usageCount",
  ];
  const rows = manifest.assets.map((asset) => ({
    ...asset,
    themes: [...new Set(asset.usages.map((usage) => usage.themeId))],
    types: [...new Set(asset.usages.map((usage) => usage.type))],
    usageCount: asset.usages.length,
  }));
  writeFileSync(
    manifestCsvPath,
    `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csv(row[header])).join(",")).join("\n")}\n`,
    "utf8",
  );
}

export function writeRuntimeAudioMaps(manifest) {
  const entries = new Map();
  for (const asset of manifest.assets) {
    if (!asset.existing || asset.status !== "ready") continue;
    for (const usage of asset.usages) {
      const previous = entries.get(usage.originalText);
      if (previous && previous !== asset.expectedFile) {
        throw new Error(`Conflicting audio paths for ${JSON.stringify(usage.originalText)}.`);
      }
      entries.set(usage.originalText, asset.expectedFile);
    }
  }
  const map = Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right, "en")));
  const version = mobileAudioMapVersion(map);
  const content = `// Generated from mobile-audio-manifest.json. Mobile only: desktop never looks up these paths.\nwindow.FullMobileAudioMapVersion = ${JSON.stringify(version)};\nwindow.FullMobileAudioUrls = Object.freeze(${JSON.stringify(map, null, 2)});\n`;
  const outputs = [
    resolve(root, mobileAudioMapPath),
    resolve(root, `deploy-cn/${mobileAudioMapPath}`),
  ];
  const scriptTagPattern = /<script src="assets\/audio\/full-mobile-audio\.js(?:\?v=[a-f0-9]+)?"><\/script>/g;
  const htmlOutputs = [sourcePath, deploySourcePath].map((path) => {
    const source = readFileSync(path, "utf8");
    let replacements = 0;
    const updated = source.replace(scriptTagPattern, () => {
      replacements += 1;
      return `<script src="${mobileAudioMapPath}?v=${version}"></script>`;
    });
    if (replacements !== 1) {
      throw new Error(`Expected one mobile audio map script tag in ${path.replace(`${root}/`, "")}; found ${replacements}.`);
    }
    return { path, updated };
  });
  for (const output of outputs) writeFileSync(output, content, "utf8");
  for (const output of htmlOutputs) writeFileSync(output.path, output.updated, "utf8");
  return {
    entries: entries.size,
    version,
    scriptUrl: `${mobileAudioMapPath}?v=${version}`,
    outputs: outputs.map((output) => output.replace(`${root}/`, "")),
    htmlOutputs: htmlOutputs.map((output) => output.path.replace(`${root}/`, "")),
  };
}

export function filterAssets(manifest, { themes = [], onlyMissing = false, includeOptional = true } = {}) {
  return manifest.assets.filter((asset) => {
    if (onlyMissing && asset.existing) return false;
    if (themes.length && !asset.usages.some((usage) => themes.includes(usage.themeId))) return false;
    if (!includeOptional && !asset.usages.some((usage) => usage.requiredByUi)) return false;
    return true;
  });
}

export function summarizeAssets(assets) {
  return {
    assets: assets.length,
    existing: assets.filter((asset) => asset.existing).length,
    missing: assets.filter((asset) => !asset.existing).length,
    characters: assets.filter((asset) => !asset.existing).reduce((sum, asset) => sum + asset.originalText.length, 0),
  };
}
