import type { ChangeEvent } from "react";
import { useSyncExternalStore } from "react";

import type { MessageKey, MessageResolver } from "../../ui-messages/public.js";
import { useMessages } from "../../ui-messages/public.js";
import type { BackupError, FileError, RestoreError } from "./contracts.js";
import type { BackupRestoreState } from "./state.js";

type DisplayError = BackupError | FileError | RestoreError;

/** codeだけを鍵とし、値は一切含めないキー写像。全codeを網羅する。 */
const errorMessageKeys = {
  "no-file-selected": "backup.errors.no-file-selected",
  "multiple-files-selected": "backup.errors.multiple-files-selected",
  unreadable: "backup.errors.unreadable",
  "size-exceeded": "backup.errors.size-exceeded",
  "not-json": "backup.errors.not-json",
  "invalid-structure": "backup.errors.invalid-structure",
  "invalid-reference": "backup.errors.invalid-reference",
  "unsupported-version": "backup.errors.unsupported-version",
  "quota-exceeded": "backup.errors.quota-exceeded",
  "storage-unavailable": "backup.errors.storage-unavailable",
  "corrupt-current-data": "backup.errors.corrupt-current-data",
  "unsupported-current-data": "backup.errors.unsupported-current-data",
  "stale-ticket": "backup.errors.stale-ticket",
  "maintenance-active": "backup.errors.maintenance-active",
  storage: "backup.errors.storage",
  serialization: "backup.errors.serialization",
} as const satisfies Record<DisplayError["code"], MessageKey>;

const messageFor = (error: DisplayError, messages: MessageResolver): string => {
  return messages(errorMessageKeys[error.code]);
};

const BUSY_PHASES = new Set(["exporting", "validating", "restoring"]);

export function BackupRestoreView({
  state,
  exportAllowed = true,
  restoreAllowed = true,
}: {
  readonly state: BackupRestoreState;
  readonly exportAllowed?: boolean;
  readonly restoreAllowed?: boolean;
}) {
  const messages = useMessages();
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
    <section aria-label={messages("backup.title")} className="backup-restore">
      <div className="backup-restore-notice">
        <p>{messages("backup.noticeUninstall")}</p>
        <p>{messages("backup.noticeFileOwnership")}</p>
        <p>{messages("backup.noticeNoAutoBackup")}</p>
      </div>

      <section
        aria-label={messages("backup.exportHeading")}
        className="backup-restore-export"
        data-region="export"
      >
        <h4>{messages("backup.exportHeading")}</h4>
        <button
          data-action="export"
          disabled={busy || !exportAllowed}
          onClick={() => void state.exportBackup()}
          type="button"
        >
          {messages("backup.exportAction")}
        </button>
        {value.phase === "exporting" && (
          <p role="status">{messages("backup.exporting")}</p>
        )}
        {value.phase === "succeeded" && value.operation === "backup" && (
          <p role="status">
            {messages("backup.downloaded", { filename: value.filename })}
          </p>
        )}
        {value.phase === "failed" && value.operation === "backup" && (
          <p role="alert">{messageFor(value.error, messages)}</p>
        )}
      </section>

      <section
        aria-label={messages("backup.restoreHeading")}
        className="backup-restore-import"
        data-region="restore"
      >
        <h4>{messages("backup.restoreHeading")}</h4>
        <input
          accept="application/json"
          disabled={busy || !restoreAllowed}
          onChange={handleFileChange}
          type="file"
        />
        {value.phase === "validating" && (
          <p role="status">{messages("backup.validating")}</p>
        )}
        {value.phase === "awaiting-confirmation" && (
          <div
            aria-label={messages("backup.restoreConfirmationTitle")}
            data-region="restore-confirmation"
            role="alertdialog"
          >
            <p>{messages("backup.restoreWarning")}</p>
            <dl>
              <dt>{messages("backup.createdAtLabel")}</dt>
              <dd>{value.ticket.preview.createdAt}</dd>
              <dt>{messages("backup.formatVersionLabel")}</dt>
              <dd>{value.ticket.preview.formatVersion}</dd>
              <dt>{messages("backup.projectCountLabel")}</dt>
              <dd>{value.ticket.preview.projectCount}</dd>
              <dt>{messages("backup.partCountLabel")}</dt>
              <dd>{value.ticket.preview.partCount}</dd>
              <dt>{messages("backup.currentBuildCountLabel")}</dt>
              <dd>{value.ticket.preview.currentBuildCount}</dd>
            </dl>
            <button
              data-action="confirm"
              disabled={!restoreAllowed}
              onClick={() => void state.confirmRestore()}
              type="button"
            >
              {messages("backup.confirmAction")}
            </button>
            <button
              data-action="cancel"
              onClick={() => state.cancel()}
              type="button"
            >
              {messages("common.dismiss")}
            </button>
          </div>
        )}
        {value.phase === "restoring" && (
          <p role="status">{messages("backup.restoring")}</p>
        )}
        {value.phase === "succeeded" && value.operation === "restore" && (
          <p role="status">
            {messages("backup.restoreCompleted", {
              projectCount: value.summary.projectCount,
              partCount: value.summary.partCount,
              currentBuildCount: value.summary.currentBuildCount,
            })}
          </p>
        )}
        {value.phase === "failed" && value.operation === "restore" && (
          <p role="alert">{messageFor(value.error, messages)}</p>
        )}
      </section>
    </section>
  );
}
