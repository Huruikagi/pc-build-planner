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

import { createDataWorkerRegistration } from "../../src/runtime/worker-registration.ts";

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
    storage: { restrictToTrustedContexts: async () => restriction },
    validator: {
      validateCommand(input) {
        return input?.kind === "query-root" && Object.keys(input).length === 1
          ? { ok: true, value: input }
          : { ok: false, error: { code: "validation", path: "$" } };
      },
    },
    authorize(caller, command) {
      authorized.push([caller, command]);
      return caller.kind === "trusted-extension";
    },
    authority: {
      async handle(command) {
        handled.push(command);
        return { ok: true, value: "handled" };
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
