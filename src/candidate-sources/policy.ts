import type {
  CandidateSource,
  CandidateSourceId,
  CandidateSourceState,
} from "../domain/public.js";
import { err, ok } from "../domain/public.js";
import type {
  CandidateSourcePolicyResult,
  CandidateSourceProjection,
} from "./model.js";

const sourceIndex = (
  state: CandidateSourceState,
  sourceId: CandidateSourceId,
) => state.sources.findIndex((source) => source.id === sourceId);

const hasSources = (
  state: CandidateSourceState,
): state is Extract<
  CandidateSourceState,
  { readonly primarySourceId: CandidateSourceId }
> => state.sources.length > 0;

export const candidateSourcePolicy = {
  add(
    state: CandidateSourceState,
    source: CandidateSource,
  ): CandidateSourcePolicyResult {
    if (sourceIndex(state, source.id) >= 0)
      return err({ kind: "duplicate-source" });
    if (!hasSources(state))
      return ok({ sources: [source], primarySourceId: source.id });
    return ok({
      sources: [...state.sources, source],
      primarySourceId: state.primarySourceId,
    });
  },
  update(
    state: CandidateSourceState,
    source: CandidateSource,
  ): CandidateSourcePolicyResult {
    if (!hasSources(state)) return err({ kind: "source-not-found" });
    const index = sourceIndex(state, source.id);
    if (index < 0) return err({ kind: "source-not-found" });
    const sources = state.sources.map((current, currentIndex) =>
      currentIndex === index ? source : current,
    ) as [CandidateSource, ...CandidateSource[]];
    return ok({ sources, primarySourceId: state.primarySourceId });
  },
  remove(
    state: CandidateSourceState,
    sourceId: CandidateSourceId,
    replacementPrimarySourceId?: CandidateSourceId,
  ): CandidateSourcePolicyResult {
    if (!hasSources(state) || sourceIndex(state, sourceId) < 0)
      return err({ kind: "source-not-found" });
    if (state.sources.length === 1) return ok({ sources: [] });
    const remaining = state.sources.filter(
      (source) => source.id !== sourceId,
    ) as [CandidateSource, ...CandidateSource[]];
    if (state.primarySourceId !== sourceId)
      return ok({ sources: remaining, primarySourceId: state.primarySourceId });
    if (replacementPrimarySourceId === undefined)
      return err({ kind: "replacement-required" });
    if (!remaining.some((source) => source.id === replacementPrimarySourceId))
      return err({ kind: "invalid-replacement" });
    return ok({
      sources: remaining,
      primarySourceId: replacementPrimarySourceId,
    });
  },
  setPrimary(
    state: CandidateSourceState,
    sourceId: CandidateSourceId,
  ): CandidateSourcePolicyResult {
    if (!hasSources(state) || sourceIndex(state, sourceId) < 0)
      return err({ kind: "source-not-found" });
    return ok({ sources: state.sources, primarySourceId: sourceId });
  },
  derive(state: CandidateSourceState): CandidateSourceProjection {
    if (!hasSources(state)) return {};
    const primary = state.sources.find(
      (source) => source.id === state.primarySourceId,
    );
    return {
      ...(primary?.pageUrl === undefined ? {} : { pageUrl: primary.pageUrl }),
      ...(primary?.price === undefined ? {} : { price: primary.price }),
    };
  },
};
