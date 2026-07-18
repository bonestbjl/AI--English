#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { sourcePath } from "./lib/mobile-audio-pipeline.mjs";

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Could not extract runtime section: ${start}`);
  return source.slice(from, to);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function audioLookup(source, navigator, map) {
  const runtime = between(source, "      function isMobileAudioPreferred()", "      const scenes = [");
  const context = vm.createContext({
    navigator,
    window: { FullMobileAudioUrls: map, matchMedia: () => ({ matches: false }), screen: { width: 1440 } },
  });
  vm.runInContext(`${runtime}\nglobalThis.lookup = getMobileAudioUrl;`, context);
  return context.lookup("gate");
}

async function speechPath(source, mobileUrl) {
  const runtime = between(source, "        async function speakEnglish", "        function stopLearningAudio");
  const calls = { mobile: [], spoken: [], cancelled: 0, playing: [] };
  class MockUtterance {
    constructor(text) { this.text = text; }
  }
  const voice = { name: "Protected desktop voice", lang: "en-US" };
  const context = vm.createContext({
    activeSpeechToken: 0,
    englishVoicesReady: true,
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
  const runtime = between(source, "        function stopLearningAudio", "        function playHotspotWord");
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
  const desktopLookup = audioLookup(source, { userAgent: "Mozilla/5.0 Macintosh", platform: "MacIntel", maxTouchPoints: 0 }, { gate: "assets/audio/gate.mp3" });
  assert(desktopLookup === null, "Desktop audio lookup must not return a mobile MP3.");
  const mobileLookup = audioLookup(source, { userAgent: "Mozilla/5.0 iPhone Mobile", platform: "iPhone", maxTouchPoints: 5 }, { gate: "assets/audio/gate.mp3" });
  assert(mobileLookup === "assets/audio/gate.mp3", "Mobile audio lookup did not return the static MP3.");

  const desktop = await speechPath(source, desktopLookup);
  assert(desktop.mobile.length === 0 && desktop.spoken.length === 1, "Desktop speech did not stay on speechSynthesis.");
  assert(desktop.spoken[0].lang === "en-US" && desktop.spoken[0].rate === 0.9 && desktop.spoken[0].voice?.name === "Protected desktop voice", "Desktop utterance settings changed.");
  const mobile = await speechPath(source, mobileLookup);
  assert(mobile.mobile.length === 1 && mobile.spoken.length === 0, "Mobile speech did not prefer the static MP3.");

  const noAudio = playbackPath(source, false);
  assert(noAudio.fallback.length === 1 && noAudio.fallback[0][3] === true, "Missing Audio support did not use the speech fallback.");
  const rapid = playbackPath(source, true);
  assert(rapid.instances.length === 2 && rapid.instances[0].paused && rapid.instances[0].loaded, "Rapid clicks did not stop and release the previous Audio instance.");
  return { desktopSpeechSynthesis: true, mobileStaticMp3: true, missingMp3Fallback: true, rapidClickReplacement: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRuntimeAudioTests().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(`Mobile audio runtime test failed: ${error.message}`);
    process.exit(1);
  });
}
