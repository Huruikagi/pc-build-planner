import assert from "node:assert/strict";
import test from "node:test";
import type { RequestId, UtcTimestamp } from "../../../src/domain/public.js";
import { err, ok } from "../../../src/domain/public.js";
import type { ExtractionCandidate } from "../../../src/features/product-capture/contracts.js";
import type {
  ActiveTabInfo,
  CaptureRuntimePort,
} from "../../../src/features/product-capture/coordinator.js";
import { createCaptureCoordinator } from "../../../src/features/product-capture/coordinator.js";
import { createCaptureNormalizer } from "../../../src/features/product-capture/normalizer.js";
import { createCandidateRanker } from "../../../src/features/product-capture/ranker.js";

const REQUEST_ID = "80000000-0000-4000-8000-000000000001" as RequestId;
const CAPTURED_AT = "2026-07-23T00:00:00Z" as UtcTimestamp;
const TAB: ActiveTabInfo = {
  tabId: 7,
  url: "https://shop.example.invalid/products/x100",
};

const candidate = (
  overrides: Partial<ExtractionCandidate> = {},
): ExtractionCandidate => ({
  field: "name",
  rawValue: "架空CPU X100",
  source: "json-ld",
  sourceLabel: "JSON-LD name",
  ...overrides,
});

interface Harness {
  readonly runtime: CaptureRuntimePort;
  readonly injectCalls: number[];
  readonly activeTab: ActiveTabInfo | undefined;
  setActiveTab(tab: ActiveTabInfo | undefined): void;
  setInjectResult(
    result: Awaited<ReturnType<CaptureRuntimePort["inject"]>>,
  ): void;
}

const harness = (): Harness => {
  let activeTab: ActiveTabInfo | undefined = TAB;
  let injectResult: Awaited<ReturnType<CaptureRuntimePort["inject"]>> = ok({
    requestId: REQUEST_ID,
    tabId: TAB.tabId,
    pageUrl: TAB.url,
    candidates: [candidate()],
  });
  const injectCalls: number[] = [];

  return {
    get runtime(): CaptureRuntimePort {
      return {
        async getActiveTab() {
          return activeTab;
        },
        async inject() {
          injectCalls.push(injectCalls.length + 1);
          return injectResult;
        },
      };
    },
    injectCalls,
    get activeTab() {
      return activeTab;
    },
    setActiveTab(tab) {
      activeTab = tab;
    },
    setInjectResult(result) {
      injectResult = result;
    },
  };
};

const createCoordinator = (h: Harness) =>
  createCaptureCoordinator({
    runtime: h.runtime,
    normalizer: createCaptureNormalizer(),
    ranker: createCandidateRanker(),
    createRequestId: () => REQUEST_ID,
    now: () => CAPTURED_AT,
  });

test("有効なタブと注入結果から採用値・欠損・棄却理由を含む結果を返す", async () => {
  const h = harness();
  h.setInjectResult(
    ok({
      requestId: REQUEST_ID,
      tabId: TAB.tabId,
      pageUrl: TAB.url,
      candidates: [
        candidate({ field: "name", rawValue: "架空CPU X100" }),
        candidate({ field: "price", rawValue: "not a price", source: "meta" }),
      ],
    }),
  );
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.requestId, REQUEST_ID);
  assert.equal(result.value.tabId, TAB.tabId);
  assert.equal(result.value.pageUrl, TAB.url);
  assert.equal(result.value.capturedAt, CAPTURED_AT);
  assert.equal(result.value.draft.fields.length, 1);
  assert.equal(result.value.draft.fields[0]?.field, "name");
  assert.deepEqual(result.value.rejectedFields, [
    { field: "price", reason: "unresolvable" },
  ]);
  assert.equal(h.injectCalls.length, 1);
});

test("制限ページには注入を試みず制限ページ結果を返す", async () => {
  const h = harness();
  h.setActiveTab({ tabId: 9, url: "chrome://newtab/" });
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "restricted-page" } });
  assert.equal(h.injectCalls.length, 0);
});

test("対象タブを解決できない場合は権限失効として扱う", async () => {
  const h = harness();
  h.setActiveTab(undefined);
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "permission-lost" } });
  assert.equal(h.injectCalls.length, 0);
});

test("注入が権限失効を報告した場合は権限失効として変換する", async () => {
  const h = harness();
  h.setInjectResult(err("permission"));
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "permission-lost" } });
});

test("注入が原因不明の失敗を報告した場合は注入失敗として変換する", async () => {
  const h = harness();
  h.setInjectResult(err("unknown"));
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "injection-failed" } });
});

test("注入が例外を投げても状態を変更せず注入失敗として扱う", async () => {
  const runtime: CaptureRuntimePort = {
    async getActiveTab() {
      return TAB;
    },
    async inject() {
      throw new Error("unexpected");
    },
  };
  const coordinator = createCaptureCoordinator({
    runtime,
    normalizer: createCaptureNormalizer(),
    ranker: createCandidateRanker(),
    createRequestId: () => REQUEST_ID,
    now: () => CAPTURED_AT,
  });

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "injection-failed" } });
});

test("形式不正なpayloadは不正payloadとして拒否する", async () => {
  const h = harness();
  h.setInjectResult(ok({ requestId: REQUEST_ID, tabId: TAB.tabId }));
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "invalid-payload" } });
});

test("domain-map由来のmanufacturer候補をruntime境界で受理する", async () => {
  const h = harness();
  h.setInjectResult(
    ok({
      requestId: REQUEST_ID,
      tabId: TAB.tabId,
      pageUrl: TAB.url,
      candidates: [
        {
          field: "manufacturer",
          rawValue: "架空メーカー",
          source: "domain-map",
          sourceLabel: "maker.example",
        },
      ],
    }),
  );

  const result = await createCoordinator(h).captureCurrentTab();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.draft.fields[0], {
    field: "manufacturer",
    normalizedValue: "架空メーカー",
    rawValue: "架空メーカー",
    source: "domain-map",
    sourceLabel: "maker.example",
  });
});

test("domain-mapをmanufacturer以外のfieldへ偽装したpayloadは拒否する", async () => {
  const h = harness();
  h.setInjectResult(
    ok({
      requestId: REQUEST_ID,
      tabId: TAB.tabId,
      pageUrl: TAB.url,
      candidates: [
        {
          field: "name",
          rawValue: "架空品",
          source: "domain-map",
          sourceLabel: "maker.example",
        },
      ],
    }),
  );

  assert.deepEqual(await createCoordinator(h).captureCurrentTab(), {
    ok: false,
    error: { kind: "invalid-payload" },
  });
});

test("requestIdが一致しない結果はタブ遷移として破棄する", async () => {
  const h = harness();
  h.setInjectResult(
    ok({
      requestId: "80000000-0000-4000-8000-000000000099",
      tabId: TAB.tabId,
      pageUrl: TAB.url,
      candidates: [candidate()],
    }),
  );
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "tab-changed" } });
});

test("tabIdが一致しない結果はタブ遷移として破棄する", async () => {
  const h = harness();
  h.setInjectResult(
    ok({
      requestId: REQUEST_ID,
      tabId: TAB.tabId + 1,
      pageUrl: TAB.url,
      candidates: [candidate()],
    }),
  );
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "tab-changed" } });
});

test("pageUrlが一致しない結果はタブ遷移として破棄する", async () => {
  const h = harness();
  h.setInjectResult(
    ok({
      requestId: REQUEST_ID,
      tabId: TAB.tabId,
      pageUrl: "https://shop.example.invalid/products/other",
      candidates: [candidate()],
    }),
  );
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "tab-changed" } });
});

test("候補が一件も抽出できない場合は抽出候補なしとして扱う", async () => {
  const h = harness();
  h.setInjectResult(
    ok({
      requestId: REQUEST_ID,
      tabId: TAB.tabId,
      pageUrl: TAB.url,
      candidates: [],
    }),
  );
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.deepEqual(result, { ok: false, error: { kind: "no-candidate" } });
});

test("候補はあるが全て棄却された場合は欠損と棄却理由を保持したまま成功で返す", async () => {
  const h = harness();
  h.setInjectResult(
    ok({
      requestId: REQUEST_ID,
      tabId: TAB.tabId,
      pageUrl: TAB.url,
      candidates: [candidate({ rawValue: "" })],
    }),
  );
  const coordinator = createCoordinator(h);

  const result = await coordinator.captureCurrentTab();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.draft.fields, []);
  assert.ok(result.value.draft.missingCoreFields.includes("name"));
  assert.deepEqual(result.value.rejectedFields, [
    { field: "name", reason: "empty" },
  ]);
});
