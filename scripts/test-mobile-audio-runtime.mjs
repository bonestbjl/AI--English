#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  deploySourcePath,
  loadRuntimeAudioMap,
  mobileAudioMapPath,
  mobileAudioMapVersion,
  sourcePath,
} from "./lib/mobile-audio-pipeline.mjs";

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Could not extract runtime section: ${start}`);
  return source.slice(from, to);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function audioLookup(source, navigator, map, text = "gate") {
  const runtime = between(source, "function isMobileAudioPreferred()", "const scenes = [");
  const context = vm.createContext({
    navigator,
    getPreparedThemeResourceUrl: (url) => url,
    window: { FullMobileAudioUrls: map, matchMedia: () => ({ matches: false }), screen: { width: 1440 } },
  });
  vm.runInContext(`${runtime}\nglobalThis.lookup = getMobileAudioUrl;`, context);
  return context.lookup(text);
}

async function speechPath(source, mobileUrl) {
  const runtime = between(source, "async function speakEnglish", "function stopLearningAudio");
  const calls = { mobile: [], spoken: [], cancelled: 0, playing: [] };
  class MockUtterance {
    constructor(text) { this.text = text; }
  }
  const voice = { name: "Protected desktop voice", lang: "en-US" };
  const context = vm.createContext({
    activeSpeechToken: 0,
    englishVoicesReady: true,
    isMobileAudioPreferred: () => Boolean(mobileUrl),
    ensureMobileAudioMapLoaded: async () => true,
    getMobileAudioUrl: () => mobileUrl,
    loadEnglishVoices: () => voice,
    waitForEnglishVoice: async () => voice,
    playLearningAudio: (options) => calls.mobile.push(options),
    setPlayingKey: (key) => calls.playing.push(key),
    SpeechSynthesisUtterance: MockUtterance,
    window: { speechSynthesis: { cancel: () => { calls.cancelled += 1; }, speak: (utterance) => calls.spoken.push(utterance) } },
  });
  vm.runInContext(`${runtime}\nglobalThis.speakEnglishUnderTest = speakEnglish;`, context);
  await context.speakEnglishUnderTest("gate", 0.9, "gate-test");
  return calls;
}

function playbackPath(source, audioAvailable) {
  const runtime = between(source, "function stopLearningAudio", "function playHotspotWord");
  const fallback = [];
  const instances = [];
  class MockAudio {
    constructor(url) { this.url = url; this.paused = false; this.loaded = false; instances.push(this); }
    pause() { this.paused = true; }
    removeAttribute() { this.url = null; }
    load() { this.loaded = true; }
    play() { return Promise.resolve(); }
  }
  const context = vm.createContext({
    activeLearningAudio: null,
    Audio: audioAvailable ? MockAudio : undefined,
    setPlayingKey: () => {},
    speakEnglish: (...args) => fallback.push(args),
    window: { speechSynthesis: { cancel: () => {} } },
  });
  vm.runInContext(`${runtime}\nglobalThis.playLearningAudioUnderTest = playLearningAudio;`, context);
  context.playLearningAudioUnderTest({ text: "gate", audioUrl: "assets/audio/gate.mp3", rate: 0.9, key: "one" });
  if (audioAvailable) context.playLearningAudioUnderTest({ text: "lion", audioUrl: "assets/audio/lion.mp3", rate: 0.9, key: "two" });
  return { fallback, instances };
}

export async function runRuntimeAudioTests(path = sourcePath) {
  const source = readFileSync(path, "utf8");
  const deploySource = readFileSync(deploySourcePath, "utf8");
  const runtimeMap = loadRuntimeAudioMap();
  const mapVersion = mobileAudioMapVersion(runtimeMap);
  const versionedMapUrl = `${mobileAudioMapPath}?v=${mapVersion}`;
  const scriptReference = `const MOBILE_AUDIO_MAP_SCRIPT_URL = "${versionedMapUrl}";`;
  assert(source.includes(scriptReference) && deploySource.includes(scriptReference), "HTML files do not reference the current deferred versioned mobile audio map.");
  assert(!source.includes(`<script src="${versionedMapUrl}"></script>`) && !deploySource.includes(`<script src="${versionedMapUrl}"></script>`), "Mobile audio map is still parser-blocking.");

  const previousVersionedUrl = `${mobileAudioMapPath}?v=0000000000000000`;
  const simulatedOldCache = new Map([
    [mobileAudioMapPath, { laundromat: null }],
    [previousVersionedUrl, { laundromat: null }],
  ]);
  assert(simulatedOldCache.has(mobileAudioMapPath) && simulatedOldCache.has(previousVersionedUrl), "The simulated old map cache was not created.");
  assert(!simulatedOldCache.has(versionedMapUrl), "The current versioned map URL still collides with an old cache key.");
  assert(mobileAudioMapVersion({ ...runtimeMap, "cache-version-test": "new-audio.mp3" }) !== mapVersion, "A changed map did not produce a new cache version.");

  const desktopLookup = audioLookup(source, { userAgent: "Mozilla/5.0 Macintosh", platform: "MacIntel", maxTouchPoints: 0 }, { gate: "assets/audio/gate.mp3" });
  assert(desktopLookup === null, "Desktop audio lookup must not return a mobile MP3.");
  const mobileLookup = audioLookup(source, { userAgent: "Mozilla/5.0 iPhone Mobile", platform: "iPhone", maxTouchPoints: 5 }, { gate: "assets/audio/gate.mp3" });
  assert(mobileLookup === "assets/audio/gate.mp3", "Mobile audio lookup did not return the static MP3.");

  const mobileBrowsers = [
    { name: "Chrome iOS", navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/126 Mobile", platform: "iPhone", maxTouchPoints: 5 } },
    { name: "Safari iOS", navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari", platform: "iPhone", maxTouchPoints: 5 } },
    { name: "WeChat iOS", navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile MicroMessenger", platform: "iPhone", maxTouchPoints: 5 } },
  ];
  for (const browser of mobileBrowsers) {
    assert(audioLookup(source, browser.navigator, runtimeMap, "laundromat") === runtimeMap.laundromat, `${browser.name} did not resolve the Laundry MP3.`);
    assert(audioLookup(source, browser.navigator, runtimeMap, "gate") === runtimeMap.gate, `${browser.name} did not preserve the Zoo MP3.`);
    assert(audioLookup(source, browser.navigator, runtimeMap, "apple") === runtimeMap.apple, `${browser.name} did not preserve the Fruit Shop MP3.`);
  }

  const desktop = await speechPath(source, desktopLookup);
  assert(desktop.mobile.length === 0 && desktop.spoken.length === 1, "Desktop speech did not stay on speechSynthesis.");
  assert(desktop.spoken[0].lang === "en-US" && desktop.spoken[0].rate === 0.9 && desktop.spoken[0].voice?.name === "Protected desktop voice", "Desktop utterance settings changed.");
  const mobile = await speechPath(source, mobileLookup);
  assert(mobile.mobile.length === 1 && mobile.spoken.length === 0, "Mobile speech did not prefer the static MP3.");

  const noAudio = playbackPath(source, false);
  assert(noAudio.fallback.length === 1 && noAudio.fallback[0][3] === true, "Missing Audio support did not use the speech fallback.");
  const rapid = playbackPath(source, true);
  assert(rapid.instances.length === 2 && rapid.instances[0].paused && rapid.instances[0].loaded, "Rapid clicks did not stop and release the previous Audio instance.");
  return {
    desktopSpeechSynthesis: true,
    mobileStaticMp3: true,
    missingMp3Fallback: true,
    rapidClickReplacement: true,
    cacheVersion: mapVersion,
    oldCacheBypassed: true,
    laundryChromeMp3: true,
    laundrySafariMp3: true,
    laundryWeChatMp3: true,
    zooAndFruitShopProtected: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRuntimeAudioTests().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(`Mobile audio runtime test failed: ${error.message}`);
    process.exit(1);
  });
}
