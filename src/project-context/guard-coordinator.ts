import { err, ok, type ProjectId, type Result } from "../domain/public.js";
import type {
  ProjectContextChangeGuard,
  ProjectContextChangeIntent,
} from "./contracts.js";

export type ProjectChangeGuardError =
  | { readonly kind: "duplicate-guard" }
  | { readonly kind: "guard-failed" }
  | { readonly kind: "confirmation-stale" }
  | { readonly kind: "permit-stale" }
  | { readonly kind: "permit-not-started" }
  | { readonly kind: "permit-already-completed" };

export interface ProjectSwitchConfirmation {
  readonly id: string;
  readonly intent: Extract<
    ProjectContextChangeIntent,
    { readonly kind: "select-project" }
  >;
  readonly baseGeneration: number;
  readonly registryRevision: number;
}

export interface ProjectReplacementConfirmation {
  readonly id: string;
  readonly baseGeneration: number;
  readonly registryRevision: number;
}

export interface ProjectReplacementPermit {
  readonly id: string;
  readonly baseGeneration: number;
  readonly registryRevision: number;
}

type SelectionAssessment =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "confirmation-required";
      readonly confirmation: ProjectSwitchConfirmation;
    };
type ReplacementPreparation =
  | { readonly kind: "permitted"; readonly permit: ProjectReplacementPermit }
  | {
      readonly kind: "confirmation-required";
      readonly confirmation: ProjectReplacementConfirmation;
    };

interface PendingConfirmation {
  readonly id: string;
  readonly intent: ProjectContextChangeIntent;
  readonly baseGeneration: number;
  readonly registryRevision: number;
  cancelled: boolean;
}

interface ReplacementPermit extends ProjectReplacementPermit {
  readonly intent: Extract<
    ProjectContextChangeIntent,
    { readonly kind: "replace-catalog" }
  >;
  started: boolean;
  closed: boolean;
}

export interface ProjectChangeGuardCoordinator {
  register(
    guard: ProjectContextChangeGuard,
  ): Result<() => void, { readonly kind: "duplicate-guard" }>;
  unregister(id: string): void;
  registryRevision(): number;
  evaluateSelection(
    intent: Extract<
      ProjectContextChangeIntent,
      { readonly kind: "select-project" }
    >,
  ): Promise<Result<SelectionAssessment, ProjectChangeGuardError>>;
  confirmSelection(
    id: string,
  ): Promise<
    Result<
      Extract<
        SelectionAssessment,
        { readonly kind: "confirmation-required" }
      >["confirmation"],
      ProjectChangeGuardError
    >
  >;
  cancelSelection(id: string): Result<void, ProjectChangeGuardError>;
  prepareReplacement(): Promise<
    Result<ReplacementPreparation, ProjectChangeGuardError>
  >;
  confirmReplacement(
    id: string,
  ): Promise<Result<ProjectReplacementPermit, ProjectChangeGuardError>>;
  cancelReplacement(id: string): Result<void, ProjectChangeGuardError>;
  beginReplacement(id: string): Result<void, ProjectChangeGuardError>;
  completeReplacement(
    id: string,
    outcome: "succeeded" | "failed" | "cancelled",
  ): Promise<Result<void, ProjectChangeGuardError>>;
  notifyForcedSelection(
    intent: Extract<
      ProjectContextChangeIntent,
      { readonly kind: "select-project" }
    >,
  ): Promise<Result<void, ProjectChangeGuardError>>;
  invalidatePending(): void;
}

const GUARD_FAILED: ProjectChangeGuardError = { kind: "guard-failed" };
const CONFIRMATION_STALE: ProjectChangeGuardError = {
  kind: "confirmation-stale",
};
const PERMIT_STALE: ProjectChangeGuardError = { kind: "permit-stale" };

/** Guard の評価対象を開始時の登録順 snapshot に固定する。 */
export const createProjectChangeGuardCoordinator = (input: {
  readonly getSnapshot: () => {
    readonly generation: number;
    readonly selectedProjectId: ProjectId | null;
  };
}): ProjectChangeGuardCoordinator => {
  const guards = new Map<string, ProjectContextChangeGuard>();
  const confirmations = new Map<string, PendingConfirmation>();
  const permits = new Map<string, ReplacementPermit>();
  let revision = 0;
  let serial = 0;
  const nextId = (prefix: string) => `${prefix}-${++serial}`;
  const stale = (entry: {
    readonly baseGeneration: number;
    readonly registryRevision: number;
    readonly cancelled?: boolean;
  }) =>
    entry.cancelled === true ||
    entry.baseGeneration !== input.getSnapshot().generation ||
    entry.registryRevision !== revision;

  const evaluate = async (
    intent: ProjectContextChangeIntent,
  ): Promise<Result<boolean, ProjectChangeGuardError>> => {
    const registered = [...guards.values()];
    let needsConfirmation = false;
    for (const guard of registered) {
      let assessed: Awaited<ReturnType<ProjectContextChangeGuard["evaluate"]>>;
      try {
        assessed = await guard.evaluate(intent);
      } catch {
        return err(GUARD_FAILED);
      }
      if (!assessed.ok) return err(GUARD_FAILED);
      if (assessed.value.kind === "confirmation-required")
        needsConfirmation = true;
    }
    return ok(needsConfirmation);
  };
  const forced = async (
    intent: ProjectContextChangeIntent,
  ): Promise<boolean> => {
    let failed = false;
    for (const guard of [...guards.values()]) {
      try {
        await guard.notifyForced?.(intent);
      } catch {
        /* observer failure must not reopen a committed transaction */
        failed = true;
      }
    }
    return failed;
  };
  const createPermit = (
    intent: Extract<
      ProjectContextChangeIntent,
      { readonly kind: "replace-catalog" }
    >,
  ): ProjectReplacementPermit => {
    const permit: ReplacementPermit = {
      id: nextId("replacement"),
      intent,
      baseGeneration: input.getSnapshot().generation,
      registryRevision: revision,
      started: false,
      closed: false,
    };
    permits.set(permit.id, permit);
    return {
      id: permit.id,
      baseGeneration: permit.baseGeneration,
      registryRevision: permit.registryRevision,
    };
  };

  return {
    register(guard) {
      if (guards.has(guard.id)) return err({ kind: "duplicate-guard" });
      guards.set(guard.id, guard);
      revision += 1;
      let active = true;
      return ok(() => {
        if (active) {
          active = false;
          guards.delete(guard.id);
          revision += 1;
        }
      });
    },
    unregister(id) {
      if (guards.delete(id)) revision += 1;
    },
    registryRevision: () => revision,
    async evaluateSelection(intent) {
      const evaluated = await evaluate(intent);
      if (!evaluated.ok) return evaluated;
      if (!evaluated.value) return ok({ kind: "allowed" });
      const confirmation: ProjectSwitchConfirmation = {
        id: nextId("selection"),
        intent,
        baseGeneration: input.getSnapshot().generation,
        registryRevision: revision,
      };
      confirmations.set(confirmation.id, { ...confirmation, cancelled: false });
      return ok({ kind: "confirmation-required", confirmation });
    },
    async confirmSelection(id) {
      const pending = confirmations.get(id);
      if (
        pending === undefined ||
        pending.intent.kind !== "select-project" ||
        stale(pending)
      )
        return err(CONFIRMATION_STALE);
      confirmations.delete(id);
      return ok({
        id: pending.id,
        intent: pending.intent,
        baseGeneration: pending.baseGeneration,
        registryRevision: pending.registryRevision,
      });
    },
    cancelSelection(id) {
      const pending = confirmations.get(id);
      if (
        pending === undefined ||
        pending.intent.kind !== "select-project" ||
        stale(pending)
      )
        return err(CONFIRMATION_STALE);
      pending.cancelled = true;
      confirmations.delete(id);
      return ok(undefined);
    },
    async prepareReplacement() {
      const intent: Extract<
        ProjectContextChangeIntent,
        { readonly kind: "replace-catalog" }
      > = {
        kind: "replace-catalog",
        from: input.getSnapshot().selectedProjectId,
        cause: "backup-restore",
      };
      const evaluated = await evaluate(intent);
      if (!evaluated.ok) return evaluated;
      if (!evaluated.value)
        return ok({ kind: "permitted", permit: createPermit(intent) });
      const confirmation: ProjectReplacementConfirmation = {
        id: nextId("replacement-confirm"),
        baseGeneration: input.getSnapshot().generation,
        registryRevision: revision,
      };
      confirmations.set(confirmation.id, {
        ...confirmation,
        intent,
        cancelled: false,
      });
      return ok({ kind: "confirmation-required", confirmation });
    },
    async confirmReplacement(id) {
      const pending = confirmations.get(id);
      if (
        pending === undefined ||
        pending.intent.kind !== "replace-catalog" ||
        stale(pending)
      )
        return err(CONFIRMATION_STALE);
      confirmations.delete(id);
      return ok(createPermit(pending.intent));
    },
    cancelReplacement(id) {
      const pending = confirmations.get(id);
      if (
        pending === undefined ||
        pending.intent.kind !== "replace-catalog" ||
        stale(pending)
      )
        return err(CONFIRMATION_STALE);
      pending.cancelled = true;
      confirmations.delete(id);
      return ok(undefined);
    },
    beginReplacement(id) {
      const permit = permits.get(id);
      if (permit === undefined || permit.closed || permit.started)
        return err({ kind: "permit-already-completed" });
      if (stale(permit)) {
        permit.closed = true;
        return err(PERMIT_STALE);
      }
      permit.started = true;
      return ok(undefined);
    },
    async completeReplacement(id, outcome) {
      const permit = permits.get(id);
      if (permit === undefined || permit.closed)
        return err({ kind: "permit-already-completed" });
      if (!permit.started) return err({ kind: "permit-not-started" });
      permit.closed = true;
      if (outcome === "succeeded" && (await forced(permit.intent))) {
        return err(GUARD_FAILED);
      }
      return ok(undefined);
    },
    async notifyForcedSelection(intent) {
      return (await forced(intent)) ? err(GUARD_FAILED) : ok(undefined);
    },
    invalidatePending() {
      for (const confirmation of confirmations.values())
        confirmation.cancelled = true;
    },
  };
};
