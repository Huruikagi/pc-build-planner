import type { ProjectId, Result, UtcTimestamp } from "../domain/public.js";

/**
 * project context が公開する最小 project projection（要件 1.1、1.6）。
 * project 内容の authoritative record ではなく、選択と表示に必要な field だけを持つ。
 */
export interface ProjectCatalogItem {
  readonly id: ProjectId;
  readonly name: string;
  readonly updatedAt: UtcTimestamp;
}

/**
 * catalog 取得・射影の失敗。vendor 固有 error や project 名・ID を含めない（要件 1.3）。
 * - `source-unavailable`: owner source の読み取り自体が失敗した。
 * - `invalid-catalog`: entry が不正、または ID が重複しており部分 catalog を公開できない。
 */
export type ProjectCatalogError =
  | { readonly kind: "source-unavailable" }
  | { readonly kind: "invalid-catalog" };

/** owner から注入される、絞り込み済みの catalog 読み取り口。順序は source が決める（要件 2.4）。 */
export interface ProjectCatalogSource {
  list(): Promise<Result<readonly ProjectCatalogItem[], ProjectCatalogError>>;
}

/** source の成功値を全-or-nothing で最小 catalog へ射影する（要件 1.1、1.2、1.3）。 */
export interface ProjectCatalogProjection {
  load(): Promise<Result<readonly ProjectCatalogItem[], ProjectCatalogError>>;
}

/** `unavailable` snapshot の原因。利用者向け文言ではなく安定した識別子として扱う。 */
export type ProjectContextUnavailableReason =
  | "not-initialized"
  | "catalog-unavailable"
  | "preference-unavailable"
  | "preference-write-failed";

/**
 * catalog と選択の一貫性境界（要件 1.1〜1.6）。
 * `ready` だけが non-null な選択を持ち、`empty` と `unavailable` は
 * project 固有操作に使える現在 project ID を公開しない。
 */
export type ProjectContextSnapshot =
  | {
      readonly status: "ready";
      readonly generation: number;
      readonly catalog: readonly [ProjectCatalogItem, ...ProjectCatalogItem[]];
      readonly selectedProjectId: ProjectId;
    }
  | {
      readonly status: "empty";
      readonly generation: number;
      readonly catalog: readonly [];
      readonly selectedProjectId: null;
    }
  | {
      readonly status: "unavailable";
      readonly generation: number;
      readonly selectedProjectId: null;
      readonly reason: ProjectContextUnavailableReason;
    };

/**
 * 専用 key から読み出した preference の解釈結果（要件 2.1、2.2、2.3、8.2）。
 * - `missing`: 保存値が存在しない。初回起動、または catalog が空になった後。
 * - `invalid`: strict schema に適合しない。未知 version もここへ閉じ、推測 migration を行わない。
 * - `valid`: version 1 として検証済みの選択。catalog との照合はまだ行っていない。
 */
export type ProjectPreferenceRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "valid"; readonly selectedProjectId: ProjectId };

/**
 * preference storage の失敗。保存値、project ID、vendor 例外を含めない（要件 2.6、3.6）。
 * - `storage-unavailable`: 読み取り自体が拒否された。
 * - `storage-write-failed`: 書き込みまたは消去が拒否された。
 */
export type ProjectPreferenceError =
  | { readonly kind: "storage-unavailable" }
  | { readonly kind: "storage-write-failed" };

/**
 * 専用 key 一件だけを read/write/clear する保存 port（要件 8.1、8.3）。
 * Chrome adapter と in-memory adapter は同じこの契約を満たす。
 */
export interface ProjectPreferencePort {
  read(): Promise<Result<ProjectPreferenceRead, ProjectPreferenceError>>;
  write(projectId: ProjectId): Promise<Result<void, ProjectPreferenceError>>;
  clear(): Promise<Result<void, ProjectPreferenceError>>;
}

/** project 切替と catalog 全体置換だけを表す guard の意図。draft や置換データは含めない。 */
export type ProjectContextChangeIntent =
  | {
      readonly kind: "select-project";
      readonly from: ProjectId;
      readonly to: ProjectId;
      readonly cause: "user";
    }
  | {
      readonly kind: "select-project";
      readonly from: ProjectId;
      readonly to: ProjectId | null;
      readonly cause: "catalog-invalidated";
    }
  | {
      readonly kind: "replace-catalog";
      readonly from: ProjectId | null;
      readonly cause: "backup-restore";
    };

export type ProjectContextChangeGuardDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "confirmation-required" };

/** feature-owned draft を解釈せず、変更の可否だけを返す owner-local guard。 */
export interface ProjectContextChangeGuard {
  readonly id: string;
  evaluate(
    intent: ProjectContextChangeIntent,
  ): Promise<
    Result<ProjectContextChangeGuardDecision, { readonly kind: "guard-failed" }>
  >;
  notifyForced?(intent: ProjectContextChangeIntent): void | Promise<void>;
}
