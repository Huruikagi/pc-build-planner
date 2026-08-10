import type { OperationKind } from "../../application-shell/public.js";

/** 区画表示、export、file選択、preflightは既存rootを書き換えない読取操作である。 */
export const backupReadOperation = "read" satisfies OperationKind;

/**
 * 復元commitとcommit後のcleanupだけがroot writeを伴う。
 * 通常maintenance中は拒否され、`recovery-required`では許可される。
 */
export const backupRestoreCommitOperation = "recovery" satisfies OperationKind;
