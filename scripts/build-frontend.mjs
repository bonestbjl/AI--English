#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Babel = require("../vendor/babel.min.js");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "src/app.jsx");
const htmlPaths = [resolve(root, "index.html"), resolve(root, "deploy-cn/index.html")];
const serviceWorkerPaths = [resolve(root, "service-worker.js"), resolve(root, "deploy-cn/service-worker.js")];
const coverManifestPath = resolve(root, "assets/theme-covers/manifest.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extractInitialSource() {
  if (existsSync(sourcePath)) return;
  const html = readFileSync(htmlPaths[0], "utf8");
  const match = html.match(/<script type="text\/babel">\n([\s\S]*?)\n    <\/script>/);
  if (!match) throw new Error("Missing inline text/babel application source.");
  const source = match[1]
    .split("\n")
    .map((line) => line.startsWith("      ") ? line.slice(6) : line)
    .join("\n")
    .trimEnd() + "\n";
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, source, "utf8");
}

function injectCoverManifest(source) {
  const marker = "/*__RSE_THEME_COVER_MANIFEST__*/ {}";
  if (!source.includes(marker)) return source;
  if (!existsSync(coverManifestPath)) {
    throw new Error("Theme cover manifest is missing. Run npm run generate:theme-covers first.");
  }
  const manifest = JSON.parse(readFileSync(coverManifestPath, "utf8"));
  return source.replace(marker, JSON.stringify(manifest.themes || {}));
}

function compileSource(source) {
  const result = Babel.transform(injectCoverManifest(source), {
    presets: ["env", ["react", { runtime: "classic" }]],
    comments: false,
    compact: true,
    sourceType: "script",
  });
  if (!result?.code) throw new Error("Babel did not return compiled application code.");
  return `${result.code}\n`;
}

function updateHtml(path, bundleRelativePath) {
  let html = readFileSync(path, "utf8");
  html = html.replace(/\n\s*<script src="vendor\/babel\.min\.js"><\/script>/, "");
  html = html.replace(
    /<script type="text\/babel">\n[\s\S]*?\n    <\/script>/,
    `<script defer src="${bundleRelativePath}"></script>`,
  );
  html = html.replace(
    /<script defer src="assets\/app\/app-[a-f0-9]{12}\.js"><\/script>/,
    `<script defer src="${bundleRelativePath}"></script>`,
  );
  if (!html.includes(`<script defer src="${bundleRelativePath}"></script>`)) {
    throw new Error(`Could not update application bundle reference in ${path}.`);
  }
  writeFileSync(path, html, "utf8");
}

function updateServiceWorker(path, version, bundleRelativePath) {
  let source = readFileSync(path, "utf8");
  if (/const APP_BUNDLE_VERSION = "[^"]+";/.test(source)) {
    source = source.replace(/const APP_BUNDLE_VERSION = "[^"]+";/, `const APP_BUNDLE_VERSION = "${version}";`);
  } else {
    source = source.replace(
      /(const THEME_PACK_VERSION = "[^"]+";)/,
      `$1\nconst APP_BUNDLE_VERSION = "${version}";`,
    );
  }
  source = source.replace(
    /const CACHE_VERSION = `[^`]+`;/,
    "const CACHE_VERSION = `v2-${THEME_PACK_VERSION}-${APP_BUNDLE_VERSION}`;",
  );
  source = source.replace(/^\s*"\.\/vendor\/babel\.min\.js",?\s*$/m, "");
  const appShellEntry = `  "./${bundleRelativePath}",`;
  if (/\s+"\.\/assets\/app\/app-[a-f0-9]{12}\.js",?/.test(source)) {
    source = source.replace(/\s+"\.\/assets\/app\/app-[a-f0-9]{12}\.js",?/, `\n${appShellEntry}`);
  } else {
    source = source.replace(/(\s+"\.\/vendor\/react-dom\.production\.min\.js",)/, `$1\n${appShellEntry}`);
  }
  source = source.replace(/("\.\/assets\/app\/app-[a-f0-9]{12}\.js",)\s+("\.\/vendor\/tailwind-runtime\.js",)/, "$1\n  $2");
  if (!source.includes(appShellEntry.trim())) throw new Error(`Could not update app shell in ${path}.`);
  writeFileSync(path, source, "utf8");
}

extractInitialSource();
const source = readFileSync(sourcePath, "utf8");
const compiled = compileSource(source);
const version = sha256(compiled).slice(0, 12);
const bundleRelativePath = `assets/app/app-${version}.js`;

for (const base of [root, resolve(root, "deploy-cn")]) {
  const outputPath = resolve(base, bundleRelativePath);
  const outputDirectory = dirname(outputPath);
  mkdirSync(outputDirectory, { recursive: true });
  for (const entry of readdirSync(outputDirectory)) {
    if (/^app-[a-f0-9]{12}\.js$/.test(entry) && entry !== `app-${version}.js`) {
      rmSync(resolve(outputDirectory, entry));
    }
  }
  writeFileSync(outputPath, compiled, "utf8");
}
for (const htmlPath of htmlPaths) updateHtml(htmlPath, bundleRelativePath);
for (const serviceWorkerPath of serviceWorkerPaths) updateServiceWorker(serviceWorkerPath, version, bundleRelativePath);

console.log(JSON.stringify({
  source: sourcePath.slice(root.length + 1),
  bundle: bundleRelativePath,
  version,
  sourceBytes: Buffer.byteLength(source),
  bundleBytes: Buffer.byteLength(compiled),
  htmlBytes: htmlPaths.map((path) => ({ path: path.slice(root.length + 1), bytes: readFileSync(path).byteLength })),
}, null, 2));
