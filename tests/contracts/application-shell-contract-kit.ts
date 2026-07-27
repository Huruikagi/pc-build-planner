import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import type {
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  Availability,
  FeatureActivationIntent,
  FeatureId,
  RegistrationError,
  WorkerRegistrationContext,
} from "../../src/application-shell/contracts.js";
import { isPersistent } from "../../src/application-shell/contracts.js";
import { createFeatureRegistry } from "../../src/application-shell/feature-registry.js";
import type {
  ActivationId,
  TargetTabId,
  TransientGestureRegistrationPort,
  TransientSurfaceLifecyclePort,
} from "../../src/application-shell/public.js";
import { createSidePanelHost } from "../../src/application-shell/side-panel-host.js";
import { createTransientSurfaceController } from "../../src/application-shell/transient-surface-controller.js";
import type { TransientActivationRequest } from "../../src/application-shell/transient-surface-ports.js";
import { err, ok, type Result } from "../../src/domain/public.js";
import { createTransientGestureRegistrar } from "../../src/runtime/transient-gesture-registration.js";
import type { MessageKey } from "../../src/ui-messages/public.js";

export interface ContractFixtureObservations {
  mountCount: number;
  unmountCount: number;
  availabilityNotifications: number;
  notificationsAfterUnsubscribe: number;
  containerAfterUnmount: string;
  activeActionHandlers: number;
  activationValidationCount: number;
  activationApplyCount: number;
}

export interface FeatureContractFixture {
  readonly feature: ApplicationFeatureRegistration<object, unknown>;
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
  readonly activation?: boolean;
}

export interface ActivationLifecycleFixture {
  readonly source: ApplicationFeatureRegistration<object, unknown>;
  readonly target: ApplicationFeatureRegistration<object, unknown>;
  readonly intent: FeatureActivationIntent;
  readonly observations: {
    sourceMountCount: number;
    targetMountCount: number;
    targetUnmountCount: number;
    sourceRestoredState: unknown;
  };
}

const fixtureId = "contract-fixture" as FeatureId;

export function createTransientHandoffContractFixture() {
  const activation: TransientActivationRequest = {
    activationId: "contract-transient-activation" as ActivationId,
    surfaceId: "contract-transient" as FeatureId,
    tabId: 17 as TargetTabId,
  };
  const handoffIntent: FeatureActivationIntent = {
    featureId: "contract-handoff-target" as FeatureId,
    target: "accept-transient-handoff",
    payload: Object.freeze({ fixture: true }),
  };
  const observations = {
    requested: [] as TransientActivationRequest[],
    concluded: [] as FeatureActivationIntent[],
    gestureEmits: [] as TargetTabId[],
    activeGestureSources: 0,
    maximumMounted: 0,
  };
  let mounted = 0;
  const registration = (
    id: FeatureId,
    presentation: "persistent" | "transient",
    activationTarget = false,
  ): ApplicationFeatureRegistration<object, unknown> => ({
    id,
    ...(presentation === "persistent"
      ? {
          presentation,
          navigation: {
            labelKey: id as MessageKey,
            order: activationTarget ? 1 : 0,
          },
        }
      : { presentation }),
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => {},
    async mount(context) {
      mounted += 1;
      observations.maximumMounted = Math.max(
        observations.maximumMounted,
        mounted,
      );
      context.container.textContent = id;
      return {
        async captureState() {
          return ok({ id });
        },
        async unmount() {
          mounted -= 1;
          context.container.textContent = "";
        },
      };
    },
    ...(activationTarget
      ? {
          activation: {
            validate: () => ok({ fixture: true }),
            async activate() {
              observations.concluded.push(handoffIntent);
              return ok(undefined);
            },
          },
        }
      : {}),
  });
  const registry = createFeatureRegistry();
  const planner = registration("contract-planner" as FeatureId, "persistent");
  const transient = registration(activation.surfaceId, "transient");
  const target = registration(handoffIntent.featureId, "persistent", true);
  for (const feature of [planner, transient, target])
    registry.register(feature);
  const host = createSidePanelHost({
    registry,
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    onStateChange() {},
    reportError() {},
  });
  const controller = createTransientSurfaceController({
    host: {
      getSelected: host.getSelected,
      isTransientAvailable: (id) => id === transient.id,
      async showTransient(id) {
        const result = await host.showTransient(id);
        return result.ok ? ok(undefined) : err({ kind: "transition-failed" });
      },
      async restorePersistent(preferred, reason) {
        const result = await host.restorePersistent(preferred, reason);
        return result.ok ? ok(undefined) : err({ kind: "transition-failed" });
      },
      async activate(intent) {
        const result = await host.activate(intent);
        return result.ok ? ok(undefined) : err({ kind: "transition-failed" });
      },
    },
  });
  const lifecycle: TransientSurfaceLifecyclePort = controller;
  let ingressTask: Promise<unknown> = Promise.resolve();
  const registrar = createTransientGestureRegistrar({
    ingress(surfaceId, tabId) {
      observations.gestureEmits.push(tabId);
      observations.requested.push({ ...activation, surfaceId, tabId });
      ingressTask = controller.request({ ...activation, surfaceId, tabId });
    },
  });
  registrar.start();
  const gestures: TransientGestureRegistrationPort = registrar;
  let emit: ((tabId: TargetTabId) => void) | undefined;
  const registered = gestures.register({
    id: "contract-feature-gesture",
    surfaceId: activation.surfaceId,
    start(next) {
      observations.activeGestureSources += 1;
      emit = next;
      return ok(() => {
        emit = undefined;
        observations.activeGestureSources -= 1;
      });
    },
  });
  if (!registered.ok) throw new Error("contract gesture fixture failed");
  return {
    activation,
    handoffIntent,
    lifecycle,
    gestures,
    captureConsumer: { lifecycle },
    handoffConsumer: { lifecycle },
    gestureConsumer: {
      registration: gestures,
      emit: () => emit?.(activation.tabId),
    },
    observations,
    async start() {
      const hostStarted = await host.start();
      if (!hostStarted.ok) return err({ kind: "transition-failed" as const });
      return controller.start();
    },
    async settle() {
      await ingressTask;
    },
    async dispose() {
      registered.value();
      registrar.stop();
      await controller.stop();
      await host.stop();
      registry.dispose?.();
    },
  };
}

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
    activationValidationCount: 0,
    activationApplyCount: 0,
  };
  const listeners = new Set<(availability: Availability) => void>();
  const notify = (availability: Availability) => {
    for (const listener of listeners) listener(availability);
  };

  const feature: ApplicationFeatureRegistration<object, unknown> = {
    id: options.invalid ? ("" as FeatureId) : fixtureId,
    presentation: "persistent",
    navigation: {
      labelKey: (options.invalid ? "" : "Contract fixture") as MessageKey,
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
    ...(options.activation
      ? {
          activation: {
            validate(intent) {
              observations.activationValidationCount += 1;
              if (intent.target !== "open-editor")
                return err({
                  kind: "invalid_activation" as const,
                  detail: "fixture target is not supported",
                });
              return ok(intent.payload);
            },
            async activate(_input: unknown) {
              observations.activationApplyCount += 1;
              return ok(undefined);
            },
          },
        }
      : {}),
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
 * Exercises a downstream feature's opaque activation adapter without teaching
 * the shell contract kit anything about the feature's payload shape.
 */
export async function collectFeatureActivationContractViolations(
  feature: ApplicationFeatureRegistration<object, unknown>,
  intent: import("../../src/application-shell/contracts.js").FeatureActivationIntent,
): Promise<readonly string[]> {
  const violations: string[] = [];
  const adapter = feature.activation;
  if (adapter === undefined) {
    violations.push("activation.adapter: adapter is required");
    return violations;
  }

  let validated: ReturnType<typeof adapter.validate>;
  try {
    validated = adapter.validate(intent);
  } catch {
    violations.push("activation.validate: registration rejected");
    return violations;
  }
  if (!validated.ok) {
    violations.push("activation.validate: intent was rejected");
    return violations;
  }
  try {
    const applied = await adapter.activate(validated.value);
    if (!applied.ok)
      violations.push("activation.apply: activation was rejected");
  } catch {
    violations.push("activation.apply: registration rejected");
  }
  return violations;
}

/** Exercises shell-owned rollback with opaque feature state and target cleanup. */
export function createActivationLifecycleFixture(): ActivationLifecycleFixture {
  const sourceId = "activation-source" as FeatureId;
  const targetId = "activation-target" as FeatureId;
  const sourceSnapshot = Object.freeze({ draft: "fictional-source-state" });
  const observations = {
    sourceMountCount: 0,
    targetMountCount: 0,
    targetUnmountCount: 0,
    sourceRestoredState: undefined as unknown,
  };
  const available = () => ({ status: "available" as const });
  const source: ApplicationFeatureRegistration<object, unknown> = {
    id: sourceId,
    presentation: "persistent",
    navigation: { labelKey: "Activation source" as MessageKey, order: 0 },
    publicApi: {},
    getAvailability: available,
    subscribeAvailability: () => () => {},
    async mount(context) {
      observations.sourceMountCount += 1;
      observations.sourceRestoredState = context.restoredState;
      context.container.textContent = "source";
      return {
        async captureState() {
          return ok(sourceSnapshot);
        },
        async unmount() {
          context.container.textContent = "";
        },
      };
    },
  };
  const target: ApplicationFeatureRegistration<object, unknown> = {
    id: targetId,
    presentation: "persistent",
    navigation: { labelKey: "Activation target" as MessageKey, order: 1 },
    publicApi: {},
    getAvailability: available,
    subscribeAvailability: () => () => {},
    async mount(context) {
      observations.targetMountCount += 1;
      context.container.textContent = "target";
      return {
        async unmount() {
          observations.targetUnmountCount += 1;
          context.container.textContent = "";
        },
      };
    },
    activation: {
      validate: () => ok(undefined),
      async activate() {
        return err({
          kind: "activation_failed",
          detail: "fixture apply failure",
        });
      },
    },
  };
  return {
    source,
    target,
    intent: { featureId: targetId, target: "fixture-target", payload: {} },
    observations,
  };
}

export async function collectActivationLifecycleViolations(
  fixture: ActivationLifecycleFixture,
): Promise<readonly string[]> {
  const violations: string[] = [];
  const registry = createFeatureRegistry();
  registry.register(fixture.source);
  registry.register(fixture.target);
  const host = createSidePanelHost({
    registry,
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    onStateChange() {},
    reportError() {},
  });
  try {
    const started = await host.start();
    if (!started.ok)
      violations.push("activation.lifecycle: source did not start");
    const activated = await host.activate(fixture.intent);
    if (activated.ok) violations.push("activation.apply: failure was accepted");
    if (fixture.observations.targetUnmountCount !== 1)
      violations.push(
        "activation.cleanup: failed target was not unmounted once",
      );
    if (fixture.observations.sourceMountCount !== 2)
      violations.push("activation.rollback: source was not remounted once");
    if (fixture.observations.sourceRestoredState === undefined)
      violations.push("activation.rollback: source state was not restored");
  } finally {
    await host.stop();
    registry.dispose?.();
  }
  return violations;
}

/**
 * Downstream registrations can call this from their own contract suite. The
 * returned strings form a stable, field-qualified protocol suitable for CI.
 */
export async function collectFeatureContractViolations(
  feature: ApplicationFeatureRegistration<object, unknown>,
  probe?: FeatureContractProbe,
): Promise<readonly string[]> {
  const violations: string[] = [];
  if (feature.id.trim().length === 0)
    violations.push("registration.id: non-empty feature id is required");
  if (isPersistent(feature)) {
    if (feature.navigation.labelKey.trim().length === 0)
      violations.push(
        "registration.navigation.labelKey: non-empty label key is required",
      );
    if (!Number.isFinite(feature.navigation.order))
      violations.push(
        "registration.navigation.order: finite order is required",
      );
  }

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
  feature: ApplicationFeatureRegistration<object, unknown>,
  violations: string[],
): Promise<void> {
  const container = document.createElement("div");
  let handle: Awaited<ReturnType<typeof feature.mount>> | undefined;
  try {
    await act(async () => {
      handle = await feature.mount({
        container,
        operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
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
  ApplicationFeatureRegistration<object, unknown>,
  ContractFixtureObservations
>();
const fixtureNotifiers = new WeakMap<
  ApplicationFeatureRegistration<object, unknown>,
  (availability: Availability) => void
>();

function fixtureObservation(
  feature: ApplicationFeatureRegistration<object, unknown>,
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
