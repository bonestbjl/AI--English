#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "index.html"), "utf8");
const previousManifestPath = resolve(root, "p0-audio-manifest.csv");
const outputPath = resolve(root, "full-audio-manifest.csv");

const chapters = [
  ["zoo", "scenes", "dialogues", "moreAnimalPages"],
  ["fruitShop", "fruitShopScenes", "fruitShopDialogues", "moreFruitPages"],
  ["campus", "campusScenes", "campusDialogues", "moreCampusPages"],
  ["cafe", "cafeScenes", "cafeDialogues", "moreCafePages"],
  ["airport", "airportScenes", "airportDialogues", "moreAirportPages"],
  ["office", "officeScenes", "officeDialogues", "moreOfficePages"],
  ["hotel", "hotelScenes", "hotelDialogues", "moreHotelPages"],
  ["restaurant", "restaurantScenes", "restaurantDialogues", "moreRestaurantPages"],
  ["supermarket", "supermarketScenes", "supermarketDialogues", "moreSupermarketPages"],
  ["metro", "metroScenes", "metroDialogues", "moreMetroPages"],
  ["clinic", "clinicScenes", "clinicDialogues", "moreClinicPages"],
  ["bank", "bankScenes", "bankDialogues", "moreBankPages"],
  ["apartment", "apartmentScenes", "apartmentDialogues", "moreApartmentPages"],
];
const dataNames = [...new Set(chapters.flatMap(([, scenesName, dialoguesName, moreName]) => [scenesName, dialoguesName, moreName]))];

function extractStaticData() {
  const start = source.indexOf("      const scenes = [");
  const end = source.indexOf("      const sceneCards = [");
  if (start < 0 || end < 0 || end <= start) throw new Error("Could not locate the static chapter data block in index.html.");

  const capture = `\nglobalThis.__audioManifestData = { ${dataNames.join(", ")} };\n`;
  const context = vm.createContext({ console });
  vm.runInContext(source.slice(start, end) + capture, context, { filename: "index.html:data" });
  return context.__audioManifestData;
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

function readPreviousPaths() {
  if (!existsSync(previousManifestPath)) return new Map();
  const lines = readFileSync(previousManifestPath, "utf8").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return new Map(lines.slice(1).filter(Boolean).map((line) => {
    const row = Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value]));
    return [legacyKey(row.chapterId, row.sceneIdOrPageId, row.itemType, row.audioType, row.textToSpeak), row];
  }));
}

function legacyKey(chapterId, sceneIdOrPageId, itemType, audioType, textToSpeak) {
  return [chapterId, sceneIdOrPageId, itemType, audioType, textToSpeak].join("\u0001");
}

function priorityFor(chapterId) {
  if (["zoo", "fruitShop"].includes(chapterId)) return "P0";
  if (["campus", "cafe", "airport"].includes(chapterId)) return "P1";
  return "P2";
}

function slug(value) {
  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";
}

function csv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function currentExists(assetsPath, deployCnPath) {
  try {
    return readFileSync(resolve(root, assetsPath)).byteLength > 512 && readFileSync(resolve(root, deployCnPath)).byteLength > 512;
  } catch {
    return false;
  }
}

function addRecord(records, previousPaths, { chapterId, sceneIdOrPageId, itemType, audioType, displayText, textToSpeak, assetsPath, notes = "" }) {
  const cleanText = typeof textToSpeak === "string" ? textToSpeak.trim() : "";
  const legacy = previousPaths.get(legacyKey(chapterId, sceneIdOrPageId, itemType, audioType, cleanText));
  const finalAssetsPath = legacy?.assetsPath || assetsPath;
  const deployCnPath = legacy?.deployCnPath || `deploy-cn/${finalAssetsPath}`;
  records.push({
    chapterId,
    sceneIdOrPageId,
    itemType,
    audioType,
    displayText: displayText || "",
    textToSpeak: cleanText,
    targetFileName: finalAssetsPath.split("/").at(-1),
    assetsPath: finalAssetsPath,
    deployCnPath,
    currentExists: currentExists(finalAssetsPath, deployCnPath),
    priority: priorityFor(chapterId),
    notes: legacy ? `${notes}${notes ? " " : ""}Existing P0 path retained for compatibility.` : notes,
  });
}

function makeLearningRecords(records, previousPaths, chapterId, sceneIdOrPageId, itemType, item, prefix) {
  const base = `${prefix}${slug(item.id)}`;
  addRecord(records, previousPaths, {
    chapterId, sceneIdOrPageId, itemType, audioType: "word", displayText: item.word, textToSpeak: item.word,
    assetsPath: `assets/audio/words/${chapterId}/${base}.mp3`, notes: "Learning item word audio.",
  });
  addRecord(records, previousPaths, {
    chapterId, sceneIdOrPageId, itemType, audioType: "sentence", displayText: item.word, textToSpeak: item.example,
    assetsPath: `assets/audio/sentences/${chapterId}/${base}.mp3`, notes: "Learning item example audio.",
  });
}

function addDialogue(records, previousPaths, chapterId, sceneIdOrPageId, dialogueId, role, index, text, itemType = "dialogue") {
  addRecord(records, previousPaths, {
    chapterId,
    sceneIdOrPageId,
    itemType,
    audioType: "dialogue",
    displayText: text,
    textToSpeak: text,
    assetsPath: `assets/audio/dialogues/${chapterId}/${slug(sceneIdOrPageId)}--${slug(dialogueId)}--${role}-${index}.mp3`,
    notes: `Dialogue ${role} audio.`,
  });
}

function buildRecords(data, previousPaths) {
  const records = [];
  for (const [chapterId, scenesName, dialoguesName, moreName] of chapters) {
    const sceneList = data[scenesName];
    const dialogueMap = data[dialoguesName];
    const morePages = data[moreName];
    if (!Array.isArray(sceneList) || !dialogueMap || !Array.isArray(morePages)) throw new Error(`Incomplete data for ${chapterId}.`);

    for (const scene of sceneList) {
      if (scene.intro?.text) addDialogue(records, previousPaths, chapterId, scene.id, scene.id, "intro", 1, scene.intro.text);
      for (const hotspot of scene.hotspots || []) {
        const itemType = hotspot.type === "action" ? "action" : "hotspot";
        makeLearningRecords(records, previousPaths, chapterId, scene.id, itemType, hotspot, `${slug(scene.id)}--`);
        if (hotspot.actionMessageEn) {
          addDialogue(records, previousPaths, chapterId, scene.id, hotspot.id, "action", 1, hotspot.actionMessageEn, "action");
        }
      }
      if (scene.npc && dialogueMap[scene.npc]) {
        const dialogue = dialogueMap[scene.npc];
        if (dialogue.text) addDialogue(records, previousPaths, chapterId, scene.id, dialogue.id || scene.npc, "npc", 1, dialogue.text, "npcDialogue");
        (dialogue.options || []).forEach((option, index) => {
          if (option.text) addDialogue(records, previousPaths, chapterId, scene.id, dialogue.id || scene.npc, "option", index + 1, option.text, "npcDialogue");
          if (typeof option.reply === "string" && option.reply) addDialogue(records, previousPaths, chapterId, scene.id, dialogue.id || scene.npc, "reply", index + 1, option.reply, "npcDialogue");
        });
      }
    }

    // Include dialogue definitions retained in the data even when no current scene points to them.
    // This keeps the audio inventory complete without changing the scene flow.
    const referencedDialogueIds = new Set(sceneList.map((scene) => scene.npc).filter(Boolean));
    for (const [dialogueKey, dialogue] of Object.entries(dialogueMap)) {
      if (referencedDialogueIds.has(dialogueKey)) continue;
      const dialogueSceneId = `dialogue-${dialogueKey}`;
      if (dialogue.text) addDialogue(records, previousPaths, chapterId, dialogueSceneId, dialogue.id || dialogueKey, "npc", 1, dialogue.text, "npcDialogue");
      (dialogue.options || []).forEach((option, index) => {
        if (option.text) addDialogue(records, previousPaths, chapterId, dialogueSceneId, dialogue.id || dialogueKey, "option", index + 1, option.text, "npcDialogue");
        if (typeof option.reply === "string" && option.reply) addDialogue(records, previousPaths, chapterId, dialogueSceneId, dialogue.id || dialogueKey, "reply", index + 1, option.reply, "npcDialogue");
      });
    }

    for (const page of morePages) {
      const words = page.words || page.animals || page.fruits;
      if (!Array.isArray(words)) throw new Error(`Could not find More Words for ${chapterId}/${page.id}.`);
      for (const word of words) makeLearningRecords(records, previousPaths, chapterId, page.id, "moreWord", word, `more--${slug(page.id)}--`);
    }
  }
  return records;
}

function validate(records) {
  const emptyTexts = records.filter((record) => !record.textToSpeak);
  const paths = new Map();
  for (const record of records) {
    const previous = paths.get(record.assetsPath);
    if (previous && previous.textToSpeak !== record.textToSpeak) throw new Error(`Path collision with different text: ${record.assetsPath}`);
    paths.set(record.assetsPath, record);
  }
  if (emptyTexts.length) throw new Error(`Found ${emptyTexts.length} empty textToSpeak records.`);
  return { emptyTexts: 0, uniquePaths: paths.size };
}

const headers = [
  "chapterId", "sceneIdOrPageId", "itemType", "audioType", "displayText", "textToSpeak", "targetFileName", "assetsPath", "deployCnPath", "currentExists", "priority", "notes",
];
const previousPaths = readPreviousPaths();
const records = buildRecords(extractStaticData(), previousPaths);
const validation = validate(records);
writeFileSync(outputPath, `${headers.join(",")}\n${records.map((record) => headers.map((header) => csv(record[header])).join(",")).join("\n")}\n`, "utf8");

const byChapter = Object.fromEntries(chapters.map(([chapterId]) => [chapterId, records.filter((record) => record.chapterId === chapterId).length]));
const byType = Object.fromEntries([...new Set(records.map((record) => record.itemType))].map((type) => [type, records.filter((record) => record.itemType === type).length]));
console.log(JSON.stringify({ output: "full-audio-manifest.csv", records: records.length, existing: records.filter((record) => record.currentExists).length, validation, byChapter, byType }, null, 2));
