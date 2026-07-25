/**
 * アプリケーションシェルの状態表示・起動失敗の文言。
 * `startupFailed` は `composition-root.ts`（`STARTUP_FAILED`）と
 * `application-composition.ts`（`STARTUP_ERROR`）の2箇所で文面が完全一致していたため単一キーへ統合する。
 */
export const shell = {
  loading: "読み込み中です",
  errorHeading: "エラーが発生しました",
  maintenanceHeading: "メンテナンス中",
  emptyHeading: "利用可能な機能がありません",
  emptyBody: "利用可能になるまでお待ちください。",
  retry: "再試行",
  featureFailureHeading: "機能を表示できませんでした",
  featureFailureBody: "再試行するか、別の機能へ移動してください。",
  startupFailed: "アプリケーションを開始できませんでした",
  missingDependency: "必須の依存関係がありません",
  maintenanceActive: "メンテナンス中です。変更操作は利用できません。",
  maintenanceStartupFailed: "メンテナンス状態を取得できませんでした",
} as const;
