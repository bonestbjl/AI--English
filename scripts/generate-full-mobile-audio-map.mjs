#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { manifestJsonPath, writeRuntimeAudioMaps } from "./lib/mobile-audio-pipeline.mjs";

const manifest = JSON.parse(readFileSync(manifestJsonPath, "utf8"));
console.log(JSON.stringify(writeRuntimeAudioMaps(manifest), null, 2));
