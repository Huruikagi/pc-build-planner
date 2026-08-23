import type {
  AppDataError,
  CandidatePart,
  CandidateSource,
  LocalDataRoot,
  RequestId,
  Result,
  Revision,
} from "../domain/public.js";
import { validateCandidatePartValue } from "../domain/public.js";
import type { ManufacturerDomainLookup } from "../features/product-capture/public.js";
import type { FoundationScopedDataPort } from "../persistence/public.js";
import {
  type CandidateSourcePublicError,
  projectAppDataError,
} from "./app-data-error-projection.js";
import type {
  AddCandidateSourceInput,
  PatchCandidateSourcePriceInput,
  RemoveCandidateSourceInput,
  SetPrimarySourceInput,
  UpdateCandidateSourceInput,
} from "./model.js";
import { candidateSourcePolicy } from "./policy.js";

export interface SourcePricePatchContract {
  patchSourcePrice(
    input: PatchCandidateSourcePriceInput,
  ): Promise<Result<CandidatePart, CandidateSourcePublicError>>;
}

export interface CandidateSourceMutationPort extends SourcePricePatchContract {
  addSource(
    input: AddCandidateSourceInput,
  ): Promise<Result<CandidatePart, CandidateSourcePublicError>>;
  updateSource(
    input: UpdateCandidateSourceInput,
  ): Promise<Result<CandidatePart, CandidateSourcePublicError>>;
  removeSource(
    input: RemoveCandidateSourceInput,
  ): Promise<Result<CandidatePart, CandidateSourcePublicError>>;
  setPrimarySource(
    input: SetPrimarySourceInput,
  ): Promise<Result<CandidatePart, CandidateSourcePublicError>>;
}

export interface CandidateSourceMutationDependencies {
  readonly data: FoundationScopedDataPort;
  readonly manufacturerDomains: ManufacturerDomainLookup;
  readonly createRequestId?: () => RequestId;
}

type PolicyResult = ReturnType<
  | typeof candidateSourcePolicy.add
  | typeof candidateSourcePolicy.update
  | typeof candidateSourcePolicy.remove
  | typeof candidateSourcePolicy.setPrimary
>;

const policyError = (
  error: Extract<PolicyResult, { readonly ok: false }>["error"],
): CandidateSourcePublicError => {
  switch (error.kind) {
    case "source-not-found":
      return { kind: "not-found", entity: "source" };
    case "replacement-required":
    case "invalid-replacement":
      return { kind: "primary-required" };
    case "duplicate-source":
      return {
        kind: "source-validation",
        path: "source.id",
        reason: "duplicate-id",
      };
  }
};

const validationError = (
  candidate: CandidatePart,
): CandidateSourcePublicError | undefined => {
  const validation = validateCandidatePartValue(candidate, "candidate");
  return validation.ok
    ? undefined
    : {
        kind: "source-validation",
        path: validation.error.path,
        reason: validation.error.code,
      };
};

const defaultRequestId = (): RequestId =>
  globalThis.crypto.randomUUID() as RequestId;

export const createCandidateSourceMutationService = (
  dependencies: CandidateSourceMutationDependencies,
): CandidateSourceMutationPort => {
  const commit = async (
    candidateId: AddCandidateSourceInput["candidateId"],
    derive: (candidate: CandidatePart) => PolicyResult,
  ): Promise<Result<CandidatePart, CandidateSourcePublicError>> => {
    const snapshot = await dependencies.data.query((root: LocalDataRoot) => ({
      revision: root.revision,
      candidate: root.candidateParts.find((item) => item.id === candidateId),
    }));
    if (!snapshot.ok)
      return { ok: false, error: projectAppDataError(snapshot.error) };
    if (snapshot.value.candidate === undefined)
      return { ok: false, error: { kind: "not-found", entity: "candidate" } };

    const current = snapshot.value.candidate;
    const derived = derive(current);
    if (!derived.ok) return { ok: false, error: policyError(derived.error) };
    const candidate = { ...current, ...derived.value } as CandidatePart;
    const invalid = validationError(candidate);
    if (invalid !== undefined) return { ok: false, error: invalid };

    const committed = await dependencies.data.mutate({
      requestId: (dependencies.createRequestId ?? defaultRequestId)(),
      expectedRevision: snapshot.value.revision as Revision,
      operation: { kind: "update", entity: "candidatePart", value: candidate },
    });
    return committed.ok
      ? { ok: true, value: candidate }
      : {
          ok: false,
          error: projectAppDataError(committed.error as AppDataError),
        };
  };

  const patchSourcePrice = async (
    input: PatchCandidateSourcePriceInput,
  ): Promise<Result<CandidatePart, CandidateSourcePublicError>> => {
    const snapshot = await dependencies.data.query((root: LocalDataRoot) => ({
      revision: root.revision,
      candidate: root.candidateParts.find(
        (candidate) => candidate.id === input.candidateId,
      ),
    }));
    if (!snapshot.ok)
      return { ok: false, error: projectAppDataError(snapshot.error) };

    const current = snapshot.value.candidate;
    const source = current?.sources.find(({ id }) => id === input.sourceId);
    if (
      current === undefined ||
      source === undefined ||
      source.pageUrl !== input.expectedPageUrl ||
      source.kind !== input.expectedKind
    )
      return { ok: false, error: { kind: "precondition-failed" } };

    const candidate = {
      ...current,
      sources: current.sources.map((item) =>
        item.id === input.sourceId
          ? { ...item, price: input.price, capturedAt: input.capturedAt }
          : item,
      ),
    } as unknown as CandidatePart;
    const invalid = validationError(candidate);
    if (invalid !== undefined) return { ok: false, error: invalid };

    const committed = await dependencies.data.mutate({
      requestId: (dependencies.createRequestId ?? defaultRequestId)(),
      expectedRevision: snapshot.value.revision as Revision,
      operation: { kind: "update", entity: "candidatePart", value: candidate },
    });
    return committed.ok
      ? { ok: true, value: candidate }
      : {
          ok: false,
          error: projectAppDataError(committed.error as AppDataError),
        };
  };

  return Object.freeze({
    addSource(input: AddCandidateSourceInput) {
      if (input.source.kind === undefined) {
        const classified = dependencies.manufacturerDomains.findManufacturer(
          input.source.pageUrl,
        );
        if (!classified.ok)
          return Promise.resolve({
            ok: false as const,
            error: {
              kind: "source-validation" as const,
              path: "source.pageUrl",
              reason: "invalid-url",
            },
          });
        const source: CandidateSource = {
          ...input.source,
          kind: classified.value === undefined ? "retail" : "manufacturer",
        };
        return commit(input.candidateId, (candidate) =>
          candidateSourcePolicy.add(candidate, source),
        );
      }
      return commit(input.candidateId, (candidate) => {
        return candidateSourcePolicy.add(candidate, input.source);
      });
    },
    updateSource(input: UpdateCandidateSourceInput) {
      return commit(input.candidateId, (candidate) => {
        const current = candidate.sources.find(
          (source) => source.id === input.source.id,
        );
        return candidateSourcePolicy.update(candidate, {
          ...current,
          ...input.source,
        });
      });
    },
    removeSource(input: RemoveCandidateSourceInput) {
      return commit(input.candidateId, (candidate) =>
        candidateSourcePolicy.remove(
          candidate,
          input.sourceId,
          input.replacementPrimarySourceId,
        ),
      );
    },
    setPrimarySource(input: SetPrimarySourceInput) {
      return commit(input.candidateId, (candidate) =>
        candidateSourcePolicy.setPrimary(candidate, input.sourceId),
      );
    },
    patchSourcePrice,
  });
};
