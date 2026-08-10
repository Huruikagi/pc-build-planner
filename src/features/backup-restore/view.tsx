import type { ChangeEvent } from "react";
import { useSyncExternalStore } from "react";
import type { MessageKey, MessageResolver } from "../../ui-messages/public.js";
import { useMessages } from "../../ui-messages/public.js";
import type { RetryPolicy } from "./contracts.js";
import type {
  BackupRestoreFailure,
  BackupRestoreState,
  BackupRestoreStateValue,
} from "./state.js";

type DisplayError = BackupRestoreFailure;

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
  "stale-assessment": "backup.errors.stale-ticket",
  "precommit-cleanup-pending": "backup.errors.maintenance-active",
  "maintenance-active": "backup.errors.maintenance-active",
  storage: "backup.errors.storage",
  serialization: "backup.errors.serialization",
  "backup-capacity-invariant": "backup.errors.serialization",
  "guard-failed": "backup.errors.guard-failed",
  "confirmation-stale": "backup.errors.stale-ticket",
  "permit-stale": "backup.errors.stale-ticket",
  "context-unavailable": "backup.errors.context-unavailable",
  "refresh-failed": "backup.errors.context-unavailable",
} as const satisfies Record<DisplayError["code"], MessageKey>;

const messageFor = (error: DisplayError, messages: MessageResolver): string => {
  return messages(errorMessageKeys[error.code]);
};

/** 現行rootの異常分類だけを鍵とする回復案内。異常値やfingerprintは受け取らない。 */
const recoveryMessageKeys = {
  "corrupt-data": "backup.recoveryModeCorrupt",
  "unsupported-version": "backup.recoveryModeUnsupported",
} as const satisfies Record<string, MessageKey>;

/** contracts.tsのretry policyだけを鍵とし、Viewは許可actionを再判定しない。 */
const retryGuidance = (
  retry: RetryPolicy,
  messages: MessageResolver,
): string => {
  if (retry.kind === "unsupported")
    return messages("backup.retryGuidance.unsupported");
  switch (retry.action) {
    case "retry-export":
      return messages("backup.retryGuidance.retry-export");
    case "retry-restore":
      return messages("backup.retryGuidance.retry-restore");
    case "reassess-restore":
      return messages("backup.retryGuidance.reassess-restore");
    case "select-another-file":
      return messages("backup.retryGuidance.select-another-file");
    case "resolve-draft":
      return messages("backup.retryGuidance.resolve-draft");
  }
};

/** ticketを保持するすべてのphaseから、現行rootの異常分類だけを取り出す。 */
const currentAnomalyOf = (
  value: BackupRestoreStateValue,
): keyof typeof recoveryMessageKeys | undefined => {
  const ticket =
    value.phase === "awaiting-replacement-confirmation" ||
    value.phase === "awaiting-draft-confirmation" ||
    value.phase === "restoring"
      ? value.ticket
      : value.phase === "failed" && value.operation === "restore"
        ? value.ticket
        : undefined;
  return ticket?.currentAnomaly?.code;
};

const BUSY_PHASES = new Set([
  "exporting",
  "validating",
  "restoring",
  "refreshing-context",
]);

/** root write済みの状態。file再選択と復元確定を操作面から取り下げる。 */
const POST_COMMIT_PHASES = new Set([
  "restored-finalization-required",
  "restored-context-unavailable",
]);

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
  const postCommit = POST_COMMIT_PHASES.has(value.phase);
  /** root write済みの三状態は同じ件数summaryを一つのstatusとして示す。 */
  const completedSummary =
    (value.phase === "succeeded" && value.operation === "restore") ||
    value.phase === "restored-finalization-required" ||
    value.phase === "restored-context-unavailable"
      ? value.summary
      : undefined;
  const currentAnomaly = currentAnomalyOf(value);

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
          <>
            <p role="alert">{messageFor(value.error, messages)}</p>
            <p data-region="export-retry-guidance">
              {retryGuidance(value.retry, messages)}
            </p>
          </>
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
          disabled={busy || postCommit || !restoreAllowed}
          onChange={handleFileChange}
          type="file"
        />
        {value.phase === "validating" && (
          <p role="status">{messages("backup.validating")}</p>
        )}
        {currentAnomaly !== undefined && (
          <div data-region="restore-recovery">
            <p>{messages(recoveryMessageKeys[currentAnomaly])}</p>
          </div>
        )}
        {value.phase === "awaiting-replacement-confirmation" && (
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
        {value.phase === "awaiting-draft-confirmation" && (
          <div
            aria-label={messages("backup.draftConfirmationTitle")}
            data-region="restore-draft-confirmation"
            role="alertdialog"
          >
            <p>{messages("backup.draftWarning")}</p>
            <button
              data-action="approve-draft"
              disabled={!restoreAllowed}
              onClick={() => void state.approveDraft()}
              type="button"
            >
              {messages("backup.approveDraftAction")}
            </button>
            <button
              data-action="cancel-draft"
              onClick={() => state.cancelDraft()}
              type="button"
            >
              {messages("common.dismiss")}
            </button>
          </div>
        )}
        {(value.phase === "restoring" ||
          value.phase === "refreshing-context") && (
          <p role="status">{messages("backup.restoring")}</p>
        )}
        {completedSummary !== undefined && (
          <p role="status">
            {messages("backup.restoreCompleted", {
              projectCount: completedSummary.projectCount,
              partCount: completedSummary.partCount,
              currentBuildCount: completedSummary.currentBuildCount,
            })}
          </p>
        )}
        {value.phase === "restored-finalization-required" && (
          <div data-region="restore-finalization">
            <p>{messages("backup.finalizationRequired")}</p>
            <button
              data-action="finalize"
              disabled={!restoreAllowed}
              onClick={() => void state.finalizeRestore()}
              type="button"
            >
              {messages("backup.finalizeAction")}
            </button>
          </div>
        )}
        {value.phase === "restored-context-unavailable" && (
          <div data-region="restore-context-refresh">
            <p>{messages("backup.contextUnavailable")}</p>
            <button
              data-action="refresh-context"
              onClick={() => void state.refreshContext()}
              type="button"
            >
              {messages("backup.refreshContextAction")}
            </button>
          </div>
        )}
        {value.phase === "failed" && value.operation === "restore" && (
          <>
            <p role="alert">{messageFor(value.error, messages)}</p>
            <p data-region="restore-retry-guidance">
              {retryGuidance(value.retry, messages)}
            </p>
            {((value.retry.kind === "retryable" &&
              value.retry.action === "retry-restore") ||
              (value.retry.kind === "action-required" &&
                value.retry.action === "resolve-draft")) && (
              <button
                data-action="retry-restore"
                disabled={!restoreAllowed}
                onClick={() => void state.retryRestore()}
                type="button"
              >
                {messages("backup.retryRestoreAction")}
              </button>
            )}
            {value.retry.kind === "retryable" &&
              value.retry.action === "reassess-restore" && (
                <button
                  data-action="reassess-restore"
                  disabled={!restoreAllowed}
                  onClick={() => void state.reassessRestore()}
                  type="button"
                >
                  {messages("backup.reassessRestoreAction")}
                </button>
              )}
          </>
        )}
      </section>
    </section>
  );
}
