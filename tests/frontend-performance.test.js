const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("frontend uses a mirrored versioned production bundle without runtime Babel", () => {
  const index = readFileSync(path.join(root, "index.html"), "utf8");
  const deploy = readFileSync(path.join(root, "deploy-cn/index.html"), "utf8");
  assert.equal(index, deploy);
  assert.ok(Buffer.byteLength(index) < 60000, "initial HTML exceeds the 60 KiB budget");
  assert.doesNotMatch(index, /babel\.min\.js|type="text\/babel"/);
  const bundle = index.match(/assets\/app\/app-([a-f0-9]{12})\.js/)?.[0];
  assert.ok(bundle, "versioned application bundle is missing");
  const sourceBundle = path.join(root, bundle);
  const deployBundle = path.join(root, "deploy-cn", bundle);
  assert.ok(existsSync(sourceBundle) && existsSync(deployBundle));
  assert.equal(createHash("sha256").update(readFileSync(sourceBundle)).digest("hex"), createHash("sha256").update(readFileSync(deployBundle)).digest("hex"));
  for (const serviceWorkerPath of ["service-worker.js", "deploy-cn/service-worker.js"]) {
    const serviceWorker = readFileSync(path.join(root, serviceWorkerPath), "utf8");
    assert.match(serviceWorker, new RegExp(bundle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(serviceWorker, /babel\.min\.js/);
  }
});

test("all theme cards use budgeted optimized covers with stable fallback", () => {
  const appSource = readFileSync(path.join(root, "src/app.jsx"), "utf8");
  const manifest = JSON.parse(readFileSync(path.join(root, "assets/theme-covers/manifest.json"), "utf8"));
  const themes = Object.entries(manifest.themes);
  assert.equal(themes.length, 14);
  assert.match(appSource, /loading=\{sceneIndex < 3 \? "eager" : "lazy"\}/);
  assert.match(appSource, /fetchPriority=\{sceneIndex === 0 \? "high"/);
  assert.match(appSource, /data-cover-failed=/);
  assert.doesNotMatch(appSource, /requestIdleCallback\(prefetch/);
  for (const [theme, item] of themes) {
    assert.ok(statSync(path.join(root, item.webp)).size <= 120000, `${theme} cover exceeds 120 KiB`);
    assert.equal(readFileSync(path.join(root, item.webp)).compare(readFileSync(path.join(root, "deploy-cn", item.webp))), 0);
  }
});
