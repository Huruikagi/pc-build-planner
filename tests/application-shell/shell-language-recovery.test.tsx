import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ShellView } from "../../src/application-shell/shell-view.js";
import {
  defaultMessageResolver,
  message,
} from "../../src/ui-messages/public.js";

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
