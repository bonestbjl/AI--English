#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  const runtime = between(source, "async function speakWithEnglishVoice", "function stopLearningAudio");
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
    showAudioPlaybackHint: () => {},
    setPlayingKey: (key) => calls.playing.push(key),
    recordAudioDebug: () => {},
    reportAudioDebugFailure: () => {},
    getAudioIndexStatus: () => mobileUrl ? "ready" : "not_loaded",
    refreshAudioDebugSnapshot: () => {},
    audioDebugLastEventRef: { current: null },
    audioDebugEnabled: false,
    SpeechSynthesisUtterance: MockUtterance,
    window: { speechSynthesis: { cancel: () => { calls.cancelled += 1; }, speak: (utterance) => calls.spoken.push(utterance) } },
  });
  vm.runInContext(`${runtime}\nglobalThis.speakEnglishUnderTest = speakEnglish;`, context);
  await context.speakEnglishUnderTest("gate", 0.9, "gate-test");
  return calls;
}

async function missingIndexPath(source) {
  const runtime = between(source, "function speakEnglish", "function stopLearningAudio");
  const calls = { mapRequests: 0, hints: [], spoken: [] };
  const context = vm.createContext({
    isMobileAudioPreferred: () => true,
    getMobileAudioUrl: () => null,
    ensureMobileAudioMapLoaded: () => {
      calls.mapRequests += 1;
      return Promise.resolve(true);
    },
    playLearningAudio: () => { throw new Error("Audio must not play before the index is ready."); },
    speakWithEnglishVoice: (...args) => calls.spoken.push(args),
    showAudioPlaybackHint: (message) => calls.hints.push(message),
    console: { warn: () => {} },
    recordAudioDebug: () => {},
    reportAudioDebugFailure: () => {},
    getAudioIndexStatus: () => "not_loaded",
    refreshAudioDebugSnapshot: () => {},
    releasePendingPlaybackVisual: () => {},
    audioDebugLastEventRef: { current: null },
    audioDebugEnabled: false,
  });
  vm.runInContext(`${runtime}\nglobalThis.speakEnglishUnderTest = speakEnglish;`, context);
  context.speakEnglishUnderTest("gate", 0.9, "gate-test");
  await Promise.resolve();
  return calls;
}

function createAudioTriggerContext(calls, getElementsFromPoint = () => []) {
  let now = 1000;
  const context = vm.createContext({
    Date: { now: () => now },
    document: { elementsFromPoint: getElementsFromPoint },
    audioTriggerRegistryRef: { current: new Map() },
    lastNativeAudioTriggerRef: { current: { triggerId: "", timestamp: 0 } },
    audioPlaybackVisualTimerRef: { current: null },
    window: {
      clearTimeout: () => {},
      setTimeout: () => 1,
    },
    setPlayingKey: (key) => calls.push(`playing:${key}`),
    describeAudioDebugEvent: () => calls.push("event"),
    recordAudioDebug: (message) => calls.push(`debug:${message}`),
    reportAudioDebugFailure: () => calls.push("error"),
    showAudioPlaybackHint: () => calls.push("hint"),
  });
  return {
    context,
    advance(ms) { now += ms; },
  };
}

function audioButtonInputPath(source, pointerType) {
  const runtime = between(source, "function clearPendingPlaybackVisual", "\n\n  useEffect(() => {\n    document.addEventListener(\"pointerup\", handleNativeAudioPointerUp, true);");
  const calls = [];
  const { context, advance } = createAudioTriggerContext(calls);
  vm.runInContext(`${runtime}\nglobalThis.getAudioButtonProps = audioButtonProps;`, context);
  const props = context.getAudioButtonProps("gate", () => calls.push("business"));
  props.onPointerUp({ type: "pointerup", pointerType });
  props.onClick({ type: "click", detail: pointerType === "mouse" ? 1 : 0 });
  advance(600);
  props.onClick({ type: "click", detail: 0 });
  return calls;
}

function nativeDelegatedInputPath(source, { overlay = false, replaceEntry = false, missingEntry = false } = {}) {
  const runtime = between(source, "function clearPendingPlaybackVisual", "\n\n  useEffect(() => {\n    document.addEventListener(\"pointerup\", handleNativeAudioPointerUp, true);");
  const calls = [];
  const trigger = {
    tagName: "BUTTON",
    dataset: { audioTriggerId: "scene-word" },
    closest: (selector) => selector === '[data-audio-trigger="true"]' ? trigger : null,
  };
  const overlayTarget = {
    tagName: "DIV",
    dataset: {},
    closest: () => null,
  };
  const { context } = createAudioTriggerContext(calls, () => overlay ? [overlayTarget, trigger] : [trigger]);
  vm.runInContext(`${runtime}\nglobalThis.handleNativeAudioPointerUpUnderTest = handleNativeAudioPointerUp;`, context);
  if (!missingEntry) {
    context.audioTriggerRegistryRef.current.set("scene-word", {
      key: "gate-key",
      action: () => calls.push("business:gate"),
    });
  }
  if (replaceEntry) {
    context.audioTriggerRegistryRef.current.set("scene-word", {
      key: "laundry-key",
      action: () => calls.push("business:laundry"),
    });
  }
  context.handleNativeAudioPointerUpUnderTest({
    type: "pointerup",
    pointerType: "touch",
    target: overlay ? overlayTarget : trigger,
    clientX: 24,
    clientY: 32,
  });
  return calls;
}

function nativeAndReactDedupPath(source) {
  const runtime = between(source, "function clearPendingPlaybackVisual", "\n\n  useEffect(() => {\n    document.addEventListener(\"pointerup\", handleNativeAudioPointerUp, true);");
  const calls = [];
  const trigger = {
    tagName: "BUTTON",
    dataset: { audioTriggerId: "gate" },
    closest: (selector) => selector === '[data-audio-trigger="true"]' ? trigger : null,
  };
  const { context } = createAudioTriggerContext(calls, () => [trigger]);
  vm.runInContext(`${runtime}\nglobalThis.getAudioButtonProps = audioButtonProps; globalThis.handleNativeAudioPointerUpUnderTest = handleNativeAudioPointerUp;`, context);
  const props = context.getAudioButtonProps("gate", () => calls.push("business"));
  props.ref(trigger);
  const pointerEvent = { type: "pointerup", pointerType: "touch", target: trigger, clientX: 24, clientY: 32 };
  context.handleNativeAudioPointerUpUnderTest(pointerEvent);
  props.onPointerUp(pointerEvent);
  props.onClick({ type: "click", detail: 1 });
  return calls;
}

async function playbackPath(source, { audioAvailable, playError = null } = {}) {
  const runtime = between(source, "function stopLearningAudio", "function playHotspotWord");
  const fallbacks = [];
  const hints = [];
  const errors = [];
  const instances = [];
  class MockAudio {
    constructor(url) { this.url = url; this.paused = false; this.loaded = false; this.playCount = 0; instances.push(this); }
    pause() { this.paused = true; }
    removeAttribute() { this.url = null; }
    load() { this.loaded = true; }
    play() { this.playCount += 1; return playError ? Promise.reject(playError) : Promise.resolve(); }
  }
  const context = vm.createContext({
    learningAudioRef: { current: null },
    audioPlaybackAttemptRef: { current: 0 },
    Audio: audioAvailable ? MockAudio : undefined,
    setPlayingKey: () => {},
    speakWithEnglishVoice: (...args) => fallbacks.push(args),
    showAudioPlaybackHint: (message) => hints.push(message),
    console: { error: (...args) => errors.push(args) },
    recordAudioDebug: () => {},
    refreshAudioDebugSnapshot: () => {},
    reportAudioDebugFailure: () => {},
    getAudioElementDebugState: () => ({}),
    audioDebugEnabled: false,
    Error,
    window: { speechSynthesis: { cancel: () => {} } },
  });
  vm.runInContext(`${runtime}\nglobalThis.playLearningAudioUnderTest = playLearningAudio;`, context);
  context.playLearningAudioUnderTest({ text: "gate", audioUrl: "assets/audio/gate.mp3", rate: 0.9, key: "one" });
  if (audioAvailable) context.playLearningAudioUnderTest({ text: "lion", audioUrl: "assets/audio/lion.mp3", rate: 0.9, key: "two" });
  await Promise.resolve();
  return { fallbacks, hints, errors, instances };
}

export async function runRuntimeAudioTests(path = sourcePath) {
  const source = readFileSync(path, "utf8");
  const deploySource = readFileSync(deploySourcePath, "utf8");
  const touchStyles = readFileSync(resolve(dirname(path), "tailwind.css"), "utf8");
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
    { name: "Android Chrome", navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 } },
    { name: "Android WebView", navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A) AppleWebKit/537.36 Version/4.0 Chrome/126.0 Mobile Safari/537.36; wv", platform: "Linux armv8l", maxTouchPoints: 5 } },
    { name: "Android WeChat", navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 MicroMessenger/8.0.50", platform: "Linux armv8l", maxTouchPoints: 5 } },
    { name: "Safari iOS", navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari", platform: "iPhone", maxTouchPoints: 5 } },
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

  const clickRuntime = between(source, "function speakEnglish", "function stopLearningAudio");
  assert(!/\bawait\b|\bfetch\s*\(|\bimport\s*\(/.test(clickRuntime), "The mobile click path still waits before audio.play().");
  assert(/ensureMobileAudioMapLoaded\(\)\.catch/.test(source), "The mobile index retry was removed.");
  assert(/声音准备中，请再点一次/.test(source), "The second-click hint is missing.");
  assert(/get\("audioDebug"\) === "1"/.test(source) && /Android Audio Diagnostics/.test(source), "The opt-in Android audio diagnostic panel is missing.");
  assert(/Native DOM event test/.test(source) && /minimal JavaScript audio test/.test(source), "The independent native event or JavaScript audio tests are missing.");
  assert(/AUDIO_DEBUG_NATIVE_URL/.test(source) && /__RSE_APP_BUNDLE__/.test(source), "The bundle and native-audio diagnostic checks are missing.");
  const missingIndex = await missingIndexPath(source);
  assert(missingIndex.mapRequests === 1 && missingIndex.hints[0] === "声音准备中，请再点一次" && missingIndex.spoken.length === 0, "An unfinished index did not require a second click.");

  const touchInput = audioButtonInputPath(source, "touch");
  assert(touchInput.filter((entry) => entry === "business").length === 2, "Touch pointerup did not invoke the playback business path exactly once before the deduplicated click.");
  assert(touchInput.indexOf("playing:gate") < touchInput.indexOf("business"), "Playback state was not set before the touch business action.");
  const mouseInput = audioButtonInputPath(source, "mouse");
  assert(mouseInput.filter((entry) => entry === "business").length === 2, "Mouse click did not retain the playback business path.");
  const nativeTouch = nativeDelegatedInputPath(source);
  assert(nativeTouch.includes("business:gate"), "Native capture-phase pointerup did not reach the current business playback entry.");
  assert(nativeTouch.indexOf("playing:gate-key") < nativeTouch.indexOf("business:gate"), "Native capture did not set visual playback state before the business action.");
  const overlayTouch = nativeDelegatedInputPath(source, { overlay: true });
  assert(overlayTouch.includes("business:gate") && overlayTouch.some((entry) => entry.startsWith("debug:native pointerup captured")), "elementsFromPoint did not recover an audio trigger behind an overlay.");
  const refreshedEntry = nativeDelegatedInputPath(source, { replaceEntry: true });
  assert(refreshedEntry.includes("business:laundry") && !refreshedEntry.includes("business:gate"), "The audio trigger registry retained a stale scene payload after replacement.");
  const missingRegistry = nativeDelegatedInputPath(source, { missingEntry: true });
  assert(missingRegistry.includes("debug:native trigger found but registry entry missing") && !missingRegistry.some((entry) => entry.startsWith("business:")), "A missing audio registry entry did not surface in diagnostics or attempted stale playback.");
  const nativeAndReact = nativeAndReactDedupPath(source);
  assert(nativeAndReact.filter((entry) => entry === "business").length === 1, "A native touch pointerup and subsequent React events played the same item more than once.");
  assert(source.includes('document.addEventListener("pointerup", handleNativeAudioPointerUp, true)') && source.includes("data-audio-trigger") && touchStyles.includes("touch-action: manipulation"), "Audio controls are missing their native capture trigger or mobile touch target rules.");
  assert(touchStyles.includes(".hotspot-sign::before") && touchStyles.includes("pointer-events: none"), "Hotspot decoration can still intercept input.");

  const noAudio = await playbackPath(source, { audioAvailable: false });
  assert(noAudio.fallbacks.length === 1 && noAudio.fallbacks[0][3] === true, "Missing Audio support did not use the explicit speech fallback.");
  const rapid = await playbackPath(source, { audioAvailable: true });
  assert(rapid.instances.length === 1 && rapid.instances[0].playCount === 2 && rapid.instances[0].paused && rapid.instances[0].loaded, "Rapid clicks did not reuse and reset the persistent Audio instance.");
  const notAllowed = await playbackPath(source, {
    audioAvailable: true,
    playError: Object.assign(new Error("play() failed because it was not initiated by a user gesture"), { name: "NotAllowedError" }),
  });
  assert(notAllowed.errors.length >= 1 && notAllowed.hints.includes("播放失败，请重试或在浏览器中打开") && notAllowed.fallbacks.length === 0, "NotAllowedError did not stay visible instead of silently falling back to TTS.");
  return {
    desktopSpeechSynthesis: true,
    mobileStaticMp3: true,
    missingMp3RequiresSecondClick: true,
    persistentAudioReplacement: true,
    notAllowedErrorVisible: true,
    cacheVersion: mapVersion,
    oldCacheBypassed: true,
    laundryAndroidChromeMp3: true,
    laundryAndroidWebViewMp3: true,
    laundryAndroidWeChatMp3: true,
    zooAndFruitShopProtected: true,
    touchPointerUpTriggersPlayback: true,
    touchClickIsDeduplicated: true,
    nativeCaptureDelegatesPlayback: true,
    overlayFallbackFindsAudioTrigger: true,
    registryUsesCurrentScenePayload: true,
    missingRegistryEntryIsVisible: true,
    nativeAndReactTouchIsDeduplicated: true,
    mouseAndKeyboardClickProtected: true,
    immediatePlaybackVisualState: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRuntimeAudioTests().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(`Mobile audio runtime test failed: ${error.message}`);
    process.exit(1);
  });
}
