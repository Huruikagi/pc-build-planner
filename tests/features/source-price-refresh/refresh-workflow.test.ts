import assert from "node:assert/strict";
import test from "node:test";
import type {
  ActivationId,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import {
  type AppDataError,
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
  CandidateSourceMutationPort,
  CandidateSourceReference,
  PatchCandidateSourcePriceInput,
} from "../../../src/features/candidate-management/public.js";
import type {
  PagePriceExtractionError,
  PagePriceExtractionPort,
  PagePriceObservation,
} from "../../../src/features/product-capture/public.js";
import type {
  MatchedCandidateSource,
  MatchStoredSourceInput,
  NormalizedSourcePageUrl,
  RefreshCapturedPriceInput,
  SourcePriceRefreshError,
  SourcePriceRefreshPort,
  SourcePriceRefreshReceipt,
} from "../../../src/features/source-price-refresh/contracts.js";
import {
  createSourcePriceRefreshService,
  createSourcePriceRefreshWorkflow,
} from "../../../src/features/source-price-refresh/service.js";
import { createSourcePriceRefreshState } from "../../../src/features/source-price-refresh/state.js";

const candidateA = "30000000-0000-4000-8000-00000000000a" as CandidatePartId;
const primaryId = "40000000-0000-4000-8000-000000000001" as CandidateSourceId;

const pageUrl = "https://shop.example.invalid/p/1";
const oldCapturedAt = "2026-01-01T00:00:00.000Z" as UtcTimestamp;
const newCapturedAt = "2026-02-02T02:02:02.000Z" as UtcTimestamp;

const money = (amount: number): SourcedValue<MoneyValue> => ({
  original: `${amount}JPY`,
  confirmed: { amount, currency: "JPY" },
});

const oldPrice = money(19800);
const newPrice = money(17800);

const activationOf = (suffix: string): ActivationId =>
  `activation-${suffix}` as ActivationId;

const tabOf = (value: number): TargetTabId => value as TargetTabId;

const targetTab = tabOf(7);

type ExtractionResult = Result<PagePriceObservation, PagePriceExtractionError>;

type RefreshResult = Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

/** Hand-resolved port so interleaving is ordered by the test, not by timers. */
const createDeferred = <T>(): Deferred<T> => {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolveWith) => {
    settle = resolveWith;
  });
  if (settle === undefined) throw new TypeError("deferred not initialised");
  const resolve = settle;
  return { promise, resolve };
};

interface ExtractionStub {
  readonly port: PagePriceExtractionPort;
  /** Every tab id handed to the upstream extraction port, in order. */
  readonly tabs: readonly TargetTabId[];
  settle(result: ExtractionResult): void;
}

const createExtractionStub = (): ExtractionStub => {
  const tabs: TargetTabId[] = [];
  let deferred: Deferred<ExtractionResult> | null = null;
  return {
    tabs,
    port: {
      extractPrice(tabId): Promise<ExtractionResult> {
        tabs.push(tabId);
        const next = createDeferred<ExtractionResult>();
        deferred = next;
        return next.promise;
      },
    },
    settle(result) {
      if (deferred === null)
        throw new TypeError("extractPrice was never called");
      deferred.resolve(result);
    },
  };
};

const observation = (
  overrides: {
    readonly pageUrl?: string;
    readonly capturedAt?: UtcTimestamp;
    readonly price?: SourcedValue<MoneyValue> | undefined;
  } = {},
): PagePriceObservation => {
  const price = "price" in overrides ? overrides.price : newPrice;
  const base = {
    pageUrl: overrides.pageUrl ?? pageUrl,
    capturedAt: overrides.capturedAt ?? newCapturedAt,
  };
  return price === undefined ? base : { ...base, price };
};

interface StoredCandidate {
  readonly id: CandidatePartId;
  sources: CandidateSource[];
  primarySourceId: CandidateSourceId;
}

interface FakeStoreOptions {
  readonly mutationFailure?: AppDataError;
  /**
   * Makes `patchSourcePrice` violate its `Result` contract by throwing, after the
   * call has been recorded. Lets a test observe both the containment and the
   * absence of any compensating second write.
   */
  readonly mutationThrows?: boolean;
  /** Runs after a mutation is applied, so a generation can flip mid-commit. */
  readonly onUpdate?: () => void;
}

interface FakeStore {
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
  readonly updateInputs: readonly PatchCandidateSourcePriceInput[];
  snapshot(): string;
  representativePrice(): SourcedValue<MoneyValue> | undefined;
}

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

/**
 * Mirrors the upstream aggregate's latest-entry merge semantics: only price and
 * capturedAt are replaced, while concurrent metadata remains on the current
 * source. Representative price is derived from `primarySourceId` only.
 */
const createFakeStore = (options: FakeStoreOptions = {}): FakeStore => {
  const candidate: StoredCandidate = {
    id: candidateA,
    primarySourceId: primaryId,
    sources: [storedSource({ id: primaryId })],
  };
  const updateInputs: PatchCandidateSourcePriceInput[] = [];

  const reference = (source: CandidateSource): CandidateSourceReference => ({
    candidateId: candidate.id,
    sourceId: source.id,
    ...(source.pageUrl === undefined ? {} : { pageUrl: source.pageUrl }),
    ...(source.kind === undefined ? {} : { kind: source.kind }),
    isPrimary: candidate.primarySourceId === source.id,
  });

  const catalog: CandidateSourceCatalogPort = {
    async listSourceReferences(
      input,
    ): Promise<Result<readonly CandidateSourceReference[], AppDataError>> {
      if (input.candidateId !== undefined && input.candidateId !== candidate.id)
        return ok([]);
      return ok(candidate.sources.map(reference));
    },
    async getSourceReference(
      input,
    ): Promise<Result<CandidateSourceReference, AppDataError>> {
      if (input.candidateId !== candidate.id)
        return err({
          code: "validation",
          reason: "entity-not-found",
          message: "candidate",
        });
      const source = candidate.sources.find(
        (item) => item.id === input.sourceId,
      );
      return source === undefined
        ? err({
            code: "validation" as const,
            reason: "entity-not-found" as const,
            message: "source",
          })
        : ok(reference(source));
    },
  };

  const unsupported = async (): Promise<Result<void, AppDataError>> =>
    err({ code: "unsupported-version" });

  const mutations: CandidateSourceMutationPort = {
    addSource: unsupported,
    removeSource: unsupported,
    setPrimarySource: unsupported,
    async patchSourcePrice(input): Promise<Result<void, AppDataError>> {
      updateInputs.push(input);
      if (options.mutationThrows === true)
        throw new Error("mutation port contract violated");
      if (options.mutationFailure !== undefined)
        return err(options.mutationFailure);
      const index = candidate.sources.findIndex(
        (item) => item.id === input.sourceId,
      );
      if (index < 0)
        return err({
          code: "validation" as const,
          reason: "entity-not-found" as const,
          message: "source",
        });
      candidate.sources = candidate.sources.map((current, currentIndex) =>
        currentIndex === index
          ? { ...current, price: input.price, capturedAt: input.capturedAt }
          : current,
      );
      options.onUpdate?.();
      return ok(undefined);
    },
    updateSource: unsupported,
  };

  return {
    catalog,
    mutations,
    updateInputs,
    snapshot: () => JSON.stringify(candidate),
    representativePrice: () =>
      candidate.sources.find(
        (source) => source.id === candidate.primarySourceId,
      )?.price,
  };
};

interface Harness {
  readonly store: FakeStore;
  readonly extraction: ExtractionStub;
  readonly runRefresh: (input: {
    readonly activationId: ActivationId;
    readonly tabId: TargetTabId;
  }) => Promise<RefreshResult>;
  readonly isCurrent: (activationId: ActivationId) => boolean;
  expire(): void;
}

const createHarness = (options: FakeStoreOptions = {}): Harness => {
  const store = createFakeStore(options);
  const extraction = createExtractionStub();
  let current: ActivationId | null = activationOf("a");
  const isCurrent = (activationId: ActivationId): boolean =>
    activationId === current;
  const runRefresh = createSourcePriceRefreshWorkflow({
    refresh: createSourcePriceRefreshService({
      catalog: store.catalog,
      mutations: store.mutations,
    }),
    pagePriceExtraction: extraction.port,
    isCurrent,
  });
  return {
    store,
    extraction,
    runRefresh,
    isCurrent,
    expire: () => {
      current = null;
    },
  };
};

const expectError = (
  result: RefreshResult,
  kind: SourcePriceRefreshError["kind"],
): void => {
  assert.equal(result.ok, false, `失敗を期待したが成功した: ${kind}`);
  if (result.ok) return;
  assert.equal(result.error.kind, kind);
};

test("現行でないactivationは抽出portを一度も呼ばずstale-activationで終わる", async () => {
  const harness = createHarness();
  harness.expire();
  const before = harness.store.snapshot();

  const result = await harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });

  expectError(result, "stale-activation");
  assert.deepEqual(harness.extraction.tabs, [], "抽出を開始しない");
  assert.deepEqual(harness.store.updateInputs, []);
  assert.equal(harness.store.snapshot(), before);
});

test("現行activationだけが固定tab IDを上流抽出portへ渡す", async () => {
  const harness = createHarness();
  const settled = harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  harness.extraction.settle(ok(observation()));
  await settled;

  assert.deepEqual(harness.extraction.tabs, [targetTab]);
});

test("page由来URL・capturedAt・price provenanceを照合と原子的更新へ引き渡す", async () => {
  const harness = createHarness();
  const settled = harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  harness.extraction.settle(ok(observation()));
  const result = await settled;

  assert.deepEqual(result, {
    ok: true,
    value: {
      candidateId: candidateA,
      sourceId: primaryId,
      price: newPrice,
      capturedAt: newCapturedAt,
      isPrimary: true,
    },
  });
  assert.deepEqual(harness.store.updateInputs, [
    {
      candidateId: candidateA,
      sourceId: primaryId,
      expectedPageUrl: pageUrl,
      expectedKind: "retail",
      capturedAt: newCapturedAt,
      price: newPrice,
    },
  ]);
  assert.deepEqual(harness.store.representativePrice(), newPrice);
});

test("抽出URLが保存済みsourceと追跡query差だけ異なっても同一sourceを更新する", async () => {
  const harness = createHarness();
  const settled = harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  harness.extraction.settle(
    ok(
      observation({
        pageUrl: "https://SHOP.example.invalid:443/p/1/?utm_source=mail#top",
      }),
    ),
  );
  const result = await settled;

  assert.equal(result.ok, true);
  assert.deepEqual(harness.store.representativePrice(), newPrice);
});

test("抽出完了後に世代が変わると照合も更新も行わずstale-activationにする", async () => {
  const harness = createHarness();
  const before = harness.store.snapshot();
  const settled = harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  harness.expire();
  harness.extraction.settle(ok(observation()));
  const result = await settled;

  expectError(result, "stale-activation");
  assert.deepEqual(
    harness.store.updateInputs,
    [],
    "旧世代の抽出結果でmutationを呼ばない",
  );
  assert.equal(harness.store.snapshot(), before);
});

test("抽出完了後に世代が変わると抽出失敗も現行世代の失敗として提示しない", async () => {
  const harness = createHarness();
  const settled = harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  harness.expire();
  harness.extraction.settle(err({ kind: "injection-failed" }));

  expectError(await settled, "stale-activation");
});

test("mutation完了後に世代が変わってもcommitを巻き戻さず表示だけ抑止する", async () => {
  let harness: Harness | undefined;
  const created = createHarness({
    onUpdate: () => {
      harness?.expire();
    },
  });
  harness = created;

  const settled = created.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  created.extraction.settle(ok(observation()));
  const result = await settled;

  expectError(result, "stale-activation");
  assert.equal(
    created.store.updateInputs.length,
    1,
    "巻き戻しのための追加mutationを発行しない",
  );
  assert.deepEqual(
    created.store.representativePrice(),
    newPrice,
    "commit済みの有効な更新は巻き戻さない",
  );
});

const extractionFailures: readonly PagePriceExtractionError[] = [
  { kind: "permission-lost" },
  { kind: "restricted-page" },
  { kind: "tab-changed" },
  { kind: "injection-failed" },
  { kind: "invalid-payload" },
  { kind: "tab-unavailable" },
];

test("抽出失敗は永続化なしのtyped failureとしてそのまま提示する", async () => {
  for (const failure of extractionFailures) {
    const harness = createHarness();
    const before = harness.store.snapshot();
    const settled = harness.runRefresh({
      activationId: activationOf("a"),
      tabId: targetTab,
    });
    harness.extraction.settle(err(failure));
    const result = await settled;

    assert.deepEqual(result, { ok: false, error: failure }, failure.kind);
    assert.deepEqual(harness.store.updateInputs, [], failure.kind);
    assert.equal(harness.store.snapshot(), before, failure.kind);
  }
});

test("価格を取得できない観測は永続化せず price-unavailable にする", async () => {
  const harness = createHarness();
  const before = harness.store.snapshot();
  const settled = harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  harness.extraction.settle(ok(observation({ price: undefined })));
  const result = await settled;

  expectError(result, "price-unavailable");
  assert.deepEqual(harness.store.updateInputs, []);
  assert.equal(
    harness.store.snapshot(),
    before,
    "既存priceとcapturedAtを維持する",
  );
});

test("照合と更新の失敗をtyped failureのまま伝え保存状態を変えない", async () => {
  const harness = createHarness({
    mutationFailure: { code: "maintenance-active" },
  });
  const before = harness.store.snapshot();
  const settled = harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  harness.extraction.settle(ok(observation()));

  expectError(await settled, "maintenance");
  assert.equal(harness.store.snapshot(), before);
});

test("保存済みsourceに一致しない抽出URLは no-match にしsourceを追加しない", async () => {
  const harness = createHarness();
  const before = harness.store.snapshot();
  const settled = harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  harness.extraction.settle(
    ok(observation({ pageUrl: "https://other.example.invalid/p/1" })),
  );

  expectError(await settled, "no-match");
  assert.deepEqual(harness.store.updateInputs, []);
  assert.equal(harness.store.snapshot(), before);
});

test("上流portが型付き失敗を返す全経路でrejectせずResultとしてsettleする", async () => {
  const settlements: RefreshResult[] = [];
  for (const failure of extractionFailures) {
    const harness = createHarness();
    const settled = harness.runRefresh({
      activationId: activationOf("a"),
      tabId: targetTab,
    });
    harness.extraction.settle(err(failure));
    await assert.doesNotReject(async () => {
      settlements.push(await settled);
    });
  }

  const stale = createHarness();
  stale.expire();
  await assert.doesNotReject(async () => {
    settlements.push(
      await stale.runRefresh({
        activationId: activationOf("a"),
        tabId: targetTab,
      }),
    );
  });

  const storageFailure = createHarness({
    mutationFailure: { code: "quota-exceeded" },
  });
  const storageSettled = storageFailure.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  storageFailure.extraction.settle(ok(observation()));
  await assert.doesNotReject(async () => {
    settlements.push(await storageSettled);
  });

  assert.equal(settlements.length, extractionFailures.length + 2);
  for (const settlement of settlements) assert.equal(settlement.ok, false);
});

test("抽出・照合・更新の順序と回数がdesignのcommand順に一致する", async () => {
  const calls: string[] = [];
  const store = createFakeStore();
  const extraction = createExtractionStub();
  const service = createSourcePriceRefreshService({
    catalog: store.catalog,
    mutations: store.mutations,
  });
  const traced: SourcePriceRefreshPort = {
    matchSource(input: MatchStoredSourceInput) {
      calls.push(`matchSource:${input.scope.kind}:${input.pageUrl}`);
      return service.matchSource(input);
    },
    refreshCapturedPrice(input: RefreshCapturedPriceInput) {
      calls.push(
        `refreshCapturedPrice:${input.observedPageUrl}:${input.capturedAt}`,
      );
      return service.refreshCapturedPrice(input);
    },
  };
  const runRefresh = createSourcePriceRefreshWorkflow({
    refresh: traced,
    pagePriceExtraction: {
      extractPrice(tabId) {
        calls.push(`extractPrice:${String(tabId)}`);
        return extraction.port.extractPrice(tabId);
      },
    },
    isCurrent: () => true,
  });

  const settled = runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  extraction.settle(ok(observation()));
  assert.equal((await settled).ok, true);

  assert.deepEqual(calls, [
    "extractPrice:7",
    `matchSource:catalog:${pageUrl}`,
    `refreshCapturedPrice:${pageUrl}:${newCapturedAt}`,
  ]);
});

test("一回のactivationだけで抽出から成功表示まで進み別の実行操作を要求しない", async () => {
  const harness = createHarness();
  const state = createSourcePriceRefreshState({
    runRefresh: harness.runRefresh,
    isCurrent: harness.isCurrent,
  });
  const activationId = activationOf("a");

  const settled = state.activate(activationId, targetTab);
  assert.deepEqual(state.value, {
    status: "running",
    activationId,
    tabId: targetTab,
  });

  harness.extraction.settle(ok(observation()));
  await settled;

  assert.deepEqual(state.value, {
    status: "succeeded",
    activationId,
    receipt: {
      candidateId: candidateA,
      sourceId: primaryId,
      price: newPrice,
      capturedAt: newCapturedAt,
      isPrimary: true,
    },
  });
});

test("一回のactivationだけで抽出失敗から失敗表示まで進む", async () => {
  const harness = createHarness();
  const state = createSourcePriceRefreshState({
    runRefresh: harness.runRefresh,
    isCurrent: harness.isCurrent,
  });
  const activationId = activationOf("a");

  const settled = state.activate(activationId, targetTab);
  harness.extraction.settle(err({ kind: "permission-lost" }));
  await settled;

  assert.deepEqual(state.value, {
    status: "failed",
    activationId,
    error: { kind: "permission-lost" },
    recoverable: true,
  });
  assert.deepEqual(harness.store.updateInputs, []);
});

const matchedTarget: MatchedCandidateSource = {
  candidateId: candidateA,
  sourceId: primaryId,
  normalizedPageUrl: pageUrl as NormalizedSourcePageUrl,
  isPrimary: true,
};

/** Keeps its `Result` contract, so only the deliberately throwing half is under test. */
const compliantRefresh: SourcePriceRefreshPort = {
  matchSource: async () => ok(matchedTarget),
  refreshCapturedPrice: async () =>
    ok({
      candidateId: candidateA,
      sourceId: primaryId,
      price: newPrice,
      capturedAt: newCapturedAt,
      isPrimary: true,
    }),
};

const compliantExtraction: PagePriceExtractionPort = {
  extractPrice: async () => ok(observation()),
};

test("抽出portが契約に反して例外を投げてもrejectせずunexpectedでsettleする", async () => {
  const runRefresh = createSourcePriceRefreshWorkflow({
    refresh: compliantRefresh,
    pagePriceExtraction: {
      extractPrice(): Promise<ExtractionResult> {
        throw new Error("extraction port contract violated");
      },
    },
    isCurrent: () => true,
  });

  let result: RefreshResult | undefined;
  await assert.doesNotReject(async () => {
    result = await runRefresh({
      activationId: activationOf("a"),
      tabId: targetTab,
    });
  });

  assert.deepEqual(result, { ok: false, error: { kind: "unexpected" } });
});

test("照合portが契約に反して例外を投げてもrejectせずunexpectedでsettleする", async () => {
  const runRefresh = createSourcePriceRefreshWorkflow({
    refresh: {
      ...compliantRefresh,
      matchSource: () =>
        Promise.reject(new Error("match port contract violated")),
    },
    pagePriceExtraction: compliantExtraction,
    isCurrent: () => true,
  });

  let result: RefreshResult | undefined;
  await assert.doesNotReject(async () => {
    result = await runRefresh({
      activationId: activationOf("a"),
      tabId: targetTab,
    });
  });

  assert.deepEqual(result, { ok: false, error: { kind: "unexpected" } });
});

test("更新portが契約に反して例外を投げてもrejectせずunexpectedでsettleする", async () => {
  const runRefresh = createSourcePriceRefreshWorkflow({
    refresh: {
      ...compliantRefresh,
      refreshCapturedPrice(): Promise<RefreshResult> {
        throw new Error("refresh port contract violated");
      },
    },
    pagePriceExtraction: compliantExtraction,
    isCurrent: () => true,
  });

  let result: RefreshResult | undefined;
  await assert.doesNotReject(async () => {
    result = await runRefresh({
      activationId: activationOf("a"),
      tabId: targetTab,
    });
  });

  assert.deepEqual(result, { ok: false, error: { kind: "unexpected" } });
});

test("mutation経路の例外は補償書き込みを一切発行しない", async () => {
  const harness = createHarness({ mutationThrows: true });
  const settled = harness.runRefresh({
    activationId: activationOf("a"),
    tabId: targetTab,
  });
  harness.extraction.settle(ok(observation()));

  let result: RefreshResult | undefined;
  await assert.doesNotReject(async () => {
    result = await settled;
  });

  assert.deepEqual(result, { ok: false, error: { kind: "unexpected" } });
  assert.equal(
    harness.store.updateInputs.length,
    1,
    "巻き戻しのための追加mutationを発行しない",
  );
});

test("上流portの例外でもstateはrunningに留まらずrecoverable:falseのfailedへ到達する", async () => {
  const harness = createHarness({ mutationThrows: true });
  const state = createSourcePriceRefreshState({
    runRefresh: harness.runRefresh,
    isCurrent: harness.isCurrent,
  });
  const activationId = activationOf("a");

  const settled = state.activate(activationId, targetTab);
  harness.extraction.settle(ok(observation()));
  await settled;

  assert.deepEqual(
    state.value,
    {
      status: "failed",
      activationId,
      error: { kind: "unexpected" },
      recoverable: false,
    },
    "理由も回復案内もないspinnerのまま固まらない",
  );
});

test("旧世代の抽出完了はstateの表示も保存状態も変更しない", async () => {
  const harness = createHarness();
  const state = createSourcePriceRefreshState({
    runRefresh: harness.runRefresh,
    isCurrent: harness.isCurrent,
  });
  const activationId = activationOf("a");
  const before = harness.store.snapshot();

  const settled = state.activate(activationId, targetTab);
  harness.expire();
  harness.extraction.settle(ok(observation()));
  await settled;

  assert.deepEqual(
    state.value,
    { status: "running", activationId, tabId: targetTab },
    "旧世代の完了は表示を変更しない",
  );
  assert.equal(harness.store.snapshot(), before);
});
