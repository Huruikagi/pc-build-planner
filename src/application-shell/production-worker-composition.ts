import type { Result } from "../domain/public.js";
import type {
  FoundationRuntimeContribution,
  FoundationRuntimeInitializationError,
  WorkerMessageTarget,
} from "../persistence/public.js";
import { initializeProductionFoundationRuntimeContribution } from "../persistence/public.js";
import type { WorkerRegistrationContext } from "./contracts.js";
import type { FeatureContribution } from "./feature-contribution-catalog.js";
import { getWorkerContributions } from "./feature-contribution-catalog.js";
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
  readonly catalog: readonly FeatureContribution[];
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
