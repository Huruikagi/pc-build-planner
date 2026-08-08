import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import type {
  ActivationId,
  FeatureActivationIntent,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import {
  type CandidatePartId,
  ok,
  type RequestId,
  type Revision,
} from "../../../src/domain/public.js";
import { createSourceKindClassifier } from "../../../src/features/candidate-management/feature-contribution.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import type { CandidateSourceDataPort } from "../../../src/features/candidate-management/source-data-port.js";
import { createGenericExtractor } from "../../../src/features/product-capture/extractor.js";
import {
  createChromeCaptureRuntimePort,
  createProductCaptureContribution,
} from "../../../src/features/product-capture/feature-contribution.js";
import { createManufacturerDomainMap } from "../../../src/features/product-capture/manufacturer-domain-map.js";
import type { FoundationScopedDataPort } from "../../../src/persistence/public.js";
import { sourceRoot } from "../../fixtures/candidate-source-root.js";
import { createProductionCaptureChromeFixture } from "../../fixtures/product-capture-production.js";

const activationId = "synthetic-activation" as ActivationId;
const tabId = 71 as TargetTabId;
const pageUrl = "https://shop.synthetic-maker.example.invalid/item";

const syntheticMap = () => {
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
  if (!result.ok) throw new Error("synthetic map must be valid");
  return result.value;
};

const candidatesFrom = (body: string, url = pageUrl) => {
  document.body.innerHTML = body;
  return createGenericExtractor({
    manufacturerDomainMap: syntheticMap(),
  }).extract(document, url).candidates;
};

const createFlow = (
  candidates: ReturnType<typeof candidatesFrom>,
  targetUrl = pageUrl,
  runtime?: Parameters<typeof createProductCaptureContribution>[1]["runtime"],
  acceptIntent?: (intent: FeatureActivationIntent) => Promise<void>,
) => {
  const received: FeatureActivationIntent[] = [];
  let concludeAttempts = 0;
  let saveMutations = 0;
  let current = true;
  const contribution = createProductCaptureContribution(
    {
      data: {
        async mutate() {
          saveMutations += 1;
          return ok({});
        },
      },
    } as never,
    {
      runtime: runtime ?? {
        async getTab(requestedTabId) {
          return ok({ tabId: requestedTabId, url: targetUrl });
        },
        async inject(target, requestId: RequestId) {
          return ok({
            requestId,
            tabId: target.tabId,
            pageUrl: target.url,
            candidates,
          });
        },
      },
      transientSurface: {
        isCurrent: (id) => current && id === activationId,
        waitUntilCurrent: async (id) => current && id === activationId,
        dismiss: async () => ok(undefined),
        async conclude(_id, intent) {
          concludeAttempts += 1;
          if (
            concludeAttempts === 1 &&
            candidates.some((item) => item.rawValue === "SYN retry")
          ) {
            return { ok: false, error: { kind: "transition-failed" as const } };
          }
          received.push(intent);
          await acceptIntent?.(intent);
          return ok(undefined);
        },
      },
      createCandidateEditorIntent: (prefill) => ({
        featureId: "candidate-management" as never,
        target: "open-candidate-editor",
        payload: prefill,
      }),
    },
  );
  return {
    contribution,
    received,
    concludeAttempts: () => concludeAttempts,
    saveMutations: () => saveMutations,
    expireTab: () => {
      current = false;
    },
  };
};

const createSourceSaveHarness = () => {
  let root = sourceRoot();
  let mutations = 0;
  const data = {
    async query(project: (root: never) => unknown) {
      return ok(project(root as never));
    },
    async mutate() {
      throw new Error(
        "schema-2 source handoff must not use legacy persistence",
      );
    },
  } as FoundationScopedDataPort;
  const sourceData: CandidateSourceDataPort = {
    async query(project) {
      return ok(project(root));
    },
    async mutateCandidate(candidate) {
      mutations += 1;
      root = {
        ...root,
        revision: (root.revision + 1) as Revision,
        candidateParts: [...root.candidateParts, candidate],
      };
      return ok(undefined);
    },
  };
  return { data, sourceData, root: () => root, mutations: () => mutations };
};

const runCapture = async (flow: ReturnType<typeof createFlow>) => {
  const registration = flow.contribution.registration;
  assert.equal(registration.presentation, "transient");
  if (registration.presentation !== "transient") return;
  const accepted = await registration.transientActivation.accept({
    activationId,
    surfaceId: registration.id,
    tabId,
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  let mounted!: Awaited<
    ReturnType<typeof flow.contribution.registration.mount>
  >;
  await act(async () => {
    mounted = await flow.contribution.registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  const button = container.querySelector<HTMLButtonElement>("button");
  assert.ok(button);
  await act(async () => {
    button.click();
  });
  await act(async () => mounted.unmount());
};

test("domain-map provenanceを保つproject未解決pre-editを一度だけhandoffする", async () => {
  const flow = createFlow(candidatesFrom("<h1>SYN 架空CPU</h1>"));
  await runCapture(flow);
  assert.equal(flow.received.length, 1);
  const payload = flow.received[0]?.payload as {
    draft: { sourceSnapshot?: Record<string, string> };
  };
  assert.equal(
    payload.draft.sourceSnapshot?.["manufacturer:source"],
    "domain-map",
  );
  assert.equal("projectId" in payload.draft, false);
  assert.equal(flow.saveMutations(), 0);
  flow.expireTab();
  assert.equal(flow.received.length, 1, "handoff済みdraftはtab失効後も残る");
});

test("取得価格を初期primary sourceだけに載せてtyped concludeする", async () => {
  const flow = createFlow(
    candidatesFrom(`
      <meta property="product:price:amount" content="32100">
      <meta property="product:price:currency" content="JPY">
      <h1>SYN 架空CPU</h1>
    `),
  );
  await runCapture(flow);
  assert.equal(flow.received.length, 1);
  const payload = flow.received[0]?.payload as {
    readonly draft: {
      readonly product: Record<string, unknown>;
      readonly sourceInfo?: unknown;
      readonly sources: readonly {
        readonly id: string;
        readonly pageUrl?: string;
        readonly capturedAt?: string;
        readonly price?: {
          readonly confirmed?: {
            readonly amount: number;
            readonly currency: string;
          };
        };
        readonly kind?: string;
      }[];
      readonly primarySourceId: string;
    };
  };
  const source = payload.draft.sources[0];
  assert.ok(source);
  assert.equal(payload.draft.primarySourceId, source.id);
  assert.equal(source.pageUrl, pageUrl);
  assert.equal(typeof source.capturedAt, "string");
  assert.deepEqual(source.price?.confirmed, { amount: 32100, currency: "JPY" });
  assert.equal(source.kind, undefined);
  assert.equal("price" in payload.draft.product, false);
  assert.equal("sourceInfo" in payload.draft, false);
  assert.equal(flow.saveMutations(), 0);
});

for (const scenario of [
  { label: "domain-map一致", url: pageUrl, expectedKind: "manufacturer" },
  {
    label: "domain-map非一致",
    url: "https://unknown-shop.example.invalid/item",
    expectedKind: "retail",
  },
] as const) {
  test(`${scenario.label}のcapture intentを保存し一覧の代表sourceへ反映する`, async () => {
    const storage = createSourceSaveHarness();
    const project = storage.root().projects[0];
    assert.ok(project);
    const createdId = `20000000-0000-4000-8000-0000000000${
      scenario.expectedKind === "manufacturer" ? "21" : "22"
    }` as CandidatePartId;
    const service = createCandidateManagementService({
      data: storage.data,
      sourceData: storage.sourceData,
      classifier: createSourceKindClassifier(syntheticMap()),
      createCandidateId: () => createdId,
    });
    const captured = candidatesFrom(
      `<meta property="product:price:amount" content="32100">
       <meta property="product:price:currency" content="JPY">
       <h1>SYN source handoff CPU</h1>`,
      scenario.url,
    );
    const flow = createFlow(
      captured,
      scenario.url,
      undefined,
      async (intent) => {
        assert.equal(intent.target, "open-candidate-editor");
        const prefill = intent.payload as {
          readonly draft: Record<string, unknown>;
        };
        const saved = await service.createCandidate(
          { ...prefill.draft, projectId: project.id } as Parameters<
            typeof service.createCandidate
          >[0],
          {
            requestId: "40000000-0000-4000-8000-000000000021" as RequestId,
            expectedRevision: 1,
          },
        );
        assert.equal(saved.ok, true);
      },
    );

    await runCapture(flow);

    assert.equal(storage.mutations(), 1);
    const listed = await service.listCandidates({ projectId: project.id });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const summary = listed.value.find(
      (candidate) => candidate.id === createdId,
    );
    assert.equal(summary?.primarySource?.pageUrl, scenario.url);
    assert.equal(summary?.primarySource?.kind, scenario.expectedKind);
    assert.deepEqual(summary?.price?.confirmed, {
      amount: 32100,
      currency: "JPY",
    });
    const stored = storage
      .root()
      .candidateParts.find((candidate) => candidate.id === createdId);
    assert.equal("price" in (stored?.product ?? {}), false);
    assert.equal("sourceInfo" in (stored ?? {}), false);
  });
}

test("Chrome-shaped固定tab runtimeは実capture compositionからtyped handoffする", async () => {
  const candidates = candidatesFrom("<h1>SYN 固定tab CPU</h1>");
  const chromeFixture = createProductionCaptureChromeFixture({
    grantedTabId: tabId,
    pageUrl,
    candidates,
  });
  const flow = createFlow(
    candidates,
    pageUrl,
    createChromeCaptureRuntimePort(chromeFixture.chrome),
  );

  await runCapture(flow);

  assert.deepEqual(chromeFixture.observedTabsGet, [tabId]);
  assert.deepEqual(chromeFixture.observedInjectionTabs, [tabId, tabId]);
  assert.equal(flow.received.length, 1);
  assert.equal(flow.received[0]?.target, "open-candidate-editor");
  const payload = flow.received[0]?.payload as {
    readonly draft: { readonly projectId?: string };
  };
  assert.equal(payload.draft.projectId, undefined);
});

test("ページ明示manufacturerと未知domainも同じcompositionからhandoffする", async () => {
  const explicit = candidatesFrom(
    "<h1>SYN 製品</h1><dl><dt>manufacturer</dt><dd>SYN 明示メーカー</dd></dl>",
  );
  assert.equal(
    explicit.filter((item) => item.field === "manufacturer").length,
    1,
  );
  assert.equal(
    explicit.find((item) => item.field === "manufacturer")?.source,
    "definition-list",
  );
  const explicitFlow = createFlow(explicit);
  await runCapture(explicitFlow);
  const explicitPayload = explicitFlow.received[0]?.payload as {
    draft: { sourceSnapshot?: Record<string, string> };
  };
  assert.equal(
    explicitPayload.draft.sourceSnapshot?.["manufacturer:source"],
    "definition-list",
  );

  const unknownUrl = "https://unknown.example.invalid/item";
  const unknown = candidatesFrom("<h1>SYN 製品</h1>", unknownUrl);
  assert.equal(
    unknown.some((item) => item.field === "manufacturer"),
    false,
  );
  const unknownFlow = createFlow(unknown, unknownUrl);
  await runCapture(unknownFlow);
  const unknownPayload = unknownFlow.received[0]?.payload as {
    draft: { sourceSnapshot?: Record<string, string> };
  };
  assert.equal(unknownPayload.draft.sourceSnapshot?.manufacturer, undefined);
  assert.equal(explicitFlow.saveMutations() + unknownFlow.saveMutations(), 0);
});

test("候補ゼロは空名manual handoffを行いprojectと保存を解決しない", async () => {
  const flow = createFlow([]);
  await runCapture(flow);
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  let mounted!: Awaited<
    ReturnType<typeof flow.contribution.registration.mount>
  >;
  await act(async () => {
    mounted = await flow.contribution.registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  const manual = container.querySelector<HTMLButtonElement>(
    "[data-capture-manual]",
  );
  assert.ok(manual);
  await act(async () => manual.click());
  const payload = flow.received[0]?.payload as {
    draft: { projectId?: string; product: { name: { confirmed: string } } };
  };
  assert.equal(payload.draft.product.name.confirmed, "");
  assert.equal(payload.draft.projectId, undefined);
  assert.equal(flow.saveMutations(), 0);
  await act(async () => mounted.unmount());
});

test("handoff失敗は同じintentだけを再試行する", async () => {
  const flow = createFlow(candidatesFrom("<h1>SYN retry</h1>"));
  await runCapture(flow);
  assert.equal(flow.concludeAttempts(), 1);
  assert.equal(flow.received.length, 0);
  // production viewの同一ボタンはhandoff failure時にretained intentのretryになる。
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  let mounted!: Awaited<
    ReturnType<typeof flow.contribution.registration.mount>
  >;
  await act(async () => {
    mounted = await flow.contribution.registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  const retry = container.querySelector<HTMLButtonElement>("button");
  assert.ok(retry);
  await act(async () => retry.click());
  assert.equal(flow.concludeAttempts(), 2);
  assert.equal(flow.received.length, 1);
  await act(async () => mounted.unmount());
});
