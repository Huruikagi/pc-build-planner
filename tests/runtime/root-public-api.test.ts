import assert from "node:assert/strict";
import test from "node:test";

import type { FeatureCompositionContext } from "../../src/application-shell/public.js";
import { composeApplicationApi } from "../../src/index.js";
import type {
  FoundationDataPort,
  FoundationScopedDataPort,
} from "../../src/persistence/public.js";

const context = (): FeatureCompositionContext => ({
  data: {
    async query() {
      return { ok: true as const, value: 0 as never };
    },
    async mutate() {
      return { ok: true as const, value: {} as never };
    },
  } satisfies FoundationScopedDataPort,
  fullDataPort: {
    async query() {
      return { ok: true as const, value: 0 as never };
    },
    async mutate() {
      return { ok: true as const, value: {} as never };
    },
    async assessReplacement() {
      return { ok: true as const, value: {} as never };
    },
    async replaceRoot() {
      return { ok: true as const, value: {} as never };
    },
    async runMaintenance() {
      return { ok: true as const, value: {} as never };
    },
  } satisfies FoundationDataPort,
  navigator: {
    async activate() {
      return { ok: true as const, value: undefined };
    },
  },
});

test("root公開入口はcatalogから合成したreadonly own-property辞書を提供する", () => {
  const composed = composeApplicationApi(context());

  assert.equal(composed.ok, true);
  if (!composed.ok) return;
  assert.equal(Object.getPrototypeOf(composed.value), null);
  assert.equal(Object.isFrozen(composed.value), true);
  assert.deepEqual(Object.keys(composed.value), [
    "candidateManagement",
    "currentBuild",
    "productCapture",
    "compatibility",
    "backupRestore",
  ]);
});

test("実featureの公開契約がroot入口から到達できる", () => {
  const composed = composeApplicationApi(context());

  assert.equal(composed.ok, true);
  if (!composed.ok) return;
  const candidateManagement = composed.value.candidateManagement;
  assert.equal(typeof candidateManagement.query.listProjects, "function");
  assert.equal(typeof candidateManagement.query.getCandidateDraft, "function");
  assert.equal(typeof candidateManagement.capture.createCandidate, "function");
  assert.equal(typeof candidateManagement.openCandidateEditor, "function");
  const currentBuild = composed.value.currentBuild;
  assert.equal(typeof currentBuild.query.getByProject, "function");
  const compatibility = composed.value.compatibility;
  assert.equal(typeof compatibility.query.evaluate, "function");
});
