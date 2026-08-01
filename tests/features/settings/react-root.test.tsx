import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { act } from "react";

import { mountSettingsReactRoot } from "../../../src/features/settings/react-root.js";
import { resetUiLanguageForTest } from "../../../src/ui-language/store.js";

afterEach(() => resetUiLanguageForTest());

test("初回 layout を同期確定して単一の backup host を返す", async () => {
  const container = document.createElement("div");
  let root!: ReturnType<typeof mountSettingsReactRoot>;
  await act(() => {
    root = mountSettingsReactRoot(container);
  });
  const host = container.querySelector("[data-region='backup-restore-host']");
  assert.ok(host);
  assert.equal(root.backupRestoreHost, host);
  assert.equal(
    container.querySelectorAll("[data-region='backup-restore-host']").length,
    1,
  );
  await act(() => root.unmount());
});

test("root cleanup は container を空にし二重 unmount を無害化する", async () => {
  const container = document.createElement("div");
  let root!: ReturnType<typeof mountSettingsReactRoot>;
  await act(() => {
    root = mountSettingsReactRoot(container);
  });
  await act(() => root.unmount());
  await act(() => root.unmount());
  assert.equal(container.childElementCount, 0);
});
