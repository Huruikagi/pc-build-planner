import {
  type BuildItem,
  type CandidatePart,
  type CandidatePartId,
  type CurrentBuild,
  type CurrentBuildId,
  createUtcTimestamp,
  createUuid,
  type PositiveInteger,
  type Result,
  type UtcTimestamp,
} from "../../domain/public.js";
import type { FoundationScopedDataPort } from "../../persistence/public.js";
import type {
  CandidateQuery,
  ManagementError,
} from "../candidate-management/public.js";
import { type CategoryPolicy, isValidQuantity } from "./category-policy.js";
import type {
  BuildCommand,
  BuildError,
  BuildMutationContext,
  BuildService,
  CurrentBuildQuery,
} from "./contracts.js";

export interface BuildServiceDependencies {
  readonly data: FoundationScopedDataPort;
  readonly policy: CategoryPolicy;
  readonly candidates: CandidateQuery;
  readonly query: CurrentBuildQuery;
  readonly now?: () => UtcTimestamp;
  readonly createBuildId?: () => CurrentBuildId;
}

type EligibleCandidates = ReadonlyMap<CandidatePartId, CandidatePart>;

const corruptData: BuildError = { kind: "corrupt-data" };

const managementErrorToBuildError = (error: ManagementError): BuildError => {
  switch (error.kind) {
    case "validation":
      return { kind: "validation", fields: error.fields };
    case "not-found":
      return { kind: "not-found", entity: error.entity };
    case "conflict":
      return { kind: "conflict" };
    case "maintenance":
      return { kind: "maintenance" };
    case "storage":
      return { kind: "storage" };
    case "quota":
      return { kind: "quota" };
    case "unsupported-data":
      return { kind: "unsupported-data" };
  }
};

const foundationErrorToBuildError = (code: string): BuildError => {
  switch (code) {
    case "quota-exceeded":
      return { kind: "quota" };
    case "revision-conflict":
    case "request-conflict":
      return { kind: "conflict" };
    case "maintenance-active":
    case "stale-fence":
      return { kind: "maintenance" };
    case "unsupported-version":
    case "migration-failed":
      return { kind: "unsupported-data" };
    case "access-denied":
    case "lock-unavailable":
    case "storage-unavailable":
      return { kind: "storage" };
    default:
      return corruptData;
  }
};

const itemsEqual = (
  a: readonly BuildItem[],
  b: readonly BuildItem[],
): boolean => {
  if (a.length !== b.length) return false;
  const sort = (items: readonly BuildItem[]) =>
    [...items].sort((x, y) =>
      x.candidatePartId.localeCompare(y.candidatePartId),
    );
  const sortedA = sort(a);
  const sortedB = sort(b);
  return sortedA.every(
    (item, index) =>
      item.candidatePartId === sortedB[index]?.candidatePartId &&
      item.quantity === sortedB[index]?.quantity,
  );
};

/**
 * Any item whose candidate is missing from the eligible map is a stored
 * reference the query boundary should already have rejected as corrupt-data;
 * commands stop rather than silently repairing it.
 */
const resolvableItems = (
  items: readonly BuildItem[],
  eligible: EligibleCandidates,
): boolean => items.every((item) => eligible.has(item.candidatePartId));

const applyCommand = (
  command: BuildCommand,
  currentItems: readonly BuildItem[],
  eligible: EligibleCandidates,
  policy: CategoryPolicy,
): Result<readonly BuildItem[], BuildError> => {
  if (!resolvableItems(currentItems, eligible)) {
    return { ok: false, error: corruptData };
  }

  switch (command.type) {
    case "select": {
      const candidate = eligible.get(command.candidatePartId);
      if (candidate === undefined) {
        return { ok: false, error: { kind: "not-found", entity: "candidate" } };
      }
      const mode = policy.modeFor(candidate.category);
      if (mode === "single") {
        const others = currentItems.filter((item) => {
          const itemCandidate = eligible.get(item.candidatePartId);
          return itemCandidate?.category !== candidate.category;
        });
        return {
          ok: true,
          value: [
            ...others,
            {
              candidatePartId: command.candidatePartId,
              quantity: 1 as PositiveInteger,
            },
          ],
        };
      }
      if (mode === "multiple") {
        if (
          currentItems.some(
            (item) => item.candidatePartId === command.candidatePartId,
          )
        ) {
          return { ok: true, value: currentItems };
        }
        return {
          ok: true,
          value: [
            ...currentItems,
            {
              candidatePartId: command.candidatePartId,
              quantity: 1 as PositiveInteger,
            },
          ],
        };
      }
      return {
        ok: false,
        error: {
          kind: "validation",
          fields: { candidatePartId: "ineligible" },
        },
      };
    }
    case "set-quantity": {
      const candidate = eligible.get(command.candidatePartId);
      if (candidate === undefined) {
        return { ok: false, error: { kind: "not-found", entity: "candidate" } };
      }
      const mode = policy.modeFor(candidate.category);
      if (mode !== "multiple") {
        return {
          ok: false,
          error: {
            kind: "validation",
            fields: { quantity: "single-category" },
          },
        };
      }
      if (!isValidQuantity(mode, command.quantity)) {
        return {
          ok: false,
          error: { kind: "validation", fields: { quantity: "invalid" } },
        };
      }
      if (
        !currentItems.some(
          (item) => item.candidatePartId === command.candidatePartId,
        )
      ) {
        return { ok: false, error: { kind: "not-found", entity: "candidate" } };
      }
      return {
        ok: true,
        value: currentItems.map((item) =>
          item.candidatePartId === command.candidatePartId
            ? {
                candidatePartId: item.candidatePartId,
                quantity: command.quantity as PositiveInteger,
              }
            : item,
        ),
      };
    }
    case "remove": {
      return {
        ok: true,
        value: currentItems.filter(
          (item) => item.candidatePartId !== command.candidatePartId,
        ),
      };
    }
  }
};

export const createBuildService = (
  dependencies: BuildServiceDependencies,
): BuildService => {
  const now = dependencies.now ?? createUtcTimestamp;
  const newBuildId =
    dependencies.createBuildId ?? (() => createUuid() as CurrentBuildId);

  return {
    async execute(command: BuildCommand, context: BuildMutationContext) {
      const eligibleResult = await dependencies.candidates.listBuildEligible(
        command.projectId,
      );
      if (!eligibleResult.ok) {
        return {
          ok: false,
          error: managementErrorToBuildError(eligibleResult.error),
        };
      }
      const eligible: EligibleCandidates = new Map(
        eligibleResult.value.map((candidate) => [candidate.id, candidate]),
      );

      const snapshotResult = await dependencies.query.getByProject(
        command.projectId,
      );
      if (!snapshotResult.ok) return snapshotResult;

      if (snapshotResult.value.revision !== context.expectedRevision) {
        return { ok: false, error: { kind: "conflict" } };
      }

      const currentBuild = snapshotResult.value.currentBuild;
      const currentItems = currentBuild?.items ?? [];

      const nextItemsResult = applyCommand(
        command,
        currentItems,
        eligible,
        dependencies.policy,
      );
      if (!nextItemsResult.ok) return nextItemsResult;
      const nextItems = nextItemsResult.value;

      const unchanged =
        currentBuild !== null
          ? itemsEqual(currentBuild.items, nextItems)
          : nextItems.length === 0;
      if (unchanged) {
        return snapshotResult;
      }

      const value: CurrentBuild = {
        id: currentBuild?.id ?? newBuildId(),
        projectId: command.projectId,
        items: nextItems,
        updatedAt: now(),
      };

      const mutation = await dependencies.data.mutate({
        requestId: context.requestId,
        expectedRevision: context.expectedRevision,
        operation: {
          kind: currentBuild === null ? "create" : "update",
          entity: "currentBuild",
          value,
        },
      });
      if (!mutation.ok) {
        return {
          ok: false,
          error: foundationErrorToBuildError(mutation.error.code),
        };
      }

      return dependencies.query.getByProject(command.projectId);
    },
  };
};
