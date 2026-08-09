import type { Result } from "../../domain/public.js";
import { err, ok } from "../../domain/public.js";
import type { BackupRestoreFinalizationTicket } from "../../persistence/public.js";
import type {
  ProjectContextCommandPort,
  ProjectContextReplacementGuardPort,
  ProjectContextSnapshot,
} from "../../project-context/public.js";
import type {
  RestoreCommitOutcome,
  RestoreCompletion,
  RestoreContextError,
  RestoreError,
  RestoreSummary,
} from "./contracts.js";

/** guard内部のgeneration・revisionを持ち込まない、置換調整だけに必要な識別子。 */
export interface RestoreGuardPermit {
  readonly id: string;
}

export interface RestoreGuardConfirmation {
  readonly id: string;
}

export type RestoreGuardPreparation =
  | { readonly kind: "permitted"; readonly permit: RestoreGuardPermit }
  | {
      readonly kind: "confirmation-required";
      readonly confirmation: RestoreGuardConfirmation;
    };

export interface RestoreContextLifecycle {
  prepare(): Promise<Result<RestoreGuardPreparation, RestoreContextError>>;
  confirm(
    confirmationId: string,
  ): Promise<Result<RestoreGuardPermit, RestoreContextError>>;
  cancel(confirmationId: string): Result<void, RestoreContextError>;
  begin(permitId: string): Result<void, RestoreContextError>;
  complete(
    permitId: string,
    outcome: "succeeded" | "failed" | "cancelled",
  ): Promise<Result<void, RestoreContextError>>;
  /** begin成功済みで未closeのpermitだけがFoundation commitを開始できる。 */
  isCommitAllowed(permitId: string): boolean;
  refresh(): Promise<Result<ProjectContextSnapshot, RestoreContextError>>;
}

export interface RestoreContextLifecycleDependencies {
  readonly replacementGuard: ProjectContextReplacementGuardPort;
  readonly projectContext: Pick<ProjectContextCommandPort, "refresh">;
}

type GuardFailure = { readonly kind: string };

/** 上流guardのlifecycle errorを、値を含まないfeature codeへ写像する。 */
const mapGuardError = (error: GuardFailure): RestoreContextError => {
  switch (error.kind) {
    case "guard-failed":
    case "duplicate-guard":
      return { code: "guard-failed" };
    case "confirmation-stale":
      return { code: "confirmation-stale" };
    default:
      return { code: "permit-stale" };
  }
};

interface TrackedPermit {
  started: boolean;
  closed: boolean;
}

export const createRestoreContextLifecycle = (
  dependencies: RestoreContextLifecycleDependencies,
): RestoreContextLifecycle => {
  const permits = new Map<string, TrackedPermit>();

  return {
    async prepare() {
      const prepared = await dependencies.replacementGuard.prepare();
      if (!prepared.ok) return err(mapGuardError(prepared.error));
      if (prepared.value.kind === "confirmation-required")
        return ok({
          kind: "confirmation-required",
          confirmation: { id: prepared.value.confirmation.id },
        });
      const id = prepared.value.permit.id;
      permits.set(id, { started: false, closed: false });
      return ok({ kind: "permitted", permit: { id } });
    },

    async confirm(confirmationId) {
      const confirmed =
        await dependencies.replacementGuard.confirm(confirmationId);
      if (!confirmed.ok) return err(mapGuardError(confirmed.error));
      const id = confirmed.value.id;
      permits.set(id, { started: false, closed: false });
      return ok({ id });
    },

    cancel(confirmationId) {
      const cancelled = dependencies.replacementGuard.cancel(confirmationId);
      return cancelled.ok ? ok(undefined) : err(mapGuardError(cancelled.error));
    },

    begin(permitId) {
      const tracked = permits.get(permitId);
      if (tracked === undefined || tracked.closed || tracked.started)
        return err({ code: "permit-stale" });
      const begun = dependencies.replacementGuard.begin(permitId);
      if (!begun.ok) {
        tracked.closed = true;
        return err(mapGuardError(begun.error));
      }
      tracked.started = true;
      return ok(undefined);
    },

    async complete(permitId, outcome) {
      const tracked = permits.get(permitId);
      if (tracked === undefined) return err({ code: "permit-stale" });
      /** 既に閉じたpermitへは通知しない。committed後のsucceededは一度だけ届く。 */
      if (tracked.closed) return ok(undefined);
      tracked.closed = true;
      /** begin前のpermitは排他を取得していないため上流completeの前提を満たさない。 */
      if (!tracked.started) return ok(undefined);
      const completed = await dependencies.replacementGuard.complete(
        permitId,
        outcome,
      );
      return completed.ok ? ok(undefined) : err(mapGuardError(completed.error));
    },

    isCommitAllowed(permitId) {
      const tracked = permits.get(permitId);
      return tracked?.started === true && !tracked.closed;
    },

    async refresh() {
      let refreshed: Awaited<ReturnType<ProjectContextCommandPort["refresh"]>>;
      try {
        refreshed = await dependencies.projectContext.refresh();
      } catch {
        return err({ code: "refresh-failed" });
      }
      return refreshed.ok
        ? ok(refreshed.value)
        : err({ code: "context-unavailable" });
    },
  };
};

/**
 * project-contextがこのsectionへ合成されていない場合の入口。
 * 保護すべきdraft所有者が存在しないためprepareはpermitを発行し、
 * 再検証対象のcontextも存在しないためrefreshは`context-unavailable`を返す。
 */
export const createUnattachedProjectContextPorts =
  (): RestoreContextLifecycleDependencies => {
    let serial = 0;
    return {
      replacementGuard: {
        async prepare() {
          serial += 1;
          return ok({
            kind: "permitted",
            permit: {
              id: `unattached-${serial}`,
              baseGeneration: 0,
              registryRevision: 0,
            },
          });
        },
        async confirm() {
          return err({ kind: "confirmation-stale" });
        },
        cancel() {
          return err({ kind: "confirmation-stale" });
        },
        begin() {
          return ok(undefined);
        },
        async complete() {
          return ok(undefined);
        },
      },
      projectContext: {
        async refresh() {
          return err({ kind: "context-unavailable" });
        },
      },
    };
  };

/** commit後の通知・finalization・refreshの順序だけを所有する。root writeは再実行しない。 */
export interface RestorePostCommitCoordinator {
  afterCommit(input: {
    readonly permitId: string | null;
    readonly outcome: RestoreCommitOutcome;
  }): Promise<RestoreCompletion>;
  finalizeOnly(
    ticket: BackupRestoreFinalizationTicket,
    summary: RestoreSummary,
  ): Promise<Result<RestoreCompletion, RestoreError>>;
  refreshOnly(summary: RestoreSummary): Promise<RestoreCompletion>;
}

export interface RestorePostCommitCoordinatorDependencies {
  readonly lifecycle: RestoreContextLifecycle;
  readonly restoreService: {
    finalize(
      ticket: BackupRestoreFinalizationTicket,
      summary: RestoreSummary,
    ): Promise<Result<RestoreSummary, RestoreError>>;
  };
}

export const createRestorePostCommitCoordinator = (
  dependencies: RestorePostCommitCoordinatorDependencies,
): RestorePostCommitCoordinator => {
  const refreshInto = async (
    summary: RestoreSummary,
  ): Promise<RestoreCompletion> => {
    const refreshed = await dependencies.lifecycle.refresh();
    if (!refreshed.ok || refreshed.value.status === "unavailable")
      return { kind: "restored-context-unavailable", summary };
    return { kind: "restored", summary, context: refreshed.value.status };
  };

  return {
    async afterCommit({ permitId, outcome }) {
      /** notification失敗はroot writeを取り消さないため、結果を成功判定へ持ち込まない。 */
      if (permitId !== null)
        await dependencies.lifecycle.complete(permitId, "succeeded");
      if (outcome.kind === "committed-finalization-required")
        return {
          kind: "restored-finalization-required",
          summary: outcome.summary,
          finalization: outcome.finalization,
        };
      return refreshInto(outcome.summary);
    },

    async finalizeOnly(ticket, summary) {
      const finalized = await dependencies.restoreService.finalize(
        ticket,
        summary,
      );
      if (!finalized.ok) return err(finalized.error);
      return ok(await refreshInto(finalized.value));
    },

    refreshOnly: (summary) => refreshInto(summary),
  };
};
