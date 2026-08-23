import type {
  AddCandidateSourceInput,
  CandidatePartId,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  CandidateSourcePublicError,
  CandidateSourceReference,
  RemoveCandidateSourceInput,
  SetPrimarySourceInput,
  UpdateCandidateSourceInput,
} from "../../src/candidate-sources/public.js";

export interface CandidateSourceEditorSnapshot {
  readonly draft: Readonly<Record<string, unknown>>;
  readonly sources: readonly CandidateSourceReference[];
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

const fieldErrors = (
  error: CandidateSourcePublicError,
): Readonly<Record<string, string>> => {
  if (error.kind === "source-validation") return { [error.path]: error.kind };
  if (error.kind === "primary-required")
    return { replacementPrimarySourceId: error.kind };
  return {};
};

export const loadCandidateSourceEditor = async (
  ports: CandidateSourceEditorPorts | undefined,
  candidateId: CandidatePartId,
  current: CandidateSourceEditorSnapshot,
): Promise<CandidateSourceEditorResult> => {
  if (ports === undefined) return { kind: "unavailable", snapshot: current };
  const listed = await ports.catalog.listSourceReferences({
    scope: { kind: "candidate", candidateId },
  });
  return listed.ok
    ? {
        kind: "ready",
        snapshot: { ...current, sources: listed.value, fieldErrors: {} },
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
} => ({
  started: { ...current, fieldErrors: {}, saving: true },
  completed:
    ports === undefined
      ? Promise.resolve({ kind: "unavailable", snapshot: current })
      : mutate(ports.mutations, command).then((result) =>
          result.ok
            ? { kind: "ready", snapshot: stopped(current) }
            : {
                kind: "failed",
                snapshot: {
                  ...stopped(current),
                  fieldErrors: fieldErrors(result.error),
                },
                error: result.error,
              },
        ),
});
