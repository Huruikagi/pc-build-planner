import assert from "node:assert/strict";
import test from "node:test";
import {
  type CandidatePartId,
  type CandidateSource,
  type CandidateSourceId,
  err,
  type MoneyValue,
  ok,
  type Result,
  type SourcedValue,
  type UtcTimestamp,
} from "../../../src/domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceMutationError,
  CandidateSourceMutationPort,
  CandidateSourceReference,
  ManagementError,
  PatchCandidateSourcePriceInput,
} from "../../../src/features/candidate-management/public.js";
import type {
  RefreshCapturedPriceInput,
  SourcePriceRefreshError,
  SourcePriceRefreshReceipt,
} from "../../../src/features/source-price-refresh/contracts.js";
import { createSourcePriceRefreshService } from "../../../src/features/source-price-refresh/service.js";

const candidateA = "30000000-0000-4000-8000-00000000000a" as CandidatePartId;
const candidateB = "30000000-0000-4000-8000-00000000000b" as CandidatePartId;

const sourceId = (suffix: string): CandidateSourceId =>
  `40000000-0000-4000-8000-00000000000${suffix}` as CandidateSourceId;

const primaryId = sourceId("1");
const secondaryId = sourceId("2");

const pageUrl = "https://shop.example.invalid/p/1";
const otherPageUrl = "https://shop.example.invalid/p/2";

const oldCapturedAt = "2026-01-01T00:00:00.000Z" as UtcTimestamp;
const newCapturedAt = "2026-02-02T02:02:02.000Z" as UtcTimestamp;

const money = (amount: number, currency = "JPY"): SourcedValue<MoneyValue> => ({
  original: `${amount}${currency}`,
  confirmed: { amount, currency },
});

const oldPrice = money(19800);
const newPrice = money(17800);

interface StoredCandidate {
  readonly id: CandidatePartId;
  sources: CandidateSource[];
  primarySourceId: CandidateSourceId;
}

interface FakeCandidateStoreOptions {
  readonly referenceFailure?: ManagementError;
  readonly mutationFailure?: CandidateSourceMutationError;
  /**
   * Models a catalog that answers with a different entity than the one asked
   * for. A faithful upstream never does this, so it is the only way to observe
   * the identifier half of the pre-mutation re-validation.
   */
  readonly referenceOverride?: CandidateSourceReference;
}

interface FakeCandidateStore {
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
  /** Catalog and mutation port calls, in order. */
  readonly calls: readonly string[];
  /** Every dependency call, including the query facet, in order. */
  readonly trace: readonly string[];
  readonly updateInputs: readonly PatchCandidateSourcePriceInput[];
  readonly candidates: readonly StoredCandidate[];
  snapshot(): string;
  representativePrice(
    candidateId: CandidatePartId,
  ): SourcedValue<MoneyValue> | undefined;
}

const reference = (
  candidate: StoredCandidate,
  source: CandidateSource,
): CandidateSourceReference => ({
  candidateId: candidate.id,
  sourceId: source.id,
  ...(source.pageUrl === undefined ? {} : { pageUrl: source.pageUrl }),
  ...(source.kind === undefined ? {} : { kind: source.kind }),
  isPrimary: candidate.primarySourceId === source.id,
});

/**
 * Mirrors the upstream aggregate closely enough that field loss is observable:
 * `updateSource` replaces the stored entry with the supplied source exactly as
 * `candidateSourcePolicy.update` does, and the representative price is derived
 * from `primarySourceId` only.
 */
const createFakeCandidateStore = (
  candidates: readonly StoredCandidate[],
  options: FakeCandidateStoreOptions = {},
): FakeCandidateStore => {
  const calls: string[] = [];
  const trace: string[] = [];
  const updateInputs: PatchCandidateSourcePriceInput[] = [];
  const find = (candidateId: CandidatePartId): StoredCandidate | undefined =>
    candidates.find((candidate) => candidate.id === candidateId);
  const record = (call: string): void => {
    calls.push(call);
    trace.push(call);
  };

  const catalog: CandidateSourceCatalogPort = {
    async listSourceReferences(
      input,
    ): Promise<Result<readonly CandidateSourceReference[], ManagementError>> {
      record("listSourceReferences");
      const scoped =
        input.candidateId === undefined
          ? candidates
          : candidates.filter(
              (candidate) => candidate.id === input.candidateId,
            );
      return ok(
        scoped.flatMap((candidate) =>
          candidate.sources.map((source) => reference(candidate, source)),
        ),
      );
    },
    async getSourceReference(
      input,
    ): Promise<Result<CandidateSourceReference, ManagementError>> {
      record("getSourceReference");
      if (options.referenceFailure !== undefined)
        return err(options.referenceFailure);
      if (options.referenceOverride !== undefined)
        return ok(options.referenceOverride);
      const candidate = find(input.candidateId);
      if (candidate === undefined)
        return err({ kind: "not-found", entity: "candidate" });
      const source = candidate.sources.find(
        (item) => item.id === input.sourceId,
      );
      return source === undefined
        ? err({ kind: "not-found", entity: "source" })
        : ok(reference(candidate, source));
    },
  };

  const unsupported = async (): Promise<Result<void, ManagementError>> =>
    err({ kind: "unsupported-data" });

  const mutations: CandidateSourceMutationPort = {
    addSource: unsupported,
    removeSource: unsupported,
    setPrimarySource: unsupported,
    async patchSourcePrice(
      input,
    ): Promise<Result<void, CandidateSourceMutationError>> {
      record("patchSourcePrice");
      updateInputs.push(input);
      if (options.mutationFailure !== undefined)
        return err(options.mutationFailure);
      const candidate = find(input.candidateId);
      if (candidate === undefined)
        return err({ kind: "not-found", entity: "candidate" });
      const index = candidate.sources.findIndex(
        (item) => item.id === input.sourceId,
      );
      if (index < 0) return err({ kind: "not-found", entity: "source" });
      const current = candidate.sources[index];
      if (
        current?.pageUrl !== input.expectedPageUrl ||
        current.kind !== input.expectedKind
      )
        return err({ kind: "precondition-failed" });
      candidate.sources = candidate.sources.map((current, currentIndex) =>
        currentIndex === index
          ? { ...current, price: input.price, capturedAt: input.capturedAt }
          : current,
      );
      return ok(undefined);
    },
    updateSource: unsupported,
  };

  return {
    catalog,
    mutations,
    calls,
    trace,
    updateInputs,
    candidates,
    snapshot: () => JSON.stringify(candidates),
    representativePrice: (candidateId) => {
      const candidate = find(candidateId);
      return candidate?.sources.find(
        (source) => source.id === candidate.primarySourceId,
      )?.price;
    },
  };
};

const storedSource = (
  overrides: Partial<CandidateSource> & { readonly id: CandidateSourceId },
): CandidateSource => ({
  pageUrl,
  siteName: "サンプル販売店",
  capturedAt: oldCapturedAt,
  price: oldPrice,
  kind: "retail",
  ...overrides,
});

/** One candidate whose primary source is the refresh target. */
const primaryTargetStore = (
  options?: FakeCandidateStoreOptions,
): FakeCandidateStore =>
  createFakeCandidateStore(
    [
      {
        id: candidateA,
        primarySourceId: primaryId,
        sources: [
          storedSource({ id: primaryId }),
          storedSource({
            id: secondaryId,
            pageUrl: otherPageUrl,
            siteName: "別の販売店",
            price: money(20800),
          }),
        ],
      },
      {
        id: candidateB,
        primarySourceId: sourceId("3"),
        sources: [storedSource({ id: sourceId("3"), pageUrl: otherPageUrl })],
      },
    ],
    options,
  );

/** The same candidate, but the refresh target is not the primary source. */
const secondaryTargetStore = (): FakeCandidateStore =>
  createFakeCandidateStore([
    {
      id: candidateA,
      primarySourceId: secondaryId,
      sources: [
        storedSource({ id: primaryId }),
        storedSource({
          id: secondaryId,
          pageUrl: otherPageUrl,
          siteName: "別の販売店",
          price: money(20800),
        }),
      ],
    },
  ]);

/** Allows an explicit `price: undefined` so the missing-price case is expressible. */
type RefreshOverrides = {
  readonly [Key in keyof RefreshCapturedPriceInput]?:
    | RefreshCapturedPriceInput[Key]
    | undefined;
};

const refreshInput = (
  overrides: RefreshOverrides = {},
): RefreshCapturedPriceInput => {
  const price = "price" in overrides ? overrides.price : newPrice;
  const base = {
    target: overrides.target ?? {
      candidateId: candidateA,
      sourceId: primaryId,
    },
    observedPageUrl: overrides.observedPageUrl ?? pageUrl,
    capturedAt: overrides.capturedAt ?? newCapturedAt,
  };
  return price === undefined ? base : { ...base, price };
};

const refresh = (
  store: FakeCandidateStore,
  overrides: RefreshOverrides = {},
): Promise<Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>> =>
  createSourcePriceRefreshService({
    catalog: store.catalog,
    mutations: store.mutations,
  }).refreshCapturedPrice(refreshInput(overrides));

const expectError = <Value>(
  result: Result<Value, SourcePriceRefreshError>,
  kind: SourcePriceRefreshError["kind"],
): void => {
  assert.equal(result.ok, false, `失敗を期待したが成功した: ${kind}`);
  if (result.ok) return;
  assert.equal(result.error.kind, kind);
};

const expectReceipt = (
  result: Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>,
): SourcePriceRefreshReceipt => {
  assert.equal(
    result.ok,
    true,
    `更新成功を期待したが失敗した: ${JSON.stringify(result)}`,
  );
  if (!result.ok) throw new Error("expected refresh receipt");
  return result.value;
};

test("priceが欠損した観測はmutationを呼ばず price-unavailable として拒否する", async () => {
  const store = primaryTargetStore();
  const before = store.snapshot();

  expectError(await refresh(store, { price: undefined }), "price-unavailable");

  assert.deepEqual(store.calls, []);
  assert.equal(store.snapshot(), before);
});

test("confirmed moneyを持たないpriceはmutation前に price-unavailable として拒否する", async () => {
  const withoutConfirmedMoney: readonly SourcedValue<MoneyValue>[] = [
    { original: "17,800円" },
    { original: null },
    { original: "17800", confirmed: { amount: Number.NaN, currency: "JPY" } },
    {
      original: "17800",
      confirmed: { amount: Number.POSITIVE_INFINITY, currency: "JPY" },
    },
    { original: "17800", confirmed: { amount: 17800, currency: "" } },
    { original: "17800", confirmed: { amount: 17800, currency: "   " } },
  ];

  for (const price of withoutConfirmedMoney) {
    const store = primaryTargetStore();
    const before = store.snapshot();

    expectError(await refresh(store, { price }), "price-unavailable");

    assert.deepEqual(store.calls, [], JSON.stringify(price));
    assert.equal(store.snapshot(), before, JSON.stringify(price));
  }
});

test("primary sourceの更新でpriceとcapturedAtだけを置換し代表価格が新価格へ追従する", async () => {
  const store = primaryTargetStore();

  const receipt = expectReceipt(await refresh(store));

  assert.deepEqual(receipt, {
    candidateId: candidateA,
    sourceId: primaryId,
    price: newPrice,
    capturedAt: newCapturedAt,
    isPrimary: true,
  });
  assert.deepEqual(store.representativePrice(candidateA), newPrice);
  const updated = store.candidates[0]?.sources[0];
  assert.deepEqual(updated?.price, newPrice);
  assert.equal(updated?.capturedAt, newCapturedAt);
});

test("non-primary sourceの更新では代表価格と他sourceを変更しない", async () => {
  const store = secondaryTargetStore();
  const representativeBefore = store.representativePrice(candidateA);

  const receipt = expectReceipt(await refresh(store));

  assert.equal(receipt.isPrimary, false);
  assert.deepEqual(store.representativePrice(candidateA), representativeBefore);
  // The representative price still comes from the untouched primary source.
  assert.deepEqual(store.representativePrice(candidateA), money(20800));
  // The other source keeps every field, not merely its price and capturedAt.
  assert.deepEqual(
    store.candidates[0]?.sources[1],
    storedSource({
      id: secondaryId,
      pageUrl: otherPageUrl,
      siteName: "別の販売店",
      price: money(20800),
    }),
  );
  // The non-primary target itself took the new price while keeping siteName.
  assert.deepEqual(
    store.candidates[0]?.sources[0],
    storedSource({
      id: primaryId,
      capturedAt: newCapturedAt,
      price: newPrice,
    }),
  );
});

test("更新入力は対象ID、期待raw URL・retail kind、price、capturedAtだけを渡す", async () => {
  const store = primaryTargetStore();

  expectReceipt(await refresh(store));

  assert.deepEqual(store.updateInputs, [
    {
      candidateId: candidateA,
      sourceId: primaryId,
      expectedPageUrl: pageUrl,
      expectedKind: "retail",
      capturedAt: newCapturedAt,
      price: newPrice,
    },
  ]);
  assert.deepEqual(
    store.candidates[0]?.sources[0],
    storedSource({ id: primaryId, capturedAt: newCapturedAt, price: newPrice }),
  );
  assert.deepEqual(store.candidates[1], {
    id: candidateB,
    primarySourceId: sourceId("3"),
    sources: [storedSource({ id: sourceId("3"), pageUrl: otherPageUrl })],
  });
});

test("mutation直前に対象sourceを再読込してから一度だけ更新する", async () => {
  const store = primaryTargetStore();

  expectReceipt(await refresh(store));

  assert.deepEqual(store.calls, ["getSourceReference", "patchSourcePrice"]);
});

test("draftを読まず直前の公開referenceから条件付きprice patchを行う", async () => {
  const store = primaryTargetStore();

  expectReceipt(await refresh(store));

  assert.deepEqual(store.trace, ["getSourceReference", "patchSourcePrice"]);
});

test("再読込した現行URLがobserved URLと一致しない場合はmutationを呼ばず stale-target", async () => {
  const store = primaryTargetStore();
  const target = store.candidates[0];
  assert.ok(target);
  target.sources = [
    storedSource({
      id: primaryId,
      pageUrl: "https://shop.example.invalid/p/9",
    }),
    ...target.sources.slice(1),
  ];
  const before = store.snapshot();

  expectError(await refresh(store), "stale-target");

  assert.deepEqual(store.calls, ["getSourceReference"]);
  assert.equal(store.snapshot(), before);
});

test("再読込した現行kindがretailでない場合はmutationを呼ばず stale-target", async () => {
  const drifted: readonly CandidateSource[] = [
    storedSource({ id: primaryId, kind: "manufacturer" }),
    // Kind removed entirely: an implicit kind is never eligible for a refresh.
    {
      id: primaryId,
      pageUrl,
      siteName: "サンプル販売店",
      capturedAt: oldCapturedAt,
      price: oldPrice,
    },
  ];

  for (const source of drifted) {
    const store = primaryTargetStore();
    const target = store.candidates[0];
    assert.ok(target);
    target.sources = [source, ...target.sources.slice(1)];
    const before = store.snapshot();

    expectError(await refresh(store), "stale-target");

    assert.deepEqual(store.calls, ["getSourceReference"], String(source.kind));
    assert.equal(store.snapshot(), before, String(source.kind));
  }
});

test("再読込が別の候補IDまたはsource IDを返した場合はmutationを呼ばず stale-target", async () => {
  const drifted: readonly CandidateSourceReference[] = [
    {
      candidateId: candidateB,
      sourceId: primaryId,
      pageUrl,
      kind: "retail",
      isPrimary: true,
    },
    {
      candidateId: candidateA,
      sourceId: secondaryId,
      pageUrl,
      kind: "retail",
      isPrimary: true,
    },
  ];

  for (const referenceOverride of drifted) {
    const store = primaryTargetStore({ referenceOverride });
    const before = store.snapshot();

    expectError(await refresh(store), "stale-target");

    assert.deepEqual(store.calls, ["getSourceReference"]);
    assert.equal(store.snapshot(), before);
  }
});

test("再読込の not-found は no-match として提示する", async () => {
  const store = primaryTargetStore({
    referenceFailure: { kind: "not-found", entity: "source" },
  });
  const before = store.snapshot();

  expectError(await refresh(store), "no-match");

  assert.deepEqual(store.calls, ["getSourceReference"]);
  assert.equal(store.snapshot(), before);
});

test("catalogから対象sourceを取得できない場合はpatchせず no-match", async () => {
  for (const target of [
    { candidateId: candidateA, sourceId: sourceId("8") },
    {
      candidateId: "30000000-0000-4000-8000-00000000000f" as CandidatePartId,
      sourceId: primaryId,
    },
  ]) {
    const store = primaryTargetStore();
    const before = store.snapshot();

    expectError(await refresh(store, { target }), "no-match");

    assert.deepEqual(store.calls, ["getSourceReference"]);
    assert.equal(store.snapshot(), before);
  }
});

test("受理できないobserved URLは再読込もmutationもせず invalid-url", async () => {
  for (const observedPageUrl of [
    "ftp://shop.example.invalid/p/1",
    "chrome://extensions",
    "not a url",
    "",
  ]) {
    const store = primaryTargetStore();
    const before = store.snapshot();

    expectError(await refresh(store, { observedPageUrl }), "invalid-url");

    assert.deepEqual(store.calls, [], observedPageUrl);
    assert.equal(store.snapshot(), before);
  }
});

test("追跡queryや末尾slashだけが異なるobserved URLは同一sourceとして更新する", async () => {
  const store = primaryTargetStore();

  const receipt = expectReceipt(
    await refresh(store, {
      observedPageUrl:
        "https://SHOP.example.invalid:443/p/1/?utm_source=mail#top",
    }),
  );

  assert.equal(receipt.sourceId, primaryId);
  assert.deepEqual(store.representativePrice(candidateA), newPrice);
});

test("再読込のmanagement errorを安定mappingし保存状態を変更しない", async () => {
  const failures: readonly ManagementError[] = [
    { kind: "validation", fields: { "source.price": "invalid" } },
    { kind: "conflict" },
    { kind: "maintenance" },
    { kind: "quota" },
    { kind: "storage" },
    { kind: "unsupported-data" },
  ];

  for (const referenceFailure of failures) {
    const store = primaryTargetStore({ referenceFailure });
    const before = store.snapshot();

    const result = await refresh(store);

    assert.deepEqual(result, { ok: false, error: referenceFailure });
    assert.deepEqual(store.calls, ["getSourceReference"]);
    assert.equal(store.snapshot(), before);
  }
});

test("mutationのmanagement errorを安定mappingし部分更新を残さない", async () => {
  const failures: readonly ManagementError[] = [
    { kind: "validation", fields: { "source.price": "invalid" } },
    { kind: "conflict" },
    { kind: "maintenance" },
    { kind: "quota" },
    { kind: "storage" },
    { kind: "unsupported-data" },
  ];

  for (const mutationFailure of failures) {
    const store = primaryTargetStore({ mutationFailure });
    const before = store.snapshot();

    const result = await refresh(store);

    assert.deepEqual(result, { ok: false, error: mutationFailure });
    assert.equal(store.snapshot(), before);
    assert.deepEqual(store.representativePrice(candidateA), oldPrice);
  }
});

test("mutationの not-found は no-match として提示し保存状態を変更しない", async () => {
  const store = primaryTargetStore({
    mutationFailure: { kind: "not-found", entity: "source" },
  });
  const before = store.snapshot();

  expectError(await refresh(store), "no-match");

  assert.equal(store.snapshot(), before);
});

test("条件付きpatchの precondition-failed は stale-target として提示する", async () => {
  const store = primaryTargetStore({
    mutationFailure: { kind: "precondition-failed" },
  });
  const before = store.snapshot();

  expectError(await refresh(store), "stale-target");

  assert.equal(store.snapshot(), before);
  assert.deepEqual(store.calls, ["getSourceReference", "patchSourcePrice"]);
});

test("matchSource は catalog scope と candidate scope の一意照合を公開する", async () => {
  const store = primaryTargetStore();
  const service = createSourcePriceRefreshService({
    catalog: store.catalog,
    mutations: store.mutations,
  });

  const matched = await service.matchSource({
    scope: { kind: "catalog" },
    pageUrl,
  });
  assert.deepEqual(matched, {
    ok: true,
    value: {
      candidateId: candidateA,
      sourceId: primaryId,
      normalizedPageUrl: pageUrl,
      isPrimary: true,
    },
  });

  expectError(
    await service.matchSource({
      scope: { kind: "candidate", candidateId: candidateB },
      pageUrl,
    }),
    "no-match",
  );
  assert.equal(store.updateInputs.length, 0);
});

test("matchSource で特定した対象をそのまま refreshCapturedPrice へ渡して更新できる", async () => {
  const store = primaryTargetStore();
  const service = createSourcePriceRefreshService({
    catalog: store.catalog,
    mutations: store.mutations,
  });

  const matched = await service.matchSource({
    scope: { kind: "catalog" },
    pageUrl,
  });
  assert.equal(matched.ok, true);
  if (!matched.ok) return;

  const receipt = expectReceipt(
    await service.refreshCapturedPrice({
      target: matched.value,
      observedPageUrl: pageUrl,
      capturedAt: newCapturedAt,
      price: newPrice,
    }),
  );

  assert.equal(receipt.isPrimary, true);
  assert.deepEqual(store.representativePrice(candidateA), newPrice);
});
