// @ts-nocheck WorkerRegistration の未信頼 runtime 境界を検証する。
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier.endsWith(".js") ? `${specifier.slice(0, -3)}.ts` : specifier,
      context,
    );
  },
});

import {
  createDataWorkerRegistration,
  decodeFoundationCommand,
} from "../../src/persistence/public.ts";

const query = { kind: "query-root" };
const trustedCaller = { kind: "trusted-extension" };

const harness = ({ restriction = { ok: true, value: undefined } } = {}) => {
  const handled = [];
  const authorized = [];
  const listeners = [];
  const target = {
    addHandler(handler) {
      listeners.push(handler);
      return () => listeners.splice(listeners.indexOf(handler), 1);
    },
  };
  const registration = createDataWorkerRegistration({
    restrictAccess: async () => restriction,
    authorize(caller, command) {
      authorized.push([caller, command]);
      return caller.kind === "trusted-extension";
    },
    data: {
      async query() {
        const command = query;
        handled.push(command);
        return { ok: true, value: "handled" };
      },
      async mutate() {
        throw new Error("unexpected");
      },
      async assessReplacement() {
        throw new Error("unexpected");
      },
      async replaceRoot() {
        throw new Error("unexpected");
      },
      async runMaintenance() {
        throw new Error("unexpected");
      },
    },
  });
  return { registration, target, listeners, authorized, handled };
};

test("access restriction succeeds before registering and authorized command alone reaches authority", async () => {
  const h = harness();
  const result = await h.registration.register(h.target);
  assert.equal(result.ok, true);
  assert.equal(h.listeners.length, 1);

  assert.deepEqual(await h.listeners[0](query, trustedCaller), {
    ok: true,
    value: "handled",
  });
  assert.deepEqual(h.authorized, [[trustedCaller, query]]);
  assert.deepEqual(h.handled, [query]);
});

test("invalid payload and invalid or disallowed caller fail closed", async () => {
  const h = harness();
  await h.registration.register(h.target);
  const handler = h.listeners[0];

  assert.deepEqual(await handler({ kind: "unknown" }, trustedCaller), {
    ok: false,
    error: { code: "invalid-message" },
  });
  assert.deepEqual(
    await handler(query, { kind: "forged", url: "https://example.invalid" }),
    {
      ok: false,
      error: { code: "invalid-caller" },
    },
  );
  assert.deepEqual(await handler(query, { kind: "content-script" }), {
    ok: false,
    error: { code: "caller-denied" },
  });
  assert.deepEqual(h.handled, []);
});

test("access restriction failure registers no handler and performs no authority call", async () => {
  const h = harness({
    restriction: { ok: false, error: { code: "access-denied" } },
  });
  assert.deepEqual(await h.registration.register(h.target), {
    ok: false,
    error: { code: "access-denied" },
  });
  assert.equal(h.listeners.length, 0);
  assert.deepEqual(h.handled, []);
});

test("register rejects malformed targets without changing persistent state", async () => {
  const h = harness();
  assert.deepEqual(await h.registration.register({}), {
    ok: false,
    error: { code: "invalid-target" },
  });
  assert.deepEqual(h.handled, []);
});

test("canonical decoder accepts serializable CRUD and rejects callbacks and malformed nested fences", () => {
  const command = {
    kind: "mutate-root",
    command: {
      requestId: "80000000-0000-4000-8000-000000000001",
      expectedRevision: 1,
      operation: {
        kind: "delete",
        entity: "project",
        id: "10000000-0000-4000-8000-000000000001",
      },
    },
  };
  assert.deepEqual(decodeFoundationCommand(command), {
    ok: true,
    value: command,
  });
  assert.equal(
    decodeFoundationCommand({
      ...command,
      command: { ...command.command, operation: () => undefined },
    }).ok,
    false,
  );
  assert.equal(
    decodeFoundationCommand({
      ...command,
      command: {
        ...command.command,
        maintenance: { generation: 1, ownerId: "forged", revision: 1 },
      },
    }).ok,
    false,
  );
});

test("canonical decoder rejects malformed entity values and replacement metadata deeply", () => {
  const mutation = (value) => ({
    kind: "mutate-root",
    command: {
      requestId: "80000000-0000-4000-8000-000000000001",
      expectedRevision: 1,
      operation: { kind: "create", entity: "project", value },
    },
  });
  assert.equal(
    decodeFoundationCommand(
      mutation({
        id: "10000000-0000-4000-8000-000000000001",
        name: 42,
        createdAt: "bad",
        updatedAt: "bad",
        extra: true,
      }),
    ).ok,
    false,
  );
  const replacement = {
    kind: "replace-root",
    command: {
      candidate: {},
      assessment: {
        token: "",
        candidateDigest: "bad",
        sourceSchemaVersion: -1,
        targetSchemaVersion: 1,
        beforeBytes: -1,
        requiredBytes: -1,
        warnings: [{}],
        cursor: { extra: true },
      },
      fence: {
        generation: 1,
        ownerId: "70000000-0000-4000-8000-000000000001",
        revision: 1,
      },
    },
  };
  assert.equal(decodeFoundationCommand(replacement).ok, false);
});

test("candidatePart wire valueはcategoryと全nested objectをexact検証する", () => {
  const candidate = {
    id: "20000000-0000-4000-8000-000000000001",
    projectId: "10000000-0000-4000-8000-000000000001",
    category: "cpu",
    product: {},
    sources: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        pageUrl: "https://catalog.example.invalid/part-1",
        capturedAt: "2026-07-19T00:00:00Z",
      },
    ],
    primarySourceId: "30000000-0000-4000-8000-000000000001",
    normalizedAttributes: { category: "cpu" },
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
  };
  const command = (value) => ({
    kind: "mutate-root",
    command: {
      requestId: "80000000-0000-4000-8000-000000000001",
      expectedRevision: 0,
      operation: { kind: "create", entity: "candidatePart", value },
    },
  });

  assert.equal(decodeFoundationCommand(command(candidate)).ok, true);
  for (const invalidCandidate of [
    { ...candidate, category: "bogus" },
    { ...candidate, product: { extra: 1 } },
    { ...candidate, sourceInfo: {} },
    {
      ...candidate,
      sources: [{ ...candidate.sources[0], extra: true }],
    },
    {
      ...candidate,
      sources: [{ ...candidate.sources[0], pageUrl: "not a URL" }],
    },
    { ...candidate, normalizedAttributes: { category: "cpu", extra: true } },
    { ...candidate, normalizedAttributes: { category: "gpu" } },
    {
      ...candidate,
      product: { name: { original: null, confirmed: 42 } },
    },
  ]) {
    assert.equal(decodeFoundationCommand(command(invalidCandidate)).ok, false);
  }
});
