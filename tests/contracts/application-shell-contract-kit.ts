import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import type {
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  Availability,
  FeatureId,
  RegistrationError,
  WorkerRegistrationContext,
} from "../../src/application-shell/contracts.js";
import { err, ok, type Result } from "../../src/domain/public.js";

export interface ContractFixtureObservations {
  mountCount: number;
  unmountCount: number;
  availabilityNotifications: number;
  notificationsAfterUnsubscribe: number;
  containerAfterUnmount: string;
  activeActionHandlers: number;
}

export interface FeatureContractFixture {
  readonly feature: ApplicationFeatureRegistration;
  readonly worker: ApplicationWorkerRegistration;
  readonly workerContext: WorkerRegistrationContext;
  readonly observations: ContractFixtureObservations;
  readonly emitAvailability: (availability: Availability) => void;
}

export interface FeatureContractProbe {
  /** Drives the registration's public availability subscription in a fixture-neutral way. */
  readonly emitAvailability: (availability: Availability) => void;
}

export interface FeatureContractFixtureOptions {
  readonly invalid?: boolean;
  readonly failingWorker?: boolean;
}

const fixtureId = "contract-fixture" as FeatureId;

export function createFeatureContractFixture(
  options: FeatureContractFixtureOptions = {},
): FeatureContractFixture {
  const observations: ContractFixtureObservations = {
    mountCount: 0,
    unmountCount: 0,
    availabilityNotifications: 0,
    notificationsAfterUnsubscribe: 0,
    containerAfterUnmount: "not-observed",
    activeActionHandlers: 0,
  };
  const listeners = new Set<(availability: Availability) => void>();
  const notify = (availability: Availability) => {
    for (const listener of listeners) listener(availability);
  };

  const feature: ApplicationFeatureRegistration = {
    id: options.invalid ? ("" as FeatureId) : fixtureId,
    navigation: {
      label: options.invalid ? "" : "Contract fixture",
      order: options.invalid ? Number.NaN : 10,
    },
    publicApi: {},
    getAvailability: () =>
      options.invalid
        ? { status: "unavailable", reason: "" }
        : { status: "available" },
    subscribeAvailability(listener) {
      listeners.add(listener);
      return () => {
        if (!options.invalid) listeners.delete(listener);
      };
    },
    async mount(context) {
      observations.mountCount += 1;
      if (options.invalid) {
        return {
          async unmount() {
            observations.unmountCount += 1;
            observations.containerAfterUnmount =
              context.container.textContent ?? "";
          },
        };
      }
      const root = createRoot(context.container);
      root.render(createElement("output", null, "Contract fixture root"));
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      let unmounted = false;
      return {
        async unmount() {
          if (unmounted) return;
          unmounted = true;
          observations.unmountCount += 1;
          root.unmount();
          observations.containerAfterUnmount =
            context.container.textContent ?? "";
        },
      };
    },
  };

  const worker: ApplicationWorkerRegistration = {
    id: fixtureId,
    register(context) {
      if (options.failingWorker) {
        return err({
          kind: "invalid_registration",
          detail: "contract fixture worker failure",
        });
      }
      return ok(context.addActionHandler(fixtureId, async () => {}));
    },
  };

  const fixture = {
    feature,
    worker,
    observations,
    emitAvailability: notify,
    workerContext: {
      addActionHandler(_id: FeatureId, _handler: () => Promise<void>) {
        observations.activeActionHandlers += 1;
        let removed = false;
        return () => {
          if (removed) return;
          removed = true;
          observations.activeActionHandlers -= 1;
        };
      },
      reportError: () => {},
    },
  };
  fixtureObservations.set(feature, observations);
  fixtureNotifiers.set(feature, notify);
  return fixture;
}

/**
 * Downstream registrations can call this from their own contract suite. The
 * returned strings form a stable, field-qualified protocol suitable for CI.
 */
export async function collectFeatureContractViolations(
  feature: ApplicationFeatureRegistration,
  probe?: FeatureContractProbe,
): Promise<readonly string[]> {
  const violations: string[] = [];
  if (feature.id.trim().length === 0)
    violations.push("registration.id: non-empty feature id is required");
  if (feature.navigation.label.trim().length === 0)
    violations.push(
      "registration.navigation.label: non-empty label is required",
    );
  if (!Number.isFinite(feature.navigation.order))
    violations.push("registration.navigation.order: finite order is required");

  try {
    const availability = feature.getAvailability();
    if (
      availability.status === "unavailable" &&
      availability.reason.length === 0
    )
      violations.push("availability.reason: unavailable reason is required");
  } catch {
    violations.push("availability.get: registration rejected");
  }

  let subscribed = true;
  let notificationCount = 0;
  let notificationsAfterUnsubscribe = 0;
  const emitAvailability =
    probe?.emitAvailability ?? fixtureNotifiers.get(feature);
  let unsubscribe: (() => void) | undefined;
  try {
    const unsubscribeCandidate: unknown = feature.subscribeAvailability(() => {
      notificationCount += 1;
      if (!subscribed) notificationsAfterUnsubscribe += 1;
      fixtureObservation(
        feature,
        subscribed
          ? "availabilityNotifications"
          : "notificationsAfterUnsubscribe",
      );
    });
    if (typeof unsubscribeCandidate === "function") {
      unsubscribe = unsubscribeCandidate as () => void;
    } else {
      violations.push("availability.unsubscribe: cleanup function is required");
    }
  } catch {
    violations.push("availability.subscribe: registration rejected");
  }

  if (unsubscribe) {
    try {
      if (!emitAvailability) {
        violations.push(
          "availability.probe: an availability emitter is required to verify notifications",
        );
      } else {
        try {
          emitAvailability({
            status: "unavailable",
            reason: "fixture update",
          });
        } catch {
          violations.push("availability.emit.subscribed: probe rejected");
        }
        if (notificationCount === 0)
          violations.push(
            "availability.notification: subscribed listener was not notified",
          );
      }

      await inspectMountContract(feature, violations);
    } finally {
      subscribed = false;
      try {
        unsubscribe();
      } catch {
        violations.push("availability.unsubscribe.first: cleanup rejected");
      }
      try {
        unsubscribe();
      } catch {
        violations.push("availability.unsubscribe.second: cleanup rejected");
      }
      try {
        emitAvailability?.({ status: "available" });
      } catch {
        violations.push("availability.emit.unsubscribed: probe rejected");
      }
      if (notificationsAfterUnsubscribe > 0)
        violations.push(
          "availability.unsubscribe: listener was notified after unsubscribe",
        );
    }
  } else {
    await inspectMountContract(feature, violations);
  }
  return violations;
}

async function inspectMountContract(
  feature: ApplicationFeatureRegistration,
  violations: string[],
): Promise<void> {
  const container = document.createElement("div");
  let handle: Awaited<ReturnType<typeof feature.mount>> | undefined;
  try {
    await act(async () => {
      handle = await feature.mount({
        container,
        operationPolicy: { isAllowed: () => true },
        reportError: () => {},
      });
    });
  } catch {
    violations.push("mount: registration rejected");
  }

  if (handle) {
    if (container.textContent === "")
      violations.push(
        "mount: feature did not render into the supplied container",
      );
    try {
      await act(async () => handle?.unmount());
    } catch {
      violations.push("unmount.first: registration rejected");
    }
    try {
      await act(async () => handle?.unmount());
    } catch {
      violations.push("unmount.second: registration rejected");
    }
    if (container.textContent !== "")
      violations.push("unmount: feature did not remove its rendered root");
  } else if (!violations.includes("mount: registration rejected")) {
    violations.push("mount.handle: unmount handle is required");
  }
}

const fixtureObservations = new WeakMap<
  ApplicationFeatureRegistration,
  ContractFixtureObservations
>();
const fixtureNotifiers = new WeakMap<
  ApplicationFeatureRegistration,
  (availability: Availability) => void
>();

function fixtureObservation(
  feature: ApplicationFeatureRegistration,
  key: "availabilityNotifications" | "notificationsAfterUnsubscribe",
) {
  const observations = fixtureObservations.get(feature);
  if (observations) observations[key] += 1;
}

export function composeWorkerRegistrations(
  registrations: readonly ApplicationWorkerRegistration[],
  context: WorkerRegistrationContext,
): Result<() => void, RegistrationError> {
  const ids = new Set<FeatureId>();
  for (const registration of registrations) {
    if (registration.id.trim().length === 0)
      return err({
        kind: "invalid_registration",
        detail: "worker.id: non-empty feature id is required",
      });
    if (ids.has(registration.id))
      return err({ kind: "duplicate_feature_id", id: registration.id });
    ids.add(registration.id);
  }

  const cleanup: Array<{
    readonly id: FeatureId;
    readonly remove: () => void;
  }> = [];
  for (const registration of registrations) {
    let result: Result<() => void, RegistrationError>;
    try {
      result = registration.register(context);
    } catch {
      runWorkerCleanup(cleanup, context);
      return err({
        kind: "invalid_registration",
        detail: "worker.register: registration rejected",
      });
    }
    if (!result.ok) {
      runWorkerCleanup(cleanup, context);
      return result;
    }
    cleanup.push({ id: registration.id, remove: result.value });
  }
  let removed = false;
  return ok(() => {
    if (removed) return;
    removed = true;
    runWorkerCleanup(cleanup, context);
  });
}

function runWorkerCleanup(
  cleanup: readonly { readonly id: FeatureId; readonly remove: () => void }[],
  context: WorkerRegistrationContext,
): void {
  for (let index = cleanup.length - 1; index >= 0; index -= 1) {
    const entry = cleanup[index];
    if (!entry) continue;
    try {
      entry.remove();
    } catch {
      try {
        context.reportError(`worker.cleanup[${entry.id}]: cleanup rejected`);
      } catch {
        // A diagnostic hook must not prevent remaining cleanup.
      }
    }
  }
}
