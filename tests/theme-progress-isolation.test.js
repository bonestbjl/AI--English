const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const Babel = require("../vendor/babel.min.js");
const learningApi = require("../api/learning-data.js");

const source = readFileSync(path.join(__dirname, "../src/app.jsx"), "utf8");
const functions = new Map();
Babel.transform(source, {
  presets: ["react"], code: false, ast: false,
  plugins: [() => ({ visitor: {
    FunctionDeclaration({ node }) {
      functions.set(node.id.name, source.slice(node.start, node.end));
    },
  } })],
});
const themes = ["zoo", "fruitShop", "campus", "cafe", "airport", "office", "hotel", "restaurant", "supermarket", "metro", "clinic", "bank", "apartment", "laundry"];
const plain = (value) => JSON.parse(JSON.stringify(value));
const title = (id) => id[0].toUpperCase() + id.slice(1);
let projectData;
test.before(async () => {
  const { extractProjectAudioData } = await import("../scripts/lib/mobile-audio-pipeline.mjs");
  projectData = extractProjectAudioData();
});

function catalog(id) {
  const scenes = projectData[id === "zoo" ? "scenes" : `${id}Scenes`];
  const dialogues = projectData[id === "zoo" ? "dialogues" : `${id}Dialogues`];
  const pages = projectData[id === "zoo" ? "moreAnimalPages" : id === "fruitShop" ? "moreFruitPages" : `more${title(id)}Pages`] || [];
  const more = pages.flatMap((page) => page.animals || page.fruits || page.words);
  return { scenes, dialogues, more, words: [...scenes.flatMap((scene) => scene.hotspots.map((item) => item.word)), ...more.map((item) => item.word)] };
}

function harness(storage = new Map()) {
  const context = vm.createContext({
    ...projectData, console,
    window: {
      localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      setTimeout: () => 1, clearTimeout: () => {}, matchMedia: () => ({ matches: false }),
    },
    LEARNING_DATA_GUEST_KEY: "realSceneEnglishData_guest",
    LEARNING_DATA_PHONE_PREFIX: "realSceneEnglishData_phone_",
    LEARNING_DATA_MIGRATION_KEY: "realSceneEnglishDataMigrated_v1",
    LEARNING_SYNC_DEBOUNCE_MS: 1200,
    CHAPTER_SCENE_COUNTS: Object.fromEntries(themes.map((id) => [id, catalog(id).scenes.length])),
    MOBILE_MORE_WORD_MEDIA_QUERY: "(max-width: 768px)",
    currentUser: null, getCurrentUser: () => null,
    latestLearningDataRef: { current: null }, cloudSyncTimerRef: { current: null },
    showAuthToast: () => {},
  });
  for (const [, state, setter] of source.matchAll(/const \[(\w+), (set\w+)\] = useState\(/g)) {
    context[setter] = (value) => { context[state] = typeof value === "function" ? value(context[state]) : value; };
  }
  const names = [
    "createEmptyLearningData", "normalizeStringList", "getWordKey", "normalizeWordBookEntry",
    "getActiveUserDataKey", "normalizeLearningData", "getActiveLearningData", "saveActiveLearningData",
    "getLearningAuthToken", "getLearningDataTime", "mergeStringLists", "mergeWordBookEntries",
    "pickLaterLastScene", "mergeLearningData", "requestCloudLearningData", "loadCloudLearningData", "saveCloudLearningData",
    "buildLearningData", "applyLearningData", "scheduleCloudLearningDataSync", "hydrateLearningDataFromCloud",
    "restartTrip", "rememberWord", "openHotspot", "openMoreWordItem",
    ...themes.map((id) => `enter${title(id)}`),
  ];
  for (const name of names) {
    assert.ok(functions.has(name), name);
    vm.runInContext(functions.get(name), context);
  }
  context.playHotspotWord = () => {};
  context.triggerAnimalFeedback = () => {};
  context.speakEnglish = () => {};
  context.isMobileLandscape = false;
  context.ripples = [];
  context.applyLearningData(context.createEmptyLearningData());
  function refresh() {
    const sceneSelection = source.slice(source.indexOf('  const isZooChapter = currentChapter === "zoo";'), source.indexOf("  const chapterTitle = isZooChapter"));
    Object.assign(context, vm.runInContext(`(() => { ${sceneSelection}; return { activeScenes, activeDialogues, ${themes.map((id) => `is${title(id)}Chapter`).join(", ")} }; })()`, context));
    context.currentScene = context.activeScenes[context.currentIndex];
  }
  refresh();
  return {
    context, storage,
    apply: (data) => { context.applyLearningData(data); refresh(); },
    enter: (id) => { refresh(); context[`enter${title(id)}`](); refresh(); },
    restart: () => { refresh(); context.restartTrip(); refresh(); },
    data: () => plain(context.buildLearningData()),
    persist: (user = null) => plain(context.saveActiveLearningData(context.buildLearningData(), user)),
  };
}

function history(h) {
  const data = plain(h.context.createEmptyLearningData());
  for (const id of themes) {
    const { scenes, dialogues, more } = catalog(id);
    const scene = scenes[0];
    data.completedHotspots.push(`${scene.id}:${scene.hotspots[0].id}`);
    data.completedDialogs.push(Object.values(dialogues)[0].id);
    data.completedActions.push(scene.id);
    data.completedScenes.push(`${id}:${scene.id}`);
    data.learnedWords.push(scene.hotspots[0].word);
    if (more[0]) {
      data.moreWords[id].push(more[0].id);
      data.learnedWords.push(more[0].word);
    }
  }
  data.learnedWords = [...new Set(data.learnedWords)];
  data.wordBook = [{ word: "gate", zh: "大门", scene: "Zoo / Entrance", type: "object", addedAt: "2026-01-01T00:00:00.000Z" }];
  return data;
}

function progress(data) {
  const { lastScene, updatedAt, version, ...rest } = plain(data);
  return rest;
}

for (const id of themes) {
  test(`enter ${id} preserves all existing themes, More Words and word book after local reload`, () => {
    const h = harness();
    h.apply(history(h));
    const before = h.data();
    h.enter(id);
    assert.deepEqual(progress(h.data()), progress(before));
    h.persist();
    const reloaded = harness(h.storage);
    reloaded.apply(reloaded.context.getActiveLearningData(null));
    assert.deepEqual(progress(reloaded.data()), progress(before));
  });

  test(`Restart ${id} resets only exact current-theme records and preserves unknown history`, () => {
    const h = harness();
    const seed = history(h);
    seed.completedHotspots.push("legacy-scene:legacy-word");
    seed.completedDialogs.push("legacy-dialogue");
    seed.completedActions.push("legacy-scene");
    seed.completedScenes.push("legacy:legacy-scene");
    seed.learnedWords.push("legacy vocabulary");
    seed.lastScene = { chapterId: id, sceneIndex: 1 };
    h.apply(seed);
    const before = h.data();
    h.restart();
    const current = catalog(id);
    const hotspotKeys = new Set(current.scenes.flatMap((scene) => scene.hotspots.map((item) => `${scene.id}:${item.id}`)));
    const dialogueIds = new Set(Object.values(current.dialogues).map((item) => item.id));
    const sceneIds = new Set(current.scenes.map((scene) => scene.id));
    const completedIds = new Set(current.scenes.map((scene) => `${id}:${scene.id}`));
    const otherWords = new Set(themes.filter((other) => other !== id).flatMap((other) => catalog(other).words));
    const expected = {
      ...before,
      completedHotspots: before.completedHotspots.filter((key) => !hotspotKeys.has(key)),
      completedDialogs: before.completedDialogs.filter((key) => !dialogueIds.has(key)),
      completedActions: before.completedActions.filter((key) => !sceneIds.has(key)),
      completedScenes: before.completedScenes.filter((key) => !completedIds.has(key)),
      learnedWords: before.learnedWords.filter((word) => !current.words.includes(word) || otherWords.has(word)),
      moreWords: { ...before.moreWords, [id]: [] },
      lastScene: { chapterId: id, sceneIndex: 0 },
    };
    assert.deepEqual(h.data(), expected);
    h.persist();
    const reloaded = harness(h.storage);
    reloaded.apply(reloaded.context.getActiveLearningData(null));
    assert.deepEqual(reloaded.data(), expected);
  });
}

test("Zoo history survives learning a Cafe hotspot, leaving and returning; Airport preserves Zoo and Campus", () => {
  const h = harness();
  h.apply(history(h));
  const before = h.data();
  h.enter("cafe");
  const hotspot = catalog("cafe").scenes[0].hotspots[1];
  h.context.openHotspot(hotspot);
  h.enter("zoo");
  const expected = progress(before);
  expected.completedHotspots.push(`${catalog("cafe").scenes[0].id}:${hotspot.id}`);
  if (!expected.learnedWords.includes(hotspot.word)) expected.learnedWords.push(hotspot.word);
  assert.deepEqual(progress(h.data()), expected);
  h.enter("airport");
  assert.deepEqual(progress(h.data()), expected);
});

test("Restart conservatively preserves text shared with another theme", () => {
  const h = harness();
  const shared = catalog("cafe").words[0];
  const originalWord = projectData.scenes[0].hotspots[0].word;
  const seed = history(h);
  seed.learnedWords.push(shared);
  seed.lastScene.chapterId = "cafe";
  // Model a legacy cross-theme alias without changing production vocabulary.
  try {
    projectData.scenes[0].hotspots[0].word = shared;
    h.apply(seed);
    h.restart();
    assert.ok(h.data().learnedWords.includes(shared));
  } finally {
    projectData.scenes[0].hotspots[0].word = originalWord;
  }
});

test("saved state round-trips through the real learning-data API and cloud hydration without losing other themes", async () => {
  const names = ["AUTH_TOKEN_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const oldFetch = global.fetch;
  const secret = "isolation-test-only";
  const phone = "13000000000";
  const payload = Buffer.from(JSON.stringify({ phone, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  const user = { phone, authToken: `${payload}.${crypto.createHmac("sha256", secret).update(payload).digest("base64url")}` };
  let cloudRow = null;
  let saves = 0;
  process.env.AUTH_TOKEN_SECRET = secret;
  process.env.SUPABASE_URL = "https://isolation-test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-not-a-key";
  global.fetch = async (url, init) => {
    assert.ok(String(url).startsWith("https://isolation-test.invalid/rest/v1/learning_data?"));
    if (init.method === "POST") { cloudRow = JSON.parse(init.body); saves += 1; }
    return new Response(JSON.stringify(cloudRow ? [cloudRow] : []), { status: 200 });
  };
  async function apiFetch(url, init) {
    assert.equal(url, "/api/learning-data");
    const recorder = { statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
    await learningApi({ method: init.method, body: JSON.parse(init.body) }, recorder);
    return new Response(JSON.stringify(recorder.body), { status: recorder.statusCode });
  }
  try {
    const h = harness();
    h.context.fetch = apiFetch;
    h.apply(history(h));
    h.enter("cafe");
    h.context.openHotspot(catalog("cafe").scenes[0].hotspots[1]);
    h.restart();
    const expected = h.data();
    const saved = h.persist(user);
    await h.context.saveCloudLearningData(user, saved);
    const reloaded = harness(h.storage);
    reloaded.context.fetch = apiFetch;
    await reloaded.context.hydrateLearningDataFromCloud(user, reloaded.context.getActiveLearningData(user), { silent: true });
    assert.deepEqual(reloaded.data(), expected);
    const newDevice = harness();
    newDevice.context.fetch = apiFetch;
    await newDevice.context.hydrateLearningDataFromCloud(user, newDevice.context.createEmptyLearningData(), { silent: true });
    assert.deepEqual(progress(newDevice.data()), progress(expected));
    assert.equal(saves, 3);
    assert.equal(cloudRow.phone, phone);
  } finally {
    global.fetch = oldFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("the existing autosave effect watches every shared progress state", () => {
  const effect = source.slice(source.indexOf("  useEffect(() => {\n    const localData = saveActiveLearningData(buildLearningData()"));
  const block = effect.slice(0, effect.indexOf("  ]);") + 5);
  assert.match(block, /scheduleCloudLearningDataSync\(latestLearningDataRef.current, currentUser\)/);
  for (const name of ["conversationDone", "completedActions", "completedSceneIds", "learnedHotspotKeys", "learnedWords", "savedWords"]) assert.ok(block.includes(name));
});
