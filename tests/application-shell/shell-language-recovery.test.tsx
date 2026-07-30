import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import type { FeatureId } from "../../src/application-shell/contracts.js";
import { ShellView } from "../../src/application-shell/shell-view.js";
import {
  defaultMessageResolver,
  message,
} from "../../src/ui-messages/public.js";

const settingsId = "settings" as FeatureId;
const settingsNavigation = [
  { id: settingsId, labelKey: "nav.settings" as const },
];

test("loading は header control なしで二言語案内と回復操作を同じ status に表示する", () => {
  const markup = renderToStaticMarkup(
    <ShellView
      navigation={settingsNavigation}
      onNavigate={() => {}}
      onRetry={() => {}}
      state={{ kind: "loading" }}
    />,
  );

  assert.match(markup, /設定 \/ Settings/);
  assert.doesNotMatch(markup, /<nav/);
  assert.doesNotMatch(markup, /data-region="language-select"/);
  assert.match(markup, /class="shell-status"[^>]*>[\s\S]*data-action="retry"/);
});

test("ready、maintenance、feature-local failure は settings navigation を維持する", () => {
  const states = [
    { kind: "ready", selected: settingsId } as const,
    {
      kind: "maintenance",
      selected: settingsId,
      message: message("shell.maintenanceActive"),
    } as const,
    {
      kind: "error",
      message: message("shell.featureMountFailed", { featureId: "fixture" }),
      recoverable: true,
    } as const,
  ];

  for (const state of states) {
    const markup = renderToStaticMarkup(
      <ShellView
        navigation={settingsNavigation}
        onNavigate={() => {}}
        onRetry={() => {}}
        state={state}
      />,
    );
    assert.match(markup, /<nav/);
    assert.match(markup, /data-feature-id="settings"/);
    assert.doesNotMatch(markup, /data-region="language-select"/);
  }
});

test("startup error は二言語案内と回復操作を表示し navigation を提示しない", () => {
  const markup = renderToStaticMarkup(
    <ShellView
      navigation={[]}
      onNavigate={() => {}}
      onRetry={() => {}}
      state={{
        kind: "error",
        message: message("shell.startupFailed"),
        recoverable: true,
      }}
    />,
  );

  assert.match(markup, /設定 \/ Settings/);
  assert.doesNotMatch(markup, /<nav/);
  assert.match(markup, /data-action="retry"/);
  assert.match(markup, new RegExp(defaultMessageResolver("shell.retry")));
  assert.doesNotMatch(markup, /data-region="language-select"/);
});
