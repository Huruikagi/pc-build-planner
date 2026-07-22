import type { RequestId, Revision } from "../domain/identifiers.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { MaintenanceFence } from "./maintenance.js";
import type {
  MutationCapacityStatus,
  MutationPipeline,
  RootOperation,
} from "./mutation-pipeline.js";
import type { ReplacementAssessment } from "./replacement.js";
import type {
  LocalDataRepository,
  RepositoryError,
  RootQuery,
} from "./repository.js";
import type {
  MaintenanceCommand,
  MaintenanceReceipt,
  ReplacementCommand,
  ReplacementReceipt,
  RequestCommitReceipt,
  RequestPayload,
  RootTransactionRunner,
} from "./root-transaction-runner.js";

export interface RootMutationCommand {
  readonly requestId: RequestId;
  readonly expectedRevision: Revision;
  readonly operation: RootOperation;
  readonly maintenance?: MaintenanceFence;
}

export interface MutationValue {
  readonly capacity: MutationCapacityStatus;
}

export type MutationReceipt = RequestCommitReceipt<MutationValue>;

/**
 * 信頼済み拡張UI contextへ渡す最小権限のdata port。
 * 参照と原子的root mutationだけを転送し、置換・保守capabilityを公開しない。
 */
export interface FoundationScopedDataPort {
  query<T>(query: RootQuery<T>): Promise<Result<T, FoundationError>>;
  mutate(
    command: RootMutationCommand,
  ): Promise<Result<MutationReceipt, FoundationError>>;
}

export interface FoundationDataPort extends FoundationScopedDataPort {
  assessReplacement(
    input: unknown,
  ): Promise<Result<ReplacementAssessment, FoundationError>>;
  replaceRoot(
    command: ReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>>;
  runMaintenance(
    command: MaintenanceCommand,
  ): Promise<Result<MaintenanceReceipt, FoundationError>>;
}

export interface WriteAuthorityDependencies {
  readonly repository: LocalDataRepository;
  readonly runner: RootTransactionRunner;
  readonly pipeline: MutationPipeline;
}

const pipelineFailure = (code: string): FoundationError => {
  switch (code) {
    case "quota-exceeded":
      return { code: "quota-exceeded" };
    case "repair-failed":
      return { code: "repair-failed" };
    default:
      return { code: "validation" };
  }
};

class WriteQueue {
  #tail: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.#tail.then(task, task);
    this.#tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

class DefaultWriteAuthority implements FoundationDataPort {
  readonly #deps: WriteAuthorityDependencies;
  readonly #queue = new WriteQueue();

  constructor(deps: WriteAuthorityDependencies) {
    this.#deps = deps;
  }

  async query<T>(query: RootQuery<T>): Promise<Result<T, FoundationError>> {
    const result = await this.#deps.repository.query(query);
    return result as Result<T, RepositoryError>;
  }

  mutate(
    command: RootMutationCommand,
  ): Promise<Result<MutationReceipt, FoundationError>> {
    return this.#queue.enqueue(() =>
      this.#deps.runner.runRequest({
        requestId: command.requestId,
        payload: {
          expectedRevision: command.expectedRevision,
          operation: command.operation,
          ...(command.maintenance === undefined
            ? {}
            : { maintenance: command.maintenance }),
        } as unknown as RequestPayload,
        expectedRevision: command.expectedRevision,
        ...(command.maintenance === undefined
          ? {}
          : { maintenance: command.maintenance }),
        execute: ({ snapshot, currentBytes, quotaBytes }) => {
          const candidate = this.#deps.pipeline.apply(
            snapshot,
            command.operation,
            { currentBytes, quotaBytes },
          );
          if (!candidate.ok)
            return {
              ok: false,
              error: pipelineFailure(candidate.error.code),
            };
          return {
            ok: true,
            value: {
              root: candidate.value.root,
              value: { capacity: candidate.value.capacity },
            },
          };
        },
      }),
    );
  }

  assessReplacement(
    input: unknown,
  ): Promise<Result<ReplacementAssessment, FoundationError>> {
    return this.#queue.enqueue(() =>
      this.#deps.runner.assessReplacement(input),
    );
  }

  replaceRoot(
    command: ReplacementCommand,
  ): Promise<Result<ReplacementReceipt, FoundationError>> {
    return this.#queue.enqueue(() => this.#deps.runner.replaceRoot(command));
  }

  runMaintenance(
    command: MaintenanceCommand,
  ): Promise<Result<MaintenanceReceipt, FoundationError>> {
    return this.#queue.enqueue(() => this.#deps.runner.runMaintenance(command));
  }
}

export const createWriteAuthority = (
  dependencies: WriteAuthorityDependencies,
): FoundationDataPort => new DefaultWriteAuthority(dependencies);

/**
 * 同一contextのauthorityへ委譲するfrozen view。
 * 排他の根拠は固定名Web Lockと永続rootのrevisionであり、view追加では変わらない。
 */
export const createScopedDataPort = (
  port: FoundationScopedDataPort,
): FoundationScopedDataPort =>
  Object.freeze({
    query: <T>(query: RootQuery<T>) => port.query(query),
    mutate: (command: RootMutationCommand) => port.mutate(command),
  });
