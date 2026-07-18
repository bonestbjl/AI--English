#!/usr/bin/env node

import {
  buildManifest,
  manifestCsvPath,
  manifestJsonPath,
  root,
  writeManifestArtifacts,
} from "./lib/mobile-audio-pipeline.mjs";

try {
  const manifest = buildManifest();
  writeManifestArtifacts(manifest);
  console.log(JSON.stringify({
    json: manifestJsonPath.replace(`${root}/`, ""),
    csv: manifestCsvPath.replace(`${root}/`, ""),
    summary: manifest.summary,
    themes: manifest.themes,
  }, null, 2));
} catch (error) {
  console.error(`Mobile audio manifest failed: ${error.message}`);
  process.exit(1);
}
