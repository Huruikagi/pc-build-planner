import type {
  CapacityPolicy,
  CoreError,
  CoreResult,
  ExclusiveLockPort,
  LocalDataPolicy,
  StoragePort,
  TransactionPort,
} from "./contracts.js";

export interface TransactionEngineDependencies<Root, Operation, Control> {
  readonly storage: StoragePort<Root, Control>;
  readonly lock: ExclusiveLockPort;
  readonly policy: LocalDataPolicy<Root, Operation, Control, CoreError>;
  readonly capacity: CapacityPolicy<Root>;
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

        const validated = runPolicyStage(
          () => dependencies.policy.decodeAndMigrate(repaired.value),
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

        const revision = runPolicyStage(
          () => ({
            ok: true,
            value: dependencies.policy.revision(validated.value),
          }),
          "validation",
        );
        if (!revision.ok) return revision;

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
            revision: revision.value,
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
