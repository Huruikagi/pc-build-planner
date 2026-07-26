import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { ApplicationCompositionRoot } from "../../src/application-shell/contracts.js";
import { startSidePanelWithLanguage } from "../../src/runtime/side-panel-bootstrap.js";
import { createLanguagePreferencePort } from "../../src/ui-language/preference-store.js";
import { resetUiLanguageForTest } from "../../src/ui-language/store.js";

const originalLang = document.documentElement.lang;

afterEach(() => {
  resetUiLanguageForTest();
  document.documentElement.lang = originalLang;
});

const api = Object.freeze({ ping: () => "pong" });

const fakeRoot = (
  onStart: () => void,
): ApplicationCompositionRoot<typeof api> => ({
  async start() {
    onStart();
    return { ok: true, value: { api } };
  },
  async stop() {},
});

/** `createSidePanelBootstrap.start()` requires this host to resolve `ok`. */
const withHost = <T>(run: () => Promise<T>): Promise<T> => {
  const host = document.createElement("main");
  host.id = "application-shell";
  document.body.append(host);
  return run().finally(() => host.remove());
};

test("言語ランタイムの初期化と文書の言語同期がシェル起動より前に完了する", async () => {
  const order: string[] = [];
  const languagePlatform = {
    preferences: {
      read: async () => {
        order.push("read-preferences");
        return { ok: true as const, value: undefined };
      },
      write: async () => ({ ok: true as const, value: undefined }),
    },
    browserUiLanguage: () => {
      order.push("browser-ui-language");
      return "ja";
    },
  };
  const root = fakeRoot(() => order.push("shell-start"));

  const result = await withHost(() =>
    startSidePanelWithLanguage({ root, document, languagePlatform }),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(order, [
    "browser-ui-language",
    "read-preferences",
    "shell-start",
  ]);
  assert.equal(document.documentElement.lang, "ja");
});

test("保存ポートが利用できなくても初期化はシェル起動を妨げない", async () => {
  const brokenStorage = {
    get: async (): Promise<Record<string, unknown>> => {
      throw new Error("storage unavailable");
    },
    set: async (): Promise<void> => {
      throw new Error("storage unavailable");
    },
  };
  const languagePlatform = {
    preferences: createLanguagePreferencePort(brokenStorage),
    browserUiLanguage: () => "ja",
  };
  let started = false;
  const root = fakeRoot(() => {
    started = true;
  });

  const result = await withHost(() =>
    startSidePanelWithLanguage({ root, document, languagePlatform }),
  );

  assert.equal(started, true);
  assert.equal(result.ok, true);
});
