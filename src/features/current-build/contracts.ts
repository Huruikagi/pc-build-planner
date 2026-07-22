import type {
  CandidatePartId,
  CurrentBuild,
  ProjectId,
  RequestId,
  Result,
  Revision,
} from "../../domain/public.js";

export type BuildCommand =
  | {
      readonly type: "select";
      readonly projectId: ProjectId;
      readonly candidatePartId: CandidatePartId;
    }
  | {
      readonly type: "set-quantity";
      readonly projectId: ProjectId;
      readonly candidatePartId: CandidatePartId;
      readonly quantity: number;
    }
  | {
      readonly type: "remove";
      readonly projectId: ProjectId;
      readonly candidatePartId: CandidatePartId;
    };

export interface BuildMutationContext {
  readonly requestId: RequestId;
  readonly expectedRevision: Revision;
}

export interface CurrentBuildSnapshot {
  readonly revision: Revision;
  readonly currentBuild: Readonly<CurrentBuild> | null;
}

/** Errors are normalized by the feature so consumers can choose retry, reload, or stop. */
export type BuildError =
  | {
      readonly kind: "validation";
      readonly fields: Readonly<Record<string, string>>;
    }
  | { readonly kind: "not-found"; readonly entity: "project" | "candidate" }
  | { readonly kind: "conflict" }
  | { readonly kind: "maintenance" }
  | { readonly kind: "corrupt-data" }
  | { readonly kind: "unsupported-data" }
  | { readonly kind: "quota" }
  | { readonly kind: "storage" };

export interface CurrentBuildQuery {
  getByProject(
    projectId: ProjectId,
  ): Promise<Result<CurrentBuildSnapshot, BuildError>>;
}

export interface BuildService {
  execute(
    command: BuildCommand,
    context: BuildMutationContext,
  ): Promise<Result<CurrentBuildSnapshot, BuildError>>;
}
