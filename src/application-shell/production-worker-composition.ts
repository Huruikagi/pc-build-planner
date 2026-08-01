import type { Result } from "../domain/public.js";
import type {
  FoundationRuntimeContribution,
  FoundationRuntimeInitializationError,
  WorkerMessageTarget,
} from "../persistence/public.js";
import { initializeProductionFoundationRuntimeContribution } from "../persistence/public.js";
import type { WorkerRegistrationContext } from "./contracts.js";
import type { WorkerFeatureContribution } from "./feature-contribution-catalog.js";
import { getWorkerContributions } from "./feature-contribution-catalog.js";
import type {
  TransientGestureRegistrationPort,
  TransientGestureSource,
  TransientMenuGestureDependencies,
} from "./transient-surface-ports.js";
import { composeWorkerContributions } from "./worker-composition.js";

export type ProductionWorkerStartupError = {
  readonly kind: "startup_failed";
  readonly stage:
    | "foundation_initialization"
    | "foundation_registration"
    | "catalog_registration"
    | "stopped";
  readonly message: string;
};

export interface ProductionWorkerComposition {
  start(): Promise<Result<void, ProductionWorkerStartupError>>;
  stop(): Promise<void>;
}

export interface ProductionWorkerCompositionOptions {
  readonly initializeFoundation: () => Promise<
    Result<FoundationRuntimeContribution, FoundationRuntimeInitializationError>
  >;
  readonly foundationTarget: WorkerMessageTarget;
  readonly catalog: readonly WorkerFeatureContribution[];
  readonly workerContext: WorkerRegistrationContext;
}

export type ProductionFoundationInitializer =
  ProductionWorkerCompositionOptions["initializeFoundation"];

export type DefaultProductionWorkerCompositionOptions = Omit<
  ProductionWorkerCompositionOptions,
  "initializeFoundation"
> & {
  readonly initializeFoundation?: ProductionFoundationInitializer;
};

const failure = (
  stage: ProductionWorkerStartupError["stage"],
): Result<void, ProductionWorkerStartupError> => ({
  ok: false,
  error: {
    kind: "startup_failed",
    stage,
    message: `worker startup failed: ${stage}`,
  },
});

export const createProductionWorkerComposition = (
  options: ProductionWorkerCompositionOptions,
): ProductionWorkerComposition => {
  let epoch = 0;
  let stopped = false;
  let startPromise:
    | Promise<Result<void, ProductionWorkerStartupError>>
    | undefined;
  let stopPromise: Promise<void> | undefined;
  let foundation: FoundationRuntimeContribution | undefined;
  let removeFoundation: (() => void) | undefined;
  let removeCatalog: (() => void) | undefined;

  const clean = async () => {
    if (removeCatalog) {
      try {
        removeCatalog();
        removeCatalog = undefined;
      } catch {
        /* retry on a later stop */
      }
    }
    if (removeFoundation) {
      try {
        removeFoundation();
        removeFoundation = undefined;
      } catch {
        /* retry on a later stop */
      }
    }
    if (foundation) {
      try {
        await foundation.dispose();
        foundation = undefined;
      } catch {
        /* retry on a later stop */
      }
    }
  };

  const run = async (): Promise<Result<void, ProductionWorkerStartupError>> => {
    const currentEpoch = epoch;
    let initialized: Result<
      FoundationRuntimeContribution,
      FoundationRuntimeInitializationError
    >;
    try {
      initialized = await options.initializeFoundation();
    } catch {
      return failure("foundation_initialization");
    }
    if (
      !initialized.ok ||
      !initialized.value ||
      typeof initialized.value.dispose !== "function"
    )
      return failure("foundation_initialization");
    foundation = initialized.value;
    if (stopped || currentEpoch !== epoch) {
      await clean();
      return failure("stopped");
    }

    let registered: Awaited<
      ReturnType<
        FoundationRuntimeContribution["workerRegistration"]["register"]
      >
    >;
    try {
      registered = await foundation.workerRegistration.register(
        options.foundationTarget,
      );
    } catch {
      await clean();
      return failure("foundation_registration");
    }
    if (!registered.ok || typeof registered.value !== "function") {
      await clean();
      return failure("foundation_registration");
    }
    removeFoundation = registered.value;
    if (stopped || currentEpoch !== epoch) {
      await clean();
      return failure("stopped");
    }

    let catalogResult: ReturnType<typeof composeWorkerContributions>;
    try {
      catalogResult = composeWorkerContributions(
        getWorkerContributions(options.catalog),
        options.workerContext,
      );
    } catch {
      await clean();
      return failure("catalog_registration");
    }
    if (!catalogResult.ok || typeof catalogResult.value !== "function") {
      await clean();
      return failure("catalog_registration");
    }
    removeCatalog = catalogResult.value;
    if (stopped || currentEpoch !== epoch) {
      await clean();
      return failure("stopped");
    }
    return { ok: true, value: undefined };
  };

  return {
    start() {
      startPromise ??= run();
      return startPromise;
    },
    stop() {
      stopped = true;
      epoch += 1;
      stopPromise = (stopPromise ?? Promise.resolve()).then(async () => {
        try {
          await startPromise;
        } catch {
          /* run normalizes startup failures */
        }
        await clean();
      });
      return stopPromise;
    },
  };
};

export interface WorkerGestureCompositionOptions {
  readonly catalog: readonly WorkerFeatureContribution[];
  /** The shell's synchronous gesture registration port. */
  readonly gestureRegistration: TransientGestureRegistrationPort;
  /**
   * Runtime-owned menu APIs and the resolved label. Omitting them composes no
   * menu source at all, so a runtime without a menu API stays inert.
   */
  readonly menu?: TransientMenuGestureDependencies;
  readonly reportDiagnostic?: (code: string) => void;
}

/**
 * Binds every worker-safe menu gesture contribution in the catalog to the
 * shell's gesture registration port. The port owns sequencing, the activation
 * record and any panel opening, so this composition only creates and registers
 * sources; it never reads a UI contribution or a browser document.
 *
 * The returned cleanup is idempotent and releases registrations in reverse
 * order, keeping worker bootstrap start and stop symmetric.
 */
export const composeWorkerGestureRegistrations = (
  options: WorkerGestureCompositionOptions,
): (() => void) => {
  const report = options.reportDiagnostic ?? (() => {});
  const cleanups: (() => void)[] = [];
  const { menu } = options;
  if (menu !== undefined)
    for (const { createMenuGestureSource } of options.catalog) {
      if (createMenuGestureSource === undefined) continue;
      let source: TransientGestureSource;
      try {
        source = createMenuGestureSource(menu);
      } catch {
        report("source-start-failed");
        continue;
      }
      const registered = options.gestureRegistration.register(source);
      if (!registered.ok) {
        report(registered.error.kind);
        continue;
      }
      cleanups.push(registered.value);
    }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      try {
        cleanups[index]?.();
      } catch {
        report("gesture-cleanup-failed");
      }
    }
  };
};

/** Compose the shell-owned production defaults without exposing them to runtime entrypoints. */
export const createDefaultProductionWorkerComposition = (
  options: DefaultProductionWorkerCompositionOptions,
): ProductionWorkerComposition =>
  createProductionWorkerComposition({
    ...options,
    initializeFoundation:
      options.initializeFoundation ??
      initializeProductionFoundationRuntimeContribution,
  });
