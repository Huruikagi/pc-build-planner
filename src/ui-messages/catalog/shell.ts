/**
 * アプリケーションシェルの状態表示・起動失敗の文言。
 * `startupFailed` は `composition-root.ts`（`STARTUP_FAILED`）と
 * `application-composition.ts`（`STARTUP_ERROR`）の2箇所で文面が完全一致していたため単一キーへ統合する。
 */
export const shell = {
  navigationLabel: "機能ナビゲーション",
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
  hostStopped: "side panel host は停止しています",
  /** `feature ${id} は未登録です` の再設計。 */
  featureNotRegistered: "feature {featureId} は未登録です",
  /** `feature ${id} は利用できません: ${reason}` の再設計。`{reason}` は機能が申告した自由文字列を受け取る。 */
  featureUnavailable: "feature {featureId} は利用できません: {reason}",
  /** `feature ${id} の表示要求は無効になりました` の再設計。 */
  featureRequestInvalidated: "feature {featureId} の表示要求は無効になりました",
  /** `feature ${id} の表示開始に失敗しました` の再設計。 */
  featureMountFailed: "feature {featureId} の表示開始に失敗しました",
  /** `feature ${id} の表示終了に失敗しました` の再設計。 */
  featureUnmountFailed: "feature {featureId} の表示終了に失敗しました",
  /**
   * 登録解除されたfeatureへ遷移しようとした場合の完結した文。「登録が解除されました」を
   * 理由として都度解決するのではなく、この1キーへ固定する（表示直前解決の原則を保つため）。
   */
  featureUnregistered:
    "feature {featureId} は利用できません: 登録が解除されました",
} as const;
