import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { FeatureCompositionContext } from "../../src/application-shell/public.js";
import type {
  CandidatePart,
  CandidatePartId,
  CandidateSource,
  CandidateSourceId,
  CurrentBuildId,
  LocalDataRoot,
  MoneyValue,
  ProjectId,
  RequestId,
  Revision,
  SourcedValue,
  UtcTimestamp,
} from "../../src/domain/public.js";
import { ok, schemaValidator } from "../../src/domain/public.js";
import {
  createCandidateManagementContribution,
  createCandidateSourceDataPort,
} from "../../src/features/candidate-management/feature-contribution.js";
import type { CandidateSourceMutationPort } from "../../src/features/candidate-management/public.js";
import { createCompatibilityContribution } from "../../src/features/compatibility/feature-contribution.js";
import { createCurrentBuildContribution } from "../../src/features/current-build/feature-contribution.js";
import type { PagePriceExtractionPort } from "../../src/features/product-capture/public.js";
import { createSourcePriceRefreshContribution } from "../../src/features/source-price-refresh/feature-contribution.js";
import { createSourcePriceRefreshUpstreamPorts } from "../../src/features/source-price-refresh/public.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../src/persistence/mutation-pipeline.js";
import { referenceRepairPolicy } from "../../src/persistence/reference-repair-policy.js";
import { createReplacementCoordinator } from "../../src/persistence/replacement.js";
import { createLocalDataRepository } from "../../src/persistence/repository.js";
import { createRootTransactionRunner } from "../../src/persistence/root-transaction-runner.js";
import {
  createInMemoryRootWriteLock,
  createInMemoryRootWriteLockState,
} from "../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../src/persistence/schema.js";
import {
  createScopedDataPort,
  createWriteAuthority,
} from "../../src/persistence/write-authority.js";
import {
  type CandidateSourceIntegrationProbe,
  type CandidateSourceIntegrationSubject,
  collectCandidateSourcePortContractViolations,
  type StoredSourceTarget,
} from "./candidate-source-port-contract-kit.js";

const storedAt = "2026-07-30T00:00:00.000Z" as UtcTimestamp;
const refreshedAt = "2026-08-01T09:00:00.000Z" as UtcTimestamp;

const projectId = "10000000-0000-4000-8000-000000000010" as ProjectId;
const cpuId = "20000000-0000-4000-8000-000000000010" as CandidatePartId;
const motherboardId = "20000000-0000-4000-8000-000000000020" as CandidatePartId;
const buildId = "40000000-0000-4000-8000-000000000010" as CurrentBuildId;
const shopSourceId =
  "30000000-0000-4000-8000-000000000011" as CandidateSourceId;
const mallSourceId =
  "30000000-0000-4000-8000-000000000012" as CandidateSourceId;
const foreignSourceId =
  "30000000-0000-4000-8000-000000000021" as CandidateSourceId;

const shopUrl = "https://parts.synthetic-shop.example.invalid/cpu/sy-1";
const mallUrl = "https://parts.synthetic-mall.example.invalid/item?id=sy-1";
const foreignUrl =
  "https://parts.synthetic-shop.example.invalid/motherboard/sy-9";
const unmatchedPageUrl =
  "https://parts.synthetic-shop.example.invalid/cpu/sy-2";

const money = (amount: number, label: string): SourcedValue<MoneyValue> => ({
  original: label,
  confirmed: { amount, currency: "SYN" },
});

const refreshedPrice = money(11_900, "架空価格 11,900 SYN");

/** The primary retail source: refreshing it must move the representative price. */
const primary: StoredSourceTarget = {
  candidateId: cpuId,
  sourceId: shopSourceId,
  pageUrl: shopUrl,
  // The same page revisited from a tracked link, with a fragment.
  observedPageUrl: `${shopUrl}?utm_source=synthetic-mail#spec`,
};

/** A second retail source on the same candidate that is not the primary one. */
const nonPrimary: StoredSourceTarget = {
  candidateId: cpuId,
  sourceId: mallSourceId,
  pageUrl: mallUrl,
  observedPageUrl: `${mallUrl}&gclid=synthetic-click`,
};

/** A source on another candidate; only the whole-catalog scope may see it. */
const foreign: StoredSourceTarget = {
  candidateId: motherboardId,
  sourceId: foreignSourceId,
  pageUrl: foreignUrl,
  observedPageUrl: foreignUrl,
};

const source = (
  id: CandidateSourceId,
  pageUrl: string,
  siteName: string,
  price: SourcedValue<MoneyValue>,
): CandidateSource => ({
  id,
  pageUrl,
  siteName,
  capturedAt: storedAt,
  price,
  kind: "retail",
});

/**
 * Two adopted candidates whose confirmed normalized attributes drive a real
 * compatibility rule, so "compatibility input does not regress" is observed
 * through the actual verdict rather than asserted about a projection.
 */
const initialRoot = (): LocalDataRoot =>
  ({
    ...createInitialRoot(),
    projects: [
      {
        id: projectId,
        name: "架空PC構成",
        createdAt: storedAt,
        updatedAt: storedAt,
      },
    ],
    candidateParts: [
      {
        id: cpuId,
        projectId,
        category: "cpu",
        product: {
          name: { original: "架空CPU SY-1" },
          manufacturer: { original: "SYN 架空メーカー" },
          modelNumber: { original: "SY-1" },
        },
        normalizedAttributes: {
          category: "cpu",
          socket: { original: "架空ソケットSK1", confirmed: "架空ソケットSK1" },
        },
        sources: [
          source(
            shopSourceId,
            shopUrl,
            "架空パーツ店",
            money(12_300, "架空価格 12,300 SYN"),
          ),
          source(
            mallSourceId,
            mallUrl,
            "架空モール",
            money(12_800, "架空価格 12,800 SYN"),
          ),
        ],
        primarySourceId: shopSourceId,
        createdAt: storedAt,
        updatedAt: storedAt,
      },
      {
        id: motherboardId,
        projectId,
        category: "motherboard",
        product: { name: { original: "架空マザーボード SY-9" } },
        normalizedAttributes: {
          category: "motherboard",
          socket: { original: "架空ソケットSK1", confirmed: "架空ソケットSK1" },
        },
        sources: [
          source(
            foreignSourceId,
            foreignUrl,
            "架空パーツ店",
            money(24_500, "架空価格 24,500 SYN"),
          ),
        ],
        primarySourceId: foreignSourceId,
        createdAt: storedAt,
        updatedAt: storedAt,
      },
    ],
    currentBuilds: [
      {
        id: buildId,
        projectId,
        items: [
          { candidatePartId: cpuId, quantity: 1 as never },
          { candidatePartId: motherboardId, quantity: 1 as never },
        ],
        updatedAt: storedAt,
      },
    ],
  }) as LocalDataRoot;

/** Page extraction is task 4.1's seam; this suite never drives it. */
const idlePagePriceExtraction: PagePriceExtractionPort = {
  async extractPrice() {
    return { ok: false, error: { kind: "tab-unavailable" } };
  },
};

const idleTransientSurface = {
  isCurrent: () => true,
  dismiss: async () => ok(undefined),
  conclude: async () => ok(undefined),
};

export interface HarnessOptions {
  readonly failNextWrite?: boolean;
  readonly decorate?: (
    mutations: CandidateSourceMutationPort,
  ) => CandidateSourceMutationPort;
}

/**
 * Assembles the production candidate-management stack over the real foundation
 * — repository, transaction runner, mutation pipeline, write authority — and
 * wires source-price-refresh to it through the composition factory, so the
 * catalog, the mutation facet and `query.getCandidateDraft` are the ones
 * production injects rather than hand-written stand-ins.
 */
const createProbe = async (
  options: HarnessOptions = {},
): Promise<CandidateSourceIntegrationProbe> => {
  const state = createInMemoryStorageState({ quotaBytes: 1_000_000 });
  const adapter = createInMemoryStorageAdapter(state);
  await adapter.writeRoot(initialRoot());
  let commits = 0;
  const storage = {
    readRoot: () => adapter.readRoot(),
    readRecoveryControl: () => adapter.readRecoveryControl(),
    writeRecoveryControl: (control: unknown) =>
      adapter.writeRecoveryControl(control),
    bytesInUse: () => adapter.bytesInUse(),
    quotaBytes: () => adapter.quotaBytes(),
    restrictToTrustedContexts: () => adapter.restrictToTrustedContexts(),
    async writeRoot(root: LocalDataRoot) {
      const result = await adapter.writeRoot(root);
      if (result.ok) commits += 1;
      return result;
    },
  };
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const authority = createWriteAuthority({
    repository: createLocalDataRepository(storage as never, migrations),
    runner: createRootTransactionRunner({
      storage: storage as never,
      lock: createInMemoryRootWriteLock(createInMemoryRootWriteLockState()),
      migrations,
      validator: schemaValidator,
      maintenance: maintenancePolicy,
      replacement: createReplacementCoordinator(migrations, schemaValidator),
      now: () => refreshedAt,
      initialRoot: createInitialRoot,
    }),
    pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
  });
  const data = createScopedDataPort(authority);
  const baseSourceData = createCandidateSourceDataPort(data);
  let injectRevisionConflict = false;
  const sourceData = {
    ...baseSourceData,
    async query<T>(project: (snapshot: LocalDataRoot) => T) {
      const result = await baseSourceData.query(project);
      if (injectRevisionConflict) {
        injectRevisionConflict = false;
        const snapshot = await baseSourceData.query((root) => root);
        assert.equal(snapshot.ok, true);
        if (snapshot.ok) {
          const competitor = snapshot.value.candidateParts[1];
          assert.ok(competitor);
          const committed = await data.mutate({
            requestId: "90000000-0000-4000-8000-000000000001" as RequestId,
            expectedRevision: snapshot.value.revision as Revision,
            operation: {
              kind: "update",
              entity: "candidatePart",
              value: { ...competitor, updatedAt: refreshedAt },
            },
          });
          assert.equal(committed.ok, true);
        }
      }
      return result;
    },
  };
  const context = {
    data,
    navigator: {
      async activate() {
        return ok(undefined);
      },
    },
  } satisfies FeatureCompositionContext;

  const candidates = createCandidateManagementContribution(context, {
    sourceData,
  }).registration.publicApi;
  const build = createCurrentBuildContribution(context, {
    candidates: candidates.query,
  }).registration.publicApi;
  const compatibility = createCompatibilityContribution(context, {
    currentBuildQuery: build.query,
    candidateQuery: candidates.query,
  }).registration.publicApi;

  // The consumer boundary check runs over the very ports that are injected, so
  // a bypass that skipped the published entries could not reach the workflow.
  const upstream = createSourcePriceRefreshUpstreamPorts({
    catalog: candidates.sources.catalog,
    mutations: candidates.sources.mutations,
    pagePriceExtraction: idlePagePriceExtraction,
    gestures: { register: () => ok(() => {}) },
  });
  const mutations =
    options.decorate === undefined
      ? upstream.mutations
      : options.decorate(upstream.mutations);
  const refresh = createSourcePriceRefreshContribution({
    catalog: upstream.catalog,
    mutations,
    pagePriceExtraction: upstream.pagePriceExtraction,
    transientSurface: idleTransientSurface as never,
  }).registration.publicApi.refresh;

  if (options.failNextWrite === true) state.failNext("write");

  return {
    refresh,
    catalog: upstream.catalog,
    mutations: candidates.sources.mutations,
    armRevisionConflict: () => {
      injectRevisionConflict = true;
    },
    rootCommits: () => commits,
    async observe() {
      const read = await adapter.readRoot();
      assert.equal(read.ok, true);
      const root = read.value as LocalDataRoot;
      const summaries = await candidates.query.listCandidates({ projectId });
      assert.equal(summaries.ok, true);
      const report = await compatibility.query.evaluate(projectId);
      assert.equal(report.ok, true);
      return {
        revision: root.revision,
        candidates: structuredClone(root.candidateParts) as CandidatePart[],
        summaries: summaries.ok ? summaries.value : [],
        compatibility: report.ok ? report.value : report,
      };
    },
  };
};

const subjectWith = (
  options: HarnessOptions = {},
): CandidateSourceIntegrationSubject => ({
  primary,
  nonPrimary,
  foreign,
  unmatchedPageUrl,
  refreshedPrice,
  refreshedAt,
  probe: () => createProbe(options),
  probeWithFailingWrite: () => createProbe({ ...options, failNextWrite: true }),
});

test("価格更新は実candidate source catalog・mutation・queryと統合される", async () => {
  assert.deepEqual(
    await collectCandidateSourcePortContractViolations(subjectWith()),
    [],
  );
});

test("公開条件付き価格patchは後発siteNameを保持し、不一致ではcommitしない", async () => {
  const probe = await createProbe();
  const before = await probe.observe();
  const source = before.candidates
    .find(({ id }) => id === primary.candidateId)
    ?.sources.find(({ id }) => id === primary.sourceId);
  assert.ok(source?.pageUrl);
  const renamed = await probe.mutations.updateSource({
    candidateId: primary.candidateId,
    source: { ...source, siteName: "架空並行更新店" },
  });
  assert.equal(renamed.ok, true);
  const commitsBeforePatch = probe.rootCommits();
  const patched = await probe.mutations.patchSourcePrice({
    candidateId: primary.candidateId,
    sourceId: primary.sourceId,
    expectedPageUrl: source.pageUrl,
    expectedKind: "retail",
    price: refreshedPrice,
    capturedAt: refreshedAt,
  });
  assert.equal(patched.ok, true);
  assert.equal(probe.rootCommits(), commitsBeforePatch + 1);
  const stored = (await probe.observe()).candidates
    .find(({ id }) => id === primary.candidateId)
    ?.sources.find(({ id }) => id === primary.sourceId);
  assert.equal(stored?.siteName, "架空並行更新店");
  assert.deepEqual(stored?.price, refreshedPrice);

  for (const mismatch of [
    { expectedPageUrl: "https://changed.example.invalid/item" },
    { sourceId: "30000000-0000-4000-8000-000000000099" as CandidateSourceId },
  ]) {
    const commitsBeforeFailure = probe.rootCommits();
    const failed = await probe.mutations.patchSourcePrice({
      candidateId: primary.candidateId,
      sourceId: primary.sourceId,
      expectedPageUrl: source.pageUrl,
      expectedKind: "retail",
      price: refreshedPrice,
      capturedAt: refreshedAt,
      ...mismatch,
    });
    assert.deepEqual(failed, {
      ok: false,
      error: { kind: "precondition-failed" },
    });
    assert.equal(probe.rootCommits(), commitsBeforeFailure);
  }
});

test("実stackのkind変更・source削除はprecondition失敗となりupdateSource互換を維持する", async () => {
  const kindProbe = await createProbe();
  const original = (await kindProbe.observe()).candidates
    .find(({ id }) => id === primary.candidateId)
    ?.sources.find(({ id }) => id === primary.sourceId);
  assert.ok(original?.pageUrl);
  const changedKind = await kindProbe.mutations.updateSource({
    candidateId: primary.candidateId,
    source: { ...original, kind: "manufacturer" },
  });
  assert.equal(changedKind.ok, true);
  const commitsAfterCompatibleUpdate = kindProbe.rootCommits();
  const kindMismatch = await kindProbe.mutations.patchSourcePrice({
    candidateId: primary.candidateId,
    sourceId: primary.sourceId,
    expectedPageUrl: original.pageUrl,
    expectedKind: "retail",
    price: refreshedPrice,
    capturedAt: refreshedAt,
  });
  assert.deepEqual(kindMismatch, {
    ok: false,
    error: { kind: "precondition-failed" },
  });
  assert.equal(kindProbe.rootCommits(), commitsAfterCompatibleUpdate);

  const removedProbe = await createProbe();
  const removed = await removedProbe.mutations.removeSource({
    candidateId: primary.candidateId,
    sourceId: primary.sourceId,
    replacementPrimarySourceId: nonPrimary.sourceId,
  });
  assert.equal(removed.ok, true);
  const commitsAfterCompatibleRemove = removedProbe.rootCommits();
  const missingSource = await removedProbe.mutations.patchSourcePrice({
    candidateId: primary.candidateId,
    sourceId: primary.sourceId,
    expectedPageUrl: primary.pageUrl,
    expectedKind: "retail",
    price: refreshedPrice,
    capturedAt: refreshedAt,
  });
  assert.deepEqual(missingSource, {
    ok: false,
    error: { kind: "precondition-failed" },
  });
  assert.equal(removedProbe.rootCommits(), commitsAfterCompatibleRemove);
});

test("期待revision取得後の別root mutationは既存conflictでpatch commitを増やさない", async () => {
  const probe = await createProbe();
  probe.armRevisionConflict();
  const commitsBefore = probe.rootCommits();
  const result = await probe.mutations.patchSourcePrice({
    candidateId: primary.candidateId,
    sourceId: primary.sourceId,
    expectedPageUrl: primary.pageUrl,
    expectedKind: "retail",
    price: refreshedPrice,
    capturedAt: refreshedAt,
  });
  assert.deepEqual(result, { ok: false, error: { kind: "conflict" } });
  // The only increment is the deliberately injected competing mutation.
  assert.equal(probe.rootCommits(), commitsBefore + 1);
});

test("compatibility判定は架空fixtureで実際に成立している", async () => {
  const probe = await createProbe();

  const observation = await probe.observe();

  // Without a decided verdict the non-regression assertion would compare two
  // identical "unknown" reports and prove nothing.
  const report = observation.compatibility as {
    readonly results: readonly {
      readonly ruleId: string;
      readonly status: string;
    }[];
  };
  const socket = report.results.find(
    (result) => result.ruleId === "cpu-motherboard-socket",
  );
  assert.equal(socket?.status, "compatible");
});

type MutationDecorator = (
  mutations: CandidateSourceMutationPort,
) => CandidateSourceMutationPort;

/**
 * Behaviour mutations applied from the consumer side only — the upstream
 * feature is never edited. Each one breaks a single guarantee the task pins, so
 * an assertion that stopped observing the integration would show up here as an
 * empty violation list.
 */
const mutationBreakers: readonly [
  string,
  MutationDecorator,
  readonly string[],
][] = [
  [
    "更新が別のsourceにも及ぶ",
    (port) => ({
      ...port,
      async patchSourcePrice(input) {
        const first = await port.patchSourcePrice(input);
        if (!first.ok) return first;
        const other =
          input.sourceId === shopSourceId ? mallSourceId : shopSourceId;
        return port.patchSourcePrice({
          candidateId: input.candidateId,
          sourceId: other,
          expectedPageUrl: input.sourceId === shopSourceId ? mallUrl : shopUrl,
          expectedKind: "retail",
          price: input.price,
          capturedAt: input.capturedAt,
        });
      },
    }),
    [
      "refresh.nonPrimary.mutation: 一回のroot mutationで確定しない",
      "refresh.nonPrimary.mutation: root revisionが一度だけ進まない",
      "refresh.nonPrimary.stored: 対象外のsourceが変わった",
      "refresh.nonPrimary.summary: 非primary更新で代表価格が変わった",
      "refresh.nonPrimary.summary: 非primary更新でprimary sourceが変わった",
      "refresh.primary.mutation: 一回のroot mutationで確定しない",
      "refresh.primary.mutation: root revisionが一度だけ進まない",
      "refresh.primary.stored: 対象外のsourceが変わった",
    ],
  ],
  [
    "更新payloadからsiteNameを落とす",
    (port) => ({
      ...port,
      async patchSourcePrice(input) {
        const patched = await port.patchSourcePrice(input);
        if (!patched.ok) return patched;
        return port.updateSource({
          candidateId: input.candidateId,
          source: {
            id: input.sourceId,
            pageUrl: input.expectedPageUrl,
            capturedAt: input.capturedAt,
            price: input.price,
            kind: input.expectedKind,
          },
        });
      },
    }),
    [
      "refresh.nonPrimary.mutation: 一回のroot mutationで確定しない",
      "refresh.nonPrimary.mutation: root revisionが一度だけ進まない",
      "refresh.nonPrimary.stored: 対象sourceのURL・siteName・種別・IDが変わった",
      "refresh.primary.mutation: 一回のroot mutationで確定しない",
      "refresh.primary.mutation: root revisionが一度だけ進まない",
      "refresh.primary.stored: 対象sourceのURL・siteName・種別・IDが変わった",
      "refresh.primary.summary: primary source projectionのURL・siteNameを保持しない",
    ],
  ],
  [
    "保存失敗を報告しながら再書き込みでrevisionを進める",
    (port) => ({
      ...port,
      async patchSourcePrice(input) {
        const attempted = await port.patchSourcePrice(input);
        if (attempted.ok) return attempted;
        // A second, unrequested write lands while the failure is still the
        // reported outcome: exactly the partial update requirement 5.1 forbids.
        await port.patchSourcePrice(input);
        return attempted;
      },
    }),
    [
      "failure.write: 保存失敗後に部分更新をcommitした",
      "failure.write: 保存失敗後にroot revisionを含む保存状態が変わった",
    ],
  ],
  [
    "primary更新を非primary sourceへ書き換える",
    (port) => ({
      ...port,
      async patchSourcePrice(input) {
        if (input.sourceId !== shopSourceId)
          return port.patchSourcePrice(input);
        return port.patchSourcePrice({
          candidateId: input.candidateId,
          sourceId: mallSourceId,
          expectedPageUrl: mallUrl,
          expectedKind: "retail",
          price: input.price,
          capturedAt: input.capturedAt,
        });
      },
    }),
    [
      "refresh.primary.stored: 対象sourceへ新しい価格を反映しない",
      "refresh.primary.stored: 対象sourceへ取得日時を反映しない",
      "refresh.primary.stored: 対象外のsourceが変わった",
      "refresh.primary.summary: primary更新後の代表価格が新価格へ追従しない",
      "refresh.primary.summary: primary source projectionが新価格を保存値と別に持った",
      "refresh.primary.summary: primary source projectionが新しい取得日時へ追従しない",
    ],
  ],
];

test("上流統合の保証を壊すpatch decoratorはcontract違反として検出される", async (t) => {
  for (const [name, decorate, expected] of mutationBreakers) {
    await t.test(name, async () => {
      assert.deepEqual(
        await collectCandidateSourcePortContractViolations(
          subjectWith({ decorate }),
        ),
        expected,
      );
    });
  }
});

test("source-price-refreshはcandidate-management公開入口だけを参照する", async () => {
  const featureRoot = new URL(
    "../../src/features/source-price-refresh/",
    import.meta.url,
  );
  const entries = await readdir(fileURLToPath(featureRoot));
  const referenced: string[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    const text = await readFile(
      fileURLToPath(new URL(entry, featureRoot)),
      "utf8",
    );
    for (const match of text.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
      const specifier = match[1] ?? "";
      if (!specifier.includes("candidate-management")) continue;
      referenced.push(`${entry}: ${specifier}`);
      assert.equal(
        specifier,
        "../candidate-management/public.js",
        `${entry}: candidate-managementへは公開入口だけを参照する`,
      );
    }
  }

  assert.ok(
    referenced.length > 0,
    "candidate-management公開入口への参照が実在する",
  );
});
