#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
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
const tailwindConfigPath = resolve(root, "tailwind.config.cjs");
const tailwindInputPath = resolve(root, "src/tailwind.css");

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

function compileStyles() {
  const cliPath = resolve(root, "node_modules/.bin/tailwindcss");
  const result = spawnSync(cliPath, [
    "--config", tailwindConfigPath,
    "--input", tailwindInputPath,
    "--minify",
  ], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`Tailwind CSS build failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`;
}

function updateHtml(path, bundleRelativePath, styleRelativePath) {
  let html = readFileSync(path, "utf8");
  html = html.replace(/\n\s*<script src="vendor\/babel\.min\.js"><\/script>/, "");
  html = html.replace(/\n\s*<script(?: defer)? src="vendor\/tailwind-runtime\.js"><\/script>/, "");
  html = html.replace(
    /\n\s*<script>\n(?:\s*window\.tailwind = window\.tailwind \|\| \{\};\n)?\s*(?:window\.)?tailwind\.config = \{[\s\S]*?\n\s*<\/script>/,
    "",
  );
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
  const styleTag = `<link rel="stylesheet" href="${styleRelativePath}" />`;
  if (/<link rel="stylesheet" href="assets\/app\/app-[a-f0-9]{12}\.css" \/>/.test(html)) {
    html = html.replace(/<link rel="stylesheet" href="assets\/app\/app-[a-f0-9]{12}\.css" \/>/, styleTag);
  } else {
    html = html.replace(/(\n\s*<\/style>)/, `$1\n    ${styleTag}`);
  }
  if (!html.includes(styleTag)) throw new Error(`Could not update application stylesheet reference in ${path}.`);
  writeFileSync(path, html, "utf8");
}

function updateServiceWorker(path, version, styleVersion, bundleRelativePath, styleRelativePath) {
  let source = readFileSync(path, "utf8");
  if (/const APP_BUNDLE_VERSION = "[^"]+";/.test(source)) {
    source = source.replace(/const APP_BUNDLE_VERSION = "[^"]+";/, `const APP_BUNDLE_VERSION = "${version}";`);
  } else {
    source = source.replace(
      /(const THEME_PACK_VERSION = "[^"]+";)/,
      `$1\nconst APP_BUNDLE_VERSION = "${version}";`,
    );
  }
  if (/const APP_STYLE_VERSION = "[^"]+";/.test(source)) {
    source = source.replace(/const APP_STYLE_VERSION = "[^"]+";/, `const APP_STYLE_VERSION = "${styleVersion}";`);
  } else {
    source = source.replace(
      /(const APP_BUNDLE_VERSION = "[^"]+";)/,
      `$1\nconst APP_STYLE_VERSION = "${styleVersion}";`,
    );
  }
  source = source.replace(
    /const CACHE_VERSION = `[^`]+`;/,
    "const CACHE_VERSION = `v3-${THEME_PACK_VERSION}-${APP_BUNDLE_VERSION}-${APP_STYLE_VERSION}`;",
  );
  source = source.replace(/^\s*"\.\/vendor\/babel\.min\.js",?\s*$/m, "");
  source = source.replace(/^\s*"\.\/vendor\/tailwind-runtime\.js",?\s*$/m, "");
  const appShellEntry = `  "./${bundleRelativePath}",`;
  if (/\s+"\.\/assets\/app\/app-[a-f0-9]{12}\.js",?/.test(source)) {
    source = source.replace(/\s+"\.\/assets\/app\/app-[a-f0-9]{12}\.js",?/, `\n${appShellEntry}`);
  } else {
    source = source.replace(/(\s+"\.\/vendor\/react-dom\.production\.min\.js",)/, `$1\n${appShellEntry}`);
  }
  const styleShellEntry = `  "./${styleRelativePath}",`;
  if (/\s+"\.\/assets\/app\/app-[a-f0-9]{12}\.css",?/.test(source)) {
    source = source.replace(/\s+"\.\/assets\/app\/app-[a-f0-9]{12}\.css",?/, `\n${styleShellEntry}`);
  } else {
    source = source.replace(appShellEntry, `${appShellEntry}\n${styleShellEntry}`);
  }
  if (!source.includes(appShellEntry.trim())) throw new Error(`Could not update app shell in ${path}.`);
  if (!source.includes(styleShellEntry.trim())) throw new Error(`Could not update stylesheet shell in ${path}.`);
  source = source.replace(/,\n\s*\n\];/, ",\n];");
  writeFileSync(path, source, "utf8");
}

extractInitialSource();
const source = readFileSync(sourcePath, "utf8");
const compiled = compileSource(source);
const styles = compileStyles();
const version = sha256(compiled).slice(0, 12);
const styleVersion = sha256(styles).slice(0, 12);
const bundleRelativePath = `assets/app/app-${version}.js`;
const styleRelativePath = `assets/app/app-${styleVersion}.css`;

for (const base of [root, resolve(root, "deploy-cn")]) {
  const outputPath = resolve(base, bundleRelativePath);
  const styleOutputPath = resolve(base, styleRelativePath);
  const outputDirectory = dirname(outputPath);
  mkdirSync(outputDirectory, { recursive: true });
  for (const entry of readdirSync(outputDirectory)) {
    const isOldScript = /^app-[a-f0-9]{12}\.js$/.test(entry) && entry !== `app-${version}.js`;
    const isOldStyle = /^app-[a-f0-9]{12}\.css$/.test(entry) && entry !== `app-${styleVersion}.css`;
    if (isOldScript || isOldStyle) {
      rmSync(resolve(outputDirectory, entry));
    }
  }
  writeFileSync(outputPath, compiled, "utf8");
  writeFileSync(styleOutputPath, styles, "utf8");
}
for (const htmlPath of htmlPaths) updateHtml(htmlPath, bundleRelativePath, styleRelativePath);
for (const serviceWorkerPath of serviceWorkerPaths) {
  updateServiceWorker(serviceWorkerPath, version, styleVersion, bundleRelativePath, styleRelativePath);
}

console.log(JSON.stringify({
  source: sourcePath.slice(root.length + 1),
  bundle: bundleRelativePath,
  stylesheet: styleRelativePath,
  version,
  styleVersion,
  sourceBytes: Buffer.byteLength(source),
  bundleBytes: Buffer.byteLength(compiled),
  stylesheetBytes: Buffer.byteLength(styles),
  htmlBytes: htmlPaths.map((path) => ({ path: path.slice(root.length + 1), bytes: readFileSync(path).byteLength })),
}, null, 2));
