#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "full-audio-manifest.csv");
const chapters = [
  ["zoo", "zoo"],
  ["fruitShop", "fruit-shop"],
  ["campus", "campus"],
  ["cafe", "cafe"],
  ["airport", "airport"],
  ["office", "office"],
  ["hotel", "hotel"],
  ["restaurant", "restaurant"],
  ["supermarket", "supermarket"],
  ["metro", "metro"],
  ["clinic", "clinic"],
  ["bank", "bank"],
  ["apartment", "apartment"],
];

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

function quote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function outputBase(name) {
  return {
    text: resolve(root, `capcut-words-${name}.txt`),
    map: resolve(root, `capcut-words-${name}-map.csv`),
  };
}

function serializeText(rows) {
  return `${rows.map((row) => row.textToSpeak).join("\n\n")}\n`;
}

function serializeMap(rows) {
  const headers = ["index", "chapterId", "sceneIdOrPageId", "textToSpeak", "assetsPath", "deployCnPath"];
  const lines = rows.map((row, index) => [
    String(index + 1).padStart(3, "0"),
    row.chapterId,
    row.sceneIdOrPageId,
    row.textToSpeak,
    row.assetsPath,
    row.deployCnPath,
  ].map(quote).join(","));
  return `${headers.join(",")}\n${lines.join("\n")}\n`;
}

function verifyPair(rows, paths) {
  const textRows = readFileSync(paths.text, "utf8").trimEnd().split("\n\n");
  const mapLines = readFileSync(paths.map, "utf8").trimEnd().split(/\r?\n/);
  const mapHeaders = parseCsvLine(mapLines[0]);
  const mapRows = mapLines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [mapHeaders[index], value])));
  if (textRows.length !== rows.length || mapRows.length !== rows.length) throw new Error(`Count mismatch for ${paths.text}.`);
  for (let index = 0; index < rows.length; index += 1) {
    const expectedIndex = String(index + 1).padStart(3, "0");
    if (textRows[index] !== rows[index].textToSpeak || mapRows[index].index !== expectedIndex || mapRows[index].textToSpeak !== rows[index].textToSpeak) {
      throw new Error(`Order mismatch at ${paths.text}, row ${index + 1}.`);
    }
    if (!mapRows[index].assetsPath.startsWith(`assets/audio/words/${rows[index].chapterId}/`) || !mapRows[index].deployCnPath.startsWith(`deploy-cn/assets/audio/words/${rows[index].chapterId}/`)) {
      throw new Error(`Unexpected word audio path at ${paths.map}, row ${index + 1}.`);
    }
  }
}

const lines = readFileSync(manifestPath, "utf8").trim().split(/\r?\n/);
const headers = parseCsvLine(lines[0]);
const requiredHeaders = ["chapterId", "sceneIdOrPageId", "itemType", "audioType", "textToSpeak", "assetsPath", "deployCnPath"];
if (requiredHeaders.some((header) => !headers.includes(header))) throw new Error("Full manifest is missing required word audio columns.");

const allRows = lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])));
const wordRows = allRows.filter((row) => row.audioType === "word");
const emptyTexts = wordRows.filter((row) => !row.textToSpeak.trim());
const chineseTexts = wordRows.filter((row) => /[\u3400-\u9fff]/.test(row.textToSpeak));
const unexpectedTypes = wordRows.filter((row) => !["hotspot", "moreWord", "action"].includes(row.itemType));
const pathCounts = new Map();
for (const row of wordRows) pathCounts.set(row.assetsPath, (pathCounts.get(row.assetsPath) || 0) + 1);
const pathConflicts = [...pathCounts.entries()].filter(([, count]) => count > 1);
if (emptyTexts.length || chineseTexts.length || unexpectedTypes.length || pathConflicts.length) {
  throw new Error(`Word manifest validation failed: empty=${emptyTexts.length}, Chinese=${chineseTexts.length}, unexpectedTypes=${unexpectedTypes.length}, pathConflicts=${pathConflicts.length}.`);
}

const allPaths = {
  text: resolve(root, "capcut-all-words.txt"),
  map: resolve(root, "capcut-all-words-map.csv"),
};
writeFileSync(allPaths.text, serializeText(wordRows), "utf8");
writeFileSync(allPaths.map, serializeMap(wordRows), "utf8");
verifyPair(wordRows, allPaths);

const byChapter = {};
for (const [chapterId, filename] of chapters) {
  const rows = wordRows.filter((row) => row.chapterId === chapterId);
  if (!rows.length) throw new Error(`No word rows found for ${chapterId}.`);
  const paths = outputBase(filename);
  writeFileSync(paths.text, serializeText(rows), "utf8");
  writeFileSync(paths.map, serializeMap(rows), "utf8");
  verifyPair(rows, paths);
  byChapter[chapterId] = { count: rows.length, text: paths.text.replace(`${root}/`, ""), map: paths.map.replace(`${root}/`, "") };
}

const textCounts = new Map();
for (const row of wordRows) textCounts.set(row.textToSpeak, (textCounts.get(row.textToSpeak) || 0) + 1);
const duplicates = [...textCounts.entries()].filter(([, count]) => count > 1);
console.log(JSON.stringify({
  total: wordRows.length,
  uniqueTextToSpeak: textCounts.size,
  duplicateTextToSpeak: duplicates.length,
  duplicateInstances: duplicates.reduce((total, [, count]) => total + count - 1, 0),
  emptyTexts: emptyTexts.length,
  pathConflicts: pathConflicts.length,
  all: { text: allPaths.text.replace(`${root}/`, ""), map: allPaths.map.replace(`${root}/`, "") },
  byChapter,
}, null, 2));
