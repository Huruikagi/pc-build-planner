import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { SettingsView } from "../../../src/features/settings/view.js";
import { LanguageProvider } from "../../../src/ui-language/public.js";
import { resetUiLanguageForTest } from "../../../src/ui-language/store.js";

afterEach(() => {
  cleanup();
  resetUiLanguageForTest();
});

test("設定、表示言語、backup 区画を見出し階層と安定識別子で描画する", () => {
  const view = render(
    <LanguageProvider>
      <SettingsView />
    </LanguageProvider>,
  );

  const settings = view.container.querySelector("[data-region='settings']");
  const language = settings?.querySelector("[data-region='language']");
  const backup = settings?.querySelector("[data-region='backup-restore']");
  assert.ok(settings);
  assert.ok(language);
  assert.ok(backup);
  assert.equal(settings.querySelectorAll(":scope > h2").length, 1);
  assert.equal(language.querySelectorAll(":scope > h3").length, 1);
  assert.equal(backup.querySelectorAll(":scope > h3").length, 1);
  assert.equal(
    language.querySelectorAll("[data-region='language-select']").length,
    1,
  );
  assert.equal(
    backup.querySelectorAll("[data-region='language-select']").length,
    0,
  );
  assert.equal(
    backup.querySelectorAll("[data-region='backup-restore-host']").length,
    1,
  );
});

test("言語変更で文言だけを更新し settings root、backup host、入力、scroll を保持する", async () => {
  const user = userEvent.setup();
  const view = render(
    <LanguageProvider>
      <SettingsView />
    </LanguageProvider>,
  );
  const settings = view.container.querySelector<HTMLElement>(
    "[data-region='settings']",
  );
  const host = view.container.querySelector<HTMLElement>(
    "[data-region='backup-restore-host']",
  );
  const select = view.container.querySelector<HTMLSelectElement>(
    "[data-region='language-select']",
  );
  assert.ok(settings);
  assert.ok(host);
  assert.ok(select);
  host.scrollTop = 37;
  const input = document.createElement("input");
  input.value = "unfinished";
  host.append(input);
  const before = view.container.textContent;

  await user.selectOptions(select, "en");

  assert.equal(
    view.container.querySelector("[data-region='settings']"),
    settings,
  );
  assert.equal(
    view.container.querySelector("[data-region='backup-restore-host']"),
    host,
  );
  assert.equal(host.querySelector("input"), input);
  assert.equal(input.value, "unfinished");
  assert.equal(host.scrollTop, 37);
  assert.notEqual(view.container.textContent, before);
  assert.match(view.container.textContent ?? "", /Settings/);
});
