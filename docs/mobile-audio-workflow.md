# Real Scene English Mobile Audio Workflow

This workflow produces static mobile MP3 files before release. It never calls TTS when a learner plays audio. Desktop speech remains on the existing `speechSynthesis` path.

## Protected Runtime Rules

- `getMobileAudioUrl()` returns `null` on non-mobile devices.
- Mobile playback uses the static map in `assets/audio/full-mobile-audio.js`.
- A missing or failed MP3 falls back to the existing `speakEnglish()` browser speech path.
- Only one `activeLearningAudio` element is active; a new click stops the previous file.
- Chrome keeps Google US English priority and Safari keeps Karen priority.
- Zoo and Fruit Shop files are protected by `mobile-audio-protected-baseline.json`.

## Current Inventory

The pre-workflow audit found 2,874 MP3 files in `assets/audio` and a synchronized copy in `deploy-cn/assets/audio`. Zoo and Fruit Shop word files include the approved Jianying/CapCut exports; their dialogue and sentence files include existing Volcengine/Seed TTS output. The set contains both 44.1 kHz stereo 128 kbps word exports and 24 kHz mono 64 kbps generated speech. Healthy legacy files are not automatically re-encoded.

The old `full-audio-manifest.csv` generator hard-coded 13 themes. The new scanner reads `sceneCards` plus the real scene/dialogue/More Words declarations, so Laundry and future conventionally named themes are discovered automatically.

## Standard Incremental Flow

1. Rebuild the deduplicated inventory:

   ```sh
   node scripts/build-mobile-audio-manifest.mjs
   ```

2. Review missing work without contacting a provider:

   ```sh
   node scripts/generate-mobile-audio.mjs --all --provider doubao --only-missing --dry-run
   node scripts/generate-mobile-audio.mjs --theme laundry --provider doubao --only-missing --dry-run
   ```

3. After human approval of voice and cost, generate only missing files:

   ```sh
   node scripts/generate-mobile-audio.mjs --theme laundry --provider doubao --only-missing --confirm-paid-api
   ```

   The paid path requires `VOLCENGINE_API_KEY`, `VOLCENGINE_RESOURCE_ID`, `VOLCENGINE_ENDPOINT`, `VOLCENGINE_SPEAKER`, and `VOLCENGINE_VOICE_PROFILE=mobile-en-learning-v1`. `VOLCENGINE_WORD_SPEAKER` and `VOLCENGINE_SAMPLE_RATE` are optional. Secrets are read only from the environment and are redacted from provider errors.

4. Normalize only newly generated/imported files:

   ```sh
   node scripts/postprocess-mobile-audio.mjs --theme laundry --dry-run
   node scripts/postprocess-mobile-audio.mjs --theme laundry
   ```

   Actual processing requires `ffmpeg`. It preserves a short edge pad, normalizes to -18 LUFS / -2 dBTP, and writes 24 kHz mono 64 kbps MP3. Existing approved files are skipped unless `--force-existing` is explicitly supplied.

5. Generation and Jianying import refresh both mobile-only maps automatically. To rebuild only the map from an unchanged manifest, run:

   ```sh
   node scripts/generate-full-mobile-audio-map.mjs
   ```

6. Run the release gate:

   ```sh
   node scripts/validate-mobile-audio.mjs
   ```

   During an approved pre-generation phase, use `--allow-missing`. Use `--quick` only for a fast metadata pass; the default also decodes files and checks severe silence/clipping issues.

## Deduplication and Cache Key

`mobile-audio-manifest.json` stores one asset per SHA-256 identity built from:

- normalized text (NFKC, normalized quotes, collapsed whitespace, lowercase);
- voice profile;
- language;
- synthesis rate;
- tone profile.

Every hotspot, sentence, More Word, Word Book source word, scene intro, NPC line, option, reply, and action feedback points to that asset through `usages`. Normal and slow buttons reuse one source MP3; the existing mobile player applies its current playback-rate behavior at runtime. A text/profile change creates a new hash and therefore a new output path. Existing files are skipped, so interrupted runs resume without rebilling completed assets.

`mobile-en-learning-v1` is the versioned voice profile in the cache identity. If the approved provider speaker changes, bump that profile before rebuilding; generated assets also record the resolved provider voice for auditability.

## Jianying / CapCut Bridge

No stable command-line Jianying project API or verified GUI automation exists in this repository. Existing Zoo/Fruit Shop scripts already depend on a human export plus CSV/SRT alignment. The supported bridge therefore leaves only one manual production step:

```sh
node scripts/prepare-jianying-audio.mjs --theme laundry
```

This writes:

- `audio-workbench/jianying/jianying-audio-manifest.csv`
- `audio-workbench/jianying/jianying-audio-text.txt`

Create the voices in order and export either numbered MP3 files (`0001.mp3`, `0002.mp3`, ...) or one MP3 with a matching SRT. Then import:

```sh
node scripts/import-jianying-audio.mjs --input-dir path/to/exported-files
# or
node scripts/import-jianying-audio.mjs --audio path/to/export.mp3 --srt path/to/export.srt
```

The importer validates count/order, trims, normalizes, transcodes, mirrors files into `deploy-cn`, and updates manifest provenance. It requires `ffmpeg` for the actual import; `--dry-run` validates inputs without changing audio.

## Validation Coverage

The validator checks manifest freshness, missing and mirrored files, MP3 frame validity and duration, deep decode, severe edge silence, severe clipping, byte duplicates, orphan MP3s, portable relative paths, runtime-map coverage, stale mappings, Zoo/Fruit Shop protected hashes, HTML/map synchronization, and executable mobile/desktop playback behavior. Any release-blocking issue exits nonzero and is written to `mobile-audio-validation-report.json`.

## Provider Notes

- `existing`: audit/repair already available static files; no network generation.
- `doubao`: one-time offline generation through Volcengine Seed TTS; never used by the browser.
- `jianying-import`: offline bridge described above.

No reliable price configuration is stored in the project, so the workflow reports API call count and missing character count but does not guess cost.
