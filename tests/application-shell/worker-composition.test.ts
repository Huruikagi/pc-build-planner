import assert from "node:assert/strict";
import test from "node:test";
import type {
  ApplicationWorkerRegistration,
  FeatureId,
  WorkerRegistrationContext,
} from "../../src/application-shell/contracts.js";
import { composeWorkerContributions } from "../../src/application-shell/worker-composition.js";

const id = (value: string) => value as FeatureId;

function context(diagnostics: string[] = []): WorkerRegistrationContext {
  return {
    addActionHandler: () => () => {},
    reportError: (message) => diagnostics.push(message),
  };
}

function registration(
  featureId: string,
  cleanup: () => void,
): ApplicationWorkerRegistration {
  return {
    id: id(featureId),
    register: () => ({ ok: true, value: cleanup }),
  };
}

test("複数worker contributionを一度ずつ登録し、停止時に逆順cleanupする", () => {
  const events: string[] = [];
  const diagnostics: string[] = [];
  const workers = ["first", "second", "third"].map((featureId) => ({
    id: id(featureId),
    register: () => {
      events.push(`register:${featureId}`);
      return {
        ok: true as const,
        value: () => {
          events.push(`remove:${featureId}`);
          if (featureId === "second") throw new Error("cleanup detail");
        },
      };
    },
  }));

  const result = composeWorkerContributions(workers, context(diagnostics));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  result.value();
  result.value();
  assert.deepEqual(events, [
    "register:first",
    "register:second",
    "register:third",
    "remove:third",
    "remove:second",
    "remove:first",
  ]);
  assert.deepEqual(diagnostics, ["worker.cleanup[second]: cleanup rejected"]);
});

test("重複feature idを副作用前に拒否する", () => {
  let registrationCount = 0;
  const worker = registration("same", () => {});
  const observed = {
    ...worker,
    register: () => {
      registrationCount += 1;
      return worker.register(context());
    },
  };

  assert.deepEqual(
    composeWorkerContributions([observed, observed], context()),
    {
      ok: false,
      error: { kind: "duplicate_feature_id", id: id("same") },
    },
  );
  assert.equal(registrationCount, 0);
});

test("途中失敗は取得済みhandlerを逆順・全件best-effortでrollbackする", () => {
  const cleanupOrder: string[] = [];
  const diagnostics: string[] = [];
  const failing: ApplicationWorkerRegistration = {
    id: id("failure"),
    register: () => ({
      ok: false,
      error: { kind: "invalid_registration", detail: "fixture failure" },
    }),
  };

  const result = composeWorkerContributions(
    [
      registration("first", () => {
        cleanupOrder.push("first");
        throw new Error("first");
      }),
      registration("second", () => {
        cleanupOrder.push("second");
        throw new Error("second");
      }),
      failing,
    ],
    context(diagnostics),
  );

  assert.deepEqual(result, {
    ok: false,
    error: { kind: "invalid_registration", detail: "fixture failure" },
  });
  assert.deepEqual(cleanupOrder, ["second", "first"]);
  assert.deepEqual(diagnostics, [
    "worker.cleanup[second]: cleanup rejected",
    "worker.cleanup[first]: cleanup rejected",
  ]);
});

test("register例外・不正cleanupを型付き失敗へ正規化してrollbackする", () => {
  const cleanupOrder: string[] = [];
  const throwing: ApplicationWorkerRegistration = {
    id: id("throwing"),
    register: () => {
      throw new Error("register detail");
    },
  };

  assert.deepEqual(
    composeWorkerContributions(
      [registration("first", () => cleanupOrder.push("first")), throwing],
      context(),
    ),
    {
      ok: false,
      error: {
        kind: "invalid_registration",
        detail: "worker.register: registration rejected",
      },
    },
  );
  assert.deepEqual(cleanupOrder, ["first"]);

  const invalidCleanup: ApplicationWorkerRegistration = {
    id: id("invalid-cleanup"),
    register: () => ({ ok: true, value: null as never }),
  };
  assert.deepEqual(composeWorkerContributions([invalidCleanup], context()), {
    ok: false,
    error: {
      kind: "invalid_registration",
      detail: "worker.register: cleanup function is required",
    },
  });
});

test("空・不正feature idを登録前に拒否する", () => {
  const invalid = registration("   ", () => {});
  assert.deepEqual(composeWorkerContributions([invalid], context()), {
    ok: false,
    error: {
      kind: "invalid_registration",
      detail: "worker.id: non-empty feature id is required",
    },
  });
});
