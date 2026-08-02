import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings専用stylesheetをside panel bundleへ含める", async () => {
  const [entry, settings] = await Promise.all([
    readFile("src/application-shell/side-panel.css", "utf8"),
    readFile("src/features/settings/styles.css", "utf8"),
  ]);

  assert.match(entry, /@import "\.\.\/features\/settings\/styles\.css";/);
  assert.match(settings, /\.settings\s*\{/);
  assert.match(settings, /\.settings__section\s*\{/);
});
