import { err, type Result } from "../domain/public.js";
import type { MessageDescriptor } from "../ui-messages/public.js";
import type {
  ApplicationCompositionRoot,
  CompositionError,
} from "./contracts.js";

export type SidePanelBootstrapError =
  | { readonly kind: "missing_host"; readonly message: MessageDescriptor }
  | CompositionError;

export interface SidePanelBootstrapResult<TRootApi extends object> {
  readonly api: TRootApi;
}

export interface SidePanelBootstrap<TRootApi extends object> {
  start(): Promise<
    Result<SidePanelBootstrapResult<TRootApi>, SidePanelBootstrapError>
  >;
  stop(): Promise<void>;
}

export interface SidePanelBootstrapOptions<TRootApi extends object> {
  readonly root: ApplicationCompositionRoot<TRootApi>;
  readonly document: Document;
  readonly lifecycleTarget?: Pick<
    EventTarget,
    "addEventListener" | "removeEventListener"
  >;
  readonly hostSelector?: string;
}

const MISSING_HOST_MESSAGE: MessageDescriptor = {
  key: "Application shell host is unavailable.",
};
const STARTUP_FAILURE_MESSAGE: MessageDescriptor = {
  key: "Application shell failed to start.",
};

export function createSidePanelBootstrap<TRootApi extends object>(
  options: SidePanelBootstrapOptions<TRootApi>,
): SidePanelBootstrap<TRootApi> {
  let startPromise:
    | Promise<
        Result<SidePanelBootstrapResult<TRootApi>, SidePanelBootstrapError>
      >
    | undefined;
  let stopPromise: Promise<void> | undefined;
  let lifecycleInstalled = false;
  let stopped = false;
  const selector = options.hostSelector ?? "#application-shell";

  const setDiagnostic = (
    target: HTMLElement,
    state: "started" | "failed" | "stopped",
    diagnostic?: SidePanelBootstrapError["kind"],
  ): void => {
    target.dataset.runtimeState = state;
    if (diagnostic === undefined) delete target.dataset.runtimeDiagnostic;
    else target.dataset.runtimeDiagnostic = diagnostic;
  };

  const stopOnPageHide = (): void => {
    void stop().catch(() => {
      const target = options.document.querySelector<HTMLElement>(selector);
      if (target !== null) setDiagnostic(target, "failed", "startup_failed");
    });
  };

  const installLifecycle = (): void => {
    if (lifecycleInstalled || options.lifecycleTarget === undefined) return;
    lifecycleInstalled = true;
    options.lifecycleTarget.addEventListener("pagehide", stopOnPageHide);
  };

  const stop = (): Promise<void> => {
    if (stopPromise !== undefined) return stopPromise;
    if (stopped) return Promise.resolve();
    stopped = true;
    const pending = (async () => {
      if (lifecycleInstalled && options.lifecycleTarget !== undefined) {
        options.lifecycleTarget.removeEventListener("pagehide", stopOnPageHide);
        lifecycleInstalled = false;
      }
      await options.root.stop();
      const host = options.document.querySelector<HTMLElement>(selector);
      if (host !== null) setDiagnostic(host, "stopped");
    })();
    stopPromise = pending;
    return pending;
  };

  return {
    start() {
      if (startPromise !== undefined) return startPromise;
      const host = options.document.querySelector<HTMLElement>(selector);
      if (host === null) {
        const failure = err<SidePanelBootstrapError>({
          kind: "missing_host",
          message: MISSING_HOST_MESSAGE,
        });
        setDiagnostic(
          options.document.documentElement,
          "failed",
          "missing_host",
        );
        startPromise = Promise.resolve(failure);
        return startPromise;
      }
      stopped = false;
      installLifecycle();
      const pending = options.root.start().then(
        (result) => {
          if (!result.ok) {
            setDiagnostic(host, "failed", result.error.kind);
            return err<SidePanelBootstrapError>({
              kind: result.error.kind,
              message: STARTUP_FAILURE_MESSAGE,
            });
          }
          setDiagnostic(host, "started");
          return result;
        },
        () => {
          setDiagnostic(host, "failed", "startup_failed");
          return err<SidePanelBootstrapError>({
            kind: "startup_failed",
            message: STARTUP_FAILURE_MESSAGE,
          });
        },
      );
      startPromise = pending;
      return pending;
    },
    stop,
  };
}
