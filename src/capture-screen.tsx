/**
 * 取り込み面。デザインキャンバス「4. 取り込み」に対応する。
 *
 * 一時表示面であり、常設ナビゲーションには現れない。拡張アイコンの操作で
 * 現れ、完了・失敗の解消・対象タブの遷移で消える
 * (`docs/reverse/screens.md` 0 章)。
 *
 * 取得できた項目には出典と元表記を添え、取得できなかった項目も理由付きで
 * 必ず出す。黙って捨てない (`features.md` 2.3)。
 */

import type { CaptureResult, CaptureState } from "./capture/types.js";
import { t } from "./i18n.js";
import { formatMoney } from "./model.js";

const sourceLabel = (source: string): string =>
  t(`captureSource_${source.replaceAll("-", "_")}`);

const CapturedFields = ({ result }: { readonly result: CaptureResult }) => {
  const rows = [
    { field: "name", accepted: result.fields.name },
    { field: "manufacturer", accepted: result.fields.manufacturer },
    { field: "modelNumber", accepted: result.fields.modelNumber },
  ] as const;

  const captured = rows.filter((row) => row.accepted !== undefined);
  const total = captured.length + (result.price === null ? 0 : 1);

  return (
    <>
      <div className="section-header">
        <span>{t("captureAccepted")}</span>
        <span>{total}</span>
      </div>

      {captured.map(({ field, accepted }) =>
        accepted === undefined ? null : (
          <div className="capture-row" key={field}>
            <div className="capture-row__head">
              <span className="capture-row__label">
                {t(`field${field.charAt(0).toUpperCase()}${field.slice(1)}`)}
              </span>
              <span className="capture-row__value">{accepted.value}</span>
              <span className="badge badge--source">
                {sourceLabel(accepted.source)}
              </span>
            </div>
            {accepted.original === accepted.value ? null : (
              <div className="capture-row__original">
                {t("captureOriginal", accepted.original)}
              </div>
            )}
          </div>
        ),
      )}

      {result.price === null ? null : (
        <div className="capture-row">
          <div className="capture-row__head">
            <span className="capture-row__label">{t("fieldPrice")}</span>
            <span className="capture-row__value capture-row__value--mono">
              {formatMoney(result.price.money)}
            </span>
            <span className="badge badge--source">
              {sourceLabel(result.price.source)}
            </span>
          </div>
          <div className="capture-row__original">
            {t("captureOriginal", result.price.original)}
          </div>
        </div>
      )}

      <div className="capture-row">
        <div className="capture-row__head">
          <span className="capture-row__label">{t("fieldCategory")}</span>
          <span className="capture-row__value">
            {result.categoryHint === null
              ? t("captureCategoryUnknown")
              : t(`category_${result.categoryHint.replace("-", "_")}`)}
          </span>
          {result.categoryHint === null ? null : (
            <span className="badge badge--hint">{t("captureHint")}</span>
          )}
        </div>
        <div className="capture-row__original">
          {result.categoryHint === null
            ? t("captureCategoryUnknownNote")
            : t("captureCategoryHintNote")}
        </div>
      </div>
    </>
  );
};

const RejectedFields = ({ result }: { readonly result: CaptureResult }) => {
  if (result.rejected.length === 0) return null;
  return (
    <>
      <div className="section-header section-header--warn">
        <span>{t("captureRejected")}</span>
        <span>{result.rejected.length}</span>
      </div>
      {result.rejected.map((rejection) => (
        <div className="capture-row capture-row--rejected" key={rejection.id}>
          <div className="capture-row__head">
            <span className="capture-row__label">{rejection.sourceLabel}</span>
            <span className="capture-row__reason">
              {t(`captureReason_${rejection.reason}`)}
            </span>
          </div>
        </div>
      ))}
    </>
  );
};

interface CaptureScreenProps {
  readonly state: CaptureState;
  readonly onAccept: (result: CaptureResult) => void;
  readonly onDismiss: () => void;
}

export const CaptureScreen = ({
  state,
  onAccept,
  onDismiss,
}: CaptureScreenProps) => {
  if (state.status === "extracting")
    return (
      <div className="capture-banner" data-capture-status="extracting">
        <span role="status">{t("captureExtracting")}</span>
      </div>
    );

  if (state.status === "failed")
    return (
      <div data-capture-status="failed">
        <div className="notice notice--error" role="alert">
          {t(`captureError_${state.kind}`)}
        </div>
        <div className="editor-actions">
          <button
            className="button"
            data-capture-dismiss
            onClick={onDismiss}
            type="button"
          >
            {t("captureDismiss")}
          </button>
        </div>
      </div>
    );

  const { result } = state;

  return (
    <div data-capture-status="captured">
      <div className="capture-banner">
        <div>
          <div className="capture-banner__title">{t("captureDone")}</div>
          <div className="capture-banner__url">{result.url}</div>
        </div>
        <button
          aria-label={t("captureDismiss")}
          className="project-menu__icon-button"
          data-capture-dismiss
          onClick={onDismiss}
          type="button"
        >
          ✕
        </button>
      </div>

      <CapturedFields result={result} />
      <RejectedFields result={result} />

      <div className="editor-actions">
        <button
          className="button button--primary"
          data-capture-accept
          onClick={() => onAccept(result)}
          type="button"
        >
          {t("captureAccept")}
        </button>
      </div>
    </div>
  );
};
