import { err, ok, type ProjectId, type Result } from "../../domain/public.js";
import type {
  ProjectContextChangeGuardRegistrationPort,
  ProjectContextChangeIntent,
  ProjectContextReadPort,
  ProjectContextSnapshot,
} from "../../project-context/public.js";

/** Stable across mounts so a remount cannot leave two current-build guards registered. */
export const CURRENT_BUILD_DRAFT_GUARD_ID = "current-build.quantity-draft";

/**
 * project-context のうち current-build が必要とする射影だけ（要件 1.1、1.5、1.6）。
 * catalog は複製せず、`ready` のときだけ project 固有操作に使える ID を公開する。
 */
export type BuildProjectAvailability =
  | {
      readonly status: "ready";
      readonly generation: number;
      readonly projectId: ProjectId;
    }
  | { readonly status: "empty"; readonly generation: number }
  | { readonly status: "unavailable"; readonly generation: number };

/**
 * adapter が feature 所有者へ返す失敗（要件 7.7、7.8）。
 * - `guard-registration-failed`: guard を登録できず draft 保護を約束できない。
 * - `guard-declined`: 所有者が取消・検証失敗・保存失敗で切替を許可しなかった。
 * - `stale-request`: 確認の完了前に要求または generation が古くなった。
 */
export type BuildContextAdapterError =
  | { readonly kind: "guard-registration-failed" }
  | { readonly kind: "guard-declined" }
  | { readonly kind: "stale-request" };

/**
 * 一回の guard 評価を識別する owner-local な handle。
 * draft 内容や保存手段は含めず、context 境界の外へ出さない。
 */
export interface BuildProjectSwitch {
  readonly token: string;
  readonly from: ProjectId | null;
  readonly to: ProjectId | null;
  readonly baseGeneration: number;
  readonly cause: "user" | "catalog-invalidated" | "backup-restore";
}

/** draft の保存・破棄・取消を所有する feature 側の判断口。 */
export interface BuildDraftGuardOwner {
  evaluate(
    change: BuildProjectSwitch,
  ): Promise<Result<"allow", BuildContextAdapterError>>;
  notifyForced(change: BuildProjectSwitch): void;
}

export interface CurrentBuildProjectContextAdapter {
  getCurrent(): BuildProjectAvailability;
  subscribe(listener: (value: BuildProjectAvailability) => void): () => void;
  registerDraftGuard(
    owner: BuildDraftGuardOwner,
  ): Result<() => void, BuildContextAdapterError>;
}

export interface CurrentBuildProjectContextAdapterDependencies {
  readonly read: ProjectContextReadPort;
  readonly guards: ProjectContextChangeGuardRegistrationPort;
}

const project = (snapshot: ProjectContextSnapshot): BuildProjectAvailability =>
  snapshot.status === "ready"
    ? {
        status: "ready",
        generation: snapshot.generation,
        projectId: snapshot.selectedProjectId,
      }
    : { status: snapshot.status, generation: snapshot.generation };

/** generation を除いた「current-build から見た内容」が同じかどうか。 */
const sameSelection = (
  left: BuildProjectAvailability,
  right: BuildProjectAvailability,
): boolean =>
  left.status === right.status &&
  (left.status !== "ready" ||
    right.status !== "ready" ||
    left.projectId === right.projectId);

const toSwitch = (
  intent: ProjectContextChangeIntent,
  token: string,
  baseGeneration: number,
): BuildProjectSwitch => ({
  token,
  from: intent.from,
  to: intent.kind === "select-project" ? intent.to : null,
  baseGeneration,
  cause: intent.cause,
});

/**
 * 共通の現在 project を owner-local な availability と draft guard へ橋渡しする。
 * project の選択 authority、preference、fallback は持たない（要件 1.5、1.6）。
 */
export const createCurrentBuildProjectContextAdapter = (
  dependencies: CurrentBuildProjectContextAdapterDependencies,
): CurrentBuildProjectContextAdapter => {
  const listeners = new Set<(value: BuildProjectAvailability) => void>();
  let unsubscribeRead: (() => void) | null = null;
  let delivered: BuildProjectAvailability | null = null;

  const publish = (snapshot: ProjectContextSnapshot) => {
    const next = project(snapshot);
    // 確定済みより古い generation は採用しない（遅延通知の逆転を無視する）。
    if (delivered !== null && next.generation < delivered.generation) return;
    const previous = delivered;
    delivered = next;
    if (previous !== null && sameSelection(previous, next)) return;
    for (const listener of [...listeners]) listener(next);
  };

  return {
    getCurrent: () => project(dependencies.read.getSnapshot()),
    subscribe(listener) {
      listeners.add(listener);
      if (unsubscribeRead === null) {
        delivered = project(dependencies.read.getSnapshot());
        unsubscribeRead = dependencies.read.subscribe(publish);
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (listeners.size > 0 || unsubscribeRead === null) return;
        const release = unsubscribeRead;
        unsubscribeRead = null;
        delivered = null;
        release();
      };
    },
    registerDraftGuard(owner) {
      let released = false;
      let serial = 0;
      let activeToken: string | null = null;
      const registered = dependencies.guards.register({
        id: CURRENT_BUILD_DRAFT_GUARD_ID,
        async evaluate(intent) {
          if (released) return ok({ kind: "allow" });
          serial += 1;
          const token = `${CURRENT_BUILD_DRAFT_GUARD_ID}:${serial}`;
          const change = toSwitch(
            intent,
            token,
            dependencies.read.getSnapshot().generation,
          );
          activeToken = token;
          let decision: Result<"allow", BuildContextAdapterError>;
          try {
            decision = await owner.evaluate(change);
          } catch {
            return err({ kind: "guard-failed" });
          }
          const stale =
            released ||
            activeToken !== token ||
            dependencies.read.getSnapshot().generation !==
              change.baseGeneration;
          // 古い確認結果は allow としても失敗としても context へ持ち込まない。
          if (stale || !decision.ok) return err({ kind: "guard-failed" });
          return ok({ kind: "allow" });
        },
        notifyForced(intent) {
          if (released) return;
          serial += 1;
          // forced 変更では保存も破棄も代行せず、所有者へ判断を戻す。
          owner.notifyForced(
            toSwitch(
              intent,
              `${CURRENT_BUILD_DRAFT_GUARD_ID}:${serial}`,
              dependencies.read.getSnapshot().generation,
            ),
          );
        },
      });
      if (!registered.ok) return err({ kind: "guard-registration-failed" });
      const release = registered.value;
      return ok(() => {
        if (released) return;
        released = true;
        activeToken = null;
        release();
      });
    },
  };
};
