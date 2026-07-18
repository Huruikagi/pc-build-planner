import type { Revision } from "../domain/identifiers.js";
import type { FoundationError, Result } from "../domain/result.js";
import type { MaintenanceFence } from "./maintenance.js";
import type {
  MutationCapacityStatus,
  MutationPipeline,
  MutationPipelineError,
  RootOperation,
} from "./mutation-pipeline.js";
import type { RootTransactionRunner } from "./root-transaction-runner.js";

export interface RootMutationCommand {
  readonly expectedRevision: Revision;
  readonly operation: RootOperation;
  readonly maintenance?: MaintenanceFence;
}

export interface MutationReceipt {
  readonly revision: Revision;
  readonly capacity: MutationCapacityStatus;
}

export type MutationTransaction = (
  command: RootMutationCommand,
) => Promise<Result<MutationReceipt, FoundationError>>;

const pipelineFailure = (error: MutationPipelineError): FoundationError => {
  switch (error.code) {
    case "quota-exceeded":
      return { code: "quota-exceeded" };
    case "repair-failed":
      return error.message === undefined
        ? { code: "repair-failed" }
        : { code: "repair-failed", message: error.message };
    case "entity-already-exists":
    case "entity-not-found":
    case "invalid-capacity-input":
    case "validation":
      return { code: "validation" };
  }
};

/** Pure candidate constructionをrunner所有のread-check-writeへ接続する境界。 */
export const createMutationTransaction =
  (
    runner: RootTransactionRunner,
    pipeline: MutationPipeline,
  ): MutationTransaction =>
  async (command) =>
    runner.run({
      expectedRevision: command.expectedRevision,
      ...(command.maintenance === undefined
        ? {}
        : { maintenance: command.maintenance }),
      execute({ snapshot, currentBytes, quotaBytes }) {
        const candidate = pipeline.apply(snapshot, command.operation, {
          currentBytes,
          quotaBytes,
        });
        if (!candidate.ok)
          return { ok: false, error: pipelineFailure(candidate.error) };
        return {
          ok: true,
          value: {
            root: candidate.value.root,
            value: {
              revision: (snapshot.revision + 1) as Revision,
              capacity: candidate.value.capacity,
            },
          },
        };
      },
    });
