import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { userEvent } from "@testing-library/user-event";

import { createShellPresentation } from "../../src/application-shell/shell-presentation.js";
import { createSettingsFeatureRegistration } from "../../src/features/settings/public.js";
import { resetUiLanguageForTest } from "../../src/ui-language/store.js";
import { message, resolverFor } from "../../src/ui-messages/public.js";

afterEach(() => resetUiLanguageForTest());

test("settings の言語変更は navigation と状態文言を更新し mount identity を保持する", async () => {
  const shellContainer = document.createElement("div");
  document.body.append(shellContainer);
  const presentation = createShellPresentation().mount({
    shellContainer,
    onNavigate() {},
    onRetry() {},
  });
  assert.equal(presentation.ok, true);
  if (!presentation.ok) return;

  const registration = createSettingsFeatureRegistration({
    backupRestore: {
      async mount() {
        return { async unmount() {} };
      },
    },
  });
  const settingsHandle = await registration.mount({
    container: presentation.value.featureContainer,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError() {},
  });
  presentation.value.publish(
    {
      kind: "maintenance",
      selected: registration.id,
      message: message("shell.maintenanceActive"),
    },
    [{ id: registration.id, ...registration.navigation }],
  );

  const settingsRoot = shellContainer.querySelector("[data-region='settings']");
  const featureContainer = presentation.value.featureContainer;
  const navigation = shellContainer.querySelector<HTMLButtonElement>(
    "[data-feature-id='settings']",
  );
  const language = featureContainer.querySelector<HTMLSelectElement>(
    "[data-region='language-select']",
  );
  assert.ok(settingsRoot);
  assert.ok(navigation);
  assert.ok(language);
  const japaneseNavigation = navigation.title;
  const japaneseStatus = shellContainer.querySelector(
    ".shell-status--maintenance",
  )?.textContent;

  await userEvent.setup().selectOptions(language, "en");

  assert.equal(
    shellContainer.querySelector("[data-region='settings']"),
    settingsRoot,
  );
  assert.equal(presentation.value.featureContainer, featureContainer);
  const english = resolverFor("en");
  assert.notEqual(navigation.title, japaneseNavigation);
  assert.equal(navigation.title, english("nav.settings"));
  assert.notEqual(
    shellContainer.querySelector(".shell-status--maintenance")?.textContent,
    japaneseStatus,
  );
  assert.match(
    shellContainer.querySelector(".shell-status--maintenance")?.textContent ??
      "",
    new RegExp(english("shell.maintenanceActive")),
  );
  assert.equal(shellContainer.querySelector("header select"), null);

  await settingsHandle.unmount();
  presentation.value.stop();
  shellContainer.remove();
});
