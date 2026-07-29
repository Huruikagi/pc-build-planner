import assert from "node:assert/strict";
import test from "node:test";

import { render } from "@testing-library/react";

import {
  hasNavIcon,
  NavIcon,
} from "../../../src/application-shell/nav-icons.js";
import {
  SETTINGS_IDENTIFIERS,
  SETTINGS_MESSAGE_KEYS,
  settingsFeatureId,
} from "../../../src/features/settings/public.js";
import { resolverFor } from "../../../src/ui-messages/public.js";

test("settings の semantic message は公開 resolver から両言語で解決できる", () => {
  assert.equal(settingsFeatureId, "settings");
  for (const key of Object.values(SETTINGS_MESSAGE_KEYS)) {
    assert.notEqual(resolverFor("ja")(key), key);
    assert.notEqual(resolverFor("en")(key), key);
  }
});

test("settings locator は表示文言に依存しない安定識別子を公開する", () => {
  assert.deepEqual(SETTINGS_IDENTIFIERS, {
    feature: "settings",
    pageRegion: "settings",
    languageRegion: "language",
    backupRegion: "backup-restore",
    backupHost: "backup-restore-host",
    languageSelectAction: "language-select",
  });
});

test("settings navigation icon は同梱 SVG として描画できる", () => {
  assert.equal(hasNavIcon("settings"), true);
  const view = render(<NavIcon name="settings" />);
  assert.ok(view.container.querySelector("svg"));
  assert.equal(
    view.container.querySelector("svg")?.getAttribute("aria-hidden"),
    "true",
  );
});
