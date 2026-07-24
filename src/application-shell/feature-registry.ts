import { err, ok } from "../domain/public.js";
import type {
  ApplicationFeatureRegistration,
  Availability,
  FeatureId,
  FeatureRegistry,
  RegistrationError,
} from "./contracts.js";

interface RegisteredFeature {
  registration: ApplicationFeatureRegistration;
  readonly availabilityListeners: Set<(value: Availability) => void>;
  availability: Availability;
  readonly unsubscribeAvailability: () => void;
}

export function createFeatureRegistry(): FeatureRegistry {
  const entries = new Map<FeatureId, RegisteredFeature>();
  const listeners = new Set<() => void>();

  const notifyRegistry = (): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // One external observer must not interrupt the remaining observers.
      }
    }
  };

  return {
    register<TPublic extends object, TActivation>(
      candidate: ApplicationFeatureRegistration<TPublic, TActivation>,
    ) {
      const shapeError = validateRegistrationShape(candidate);
      if (shapeError) return err(shapeError);

      const feature = candidate as unknown as ApplicationFeatureRegistration;
      if (entries.has(feature.id)) {
        return err({ kind: "duplicate_feature_id", id: feature.id });
      }

      let initialAvailability: Availability;
      try {
        const value: unknown = feature.getAvailability();
        const availabilityError = validateAvailability(value);
        if (availabilityError) return err(availabilityError);
        initialAvailability = copyAvailability(value);
      } catch {
        return err(
          invalidRegistration("availability.get: registration rejected"),
        );
      }

      const entry: RegisteredFeature = {
        availability: initialAvailability,
        availabilityListeners: new Set(),
        registration: feature,
        unsubscribeAvailability: () => {},
      };
      let registered = false;
      let unsubscribeCandidate: unknown;
      try {
        unsubscribeCandidate = feature.subscribeAvailability((value) => {
          const availabilityError = validateAvailability(value);
          if (availabilityError) return;
          entry.availability = copyAvailability(value);
          if (!registered) return;
          notifyAvailability(entry);
          notifyRegistry();
        });
      } catch {
        return err(
          invalidRegistration("availability.subscribe: registration rejected"),
        );
      }
      if (typeof unsubscribeCandidate !== "function") {
        return err(
          invalidRegistration(
            "availability.unsubscribe: cleanup function is required",
          ),
        );
      }

      Object.defineProperty(entry, "unsubscribeAvailability", {
        value: unsubscribeCandidate,
      });

      entry.registration = createSnapshotRegistration(entry);
      entries.set(entry.registration.id, entry);
      registered = true;
      notifyRegistry();
      return ok(undefined);
    },

    snapshot() {
      return [...entries.values()]
        .map(({ registration }) => registration)
        .sort(compareRegistration);
    },

    subscribe(listener) {
      listeners.add(listener);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        listeners.delete(listener);
      };
    },

    dispose() {
      const failures: unknown[] = [];
      for (const entry of [...entries.values()].reverse()) {
        try {
          entry.unsubscribeAvailability();
          entries.delete(entry.registration.id);
        } catch (error: unknown) {
          failures.push(error);
        }
      }
      if (entries.size === 0) listeners.clear();
      if (failures.length > 0) {
        throw new AggregateError(failures, "Feature registry cleanup failed");
      }
    },
  };
}

function validateRegistrationShape(value: unknown): RegistrationError | null {
  if (!isRecord(value))
    return invalidRegistration("registration: object is required");
  if (typeof value.id !== "string" || value.id.trim().length === 0)
    return invalidRegistration(
      "registration.id: non-empty feature id is required",
    );
  if (!isRecord(value.navigation))
    return invalidRegistration("registration.navigation: object is required");
  if (
    typeof value.navigation.label !== "string" ||
    value.navigation.label.trim().length === 0
  )
    return invalidRegistration(
      "registration.navigation.label: non-empty label is required",
    );
  if (
    typeof value.navigation.order !== "number" ||
    !Number.isFinite(value.navigation.order)
  )
    return invalidRegistration(
      "registration.navigation.order: finite order is required",
    );
  if (
    value.navigation.icon !== undefined &&
    (typeof value.navigation.icon !== "string" ||
      value.navigation.icon.trim().length === 0)
  )
    return invalidRegistration(
      "registration.navigation.icon: non-empty icon key is required when present",
    );
  if (!isRecord(value.publicApi))
    return invalidRegistration("registration.publicApi: object is required");
  if (typeof value.getAvailability !== "function")
    return invalidRegistration(
      "registration.getAvailability: function is required",
    );
  if (typeof value.subscribeAvailability !== "function")
    return invalidRegistration(
      "registration.subscribeAvailability: function is required",
    );
  if (typeof value.mount !== "function")
    return invalidRegistration("registration.mount: function is required");
  if (
    value.activation !== undefined &&
    (!isRecord(value.activation) ||
      typeof value.activation.validate !== "function" ||
      typeof value.activation.activate !== "function")
  )
    return invalidRegistration(
      "registration.activation: validate and activate functions are required",
    );
  return null;
}

function validateAvailability(value: unknown): RegistrationError | null {
  if (!isRecord(value))
    return invalidRegistration("availability: object is required");
  if (value.status === "available") return null;
  if (
    value.status === "unavailable" &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0
  )
    return null;
  if (value.status === "unavailable")
    return invalidRegistration(
      "availability.reason: unavailable reason is required",
    );
  return invalidRegistration("availability.status: known status is required");
}

function copyAvailability(value: unknown): Availability {
  if (isRecord(value) && value.status === "unavailable") {
    return { status: "unavailable", reason: String(value.reason) };
  }
  return { status: "available" };
}

function createSnapshotRegistration(
  entry: RegisteredFeature,
): ApplicationFeatureRegistration {
  const source = entry.registration;
  return Object.freeze({
    id: source.id,
    navigation: Object.freeze({ ...source.navigation }),
    publicApi: source.publicApi,
    getAvailability: () => copyAvailability(entry.availability),
    subscribeAvailability(listener: (value: Availability) => void) {
      entry.availabilityListeners.add(listener);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        entry.availabilityListeners.delete(listener);
      };
    },
    mount: source.mount.bind(source),
    ...(source.activation ? { activation: source.activation } : {}),
  });
}

function notifyAvailability(entry: RegisteredFeature): void {
  for (const listener of entry.availabilityListeners) {
    try {
      listener(copyAvailability(entry.availability));
    } catch {
      // External listeners are isolated so healthy subscriptions continue.
    }
  }
}

function compareRegistration(
  left: ApplicationFeatureRegistration,
  right: ApplicationFeatureRegistration,
): number {
  const byOrder = left.navigation.order - right.navigation.order;
  if (byOrder !== 0) return byOrder;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function invalidRegistration(detail: string): RegistrationError {
  return { kind: "invalid_registration", detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
