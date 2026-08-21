import assert from "node:assert/strict";
import test from "node:test";

import type { TransientSurfaceLifecyclePort } from "../../src/application-shell/public.js";
import type {
  CandidatePartId,
  CandidateSource,
  CandidateSourceId,
  MoneyValue,
  ProjectId,
  SourcedValue,
  UtcTimestamp,
} from "../../src/domain/public.js";
import { err, ok } from "../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
} from "../../src/features/candidate-management/public.js";
import { createSourcePriceRefreshContribution } from "../../src/features/source-price-refresh/feature-contribution.js";
import type { SourcePriceRefreshPort } from "../../src/features/source-price-refresh/public.js";
import {
  collectSourcePriceRefreshPortContractViolations,
  type SourcePriceRefreshContractObservation,
  type SourcePriceRefreshPortContractSubject,
} from "./source-price-refresh-port-contract-kit.js";

const projectId = "10000000-0000-4000-8000-000000000051" as ProjectId;
const candidateId = "20000000-0000-4000-8000-000000000051" as CandidatePartId;
const otherCandidateId =
  "20000000-0000-4000-8000-000000000052" as CandidatePartId;
const sourceId = "30000000-0000-4000-8000-000000000051" as CandidateSourceId;
const siblingSourceId =
  "30000000-0000-4000-8000-000000000052" as CandidateSourceId;
const foreignSourceId =
  "30000000-0000-4000-8000-000000000053" as CandidateSourceId;
const storedAt = "2026-07-01T00:00:00.000Z" as UtcTimestamp;
const refreshedAt = "2026-08-01T00:00:00.000Z" as UtcTimestamp;
const storedPageUrl =
  "https://catalog.synthetic-parts.example.invalid/items/unit-51?variant=blue";
const observedPageUrl = `${storedPageUrl}&UTM_Source=contract#details`;

const price = (amount: number, original: string): SourcedValue<MoneyValue> => ({
  original,
  confirmed: { amount, currency: "SYN" },
});

const refreshedPrice = price(5_100, "架空価格 5,100 SYN");

const source = (
  id: CandidateSourceId,
  pageUrl: string,
  siteName: string,
  amount: number,
): CandidateSource => ({
  id,
  pageUrl,
  siteName,
  capturedAt: storedAt,
  price: price(amount, `架空価格 ${amount} SYN`),
  kind: "retail",
});

const draft = (
  id: CandidatePartId,
  sources: readonly CandidateSource[],
  primarySourceId: CandidateSourceId,
): CandidateDraft => ({
  projectId,
  category: "cpu",
  product: { name: { original: `架空候補 ${id.slice(-2)}` } },
  normalizedAttributes: { category: "cpu" },
  sources,
  primarySourceId,
});

/**
 * Replacement semantics deliberately mirror the production source mutation:
 * updateSource replaces the complete entry and counts exactly one aggregate
 * commit. A merge fake would hide field-loss regressions in the consumer.
 */
const createProbe = () => {
  const drafts = new Map<CandidatePartId, CandidateDraft>([
    [
      candidateId,
      draft(
        candidateId,
        [
          source(sourceId, storedPageUrl, "架空専門店", 5_500),
          source(
            siblingSourceId,
            "https://catalog.synthetic-parts.example.invalid/items/unit-51?variant=red",
            "架空別店舗",
            5_800,
          ),
        ],
        sourceId,
      ),
    ],
    [
      otherCandidateId,
      draft(
        otherCandidateId,
        [
          source(
            foreignSourceId,
            "https://catalog.synthetic-parts.example.invalid/items/unit-52",
            "架空国外店",
            6_200,
          ),
        ],
        foreignSourceId,
      ),
    ],
  ]);
  let commits = 0;

  const catalog: CandidateSourceCatalogPort = {
    async listSourceReferences(input) {
      const entries =
        input.candidateId === undefined
          ? [...drafts.entries()]
          : [...drafts.entries()].filter(([id]) => id === input.candidateId);
      return ok(
        entries.flatMap(([currentCandidateId, currentDraft]) =>
          (currentDraft.sources ?? []).map((currentSource) => ({
            candidateId: currentCandidateId,
            sourceId: currentSource.id,
            ...(currentSource.pageUrl === undefined
              ? {}
              : { pageUrl: currentSource.pageUrl }),
            ...(currentSource.kind === undefined
              ? {}
              : { kind: currentSource.kind }),
            isPrimary: currentDraft.primarySourceId === currentSource.id,
          })),
        ),
      );
    },
    async getSourceReference(input) {
      const currentDraft = drafts.get(input.candidateId);
      const currentSource = currentDraft?.sources?.find(
        (entry) => entry.id === input.sourceId,
      );
      if (currentDraft === undefined || currentSource === undefined)
        return err({
          code: "validation",
          reason: "entity-not-found",
          message: "source",
        });
      return ok({
        candidateId: input.candidateId,
        sourceId: currentSource.id,
        ...(currentSource.pageUrl === undefined
          ? {}
          : { pageUrl: currentSource.pageUrl }),
        ...(currentSource.kind === undefined
          ? {}
          : { kind: currentSource.kind }),
        isPrimary: currentDraft.primarySourceId === currentSource.id,
      });
    },
  };

  const mutations: CandidateSourceMutationPort = {
    async addSource() {
      return err({ code: "unsupported-version" });
    },
    async updateSource(input) {
      const currentDraft = drafts.get(input.candidateId);
      const sources = currentDraft?.sources;
      const index = sources?.findIndex((entry) => entry.id === input.source.id);
      if (
        currentDraft === undefined ||
        sources === undefined ||
        index === undefined ||
        index < 0
      )
        return err({
          code: "validation",
          reason: "entity-not-found",
          message: "source",
        });
      const replacement = [...sources];
      replacement[index] = structuredClone(input.source);
      drafts.set(input.candidateId, { ...currentDraft, sources: replacement });
      commits += 1;
      return ok(undefined);
    },
    async patchSourcePrice(input) {
      const currentDraft = drafts.get(input.candidateId);
      const sources = currentDraft?.sources;
      const index = sources?.findIndex((entry) => entry.id === input.sourceId);
      if (
        currentDraft === undefined ||
        sources === undefined ||
        index === undefined ||
        index < 0
      )
        return err({
          code: "validation",
          reason: "entity-not-found",
          message: "source",
        });
      const current = sources[index];
      if (
        current?.pageUrl !== input.expectedPageUrl ||
        current.kind !== input.expectedKind
      )
        return err({ kind: "precondition-failed" });
      const replacement = [...sources];
      replacement[index] = {
        ...current,
        price: structuredClone(input.price),
        capturedAt: input.capturedAt,
      };
      drafts.set(input.candidateId, { ...currentDraft, sources: replacement });
      commits += 1;
      return ok(undefined);
    },
    async removeSource() {
      return err({ code: "unsupported-version" });
    },
    async setPrimarySource() {
      return err({ code: "unsupported-version" });
    },
  };

  const transientSurface: TransientSurfaceLifecyclePort = {
    isCurrent: () => true,
    waitUntilCurrent: async () => true,
    dismiss: async () => ok(undefined),
    conclude: async () => ok(undefined),
  };
  const refresh = createSourcePriceRefreshContribution({
    catalog,
    mutations,
    pagePriceExtraction: {
      async extractPrice() {
        return err({ kind: "tab-unavailable" });
      },
    },
    transientSurface,
  }).registration.publicApi.refresh;

  return {
    refresh,
    async observe(): Promise<SourcePriceRefreshContractObservation> {
      return {
        commits,
        sources: [...drafts.entries()].flatMap(([currentCandidateId, value]) =>
          (value.sources ?? []).map((currentSource) => ({
            candidateId: currentCandidateId,
            source: structuredClone(currentSource),
            isPrimary: value.primarySourceId === currentSource.id,
          })),
        ),
      };
    },
  };
};

const subject: SourcePriceRefreshPortContractSubject = {
  candidateId,
  otherCandidateId,
  sourceId,
  storedPageUrl,
  observedPageUrl,
  refreshedAt,
  refreshedPrice,
  probe: createProbe,
};

const withRefreshDecorator = (
  decorate: (refresh: SourcePriceRefreshPort) => SourcePriceRefreshPort,
): SourcePriceRefreshPortContractSubject => ({
  ...subject,
  probe() {
    const probe = subject.probe();
    return { ...probe, refresh: decorate(probe.refresh) };
  },
});

test("公開価格更新portはcatalog/candidate scopeで同じURL identityとatomic updateを共有する", async () => {
  assert.deepEqual(
    await collectSourcePriceRefreshPortContractViolations(subject),
    [],
  );
});

test("contract kitは二重mutationをcatalog/candidate両scopeで検出する", async () => {
  const decorated = withRefreshDecorator((refresh) => ({
    ...refresh,
    async refreshCapturedPrice(input) {
      const first = await refresh.refreshCapturedPrice(input);
      if (!first.ok) return first;
      return refresh.refreshCapturedPrice(input);
    },
  }));

  assert.deepEqual(
    await collectSourcePriceRefreshPortContractViolations(decorated),
    [
      "catalog.atomic: 一回のmutationで確定しない",
      "candidate.atomic: 一回のmutationで確定しない",
    ],
  );
});
