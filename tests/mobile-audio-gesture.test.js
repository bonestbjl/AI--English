const assert = require("node:assert/strict");
const test = require("node:test");

test("mobile audio click path preserves the Android user gesture", async () => {
  const { runRuntimeAudioTests } = await import("../scripts/test-mobile-audio-runtime.mjs");
  const result = await runRuntimeAudioTests();
  assert.equal(result.desktopSpeechSynthesis, true);
  assert.equal(result.missingMp3RequiresSecondClick, true);
  assert.equal(result.notAllowedErrorVisible, true);
  assert.equal(result.laundryAndroidChromeMp3, true);
  assert.equal(result.laundryAndroidWebViewMp3, true);
  assert.equal(result.laundryAndroidWeChatMp3, true);
  assert.equal(result.touchPointerUpTriggersPlayback, true);
  assert.equal(result.touchClickIsDeduplicated, true);
  assert.equal(result.nativeCaptureDelegatesPlayback, true);
  assert.equal(result.overlayFallbackFindsAudioTrigger, true);
  assert.equal(result.registryUsesCurrentScenePayload, true);
  assert.equal(result.missingRegistryEntryIsVisible, true);
  assert.equal(result.nativeAndReactTouchIsDeduplicated, true);
  assert.equal(result.mouseAndKeyboardClickProtected, true);
  assert.equal(result.immediatePlaybackVisualState, true);
});
