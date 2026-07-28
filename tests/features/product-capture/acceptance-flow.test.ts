import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import type {
  ActivationId,
  FeatureActivationIntent,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import { ok, type RequestId } from "../../../src/domain/public.js";
import { createGenericExtractor } from "../../../src/features/product-capture/extractor.js";
import { createProductCaptureContribution } from "../../../src/features/product-capture/feature-contribution.js";
import { createManufacturerDomainMap } from "../../../src/features/product-capture/manufacturer-domain-map.js";

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
  }).extract(document, url);
};

const createFlow = (
  candidates: ReturnType<typeof candidatesFrom>,
  targetUrl = pageUrl,
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
      runtime: {
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
        async conclude(_id, intent) {
          concludeAttempts += 1;
          if (
            concludeAttempts === 1 &&
            candidates.some((item) => item.rawValue === "SYN retry")
          ) {
            return { ok: false, error: { kind: "transition-failed" as const } };
          }
          received.push(intent);
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
