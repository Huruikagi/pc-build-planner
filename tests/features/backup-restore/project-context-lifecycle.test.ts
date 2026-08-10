import assert from "node:assert/strict";
import test from "node:test";
import type { Result } from "../../../src/domain/public.js";
import {
  createRestoreContextLifecycle,
  createRestorePostCommitCoordinator,
} from "../../../src/features/backup-restore/context-lifecycle.js";
import type {
  RestoreCommitOutcome,
  RestoreError,
  RestoreSummary,
  RestoreTicket,
} from "../../../src/features/backup-restore/contracts.js";
import { createBackupRestoreState } from "../../../src/features/backup-restore/state.js";
import type { BackupRestoreFinalizationTicket } from "../../../src/persistence/public.js";
import type {
  ProjectContextCommandPort,
  ProjectContextReplacementGuardPort,
  ProjectContextSnapshot,
} from "../../../src/project-context/public.js";

const SUMMARY: RestoreSummary = {
  projectCount: 1,
  partCount: 2,
  currentBuildCount: 1,
};

const FINALIZATION = "finalization-1" as BackupRestoreFinalizationTicket;

const READY: ProjectContextSnapshot = {
  status: "ready",
  generation: 3,
  catalog: [
    {
      id: "11111111-1111-4111-8111-111111111111" as never,
      name: "fixture",
      updatedAt: "2026-07-24T00:00:00.000Z" as never,
    },
  ],
  selectedProjectId: "11111111-1111-4111-8111-111111111111" as never,
};

const EMPTY: ProjectContextSnapshot = {
  status: "empty",
  generation: 4,
  catalog: [],
  selectedProjectId: null,
};

const UNAVAILABLE: ProjectContextSnapshot = {
  status: "unavailable",
  generation: 5,
  selectedProjectId: null,
  reason: "catalog-unavailable",
};

interface GuardScript {
  readonly prepare?: ProjectContextReplacementGuardPort["prepare"];
  readonly confirm?: ProjectContextReplacementGuardPort["confirm"];
  readonly cancel?: ProjectContextReplacementGuardPort["cancel"];
  readonly begin?: ProjectContextReplacementGuardPort["begin"];
  readonly complete?: ProjectContextReplacementGuardPort["complete"];
  readonly refresh?: ProjectContextCommandPort["refresh"];
}

const buildPorts = (script: GuardScript) => {
  const calls: string[] = [];
  const permit = {
    id: "permit-1",
    baseGeneration: 1,
    registryRevision: 1,
  } as const;
  const guard: ProjectContextReplacementGuardPort = {
    async prepare() {
      calls.push("prepare");
      if (script.prepare) return script.prepare();
      return { ok: true, value: { kind: "permitted", permit } };
    },
    async confirm(confirmationId) {
      calls.push(`confirm:${confirmationId}`);
      if (script.confirm) return script.confirm(confirmationId);
      return { ok: true, value: permit };
    },
    cancel(confirmationId) {
      calls.push(`cancel:${confirmationId}`);
      if (script.cancel) return script.cancel(confirmationId);
      return { ok: true, value: undefined };
    },
    begin(permitId) {
      calls.push(`begin:${permitId}`);
      if (script.begin) return script.begin(permitId);
      return { ok: true, value: undefined };
    },
    async complete(permitId, outcome) {
      calls.push(`complete:${permitId}:${outcome}`);
      if (script.complete) return script.complete(permitId, outcome);
      return { ok: true, value: undefined };
    },
  };
  const commands: Pick<ProjectContextCommandPort, "refresh"> = {
    async refresh() {
      calls.push("refresh");
      if (script.refresh) return script.refresh();
      return { ok: true, value: READY };
    },
  };
  return { calls, guard, commands, permit };
};

const buildLifecycle = (script: GuardScript = {}) => {
  const ports = buildPorts(script);
  return {
    ...ports,
    lifecycle: createRestoreContextLifecycle({
      replacementGuard: ports.guard,
      projectContext: ports.commands,
    }),
  };
};

test("prepareはpermitとconfirmationのidだけを公開しguard内部値を渡さない", async () => {
  const { lifecycle } = buildLifecycle();

  const prepared = await lifecycle.prepare();

  assert.equal(prepared.ok, true);
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.value, {
    kind: "permitted",
    permit: { id: "permit-1" },
  });
});

test("confirmation-requiredではconfirmを経てからpermitを得る", async () => {
  const { lifecycle, calls } = buildLifecycle({
    async prepare() {
      return {
        ok: true,
        value: {
          kind: "confirmation-required",
          confirmation: {
            id: "confirm-1",
            baseGeneration: 1,
            registryRevision: 1,
          },
        },
      };
    },
  });

  const prepared = await lifecycle.prepare();
  assert.ok(prepared.ok);
  assert.equal(prepared.value.kind, "confirmation-required");
  assert.ok(prepared.value.kind === "confirmation-required");
  assert.deepEqual(prepared.value.confirmation, { id: "confirm-1" });

  const confirmed = await lifecycle.confirm(prepared.value.confirmation.id);
  assert.deepEqual(confirmed, { ok: true, value: { id: "permit-1" } });
  assert.deepEqual(calls, ["prepare", "confirm:confirm-1"]);
});

test("beginが成功するまでcommitを許可しない", async () => {
  const { lifecycle } = buildLifecycle();

  const prepared = await lifecycle.prepare();
  assert.ok(prepared.ok && prepared.value.kind === "permitted");
  const permitId = prepared.value.permit.id;

  assert.equal(lifecycle.isCommitAllowed(permitId), false);
  assert.deepEqual(lifecycle.begin(permitId), { ok: true, value: undefined });
  assert.equal(lifecycle.isCommitAllowed(permitId), true);
});

test("begin失敗ではpermitを閉じcommitを許可しない", async () => {
  const { lifecycle } = buildLifecycle({
    begin: () => ({ ok: false, error: { kind: "permit-stale" } }),
  });

  const prepared = await lifecycle.prepare();
  assert.ok(prepared.ok && prepared.value.kind === "permitted");
  const permitId = prepared.value.permit.id;

  assert.deepEqual(lifecycle.begin(permitId), {
    ok: false,
    error: { code: "permit-stale" },
  });
  assert.equal(lifecycle.isCommitAllowed(permitId), false);
});

test("未知のpermitはpermit-staleとして扱いguardへ転送しない", async () => {
  const { lifecycle, calls } = buildLifecycle();

  assert.deepEqual(lifecycle.begin("unknown"), {
    ok: false,
    error: { code: "permit-stale" },
  });
  assert.deepEqual(calls, []);
});

test("guard評価失敗はguard-failedへ写像する", async () => {
  const { lifecycle } = buildLifecycle({
    async prepare() {
      return { ok: false, error: { kind: "guard-failed" } };
    },
  });

  assert.deepEqual(await lifecycle.prepare(), {
    ok: false,
    error: { code: "guard-failed" },
  });
});

test("staleなconfirmationはconfirmation-staleとして返しpermitを発行しない", async () => {
  const { lifecycle } = buildLifecycle({
    async confirm() {
      return { ok: false, error: { kind: "confirmation-stale" } };
    },
    async prepare() {
      return {
        ok: true,
        value: {
          kind: "confirmation-required",
          confirmation: {
            id: "confirm-1",
            baseGeneration: 1,
            registryRevision: 1,
          },
        },
      };
    },
  });

  await lifecycle.prepare();
  const confirmed = await lifecycle.confirm("confirm-1");

  assert.deepEqual(confirmed, {
    ok: false,
    error: { code: "confirmation-stale" },
  });
  assert.equal(lifecycle.isCommitAllowed("permit-1"), false);
});

test("commit前失敗ではfailedでpermitを閉じ、再度closeしてもguardを呼ばない", async () => {
  const { lifecycle, calls } = buildLifecycle();

  const prepared = await lifecycle.prepare();
  assert.ok(prepared.ok && prepared.value.kind === "permitted");
  lifecycle.begin(prepared.value.permit.id);

  assert.deepEqual(
    await lifecycle.complete(prepared.value.permit.id, "failed"),
    {
      ok: true,
      value: undefined,
    },
  );
  assert.deepEqual(
    await lifecycle.complete(prepared.value.permit.id, "failed"),
    {
      ok: true,
      value: undefined,
    },
  );

  assert.deepEqual(calls, [
    "prepare",
    "begin:permit-1",
    "complete:permit-1:failed",
  ]);
  assert.equal(lifecycle.isCommitAllowed(prepared.value.permit.id), false);
});

test("begin前のcancelled完了はguardのcompleteを呼ばずpermitを閉じる", async () => {
  const { lifecycle, calls } = buildLifecycle();

  const prepared = await lifecycle.prepare();
  assert.ok(prepared.ok && prepared.value.kind === "permitted");

  assert.deepEqual(
    await lifecycle.complete(prepared.value.permit.id, "cancelled"),
    { ok: true, value: undefined },
  );
  assert.deepEqual(calls, ["prepare"]);
});

test("refreshはsnapshotを返し、上流のcontext-unavailableをcodeへ写像する", async () => {
  const ready = buildLifecycle();
  assert.deepEqual(await ready.lifecycle.refresh(), { ok: true, value: READY });

  const failing = buildLifecycle({
    async refresh() {
      return { ok: false, error: { kind: "context-unavailable" } };
    },
  });
  assert.deepEqual(await failing.lifecycle.refresh(), {
    ok: false,
    error: { code: "context-unavailable" },
  });
});

test("refreshの例外はrefresh-failedとして閉じる", async () => {
  const { lifecycle } = buildLifecycle({
    refresh() {
      throw new Error("boom");
    },
  });

  assert.deepEqual(await lifecycle.refresh(), {
    ok: false,
    error: { code: "refresh-failed" },
  });
});

const buildCoordinator = (
  script: GuardScript & {
    finalize?: (
      ticket: BackupRestoreFinalizationTicket,
      summary: RestoreSummary | undefined,
    ) => Promise<
      | { ok: true; value: RestoreSummary }
      | { ok: false; error: { readonly code: "maintenance-active" } }
    >;
  } = {},
) => {
  const ports = buildPorts(script);
  const lifecycle = createRestoreContextLifecycle({
    replacementGuard: ports.guard,
    projectContext: ports.commands,
  });
  const coordinator = createRestorePostCommitCoordinator({
    lifecycle,
    restoreService: {
      async finalize(ticket, summary) {
        ports.calls.push("finalize");
        if (script.finalize) return script.finalize(ticket, summary);
        /** summary未保持の再mount経路はserviceが件数を再構築する。ここではSUMMARYで代替する。 */
        return { ok: true, value: summary ?? SUMMARY };
      },
    },
  });
  return { ...ports, lifecycle, coordinator };
};

const beginPermit = async (
  lifecycle: ReturnType<typeof createRestoreContextLifecycle>,
): Promise<string> => {
  const prepared = await lifecycle.prepare();
  assert.ok(prepared.ok && prepared.value.kind === "permitted");
  lifecycle.begin(prepared.value.permit.id);
  return prepared.value.permit.id;
};

const COMMITTED: RestoreCommitOutcome = {
  kind: "committed",
  summary: SUMMARY,
};
const COMMITTED_PENDING: RestoreCommitOutcome = {
  kind: "committed-finalization-required",
  summary: SUMMARY,
  finalization: FINALIZATION,
};

test("committedではsucceededを一回だけ通知してからrefreshする", async () => {
  const { coordinator, lifecycle, calls } = buildCoordinator();
  const permitId = await beginPermit(lifecycle);
  calls.length = 0;

  const completion = await coordinator.afterCommit({
    permitId,
    outcome: COMMITTED,
  });

  assert.deepEqual(completion, {
    kind: "restored",
    summary: SUMMARY,
    context: "ready",
  });
  assert.deepEqual(calls, ["complete:permit-1:succeeded", "refresh"]);
});

test("completion通知が失敗しても復元成功を取り消さずrefreshへ進む", async () => {
  const { coordinator, lifecycle, calls } = buildCoordinator({
    async complete() {
      return { ok: false, error: { kind: "guard-failed" } };
    },
  });
  const permitId = await beginPermit(lifecycle);
  calls.length = 0;

  const completion = await coordinator.afterCommit({
    permitId,
    outcome: COMMITTED,
  });

  assert.deepEqual(completion, {
    kind: "restored",
    summary: SUMMARY,
    context: "ready",
  });
  assert.deepEqual(calls, ["complete:permit-1:succeeded", "refresh"]);
});

test("finalization required ではrefreshせずfinalize-only状態を返す", async () => {
  const { coordinator, lifecycle, calls } = buildCoordinator();
  const permitId = await beginPermit(lifecycle);
  calls.length = 0;

  const completion = await coordinator.afterCommit({
    permitId,
    outcome: COMMITTED_PENDING,
  });

  assert.deepEqual(completion, {
    kind: "restored-finalization-required",
    summary: SUMMARY,
    finalization: FINALIZATION,
  });
  assert.deepEqual(calls, ["complete:permit-1:succeeded"]);
});

test("refresh結果のempty・unavailableを復元後状態へ写像する", async () => {
  const empty = buildCoordinator({
    async refresh() {
      return { ok: true, value: EMPTY };
    },
  });
  assert.deepEqual(
    await empty.coordinator.afterCommit({
      permitId: null,
      outcome: COMMITTED,
    }),
    { kind: "restored", summary: SUMMARY, context: "empty" },
  );

  const unavailable = buildCoordinator({
    async refresh() {
      return { ok: true, value: UNAVAILABLE };
    },
  });
  assert.deepEqual(
    await unavailable.coordinator.afterCommit({
      permitId: null,
      outcome: COMMITTED,
    }),
    { kind: "restored-context-unavailable", summary: SUMMARY },
  );

  const failed = buildCoordinator({
    async refresh() {
      return { ok: false, error: { kind: "context-unavailable" } };
    },
  });
  assert.deepEqual(
    await failed.coordinator.afterCommit({
      permitId: null,
      outcome: COMMITTED,
    }),
    { kind: "restored-context-unavailable", summary: SUMMARY },
  );
});

test("finalize-only retryはfinalizeとrefreshだけを呼びguardを再実行しない", async () => {
  const { coordinator, calls } = buildCoordinator();

  const finalized = await coordinator.finalizeOnly(FINALIZATION, SUMMARY);

  assert.deepEqual(finalized, {
    ok: true,
    value: { kind: "restored", summary: SUMMARY, context: "ready" },
  });
  assert.deepEqual(calls, ["finalize", "refresh"]);
});

test("finalize失敗ではrefreshせずfinalization retryを保持する", async () => {
  const { coordinator, calls } = buildCoordinator({
    async finalize() {
      return { ok: false, error: { code: "maintenance-active" } };
    },
  });

  const finalized = await coordinator.finalizeOnly(FINALIZATION, SUMMARY);

  assert.deepEqual(finalized, {
    ok: false,
    error: { code: "maintenance-active" },
  });
  assert.deepEqual(calls, ["finalize"]);
});

test("refresh-only retryはrefreshだけを呼ぶ", async () => {
  const { coordinator, calls } = buildCoordinator();

  const completion = await coordinator.refreshOnly(SUMMARY);

  assert.deepEqual(completion, {
    kind: "restored",
    summary: SUMMARY,
    context: "ready",
  });
  assert.deepEqual(calls, ["refresh"]);
});

/**
 * RestoreContextLifecycle・PostCommitCoordinator・BackupRestoreStateを実装のまま結線し、
 * guard lifecycleとcommit後retryのcommand列を統合契約として固定する。
 */
const TICKET: RestoreTicket = {
  candidate: { schemaVersion: 1 },
  mode: "normal",
  assessment: "assessment-1" as never,
  preview: {
    createdAt: "2026-07-24T00:00:00.000Z" as never,
    formatVersion: 1,
    projectCount: 1,
    partCount: 2,
    currentBuildCount: 1,
    estimatedBytes: 100,
  },
};

const FAKE_FILE = {} as File;

const buildIntegration = (
  options: {
    readonly guard?: GuardScript;
    readonly commit?: () => Result<RestoreCommitOutcome, RestoreError>;
    readonly finalize?: () => Result<RestoreSummary, RestoreError>;
  } = {},
) => {
  const ports = buildPorts(options.guard ?? {});
  const lifecycle = createRestoreContextLifecycle({
    replacementGuard: ports.guard,
    projectContext: ports.commands,
  });
  let commits = 0;
  const state = createBackupRestoreState({
    backupService: {
      create: () => {
        throw new Error("must not call create");
      },
    },
    restoreService: {
      async preflight() {
        return { ok: true, value: TICKET };
      },
      async commit() {
        commits += 1;
        ports.calls.push("commit");
        return options.commit?.() ?? { ok: true, value: COMMITTED };
      },
    },
    fileGateway: {
      async read() {
        return { ok: true, value: { text: "{}", byteLength: 2 } };
      },
      download: () => {
        throw new Error("must not call download");
      },
    },
    contextLifecycle: lifecycle,
    postCommit: createRestorePostCommitCoordinator({
      lifecycle,
      restoreService: {
        async finalize(_ticket, summary) {
          ports.calls.push("finalize");
          return (
            options.finalize?.() ?? { ok: true, value: summary ?? SUMMARY }
          );
        },
      },
    }),
  });
  return { ...ports, state, commitCount: () => commits };
};

test("統合: guard拒否ではcommitせずticketを保持し新しいprepareから再試行できる", async () => {
  let prepares = 0;
  const { state, calls, commitCount } = buildIntegration({
    guard: {
      async prepare() {
        prepares += 1;
        return prepares === 1
          ? { ok: false, error: { kind: "guard-failed" } }
          : {
              ok: true,
              value: {
                kind: "permitted",
                permit: {
                  id: "permit-1",
                  baseGeneration: 1,
                  registryRevision: 1,
                },
              },
            };
      },
    },
  });

  await state.validateFile(FAKE_FILE);
  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error: { code: "guard-failed" },
    retry: { kind: "action-required", action: "resolve-draft" },
    ticket: TICKET,
  });
  assert.deepEqual(calls, ["prepare"]);
  assert.equal(commitCount(), 0);

  calls.length = 0;
  await state.retryRestore();

  assert.deepEqual(calls, [
    "prepare",
    "begin:permit-1",
    "commit",
    "complete:permit-1:succeeded",
    "refresh",
  ]);
  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "restore",
    summary: SUMMARY,
    context: "ready",
  });
});

test("統合: draft確認の取消はguardを閉じticketを保持したまま置換確認へ戻す", async () => {
  const { state, calls, commitCount } = buildIntegration({
    guard: {
      async prepare() {
        return {
          ok: true,
          value: {
            kind: "confirmation-required",
            confirmation: {
              id: "confirm-1",
              baseGeneration: 1,
              registryRevision: 1,
            },
          },
        };
      },
    },
  });

  await state.validateFile(FAKE_FILE);
  await state.confirmRestore();
  state.cancelDraft();

  assert.deepEqual(state.value, {
    phase: "awaiting-replacement-confirmation",
    ticket: TICKET,
  });
  assert.deepEqual(calls, ["prepare", "cancel:confirm-1"]);
  assert.equal(commitCount(), 0);
});

test("統合: stale confirmationはcommitせずticketを保持し再試行を許可する", async () => {
  let confirms = 0;
  const { state, calls, commitCount } = buildIntegration({
    guard: {
      async prepare() {
        return {
          ok: true,
          value: {
            kind: "confirmation-required",
            confirmation: {
              id: "confirm-1",
              baseGeneration: 1,
              registryRevision: 1,
            },
          },
        };
      },
      async confirm() {
        confirms += 1;
        return { ok: false, error: { kind: "confirmation-stale" } };
      },
    },
  });

  await state.validateFile(FAKE_FILE);
  await state.confirmRestore();
  await state.approveDraft();

  assert.deepEqual(state.value, {
    phase: "failed",
    operation: "restore",
    error: { code: "confirmation-stale" },
    retry: { kind: "retryable", action: "retry-restore" },
    ticket: TICKET,
  });
  assert.equal(confirms, 1);
  assert.equal(commitCount(), 0);
  assert.deepEqual(calls, ["prepare", "confirm:confirm-1"]);
});

test("統合: finalization required ではrefreshせずfinalize-only retryだけを実行する", async () => {
  const { state, calls, commitCount } = buildIntegration({
    commit: () => ({ ok: true, value: COMMITTED_PENDING }),
  });

  await state.validateFile(FAKE_FILE);
  await state.confirmRestore();

  assert.deepEqual(calls, [
    "prepare",
    "begin:permit-1",
    "commit",
    "complete:permit-1:succeeded",
  ]);
  assert.deepEqual(state.value, {
    phase: "restored-finalization-required",
    summary: SUMMARY,
    finalization: FINALIZATION,
  });

  calls.length = 0;
  await state.finalizeRestore();

  assert.deepEqual(calls, ["finalize", "refresh"]);
  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "restore",
    summary: SUMMARY,
    context: "ready",
  });
  assert.equal(commitCount(), 1);
});

test("統合: refresh失敗後のrefresh-only retryはFoundation commitとguardを再実行しない", async () => {
  let refreshes = 0;
  const { state, calls, commitCount } = buildIntegration({
    guard: {
      async refresh() {
        refreshes += 1;
        return refreshes === 1
          ? { ok: false, error: { kind: "context-unavailable" } }
          : { ok: true, value: EMPTY };
      },
    },
  });

  await state.validateFile(FAKE_FILE);
  await state.confirmRestore();

  assert.deepEqual(state.value, {
    phase: "restored-context-unavailable",
    summary: SUMMARY,
  });

  calls.length = 0;
  await state.refreshContext();

  assert.deepEqual(calls, ["refresh"]);
  assert.deepEqual(state.value, {
    phase: "succeeded",
    operation: "restore",
    summary: SUMMARY,
    context: "empty",
  });
  assert.equal(commitCount(), 1);
});

test("統合: committed後のsucceeded通知は一度だけで、retry経路でも重複しない", async () => {
  const { state, calls } = buildIntegration({
    commit: () => ({ ok: true, value: COMMITTED_PENDING }),
  });

  await state.validateFile(FAKE_FILE);
  await state.confirmRestore();
  await state.finalizeRestore();

  assert.deepEqual(
    calls.filter((call) => call === "complete:permit-1:succeeded").length,
    1,
  );
});
