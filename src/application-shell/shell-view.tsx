import type { ReactNode } from "react";

import type { MessageKey } from "../ui-messages/public.js";
import { message, useMessages } from "../ui-messages/public.js";
import type { FeatureId, ShellViewState } from "./contracts.js";
import { ShellErrorBoundary } from "./error-boundary.js";
import { hasNavIcon, NavIcon } from "./nav-icons.js";

export interface ShellNavigationItem {
  readonly id: FeatureId;
  readonly labelKey: MessageKey;
  readonly icon?: string;
}

export interface ShellViewProps {
  readonly state: ShellViewState;
  readonly navigation: readonly ShellNavigationItem[];
  readonly children?: ReactNode;
  readonly onNavigate: (id: FeatureId) => void;
  readonly onRetry?: (() => void) | undefined;
}

type NavigationMessageKey = Extract<MessageKey, `nav.${string}`>;

const navigationMessage = (key: MessageKey) =>
  message(key as NavigationMessageKey);

function ShellNavigation({
  items,
  selected,
  onNavigate,
}: {
  readonly items: readonly ShellNavigationItem[];
  readonly selected: FeatureId | null;
  readonly onNavigate: (id: FeatureId) => void;
}) {
  const messages = useMessages();
  return (
    <nav
      aria-label={messages("shell.navigationLabel")}
      className="shell-navigation"
    >
      {items.map((item) => {
        const showIcon = item.icon !== undefined && hasNavIcon(item.icon);
        const label = messages.resolveDescriptor(
          navigationMessage(item.labelKey),
        );
        return (
          <button
            aria-current={item.id === selected ? "page" : undefined}
            aria-label={showIcon ? label : undefined}
            className="shell-navigation__item"
            data-feature-id={item.id}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={label}
            type="button"
          >
            {showIcon ? <NavIcon name={item.icon as string} /> : label}
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
  const messages = useMessages();
  return onRetry === undefined ? null : (
    <button data-action="retry" onClick={onRetry} type="button">
      {messages("shell.retry")}
    </button>
  );
}

function FeatureFailure({
  onRetry,
}: {
  readonly onRetry?: (() => void) | undefined;
}) {
  const messages = useMessages();
  return (
    <section aria-live="polite" className="shell-status shell-status--error">
      <h2>{messages("shell.featureFailureHeading")}</h2>
      <p>{messages("shell.featureFailureBody")}</p>
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
  const messages = useMessages();
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
            {messages("shell.loading")}
          </p>
        ) : null}
        {state.kind === "error" ? (
          <section
            aria-live="polite"
            className="shell-status shell-status--error"
          >
            <h2>{messages("shell.errorHeading")}</h2>
            <p>{messages.resolveDescriptor(state.message)}</p>
            {state.recoverable ? <RetryButton onRetry={onRetry} /> : null}
          </section>
        ) : null}
        {state.kind === "maintenance" ? (
          <aside
            aria-live="polite"
            className="shell-status shell-status--maintenance"
          >
            <h2>{messages("shell.maintenanceHeading")}</h2>
            <p>{messages.resolveDescriptor(state.message)}</p>
          </aside>
        ) : null}
        {(state.kind === "ready" || state.kind === "maintenance") &&
        state.selected === null ? (
          <section className="shell-status shell-status--empty">
            <h2>{messages("shell.emptyHeading")}</h2>
            <p>{messages("shell.emptyBody")}</p>
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
