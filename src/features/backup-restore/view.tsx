import type { ChangeEvent } from "react";
import { useSyncExternalStore } from "react";

import type { BackupError, FileError, RestoreError } from "./contracts.js";
import type { BackupRestoreState } from "./state.js";

type DisplayError = BackupError | FileError | RestoreError;

/** codeだけを鍵とし、値は一切含めない診断メッセージ表。全codeを網羅する。 */
const errorMessages: Readonly<Record<DisplayError["code"], string>> = {
  "no-file-selected": "ファイルが選択されていません。",
  "multiple-files-selected": "ファイルは一つだけ選択してください。",
  unreadable: "ファイルを読み取れませんでした。",
  "size-exceeded": "ファイルサイズが上限を超えています。",
  "not-json": "JSONとして読み取れないファイルです。",
  "invalid-structure": "ファイルの形式が不正です。",
  "invalid-reference": "ファイル内の参照関係が不正です。",
  "unsupported-version": "対応していない形式のバージョンです。",
  "quota-exceeded": "保存容量が不足しています。",
  "storage-unavailable": "保存領域を利用できません。",
  "corrupt-current-data":
    "保存データが破損しています。既存データは変更していません。",
  "unsupported-current-data":
    "保存データが対応していない形式です。既存データは変更していません。",
  "stale-ticket":
    "確認内容が古くなりました。もう一度ファイルを選び直してください。",
  "maintenance-active":
    "他の保守処理が進行中です。しばらくしてからお試しください。",
  storage: "保存領域を利用できません。",
  serialization: "データの変換に失敗しました。",
};

const messageFor = (error: DisplayError): string => {
  const base = errorMessages[error.code];
  return "path" in error && error.path !== undefined
    ? `${base}（位置: ${error.path}）`
    : base;
};

const BUSY_PHASES = new Set(["exporting", "validating", "restoring"]);

export function BackupRestoreView({
  state,
}: {
  readonly state: BackupRestoreState;
}) {
  useSyncExternalStore(
    (listener) => state.subscribe(listener),
    () => state.value,
    () => state.value,
  );
  const value = state.value;
  const busy = BUSY_PHASES.has(value.phase);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    const file = files?.length === 1 ? files[0] : undefined;
    event.target.value = "";
    if (file === undefined) return;
    void state.validateFile(file);
  };

  return (
    <section aria-label="バックアップと復元" className="backup-restore">
      <div className="backup-restore-notice">
        <p>
          拡張機能を削除すると、保存されているローカルデータは失われる可能性があります。
        </p>
        <p>生成したファイルの保管は利用者の責任です。</p>
        <p>バックアップは自動作成・クラウド保存・同期されません。</p>
      </div>

      <section
        aria-label="バックアップ作成"
        className="backup-restore-export"
        data-region="export"
      >
        <h3>バックアップ作成</h3>
        <button
          data-action="export"
          disabled={busy}
          onClick={() => void state.exportBackup()}
          type="button"
        >
          バックアップを作成
        </button>
        {value.phase === "exporting" && (
          <p role="status">バックアップを作成しています…</p>
        )}
        {value.phase === "succeeded" && value.operation === "backup" && (
          <p role="status">{value.filename} をダウンロードしました。</p>
        )}
        {value.phase === "failed" && value.operation === "backup" && (
          <p role="alert">{messageFor(value.error)}</p>
        )}
      </section>

      <section
        aria-label="復元"
        className="backup-restore-import"
        data-region="restore"
      >
        <h3>復元</h3>
        <input
          accept="application/json"
          disabled={busy}
          onChange={handleFileChange}
          type="file"
        />
        {value.phase === "validating" && (
          <p role="status">ファイルを確認しています…</p>
        )}
        {value.phase === "awaiting-confirmation" && (
          <div
            aria-label="復元の確認"
            data-region="restore-confirmation"
            role="alertdialog"
          >
            <p>現在の全データが選択したファイルの内容で置き換わります。</p>
            <dl>
              <dt>作成日時</dt>
              <dd>{value.ticket.preview.createdAt}</dd>
              <dt>形式版</dt>
              <dd>{value.ticket.preview.formatVersion}</dd>
              <dt>プロジェクト数</dt>
              <dd>{value.ticket.preview.projectCount}</dd>
              <dt>候補数</dt>
              <dd>{value.ticket.preview.partCount}</dd>
              <dt>現在構成数</dt>
              <dd>{value.ticket.preview.currentBuildCount}</dd>
            </dl>
            <button
              data-action="confirm"
              onClick={() => void state.confirmRestore()}
              type="button"
            >
              復元を確定
            </button>
            <button
              data-action="cancel"
              onClick={() => state.cancel()}
              type="button"
            >
              取消
            </button>
          </div>
        )}
        {value.phase === "restoring" && <p role="status">復元しています…</p>}
        {value.phase === "succeeded" && value.operation === "restore" && (
          <p role="status">
            復元が完了しました（プロジェクト{value.summary.projectCount}
            件、候補{value.summary.partCount}件、現在構成
            {value.summary.currentBuildCount}件）。
          </p>
        )}
        {value.phase === "failed" && value.operation === "restore" && (
          <p role="alert">{messageFor(value.error)}</p>
        )}
      </section>
    </section>
  );
}
