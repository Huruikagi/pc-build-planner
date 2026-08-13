import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackupOrchestrator,
  type BackupCodec,
} from "../../src/backup/index.js";
import type { CoreResult, ReplacementAssessment } from "../../src/index.js";

type Failure = { readonly code: string };
type Root = Readonly<{ revision: number; values: readonly string[] }>;
type Candidate = Readonly<{ values: readonly string[] }>;

const ok = <T>(value: T): CoreResult<T, Failure> => ({ ok: true, value });
const failed = (code: string): CoreResult<never, Failure> => ({
  ok: false,
  error: { code },
});

const createFixture = (failureAt?: string) => {
  const calls: string[] = [];
  let rootWrites = 0;
  const codec: BackupCodec<
    Root,
    string,
    { version: number; values: readonly string[] },
    { version: 1; values: readonly string[] },
    Candidate,
    string,
    Readonly<{ count: number }>,
    Failure
  > = {
    create(root) {
      calls.push("create");
      return failureAt === "create"
        ? failed("create")
        : ok(JSON.stringify({ values: root.values }));
    },
    decode(input) {
      calls.push("decode");
      if (failureAt === "decode") return failed("decode");
      return ok(JSON.parse(input) as { version: number; values: readonly string[] });
    },
    version(decoded) {
      calls.push("version");
      return failureAt === "version"
        ? failed("version")
        : ok({ version: 1 as const, values: decoded.values });
    },
    map(versioned) {
      calls.push("map");
      return failureAt === "map"
        ? failed("map")
        : ok({ values: versioned.values });
    },
    toRoot(candidate) {
      calls.push("toRoot");
      return failureAt === "toRoot"
        ? failed("to-root")
        : ok({ revision: 0, values: candidate.values });
    },
    preview(candidate) {
      calls.push("preview");
      return { count: candidate.values.length };
    },
  };
  const assessmentTicket = Object.freeze({ marker: "secret-assessment" }) as never;
  const orchestrator = createBackupOrchestrator({
    snapshot: {
      async read() {
        calls.push("snapshot");
        return ok({ revision: 4, values: ["fictional-a", "fictional-b"] });
      },
    },
    codec,
    artifactPolicy: {
      create(payload) {
        calls.push("artifact");
        return failureAt === "artifact"
          ? failed("artifact")
          : ok({ name: "fictional-backup.json", payload });
      },
    },
    replacement: {
      async assess(candidate: unknown) {
        calls.push("assess");
        if (failureAt === "assess") return failed("assess");
        assert.deepEqual(candidate, {
          revision: 0,
          values: ["fictional-a", "fictional-b"],
        });
        return ok<ReplacementAssessment<Readonly<{ internal: true }>>>({
          preview: { internal: true },
          ticket: assessmentTicket,
        });
      },
      async assessRecovery() {
        throw new Error("recovery assessment is outside this fixture");
      },
      async commit() {
        rootWrites += 1;
        throw new Error("task 4.1 must not commit");
      },
      async findPendingFinalization() {
        return ok(null);
      },
      async finalize() {
        throw new Error("task 4.1 must not finalize");
      },
    },
  });
  return { orchestrator, calls, get rootWrites() { return rootWrites; } };
};

test("creates a stable artifact through the injected snapshot, codec, and policy", async () => {
  const fixture = createFixture();
  const result = await fixture.orchestrator.create();

  assert.deepEqual(result, {
    ok: true,
    value: {
      name: "fictional-backup.json",
      payload: '{"values":["fictional-a","fictional-b"]}',
    },
  });
  assert.deepEqual(fixture.calls, ["snapshot", "create", "artifact"]);
  assert.equal(fixture.rootWrites, 0);
});

for (const stage of ["create", "artifact"] as const) {
  test(`${stage} failure returns a classified result without continuing`, async () => {
    const fixture = createFixture(stage);
    const result = await fixture.orchestrator.create();

    assert.deepEqual(result, { ok: false, error: { code: stage } });
    assert.equal(fixture.calls.at(-1), stage);
    assert.equal(fixture.rootWrites, 0);
  });
}

test("preflights untrusted input in order and exposes only preview plus an opaque ticket", async () => {
  const fixture = createFixture();
  const result = await fixture.orchestrator.preflight(
    '{"version":0,"values":["fictional-a","fictional-b"]}',
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.preview, { count: 2 });
  assert.deepEqual(Object.keys(result.value), ["preview", "ticket"]);
  assert.deepEqual(Object.keys(result.value.ticket as object), []);
  assert.equal(JSON.stringify(result.value.ticket), "{}");
  assert.deepEqual(fixture.calls, [
    "decode",
    "version",
    "map",
    "toRoot",
    "assess",
    "preview",
  ]);
  assert.equal(fixture.rootWrites, 0);
});

for (const stage of ["decode", "version", "map", "toRoot", "assess"] as const) {
  test(`${stage} failure stops preflight without a root write`, async () => {
    const fixture = createFixture(stage);
    const result = await fixture.orchestrator.preflight(
      '{"version":0,"values":["fictional-a"]}',
    );

    assert.equal(result.ok, false);
    assert.equal(fixture.calls.at(-1), stage);
    assert.equal(fixture.rootWrites, 0);
  });
}
