import assert from "node:assert/strict";
import test from "node:test";

import type { ApplicationCompositionRoot } from "../../src/application-shell/contracts.js";
import { createSidePanelBootstrap } from "../../src/application-shell/runtime-bootstrap.js";
import {
  defaultMessageResolver,
  message,
} from "../../src/ui-messages/public.js";

const api = Object.freeze({
  projects: { list: () => ["alpha"] },
  builds: { current: () => "draft" },
});

test("複数featureのroot APIを一度だけ開始して公開する", async () => {
  const host = document.createElement("main");
  host.id = "application-shell";
  document.body.append(host);
  let starts = 0;
  const root: ApplicationCompositionRoot<typeof api> = {
    async start() {
      starts += 1;
      return { ok: true, value: { api } };
    },
    async stop() {},
  };
  const bootstrap = createSidePanelBootstrap({ root, document });

  const [first, second] = await Promise.all([
    bootstrap.start(),
    bootstrap.start(),
  ]);

  assert.equal(first.ok, true);
  assert.strictEqual(second, first);
  assert.equal(starts, 1);
  assert.equal(host.dataset.runtimeState, "started");
  if (first.ok) {
    assert.deepEqual(first.value.api.projects.list(), ["alpha"]);
    assert.equal(first.value.api.builds.current(), "draft");
  }
  await bootstrap.stop();
  host.remove();
});

test("host欠落とstartup failureを固定診断へ変換しthrowしない", async () => {
  const root: ApplicationCompositionRoot<typeof api> = {
    async start() {
      return {
        ok: false,
        error: {
          kind: "startup_failed",
          message: message("shell.startupFailed"),
        },
      };
    },
    async stop() {},
  };
  const missing = createSidePanelBootstrap({ root, document });
  const missingResult = await missing.start();
  assert.deepEqual(missingResult, {
    ok: false,
    error: {
      kind: "missing_host",
      message: { key: "shell.runtimeHostUnavailable" },
    },
  });
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok)
    assert.equal(
      defaultMessageResolver.resolveDescriptor(missingResult.error.message),
      "Application shell host is unavailable.",
    );
  assert.equal(document.documentElement.dataset.runtimeState, "failed");
  assert.equal(
    document.documentElement.dataset.runtimeDiagnostic,
    "missing_host",
  );

  const host = document.createElement("main");
  host.id = "application-shell";
  document.body.append(host);
  const failed = createSidePanelBootstrap({ root, document });
  const failedResult = await failed.start();
  assert.deepEqual(failedResult, {
    ok: false,
    error: {
      kind: "startup_failed",
      message: { key: "shell.runtimeStartupFailed" },
    },
  });
  assert.equal(failedResult.ok, false);
  if (!failedResult.ok)
    assert.equal(
      defaultMessageResolver.resolveDescriptor(failedResult.error.message),
      "Application shell failed to start.",
    );
  assert.equal(host.dataset.runtimeState, "failed");
  assert.equal(host.dataset.runtimeDiagnostic, "startup_failed");
  host.remove();
});

test("pagehideでcomposition rootを一度だけ停止する", async () => {
  const host = document.createElement("main");
  host.id = "application-shell";
  document.body.append(host);
  let stops = 0;
  const root: ApplicationCompositionRoot<typeof api> = {
    async start() {
      return { ok: true, value: { api } };
    },
    async stop() {
      stops += 1;
    },
  };
  const bootstrap = createSidePanelBootstrap({
    root,
    document,
    lifecycleTarget: window,
  });
  await bootstrap.start();
  window.dispatchEvent(new window.Event("pagehide"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await bootstrap.stop();
  assert.equal(stops, 1);
  host.remove();
});
