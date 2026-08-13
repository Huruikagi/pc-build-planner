import assert from "node:assert/strict";

import {
  createTransactionEngine,
  type ErrorAdapter,
  type PolicyStage,
  type TransactionEngineDependencies,
} from "@pc-build-planner/local-data";

type RootMaintenanceControl = Readonly<{ maintenanceToken: string }>;
type PersistentRecoveryControl = Readonly<{ recoveryEpoch: number }>;
type PolicyError = Readonly<{
  identity: symbol;
  payload: { stage: PolicyStage; detail: string };
}>;
type OutputError = Readonly<{ kind: "fixture-output"; source: PolicyError }>;
type Root = Readonly<{
  revision: number;
  value: string;
  maintenance: RootMaintenanceControl;
}>;
type Operation = Readonly<{ value: string }>;

const stages = [
  "decode",
  "migration",
  "mutation",
  "repair",
  "validation",
] as const;

for (const failingStage of stages) {
  const policyError: PolicyError = {
    identity: Symbol(failingStage),
    payload: { stage: failingStage, detail: `payload:${failingStage}` },
  };
  const seen: Array<Readonly<{ stage: PolicyStage; error: PolicyError }>> = [];
  let decodeCalls = 0;
  let writes = 0;
  let stored: Root = {
    revision: 1,
    value: "before",
    maintenance: { maintenanceToken: "clear" },
  };
  const errors: ErrorAdapter<PolicyError, OutputError> = {
    fromPolicy(stage, error) {
      seen.push({ stage, error });
      return { ok: true, value: { kind: "fixture-output", source: error } };
    },
    fromCore() {
      return {
        ok: true,
        value: { kind: "fixture-output", source: policyError },
      };
    },
  };
  const dependencies: TransactionEngineDependencies<
    Root,
    Operation,
    RootMaintenanceControl,
    PersistentRecoveryControl,
    PolicyError,
    OutputError
  > = {
    storage: {
      async readRoot() {
        return { ok: true, value: stored };
      },
      async writeRoot(root) {
        writes += 1;
        stored = root;
        return { ok: true, value: undefined };
      },
      async readControl() {
        return { ok: true, value: { recoveryEpoch: 1 } };
      },
      async writeControl() {
        return { ok: true, value: undefined };
      },
      async bytesInUse() {
        return { ok: true, value: 1 };
      },
      quotaBytes: () => 1_000,
      async restrictToTrustedContexts() {
        return { ok: true, value: undefined };
      },
    },
    lock: {
      async runExclusive(operation) {
        return { ok: true, value: await operation() };
      },
    },
    policy: {
      decodeFailureStage: () =>
        failingStage === "migration" ? "migration" : "decode",
      decodeAndMigrate(input) {
        decodeCalls += 1;
        if (
          (failingStage === "decode" || failingStage === "migration") &&
          decodeCalls === 1
        )
          return { ok: false, error: policyError };
        if (failingStage === "validation" && decodeCalls === 2)
          return { ok: false, error: policyError };
        return { ok: true, value: input as Root };
      },
      apply(root, operation) {
        return failingStage === "mutation"
          ? { ok: false, error: policyError }
          : { ok: true, value: { ...root, value: operation.value } };
      },
      repair(root) {
        return failingStage === "repair"
          ? { ok: false, error: policyError }
          : { ok: true, value: root };
      },
      revision: (root) => root.revision,
      withRevision: (root, revision) => ({ ...root, revision }),
      requestRecord: () => undefined,
      withRequestRecord: (root) => root,
      control: (root) => root.maintenance,
      withControl: (root, maintenance) => ({ ...root, maintenance }),
    },
    errors,
    capacity: {
      assess: (beforeBytes, _root, quotaBytes) => ({
        ok: true,
        value: {
          beforeBytes,
          afterBytes: 2,
          warningThresholdBytes: 800,
          quotaBytes,
          warning: false,
        },
      }),
    },
    digest: (operation) => operation.value,
    now: () => 1,
    fencing: {
      acquire: () => ({ ok: false, error: { code: "stale-fence" } }),
      renew: () => ({ ok: false, error: { code: "stale-fence" } }),
      release: () => ({ ok: false, error: { code: "stale-fence" } }),
      abort: () => ({ ok: false, error: { code: "stale-fence" } }),
      authorizeMutation: () => ({ ok: true, value: undefined }),
    },
    recovery: { authorizeMutation: () => ({ ok: true, value: undefined }) },
  };

  const result = await createTransactionEngine(dependencies).execute({
    requestId: `request-${failingStage}`,
    expectedRevision: 1,
    operation: { value: "after" },
  });
  assert.equal(result.ok, false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.stage, failingStage);
  assert.strictEqual(seen[0]?.error, policyError);
  assert.strictEqual(!result.ok && result.error.source, policyError);
  assert.deepEqual(policyError.payload, {
    stage: failingStage,
    detail: `payload:${failingStage}`,
  });
  assert.equal(writes, 0);
}
