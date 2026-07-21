import type {
  CandidatePartId,
  LocalDataRoot,
  ProjectId,
} from "../domain/model.js";
import type { Result } from "../domain/result.js";

export type RootChange =
  | {
      readonly kind: "candidate-deleted";
      readonly candidatePartId: CandidatePartId;
    }
  | {
      readonly kind: "candidate-category-changed";
      readonly candidatePartId: CandidatePartId;
    }
  | {
      readonly kind: "project-deleted";
      readonly projectId: ProjectId;
    }
  | { readonly kind: "unrelated" };

export interface RepairError {
  readonly code: "repair-failed";
  readonly message?: string;
}

export interface ReferenceRepairPolicy {
  repair(
    before: LocalDataRoot,
    proposed: LocalDataRoot,
    change: RootChange,
  ): Result<LocalDataRoot, RepairError>;
}

export const referenceRepairPolicy: ReferenceRepairPolicy = {
  repair(_before, proposed, change) {
    if (change.kind === "unrelated") return { ok: true, value: proposed };
    if (change.kind === "project-deleted") {
      const candidateParts = proposed.candidateParts.filter(
        (candidate) => candidate.projectId !== change.projectId,
      );
      const currentBuilds = proposed.currentBuilds.filter(
        (build) => build.projectId !== change.projectId,
      );
      return {
        ok: true,
        value: { ...proposed, candidateParts, currentBuilds },
      };
    }

    const currentBuilds = proposed.currentBuilds.map((build) => {
      const items = build.items.filter(
        (item) => item.candidatePartId !== change.candidatePartId,
      );
      return items.length === build.items.length ? build : { ...build, items };
    });

    return { ok: true, value: { ...proposed, currentBuilds } };
  },
};
