import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { act } from "react";

import type {
  ActivationId,
  FeatureActivationIntent,
  FeatureCompositionContext,
  TargetTabId,
} from "../../src/application-shell/public.js";
import {
  createUtcTimestamp,
  type MoneyValue,
  ok,
  type SourcedValue,
} from "../../src/domain/public.js";
import { createGenericExtractor } from "../../src/features/product-capture/extractor.js";
import {
  createChromeCaptureRuntimePort,
  createProductCaptureContribution,
} from "../../src/features/product-capture/feature-contribution.js";
import { createManufacturerDomainMap } from "../../src/features/product-capture/manufacturer-domain-map.js";
import type {
  PagePriceExtractionPort,
  PagePriceObservation,
} from "../../src/features/product-capture/public.js";
import { createProductionCaptureChromeFixture } from "../fixtures/product-capture-production.js";
import {
  collectPagePriceExtractionContractViolations,
  type PagePriceExtractionContractSubject,
  type PagePriceExtractionProbe,
} from "./page-price-extraction-contract-kit.js";

const activationId = "synthetic-price-activation" as ActivationId;
const tabId = 71 as TargetTabId;
const unrelatedTabId = 72 as TargetTabId;
const pageUrl = "https://shop.synthetic-maker.example.invalid/item";
const navigatedPageUrl =
  "https://shop.synthetic-maker.example.invalid/other-item";

/**
 * The same fictional sales page the existing product ingestion acceptance flow
 * uses: an OpenGraph price pair plus a heading, extracted by the production
 * extractor so the consumer contract never invents its own candidate shapes.
 */
const PRICED_PAGE = `
  <meta property="product:price:amount" content="32100">
  <meta property="product:price:currency" content="JPY">
  <h1>SYN 架空CPU</h1>
`;
const PRICELESS_PAGE = "<h1>SYN 架空CPU</h1>";

const syntheticDomainMap = () => {
  const result = createManufacturerDomainMap([
    {
      registrableDomain: "synthetic-maker.example.invalid",
      manufacturer: "SYN 架空メーカー",
      evidenceUrl: "https://synthetic-maker.example.invalid/about",
      reviewedAt: "2026-07-29",
      owner: "synthetic-test-owner",
    },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("synthetic domain map must be valid");
  return result.value;
};

const candidatesFrom = (body: string): readonly unknown[] => {
  document.body.innerHTML = body;
  return createGenericExtractor({
    manufacturerDomainMap: syntheticDomainMap(),
  }).extract(document, pageUrl);
};

interface ContributionHarness {
  readonly contribution: ReturnType<typeof createProductCaptureContribution>;
  readonly resolvedTabs: () => readonly number[];
  readonly intents: readonly FeatureActivationIntent[];
}

/**
 * Assembles product-capture exactly as production does — the Chrome-shaped
 * fixture feeds the real runtime port, the real coordinator, extractor, ranker
 * and normalizer — and exposes only what a consumer can see: the published
 * port plus which tabs the composition actually touched.
 */
const createHarness = (options: {
  readonly candidates: readonly unknown[];
  readonly pagePayloadUrl?: string;
}): ContributionHarness => {
  const fixture = createProductionCaptureChromeFixture({
    grantedTabId: tabId,
    pageUrl,
    candidates: options.candidates,
    ...(options.pagePayloadUrl === undefined
      ? {}
      : { pagePayloadUrl: options.pagePayloadUrl }),
  });
  const intents: FeatureActivationIntent[] = [];
  const contribution = createProductCaptureContribution(
    {} as FeatureCompositionContext,
    {
      runtime: createChromeCaptureRuntimePort(fixture.chrome),
      transientSurface: {
        isCurrent: (id) => id === activationId,
        waitUntilCurrent: async (id) => id === activationId,
        dismiss: async () => ok(undefined),
        async conclude(_id, intent) {
          intents.push(intent);
          return ok(undefined);
        },
      },
      createCandidateEditorIntent: ((prefill: unknown) => ({
        featureId: "candidate-management",
        target: "open-candidate-editor",
        payload: prefill,
      })) as never,
    },
  );
  return {
    contribution,
    intents,
    resolvedTabs: () => [
      ...fixture.observedTabsGet,
      ...fixture.observedInjectionTabs,
    ],
  };
};

const probeFor = (options: {
  readonly candidates: readonly unknown[];
  readonly pagePayloadUrl?: string;
}): PagePriceExtractionProbe => {
  const harness = createHarness(options);
  return {
    port: harness.contribution.registration.publicApi.pagePriceExtraction,
    resolvedTabs: harness.resolvedTabs,
  };
};

/**
 * Drives the existing product ingestion path end to end over the same page and
 * returns the price it records on the initial source. The contract compares the
 * published port against this value, so a producer that ever split the two
 * pipelines apart fails here instead of silently diverging.
 */
const ingestedSourcePrice = async (
  candidates: readonly unknown[],
): Promise<SourcedValue<MoneyValue> | undefined> => {
  const harness = createHarness({ candidates });
  const registration = harness.contribution.registration;
  assert.equal(registration.presentation, "transient");
  if (registration.presentation !== "transient")
    throw new Error("capture registration must stay transient");
  const accepted = await registration.transientActivation.accept({
    activationId,
    surfaceId: registration.id,
    tabId,
  });
  assert.equal(accepted.ok, true);

  const container = document.createElement("div");
  document.body.replaceChildren(container);
  let mounted!: Awaited<ReturnType<typeof registration.mount>>;
  await act(async () => {
    mounted = await registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  const button = container.querySelector("button");
  assert.ok(button, "取り込み動線の実行操作が存在する");
  await act(async () => button.click());
  await act(async () => mounted.unmount());

  assert.equal(harness.intents.length, 1);
  const payload = harness.intents[0]?.payload as {
    readonly draft: {
      readonly sources: readonly {
        readonly price?: SourcedValue<MoneyValue>;
      }[];
    };
  };
  return payload.draft.sources[0]?.price;
};

const buildSubject = async (): Promise<PagePriceExtractionContractSubject> => {
  const priced = candidatesFrom(PRICED_PAGE);
  const priceless = candidatesFrom(PRICELESS_PAGE);
  const expectedPrice = await ingestedSourcePrice(priced);
  assert.ok(expectedPrice, "既存取り込みが架空fixtureから価格を確定する");
  return {
    tabId,
    unrelatedTabId,
    pageUrl,
    expectedPrice,
    onTarget: () => probeFor({ candidates: priced }),
    navigatedAway: () =>
      probeFor({ candidates: priced, pagePayloadUrl: navigatedPageUrl }),
    withoutPrice: () => probeFor({ candidates: priceless }),
    invalidPayload: () => probeFor({ candidates: [null] }),
  };
};

test("公開price extraction portは固定tab抽出契約を満たす", async () => {
  const subject = await buildSubject();

  assert.deepEqual(
    await collectPagePriceExtractionContractViolations(subject),
    [],
  );
});

test("公開price portは既存商品取り込みと同じ架空fixtureから同じ価格を選ぶ", async () => {
  const priced = candidatesFrom(PRICED_PAGE);
  const ingested = await ingestedSourcePrice(priced);
  const observed = await probeFor({ candidates: priced }).port.extractPrice(
    tabId,
  );

  assert.equal(observed.ok, true);
  if (!observed.ok) return;
  assert.deepEqual(observed.value.price, ingested);
  assert.deepEqual(observed.value.price?.confirmed, {
    amount: 32100,
    currency: "JPY",
  });
  assert.deepEqual(Object.keys(observed.value).sort(), [
    "capturedAt",
    "pageUrl",
    "price",
  ]);
});

type PortDecorator = (
  port: PagePriceExtractionPort,
  subject: PagePriceExtractionContractSubject,
) => PagePriceExtractionPort;

const withDecoratedPort = (
  subject: PagePriceExtractionContractSubject,
  decorate: PortDecorator,
): PagePriceExtractionContractSubject => {
  const wrap = (probe: PagePriceExtractionProbe): PagePriceExtractionProbe => ({
    port: decorate(probe.port, subject),
    resolvedTabs: probe.resolvedTabs,
  });
  return {
    ...subject,
    onTarget: () => wrap(subject.onTarget()),
    navigatedAway: () => wrap(subject.navigatedAway()),
    withoutPrice: () => wrap(subject.withoutPrice()),
    invalidPayload: () => wrap(subject.invalidPayload()),
  };
};

/**
 * Producer mutations, applied from the consumer side only. Each one breaks one
 * guarantee the task pins, so a contract that stopped observing the producer
 * would show up here as an empty violation list.
 */
const mutations: readonly [string, PortDecorator, readonly string[]][] = [
  [
    "注入先tabの推測URLを返す",
    (port, subject) => ({
      async extractPrice(requested) {
        const result = await port.extractPrice(requested);
        if (result.ok || result.error.kind !== "tab-changed") return result;
        return ok({
          pageUrl: subject.pageUrl,
          capturedAt: createUtcTimestamp(),
          price: subject.expectedPrice,
        });
      },
    }),
    ["extract.tabChanged: page-derived URLが対象と異なるのに成功させた"],
  ],
  [
    "page-derived URLを別URLへ差し替える",
    (port) => ({
      async extractPrice(requested) {
        const result = await port.extractPrice(requested);
        if (!result.ok) return result;
        return ok({ ...result.value, pageUrl: navigatedPageUrl });
      },
    }),
    ["extract.pageUrl: page-derived URLを返さない"],
  ],
  [
    "観測へ余分なfieldを載せる",
    (port) => ({
      async extractPrice(requested) {
        const result = await port.extractPrice(requested);
        if (!result.ok) return result;
        return ok({ ...result.value, candidates: [] } as PagePriceObservation);
      },
    }),
    [
      "extract.exposure: page URL・取得時点・価格以外をconsumerへ公開した",
      "extract.priceless: 価格欠損を欠損として区別しない",
    ],
  ],
  [
    "固定tab以外の要求でも固定tabを解決する",
    (port, subject) => ({
      async extractPrice() {
        return port.extractPrice(subject.tabId);
      },
    }),
    [
      "extract.pinnedTab: 別tab要求で固定tabを解決した",
      "extract.unrelatedTab: 権限のないtabの観測を成功させた",
    ],
  ],
  [
    "確定金額を既存normalizerと異なる値へ置換する",
    (port) => ({
      async extractPrice(requested) {
        const result = await port.extractPrice(requested);
        if (!result.ok || result.value.price === undefined) return result;
        return ok({
          ...result.value,
          price: {
            original: result.value.price.original,
            confirmed: { amount: 1, currency: "USD" },
          },
        });
      },
    }),
    ["extract.price.confirmed: 既存normalizer由来の確定金額を保持しない"],
  ],
  [
    "価格欠損を失敗として報告する",
    (port) => ({
      async extractPrice(requested) {
        const result = await port.extractPrice(requested);
        if (!result.ok || result.value.price !== undefined) return result;
        return {
          ok: false as const,
          error: { kind: "invalid-payload" as const },
        };
      },
    }),
    ["extract.priceless: 価格欠損を失敗として報告した"],
  ],
];

test("producerの保証を壊すdecoratorはcontract違反として検出される", async (t) => {
  for (const [name, decorate, expected] of mutations) {
    await t.test(name, async () => {
      const subject = await buildSubject();

      assert.deepEqual(
        await collectPagePriceExtractionContractViolations(
          withDecoratedPort(subject, decorate),
        ),
        expected,
      );
    });
  }
});

const featureRoot = new URL(
  "../../src/features/source-price-refresh/",
  import.meta.url,
);

/**
 * Same import-graph walk the transient registration suite uses, widened to type
 * positions: a deep import into another feature is forbidden even when it is
 * erased at build time, because it still couples the consumer to producer
 * internals.
 */
const moduleSpecifiers = (source: string): readonly string[] => [
  ...[...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  ),
  ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  ),
  ...[...source.matchAll(/\bimport\s+["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  ),
];

test("source-price-refreshはproduct-capture公開入口だけを参照する", async () => {
  const entries = await readdir(fileURLToPath(featureRoot));
  const inspected: string[] = [];
  const captureSpecifiers: string[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    inspected.push(entry);
    const source = await readFile(
      fileURLToPath(new URL(entry, featureRoot)),
      "utf8",
    );
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.includes("product-capture")) continue;
      captureSpecifiers.push(`${entry}: ${specifier}`);
      assert.equal(
        specifier,
        "../product-capture/public.js",
        `${entry}: product-captureへは公開入口だけを参照する`,
      );
    }
  }

  assert.ok(inspected.length > 1, "featureのmodule群を実際に走査している");
  assert.ok(
    captureSpecifiers.length > 0,
    "product-capture公開入口への参照が実在する",
  );
});
