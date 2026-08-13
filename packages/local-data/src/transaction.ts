import type {
  CapacityPolicy,
  CoreError,
  CoreResult,
  ExclusiveLockPort,
  LocalDataPolicy,
  PersistentControlPolicy,
  StoragePort,
  TransactionPort,
} from "./contracts.js";
import type { FencingPolicy } from "./fencing.js";

export interface TransactionEngineDependencies<Root, Operation, Control> {
  readonly storage: StoragePort<Root, Control>;
  readonly lock: ExclusiveLockPort;
  readonly policy: LocalDataPolicy<Root, Operation, Control, CoreError>;
  readonly capacity: CapacityPolicy<Root>;
  readonly digest: (operation: Operation) => string;
  readonly now: () => number;
  readonly fencing: FencingPolicy<Root>;
  readonly persistentControl: PersistentControlPolicy;
}

const failure = (code: CoreError["code"]): CoreResult<never, CoreError> => ({
  ok: false,
  error: { code },
});

const runPolicyStage = <Value>(
  operation: () => CoreResult<Value, CoreError>,
  exceptionCode: CoreError["code"],
): CoreResult<Value, CoreError> => {
  try {
    return operation();
  } catch {
    return failure(exceptionCode);
  }
};

export const createTransactionEngine = <Root, Operation, Control>(
  dependencies: TransactionEngineDependencies<Root, Operation, Control>,
): TransactionPort<Operation, Root, CoreError> => ({
  async execute(command) {
    try {
      const locked = await dependencies.lock.runExclusive(async () => {
        let stored;
        try {
          stored = await dependencies.storage.readRoot();
        } catch {
          return failure("storage-unavailable");
        }
        if (!stored.ok) return stored;

        const decoded = runPolicyStage(
          () => dependencies.policy.decodeAndMigrate(stored.value),
          "validation",
        );
        if (!decoded.ok) return decoded;

        const persistentControl = await dependencies.storage
          .readControl()
          .catch(() => failure("storage-unavailable"));
        if (!persistentControl.ok) return persistentControl;
        const persistentAuthorized = runPolicyStage(
          () =>
            dependencies.persistentControl.authorizeMutation(
              persistentControl.value,
              dependencies.now(),
            ),
          "stale-fence",
        );
        if (!persistentAuthorized.ok) return persistentAuthorized;

        const digest = runPolicyStage(
          () => ({ ok: true, value: dependencies.digest(command.operation) }),
          "validation",
        );
        if (!digest.ok) return digest;

        const priorRequest = runPolicyStage(
          () => ({
            ok: true,
            value: dependencies.policy.requestRecord(decoded.value, command.requestId),
          }),
          "validation",
        );
        if (!priorRequest.ok) return priorRequest;
        if (priorRequest.value !== undefined) {
          if (priorRequest.value.digest !== digest.value) return failure("request-conflict");

          const currentBytes = await dependencies.storage.bytesInUse().catch(() =>
            failure("storage-unavailable"),
          );
          if (!currentBytes.ok) return currentBytes;
          let quotaBytes: number;
          try {
            quotaBytes = dependencies.storage.quotaBytes();
          } catch {
            return failure("storage-unavailable");
          }
          const capacity = runPolicyStage(
            () => dependencies.capacity.assess(currentBytes.value, decoded.value, quotaBytes),
            "quota-exceeded",
          );
          if (!capacity.ok) return capacity;
          return {
            ok: true,
            value: {
              revision: priorRequest.value.revision,
              value: decoded.value,
              capacity: capacity.value,
              deduplicated: true,
            },
          } satisfies CoreResult<
            {
              readonly revision: number;
              readonly value: Root;
              readonly capacity: typeof capacity.value;
              readonly deduplicated: true;
            },
            CoreError
          >;
        }

        const currentRevision = runPolicyStage(
          () => ({ ok: true, value: dependencies.policy.revision(decoded.value) }),
          "validation",
        );
        if (!currentRevision.ok) return currentRevision;
        if (command.expectedRevision !== currentRevision.value) {
          return failure("revision-conflict");
        }

        const mutationFence = runPolicyStage(
          () => dependencies.fencing.authorizeMutation(decoded.value, undefined, dependencies.now()),
          "stale-fence",
        );
        if (!mutationFence.ok) return mutationFence;

        const applied = runPolicyStage(
          () => dependencies.policy.apply(decoded.value, command.operation),
          "validation",
        );
        if (!applied.ok) return applied;

        const repaired = runPolicyStage(
          () => dependencies.policy.repair(applied.value, decoded.value),
          "repair",
        );
        if (!repaired.ok) return repaired;

        if (currentRevision.value >= Number.MAX_SAFE_INTEGER) return failure("validation");
        const nextRevision = currentRevision.value + 1;
        const revisioned = runPolicyStage(
          () => ({
            ok: true,
            value: dependencies.policy.withRevision(repaired.value, nextRevision),
          }),
          "validation",
        );
        if (!revisioned.ok) return revisioned;
        const recorded = runPolicyStage(
          () => ({
            ok: true,
            value: dependencies.policy.withRequestRecord(revisioned.value, {
              requestId: command.requestId,
              digest: digest.value,
              revision: nextRevision,
            }),
          }),
          "validation",
        );
        if (!recorded.ok) return recorded;

        const validated = runPolicyStage(
          () => dependencies.policy.decodeAndMigrate(recorded.value),
          "validation",
        );
        if (!validated.ok) return validated;

        let currentBytes;
        try {
          currentBytes = await dependencies.storage.bytesInUse();
        } catch {
          return failure("storage-unavailable");
        }
        if (!currentBytes.ok) return currentBytes;

        let quotaBytes: number;
        try {
          quotaBytes = dependencies.storage.quotaBytes();
        } catch {
          return failure("storage-unavailable");
        }

        const capacity = runPolicyStage(
          () =>
            dependencies.capacity.assess(
              currentBytes.value,
              validated.value,
              quotaBytes,
            ),
          "quota-exceeded",
        );
        if (!capacity.ok) return capacity;

        let latestStored;
        try {
          latestStored = await dependencies.storage.readRoot();
        } catch {
          return failure("storage-unavailable");
        }
        if (!latestStored.ok) return latestStored;
        const latest = runPolicyStage(
          () => dependencies.policy.decodeAndMigrate(latestStored.value),
          "validation",
        );
        if (!latest.ok) return latest;
        const latestDigest = runPolicyStage(
          () => ({ ok: true, value: dependencies.digest(command.operation) }),
          "validation",
        );
        if (!latestDigest.ok) return latestDigest;
        if (latestDigest.value !== digest.value) return failure("validation");
        const latestRequest = runPolicyStage(
          () => ({
            ok: true,
            value: dependencies.policy.requestRecord(latest.value, command.requestId),
          }),
          "validation",
        );
        if (!latestRequest.ok) return latestRequest;
        if (latestRequest.value !== undefined) {
          return latestRequest.value.digest === digest.value
            ? failure("revision-conflict")
            : failure("request-conflict");
        }
        const latestRevision = runPolicyStage(
          () => ({ ok: true, value: dependencies.policy.revision(latest.value) }),
          "validation",
        );
        if (!latestRevision.ok) return latestRevision;
        if (latestRevision.value !== command.expectedRevision) {
          return failure("revision-conflict");
        }
        const commitFence = runPolicyStage(
          () => dependencies.fencing.authorizeMutation(latest.value, undefined, dependencies.now()),
          "stale-fence",
        );
        if (!commitFence.ok) return commitFence;
        const latestPersistentControl = await dependencies.storage
          .readControl()
          .catch(() => failure("storage-unavailable"));
        if (!latestPersistentControl.ok) return latestPersistentControl;
        const latestPersistentAuthorized = runPolicyStage(
          () =>
            dependencies.persistentControl.authorizeMutation(
              latestPersistentControl.value,
              dependencies.now(),
            ),
          "stale-fence",
        );
        if (!latestPersistentAuthorized.ok) return latestPersistentAuthorized;

        let committed;
        try {
          committed = await dependencies.storage.writeRoot(validated.value);
        } catch {
          return failure("storage-unavailable");
        }
        if (!committed.ok) return committed;

        return {
          ok: true,
          value: {
            revision: nextRevision,
            value: validated.value,
            capacity: capacity.value,
            deduplicated: false,
          },
        } satisfies CoreResult<
          {
            readonly revision: number;
            readonly value: Root;
            readonly capacity: typeof capacity.value;
            readonly deduplicated: false;
          },
          CoreError
        >;
      });

      if (!locked.ok) return locked;
      return locked.value;
    } catch {
      return failure("lock-unavailable");
    }
  },
});
