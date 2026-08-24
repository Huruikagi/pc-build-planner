/** 共通 project selector が利用する状態・操作・安定 failure message。 */
export const projectContext = {
  selector: {
    label: "現在のプロジェクト",
    empty: "利用できるプロジェクトはありません。",
    unavailable: "プロジェクトの情報を利用できません。",
    retry: "再試行",
    pending: "プロジェクトの情報を更新しています。",
    confirmationTitle: "プロジェクトを切り替えますか？",
    confirm: "切り替える",
    cancel: "キャンセル",
    errors: {
      contextUnavailable:
        "プロジェクトの情報を利用できません。再試行してください。",
      projectNotFound:
        "選択したプロジェクトは利用できません。再試行してください。",
      guardFailed:
        "プロジェクトを切り替えられませんでした。再試行してください。",
      confirmationStale:
        "確認の有効期限が切れました。もう一度選択してください。",
      preferenceWriteFailed:
        "プロジェクトの選択を保存できませんでした。再試行してください。",
    },
  },
} as const;
