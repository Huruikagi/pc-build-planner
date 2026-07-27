import assert from "node:assert/strict";
import test from "node:test";
import type {
  FeatureId,
  ShellViewState,
} from "../../src/application-shell/contracts.js";
import {
  projectTransientNotice,
  type TransientNoticeEvent,
} from "../../src/application-shell/transient-surface-notice.js";
import { message } from "../../src/ui-messages/public.js";

test("noticeはread成功または有効activation受理だけでclearする", () => {
  const initial: ShellViewState = {
    kind: "ready",
    selected: "planner" as FeatureId,
  };
  const failed = projectTransientNotice(initial, {
    kind: "session-read-failed",
    message: message("shell.transientActivationUnavailable", {
      detail: "retry",
    }),
  });
  assert.equal(failed.kind, "ready");
  if (failed.kind !== "ready") return;
  assert.ok(failed.transientNotice);

  const unrelated: TransientNoticeEvent = { kind: "panel-opened" };
  assert.deepEqual(projectTransientNotice(failed, unrelated), failed);
  assert.equal(
    "transientNotice" in
      projectTransientNotice(failed, { kind: "session-read-succeeded" }),
    false,
  );
  assert.equal(
    "transientNotice" in
      projectTransientNotice(failed, { kind: "activation-accepted" }),
    false,
  );
});

test("loadingとglobal errorへnoticeを投影しない", () => {
  for (const state of [
    { kind: "loading" as const },
    {
      kind: "error" as const,
      message: message("shell.startupFailed"),
      recoverable: true,
    },
  ]) {
    assert.deepEqual(
      projectTransientNotice(state, {
        kind: "session-read-failed",
        message: message("shell.transientActivationUnavailable", {
          detail: "retry",
        }),
      }),
      state,
    );
  }
});
