import type {
  AddCandidateSourceInput,
  CandidatePartId,
  CandidateSourceCatalogPort,
  CandidateSourceEntity,
  CandidateSourceId,
  CandidateSourceMutationPort,
  CandidateSourcePublicError,
  RemoveCandidateSourceInput,
  SetPrimarySourceInput,
  UpdateCandidateSourceInput,
} from "../../candidate-sources/public.js";
import { candidateSourcePageUrlPath } from "../../domain/public.js";

export interface CandidateSourceEditorSnapshot {
  readonly draft: object;
  readonly sources: readonly CandidateSourceEntity[];
  readonly primarySourceId?: CandidateSourceId;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly saving: boolean;
}

export interface CandidateSourceEditorPorts {
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
}

export type CandidateSourceEditorCommand =
  | ({ readonly kind: "add" } & AddCandidateSourceInput)
  | ({ readonly kind: "update" } & UpdateCandidateSourceInput)
  | ({ readonly kind: "remove" } & RemoveCandidateSourceInput)
  | ({ readonly kind: "set-primary" } & SetPrimarySourceInput);

export type CandidateSourceEditorResult =
  | { readonly kind: "ready"; readonly snapshot: CandidateSourceEditorSnapshot }
  | {
      readonly kind: "unavailable";
      readonly snapshot: CandidateSourceEditorSnapshot;
    }
  | {
      readonly kind: "failed";
      readonly snapshot: CandidateSourceEditorSnapshot;
      readonly error: CandidateSourcePublicError;
    };

const stopped = (snapshot: CandidateSourceEditorSnapshot) => ({
  ...snapshot,
  saving: false,
});

const withDraftPrimarySource = (
  snapshot: CandidateSourceEditorSnapshot,
): CandidateSourceEditorSnapshot => {
  if (snapshot.primarySourceId !== undefined) return snapshot;
  const primarySourceId =
    "primarySourceId" in snapshot.draft &&
    typeof snapshot.draft.primarySourceId === "string"
      ? (snapshot.draft.primarySourceId as CandidateSourceId)
      : undefined;
  return primarySourceId === undefined
    ? snapshot
    : { ...snapshot, primarySourceId };
};

const stagedSnapshot = (
  current: CandidateSourceEditorSnapshot,
  command: CandidateSourceEditorCommand,
): CandidateSourceEditorSnapshot => {
  switch (command.kind) {
    case "add":
      return { ...current, sources: [...current.sources, command.source] };
    case "update":
      return {
        ...current,
        sources: current.sources.map((source) =>
          source.id === command.source.id ? command.source : source,
        ),
      };
    case "remove":
      return {
        ...current,
        sources: current.sources.filter(
          (source) => source.id !== command.sourceId,
        ),
      };
    case "set-primary":
      return { ...current, primarySourceId: command.sourceId };
  }
};

const targetSourceId = (
  command: CandidateSourceEditorCommand,
): CandidateSourceId | undefined =>
  command.kind === "add" || command.kind === "update"
    ? command.source.id
    : command.kind === "remove" || command.kind === "set-primary"
      ? command.sourceId
      : undefined;

const targetPageUrlPath = (
  snapshot: CandidateSourceEditorSnapshot,
  command: CandidateSourceEditorCommand,
): string | undefined => {
  const sourceId = targetSourceId(command);
  if (sourceId === undefined) return undefined;
  const index = snapshot.sources.findIndex((source) => source.id === sourceId);
  return index < 0 ? undefined : candidateSourcePageUrlPath(index);
};

const fieldErrors = (
  error: CandidateSourcePublicError,
  snapshot: CandidateSourceEditorSnapshot,
  command: CandidateSourceEditorCommand,
): Readonly<Record<string, string>> => {
  const pageUrlPath = targetPageUrlPath(snapshot, command);
  if (error.kind === "source-identity-failure" && pageUrlPath !== undefined)
    return { [pageUrlPath]: error.reason };
  if (error.kind === "source-validation") {
    const isPageUrl =
      error.path === "source.pageUrl" ||
      /(?:^|\.)sources(?:\[\d+\]|\.\d+)\.pageUrl$/u.test(error.path);
    if (isPageUrl && pageUrlPath !== undefined)
      return { [pageUrlPath]: error.reason };
  }
  if (error.kind === "primary-required")
    return { replacementPrimarySourceId: error.kind };
  return {};
};

const mutationSnapshot = (
  current: CandidateSourceEditorSnapshot,
  candidate: Awaited<
    ReturnType<CandidateSourceMutationPort["setPrimarySource"]>
  > & { readonly ok: true },
): CandidateSourceEditorSnapshot => ({
  ...current,
  sources: candidate.value.sources,
  ...(candidate.value.primarySourceId === undefined
    ? {}
    : { primarySourceId: candidate.value.primarySourceId }),
  fieldErrors: {},
  saving: false,
});

export const loadCandidateSourceEditor = async (
  ports: CandidateSourceEditorPorts | undefined,
  candidateId: CandidatePartId,
  current: CandidateSourceEditorSnapshot,
): Promise<CandidateSourceEditorResult> => {
  if (ports === undefined) return { kind: "unavailable", snapshot: current };
  const listed = await ports.catalog.listSourceReferences({
    scope: { kind: "candidate", candidateId },
  });
  const primarySourceId = listed.ok
    ? listed.value.find((reference) => reference.isPrimary)?.sourceId
    : undefined;
  return listed.ok
    ? {
        kind: "ready",
        snapshot: {
          ...current,
          sources: listed.value.map((reference) => {
            const existing = current.sources.find(
              (source) => source.id === reference.sourceId,
            );
            return {
              ...(existing ?? { id: reference.sourceId }),
              ...(reference.pageUrl === undefined
                ? {}
                : { pageUrl: reference.pageUrl }),
              ...(reference.kind === undefined ? {} : { kind: reference.kind }),
            };
          }),
          ...(primarySourceId === undefined ? {} : { primarySourceId }),
          fieldErrors: {},
        },
      }
    : { kind: "failed", snapshot: current, error: listed.error };
};

const mutate = (
  mutations: CandidateSourceMutationPort,
  command: CandidateSourceEditorCommand,
) => {
  switch (command.kind) {
    case "add":
      return mutations.addSource(command);
    case "update":
      return mutations.updateSource(command);
    case "remove":
      return mutations.removeSource(command);
    case "set-primary":
      return mutations.setPrimarySource(command);
  }
};

export const beginCandidateSourceEditorSave = (
  ports: CandidateSourceEditorPorts | undefined,
  current: CandidateSourceEditorSnapshot,
  command: CandidateSourceEditorCommand,
): {
  readonly started: CandidateSourceEditorSnapshot;
  readonly completed: Promise<CandidateSourceEditorResult>;
} => {
  const preserved = withDraftPrimarySource(current);
  const staged = stagedSnapshot(preserved, command);
  const started = { ...staged, fieldErrors: {}, saving: true };
  return {
    started,
    completed:
      ports === undefined
        ? Promise.resolve({ kind: "unavailable", snapshot: preserved })
        : mutate(ports.mutations, command).then((result) =>
            result.ok
              ? { kind: "ready", snapshot: mutationSnapshot(staged, result) }
              : {
                  kind: "failed",
                  snapshot: {
                    ...stopped(preserved),
                    fieldErrors: fieldErrors(result.error, staged, command),
                  },
                  error: result.error,
                },
          ),
  };
};
