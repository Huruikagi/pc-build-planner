import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createInMemoryLanguagePreferencePort } from "../../src/ui-language/preference-store.js";
import {
  initializeUiLanguage,
  resetUiLanguageForTest,
  uiLanguageStore,
} from "../../src/ui-language/store.js";

afterEach(() => {
  resetUiLanguageForTest();
});

test("初期化前のシードはソース言語(ja)である", () => {
  assert.equal(uiLanguageStore.getSnapshot(), "ja");
});

test("initializeはブラウザ表示言語を即座に反映したうえで、保存値があれば置き換える", async () => {
  const preferences = createInMemoryLanguagePreferencePort("en");
  const resolved = await initializeUiLanguage({
    preferences,
    browserUiLanguage: () => "ja",
  });
  assert.equal(resolved, "en");
  assert.equal(uiLanguageStore.getSnapshot(), "en");
});

test("initializeは保存値が無ければブラウザ表示言語を対応言語へ対応付ける", async () => {
  const preferences = createInMemoryLanguagePreferencePort();
  const resolved = await initializeUiLanguage({
    preferences,
    browserUiLanguage: () => "ja-JP",
  });
  assert.equal(resolved, "ja");
});

test("initializeは冪等であり、2回目は既存の解決結果をそのまま返す", async () => {
  const preferences = createInMemoryLanguagePreferencePort("en");
  await initializeUiLanguage({ preferences, browserUiLanguage: () => "ja" });
  uiLanguageStore.setLanguage("ja");

  const secondCallPreferences = createInMemoryLanguagePreferencePort("en");
  const resolved = await initializeUiLanguage({
    preferences: secondCallPreferences,
    browserUiLanguage: () => "en",
  });

  assert.equal(resolved, "ja");
  assert.equal(uiLanguageStore.getSnapshot(), "ja");
});

test("setLanguageは同期的に値を更新し、購読者へ通知する", () => {
  const notified: string[] = [];
  const unsubscribe = uiLanguageStore.subscribe((language) => {
    notified.push(language);
  });
  uiLanguageStore.setLanguage("en");
  assert.equal(uiLanguageStore.getSnapshot(), "en");
  assert.deepEqual(notified, ["en"]);
  unsubscribe();
});

test("setLanguageは同値設定では通知しない", () => {
  uiLanguageStore.setLanguage("en");
  let notifiedCount = 0;
  const unsubscribe = uiLanguageStore.subscribe(() => {
    notifiedCount += 1;
  });
  uiLanguageStore.setLanguage("en");
  assert.equal(notifiedCount, 0);
  unsubscribe();
});

test("setLanguageは保存が失敗しても値を巻き戻さない", async () => {
  const failingPreferences = {
    read: async () => ({ ok: true as const, value: undefined }),
    write: async () => ({
      ok: false as const,
      error: { code: "storage-write-failed" as const },
    }),
  };
  await initializeUiLanguage({
    preferences: failingPreferences,
    browserUiLanguage: () => "ja",
  });
  uiLanguageStore.setLanguage("en");
  // Give the fire-and-forget write a microtask turn to settle.
  await Promise.resolve();
  assert.equal(uiLanguageStore.getSnapshot(), "en");
});

test("購読解除後は通知が来ない", () => {
  let notifiedCount = 0;
  const unsubscribe = uiLanguageStore.subscribe(() => {
    notifiedCount += 1;
  });
  unsubscribe();
  uiLanguageStore.setLanguage("en");
  assert.equal(notifiedCount, 0);
});

test("resetUiLanguageForTestは初期状態へ戻す", async () => {
  const preferences = createInMemoryLanguagePreferencePort("en");
  await initializeUiLanguage({ preferences, browserUiLanguage: () => "en" });
  assert.equal(uiLanguageStore.getSnapshot(), "en");

  resetUiLanguageForTest();

  assert.equal(uiLanguageStore.getSnapshot(), "ja");
});
