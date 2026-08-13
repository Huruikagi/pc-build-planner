import assert from "node:assert/strict";

import { createBackupOrchestrator } from "@pc-build-planner/local-data/backup";

const orchestrator = createBackupOrchestrator<
  string,
  string,
  number,
  { readonly version: number; readonly decoded: number },
  string,
  string,
  Uint8Array,
  { readonly label: string },
  { readonly accepted: boolean },
  { readonly revision: number },
  { readonly code: "synthetic" }
>({
  snapshot: {
    async read() {
      return { ok: true, value: "snapshot" } as const;
    },
  },
  codec: {
    create(root: string) {
      return { ok: true, value: root.toUpperCase() } as const;
    },
    decode(input: string) {
      return { ok: true, value: Number(input) } as const;
    },
    version(decoded: number) {
      return { ok: true, value: { version: 1, decoded } } as const;
    },
    map(versioned: { readonly version: number; readonly decoded: number }) {
      return { ok: true, value: `candidate-${versioned.decoded}` } as const;
    },
    toRoot(candidate: string) {
      return { ok: true, value: candidate } as const;
    },
    preview(candidate: string) {
      return { label: candidate } as const;
    },
  },
  artifactPolicy: {
    create(payload: string) {
      return { ok: true, value: new TextEncoder().encode(payload) } as const;
    },
  },
  replacementMode() {
    return "normal" as const;
  },
  replacement: {
    async assess(candidate: unknown) {
      return {
        ok: true,
        value: {
          preview: { accepted: candidate === "candidate-7" },
          ticket: {} as never,
        },
      } as const;
    },
    async assessRecovery(candidate: unknown) {
      return this.assess(candidate);
    },
    async commit() {
      throw new Error("commit is outside this consumer smoke");
    },
    async findPendingFinalization() {
      return { ok: true, value: null } as const;
    },
    async finalize() {
      throw new Error("finalize is outside this consumer smoke");
    },
  },
});

const artifact = await orchestrator.create();
assert.equal(artifact.ok, true);
if (!artifact.ok) throw new Error("synthetic artifact creation failed");
assert.equal(new TextDecoder().decode(artifact.value), "SNAPSHOT");

const preflight = await orchestrator.preflight("7");
assert.equal(preflight.ok, true);
if (!preflight.ok) throw new Error("synthetic restore preflight failed");
assert.deepEqual(preflight.value.preview, { label: "candidate-7" });
assert.equal(typeof preflight.value.ticket, "object");
