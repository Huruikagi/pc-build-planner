import type { ReactNode } from "react";

import type { FeatureId, ShellViewState } from "./contracts.js";
import { ShellErrorBoundary } from "./error-boundary.js";
import { hasNavIcon, NavIcon } from "./nav-icons.js";

export interface ShellNavigationItem {
  readonly id: FeatureId;
  readonly label: string;
  readonly icon?: string;
}

export interface ShellViewProps {
  readonly state: ShellViewState;
  readonly navigation: readonly ShellNavigationItem[];
  readonly children?: ReactNode;
  readonly onNavigate: (id: FeatureId) => void;
  readonly onRetry?: (() => void) | undefined;
}

function ShellNavigation({
  items,
  selected,
  onNavigate,
}: {
  readonly items: readonly ShellNavigationItem[];
  readonly selected: FeatureId | null;
  readonly onNavigate: (id: FeatureId) => void;
}) {
  return (
    <nav aria-label="機能ナビゲーション" className="shell-navigation">
      {items.map((item) => {
        const showIcon = item.icon !== undefined && hasNavIcon(item.icon);
        return (
          <button
            aria-current={item.id === selected ? "page" : undefined}
            aria-label={showIcon ? item.label : undefined}
            className="shell-navigation__item"
            data-feature-id={item.id}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={item.label}
            type="button"
          >
            {showIcon ? <NavIcon name={item.icon as string} /> : item.label}
          </button>
        );
      })}
    </nav>
  );
}

function RetryButton({
  onRetry,
}: {
  readonly onRetry?: (() => void) | undefined;
}) {
  return onRetry === undefined ? null : (
    <button data-action="retry" onClick={onRetry} type="button">
      再試行
    </button>
  );
}

function FeatureFailure({
  onRetry,
}: {
  readonly onRetry?: (() => void) | undefined;
}) {
  return (
    <section aria-live="polite" className="shell-status shell-status--error">
      <h2>機能を表示できませんでした</h2>
      <p>再試行するか、別の機能へ移動してください。</p>
      <RetryButton onRetry={onRetry} />
    </section>
  );
}

function selectedFeature(state: ShellViewState): FeatureId | null {
  switch (state.kind) {
    case "ready":
    case "maintenance":
      return state.selected;
    case "loading":
    case "error":
      return null;
  }
}

export function ShellView({
  state,
  navigation,
  children,
  onNavigate,
  onRetry,
}: ShellViewProps) {
  const selected = selectedFeature(state);
  return (
    <div className="application-shell">
      {state.kind === "loading" ? null : (
        <ShellNavigation
          items={navigation}
          onNavigate={onNavigate}
          selected={selected}
        />
      )}
      <main className="shell-main">
        {state.kind === "loading" ? (
          <p aria-live="polite" className="shell-status">
            読み込み中です
          </p>
        ) : null}
        {state.kind === "error" ? (
          <section
            aria-live="polite"
            className="shell-status shell-status--error"
          >
            <h2>エラーが発生しました</h2>
            <p>{state.message}</p>
            {state.recoverable ? <RetryButton onRetry={onRetry} /> : null}
          </section>
        ) : null}
        {state.kind === "maintenance" ? (
          <aside
            aria-live="polite"
            className="shell-status shell-status--maintenance"
          >
            <h2>メンテナンス中</h2>
            <p>{state.message}</p>
          </aside>
        ) : null}
        {(state.kind === "ready" || state.kind === "maintenance") &&
        state.selected === null ? (
          <section className="shell-status shell-status--empty">
            <h2>利用可能な機能がありません</h2>
            <p>利用可能になるまでお待ちください。</p>
          </section>
        ) : null}
        <section
          className="shell-feature"
          data-feature-id={selected ?? undefined}
        >
          <ShellErrorBoundary
            renderFallback={(resetBoundary) => (
              <FeatureFailure
                onRetry={() => {
                  resetBoundary();
                  onRetry?.();
                }}
              />
            )}
            resetKey={selected}
          >
            {children}
          </ShellErrorBoundary>
        </section>
      </main>
    </div>
  );
}
