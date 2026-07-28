import type {
  CandidateSource,
  CandidateSourceId,
  CandidateSourceState,
  MoneyValue,
  Result,
  SourcedValue,
} from "../../domain/public.js";
import { err, ok } from "../../domain/public.js";

export type CandidateSourceRuleError =
  | { readonly kind: "duplicate-source" }
  | { readonly kind: "source-not-found" }
  | { readonly kind: "replacement-required" }
  | { readonly kind: "invalid-replacement" };

export interface CandidateSourceProjection {
  readonly pageUrl?: string;
  readonly price?: SourcedValue<MoneyValue>;
}

const find = (state: CandidateSourceState, id: CandidateSourceId) =>
  state.sources.findIndex((source) => source.id === id);
const nonEmpty = (
  state: CandidateSourceState,
): state is Extract<
  CandidateSourceState,
  { primarySourceId: CandidateSourceId }
> => state.sources.length > 0;

export const candidateSourcePolicy = {
  add(
    state: CandidateSourceState,
    source: CandidateSource,
  ): Result<CandidateSourceState, CandidateSourceRuleError> {
    if (find(state, source.id) >= 0) return err({ kind: "duplicate-source" });
    if (!nonEmpty(state))
      return ok({ sources: [source], primarySourceId: source.id });
    return ok({
      sources: [...state.sources, source],
      primarySourceId: state.primarySourceId,
    });
  },
  update(
    state: CandidateSourceState,
    source: CandidateSource,
  ): Result<CandidateSourceState, CandidateSourceRuleError> {
    if (!nonEmpty(state)) return err({ kind: "source-not-found" });
    const index = find(state, source.id);
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
  ): Result<CandidateSourceState, CandidateSourceRuleError> {
    if (!nonEmpty(state)) return err({ kind: "source-not-found" });
    const index = find(state, sourceId);
    if (index < 0) return err({ kind: "source-not-found" });
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
  ): Result<CandidateSourceState, CandidateSourceRuleError> {
    if (!nonEmpty(state) || find(state, sourceId) < 0)
      return err({ kind: "source-not-found" });
    return ok({
      sources: state.sources as [CandidateSource, ...CandidateSource[]],
      primarySourceId: sourceId,
    });
  },
  derive(state: CandidateSourceState): CandidateSourceProjection {
    if (state.sources.length === 0) return {};
    const primary = state.sources.find(
      (source) => source.id === state.primarySourceId,
    );
    return {
      ...(primary?.pageUrl === undefined ? {} : { pageUrl: primary.pageUrl }),
      ...(primary?.price === undefined ? {} : { price: primary.price }),
    };
  },
};
