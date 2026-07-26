import assert from "node:assert/strict";
import test from "node:test";
import {
  createChromeLanguagePreferencePortIfAvailable,
  createInMemoryLanguagePreferencePort,
  createLanguagePreferencePort,
} from "../../src/ui-language/preference-store.js";

/** Minimal storage double letting each test control get/set behavior. */
const fakeStorage = (overrides: {
  get?: (key: string) => Promise<Record<string, unknown>>;
  set?: (items: Record<string, unknown>) => Promise<void>;
}) => ({
  get: overrides.get ?? (async () => ({})),
  set: overrides.set ?? (async () => undefined),
});

test("readは保存値が無い場合ok(undefined)を返す", async () => {
  const port = createLanguagePreferencePort(fakeStorage({}));
  const result = await port.read();
  assert.deepEqual(result, { ok: true, value: undefined });
});

test("readは壊れた保存値(数値・オブジェクト・未対応言語)をok(undefined)へ落とす", async () => {
  for (const brokenValue of [42, { language: "ja" }, "fr", "", null]) {
    const port = createLanguagePreferencePort(
      fakeStorage({ get: async () => ({ uiLanguage: brokenValue }) }),
    );
    const result = await port.read();
    assert.deepEqual(
      result,
      { ok: true, value: undefined },
      String(brokenValue),
    );
  }
});

test("readは正当な保存値を正規化して返す", async () => {
  const port = createLanguagePreferencePort(
    fakeStorage({ get: async () => ({ uiLanguage: "ja-JP" }) }),
  );
  const result = await port.read();
  assert.deepEqual(result, { ok: true, value: "ja" });
});

test("readは保存API不在(例外)をResultのerrへ変換し、例外を漏らさない", async () => {
  const port = createLanguagePreferencePort(
    fakeStorage({
      get: async () => {
        throw new Error("storage unavailable");
      },
    }),
  );
  const result = await port.read();
  assert.deepEqual(result, {
    ok: false,
    error: { code: "storage-unavailable" },
  });
});

test("writeは書き込み失敗をResultのerrへ変換し、例外を漏らさない", async () => {
  const port = createLanguagePreferencePort(
    fakeStorage({
      set: async () => {
        throw new Error("write failed");
      },
    }),
  );
  const result = await port.write("en");
  assert.deepEqual(result, {
    ok: false,
    error: { code: "storage-write-failed" },
  });
});

test("writeは唯一のキーへ言語コード1つだけを書く", async () => {
  const written: Record<string, unknown>[] = [];
  const port = createLanguagePreferencePort(
    fakeStorage({
      set: async (items) => {
        written.push(items);
      },
    }),
  );
  await port.write("en");
  assert.deepEqual(written, [{ uiLanguage: "en" }]);
});

test("インメモリ実装は書き込んだ値をそのまま読み戻す", async () => {
  const port = createInMemoryLanguagePreferencePort();
  assert.deepEqual(await port.read(), { ok: true, value: undefined });
  await port.write("en");
  assert.deepEqual(await port.read(), { ok: true, value: "en" });
});

test("インメモリ実装はinitial値から開始できる", async () => {
  const port = createInMemoryLanguagePreferencePort("ja");
  assert.deepEqual(await port.read(), { ok: true, value: "ja" });
});

test("Chrome APIが存在しない実行環境ではundefinedを返す", () => {
  assert.equal(createChromeLanguagePreferencePortIfAvailable(), undefined);
});
