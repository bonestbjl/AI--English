const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadRuntimeValue(relativePath, key) {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(path.join(root, relativePath), "utf8"), context, { filename: relativePath });
  return JSON.parse(JSON.stringify(context.window[key]));
}

function loadGeneratedPacks(prefix = "") {
  const base = prefix ? `${prefix}/` : "";
  const index = loadRuntimeValue(`${base}assets/theme-resource-packs.js`, "RealSceneThemeResourcePackScripts");
  return Object.fromEntries(Object.entries(index).map(([themeId]) => {
    const packs = loadRuntimeValue(
      `${base}assets/theme-resource-packs/${themeId}.js`,
      "RealSceneThemeResourcePacks",
    );
    return [themeId, packs[themeId]];
  }));
}

test("all real learning themes are registered in the shared resource framework", async () => {
  const pipeline = await import("../scripts/lib/mobile-audio-pipeline.mjs");
  const generator = await import("../scripts/generate-theme-resource-packs.mjs");
  const data = pipeline.extractProjectAudioData();
  const expectedThemeIds = Array.from(data.sceneCards, (card) => card.chapter).filter(Boolean);
  const generated = loadGeneratedPacks();
  const deployGenerated = loadGeneratedPacks("deploy-cn");
  const rebuilt = JSON.parse(JSON.stringify(generator.buildThemeResourcePacks()));

  assert.deepEqual(Object.keys(generated), expectedThemeIds);
  assert.equal(expectedThemeIds.length, 14);
  assert.deepEqual(generated, deployGenerated);
  assert.deepEqual(generated, rebuilt.packs);

  const versions = new Set();
  const cacheNames = new Set();
  for (const themeId of expectedThemeIds) {
    const pack = generated[themeId];
    assert.ok(pack, `missing resource pack for ${themeId}`);
    assert.match(pack.version, new RegExp(`^${themeId}-[a-f0-9]{12}$`));
    assert.equal(pack.cacheName, `real-scene-theme-${pack.version}`);
    assert.ok(pack.sceneOrder.length > 0, `${themeId} has no scene order`);
    assert.equal(new Set(pack.resources.map((resource) => resource.url)).size, pack.resources.length);
    assert.ok(pack.resources.some((resource) => resource.categories.includes("cover")));
    assert.ok(pack.resources.some((resource) => resource.sceneIds.includes(pack.sceneOrder[0])));
    if (pack.sceneOrder[1]) {
      assert.ok(pack.resources.some((resource) => resource.sceneIds.includes(pack.sceneOrder[1])));
    }
    for (const resource of pack.resources) {
      assert.ok(existsSync(path.join(root, resource.url)), `missing source ${resource.url}`);
      assert.ok(existsSync(path.join(root, "deploy-cn", resource.url)), `missing deploy mirror ${resource.url}`);
    }
    versions.add(pack.version);
    cacheNames.add(pack.cacheName);
  }
  assert.equal(versions.size, expectedThemeIds.length);
  assert.equal(cacheNames.size, expectedThemeIds.length);
});

test("both frontends use one generic theme preparation UI and retry path", () => {
  const source = readFileSync(path.join(root, "src/app.jsx"), "utf8");
  const index = readFileSync(path.join(root, "index.html"), "utf8");
  const deploySource = readFileSync(path.join(root, "deploy-cn/index.html"), "utf8");

  assert.equal(index, deploySource);
  assert.match(source, /async function prepareThemeEntry\(themeId\)/);
  assert.match(source, /await prepareThemeEntry\(chapter\)/);
  assert.match(source, /onClick=\{\(\) => prepareThemeEntry\(themePreparation\.themeId\)\}/);
  assert.match(source, /正在准备您的学习场景/);
  assert.match(source, /Preparing \{themePreparation\.title\}/);
  assert.match(source, /data-theme-preparation-id=\{themePreparation\.themeId\}/);
  assert.match(source, /getThemePackReadyKey\(themeId, version\)/);
  assert.match(source, /return `\$\{THEME_PACK_READY_PREFIX\}\$\{themeId\}:\$\{version\}`/);
  assert.match(source, /hasThemePackReadyMarker\(pack\)/);
  assert.match(source, /hasReadyMarker && !criticalReady/);
  assert.match(source, /ensureThemeResourcePacksLoaded\(themeId\)/);
  assert.match(source, /key: `theme-resource-pack:\$\{themeId\}`/);
  assert.doesNotMatch(source, /prepareZooEntry|getZooCriticalResources|zooPreparationRef/);

  const handlers = {
    zoo: "enterZoo",
    fruitShop: "enterFruitShop",
    campus: "enterCampus",
    cafe: "enterCafe",
    airport: "enterAirport",
    office: "enterOffice",
    hotel: "enterHotel",
    restaurant: "enterRestaurant",
    supermarket: "enterSupermarket",
    metro: "enterMetro",
    clinic: "enterClinic",
    bank: "enterBank",
    apartment: "enterApartment",
    laundry: "enterLaundry",
  };
  for (const [themeId, handler] of Object.entries(handlers)) {
    assert.match(source, new RegExp(`${themeId}: ${handler}`));
  }
});

test("theme manifests remain deferred and service-worker app-shell caching stays separate", async () => {
  const generator = await import("../scripts/generate-theme-resource-packs.mjs");
  const { indexVersion } = generator.buildThemeResourcePacks();
  const appSource = readFileSync(path.join(root, "src/app.jsx"), "utf8");
  assert.match(appSource, new RegExp(`const THEME_RESOURCE_PACKS_SCRIPT_URL = "assets/theme-resource-packs\\.js\\?v=${indexVersion}";`));
  for (const relativePath of ["index.html", "deploy-cn/index.html"]) {
    const html = readFileSync(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(html, /theme-resource-packs\.js/);
  }
  for (const relativePath of ["service-worker.js", "deploy-cn/service-worker.js"]) {
    const serviceWorker = readFileSync(path.join(root, relativePath), "utf8");
    assert.match(serviceWorker, new RegExp(`const THEME_PACK_VERSION = "${indexVersion}";`));
    assert.doesNotMatch(serviceWorker, /APP_SHELL[\s\S]*theme-resource-packs\.js/);
  }
});
