import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";

import type {
  CandidatePartId,
  ProjectId,
  Result,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CompatibilityError,
  CompatibilityQuery,
  CompatibilityReport,
  RuleResult,
} from "../../../src/features/compatibility/contracts.js";
import type { CompatibilityProjectContextAdapter } from "../../../src/features/compatibility/project-context-adapter.js";
import { createCompatibilityState } from "../../../src/features/compatibility/state.js";
import { CompatibilityView } from "../../../src/features/compatibility/view.js";
import {
  defaultMessageResolver,
  MessageProvider,
  resolverFor,
} from "../../../src/ui-messages/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

const partId = (raw: string): CandidatePartId =>
  raw as unknown as CandidatePartId;

const cpuId = partId("30000000-0000-4000-8000-000000000001");
const motherboardId = partId("30000000-0000-4000-8000-000000000002");
const memoryId = partId("30000000-0000-4000-8000-000000000003");

const compatibleResult = (): RuleResult => ({
  ruleId: "cpu-motherboard-socket",
  status: "compatible",
  left: { candidatePartId: cpuId, displayName: "架空CPU" },
  right: { candidatePartId: motherboardId, displayName: "架空マザーボード" },
  comparedValue: { left: "AM5", right: "AM5" },
  reasonCode: "value-equal",
});

const incompatibleResult = (): RuleResult => ({
  ruleId: "cooler-cpu-socket",
  status: "incompatible",
  left: { candidatePartId: cpuId, displayName: "架空CPU" },
  right: { candidatePartId: motherboardId, displayName: "架空クーラー" },
  comparedValue: { left: "LGA1700", right: ["AM4", "AM5"] },
  reasonCode: "value-not-included",
});

const unknownResult = (displayName = "架空マザーボード"): RuleResult => ({
  ruleId: "motherboard-memory-ddr",
  status: "unknown",
  left: { candidatePartId: motherboardId, displayName },
  missingFields: [{ side: "right", reason: "category-missing" }],
  reasonCode: "input-missing",
});

const unnamedUnsafeResult = (): RuleResult => ({
  ruleId: "case-motherboard-form-factor",
  status: "compatible",
  left: {
    candidatePartId: motherboardId,
    displayName: "<img src=x onerror=alert(1)> 危険なマザーボード名",
  },
  right: { candidatePartId: memoryId, displayName: "架空ケース" },
  comparedValue: { left: "Micro-ATX", right: ["ATX", "Micro-ATX"] },
  reasonCode: "value-included",
});

const reportOf = (
  status: CompatibilityReport["status"],
  results: readonly RuleResult[],
): CompatibilityReport => ({
  projectId,
  buildUpdatedAt: timestamp,
  status,
  results,
});

const fixedQuery = (
  result: Result<CompatibilityReport, CompatibilityError>,
): CompatibilityQuery => ({
  async evaluate() {
    return result;
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(cleanup);

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

test("idle状態は評価開始前であることを識別可能に表示する", () => {
  const state = createCompatibilityState({
    query: fixedQuery({ ok: true, value: reportOf("compatible", []) }),
  });

  const view = render(<CompatibilityView state={state} />);

  assert.equal(
    view.container.querySelector("[data-status='idle']") !== null,
    true,
  );
});

test("loading中は以前のreportを最新結果として表示しない", () => {
  const { query } = (() => {
    const { promise } =
      deferred<Result<CompatibilityReport, CompatibilityError>>();
    const q: CompatibilityQuery = {
      async evaluate() {
        return promise;
      },
    };
    return { query: q };
  })();
  const state = createCompatibilityState({ query });

  void state.evaluate(projectId);
  const view = render(<CompatibilityView state={state} />);

  assert.equal(
    view.container.querySelector("[data-status='loading']") !== null,
    true,
  );
  assert.equal(view.container.querySelector("[data-status='ready']"), null);
});

test("no-buildは構成空状態としてreasonを識別可能に表示する", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({ ok: false, error: { kind: "no-build" } }),
  });
  await state.evaluate(projectId);

  const view = render(<CompatibilityView state={state} />);

  const empty = view.container.querySelector("[data-status='empty-build']");
  assert.ok(empty);
  assert.equal(empty.getAttribute("data-empty-reason"), "no-build");
});

test("不正参照は失敗状態としてno-buildと区別可能なreasonで表示する", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({ ok: false, error: { kind: "invalid-reference" } }),
  });
  await state.evaluate(projectId);

  const view = render(<CompatibilityView state={state} />);

  const failed = view.container.querySelector("[data-status='failed']");
  assert.ok(failed);
  assert.equal(failed.getAttribute("data-failure-reason"), "invalid-reference");
});

test("読取失敗は失敗状態として誤った互換性statusを表示しない", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({ ok: false, error: { kind: "read-failed" } }),
  });
  await state.evaluate(projectId);

  const view = render(<CompatibilityView state={state} />);

  const failed = view.container.querySelector("[data-status='failed']");
  assert.ok(failed);
  assert.equal(failed.getAttribute("data-failure-reason"), "read-failed");
  assert.equal(view.container.querySelector("[data-aggregate-status]"), null);
});

test("失敗はlive regionとnative buttonを持ち、retryは最新ready snapshotを再評価する", async () => {
  let attempts = 0;
  const context: CompatibilityProjectContextAdapter = {
    getCurrent: () => ({ status: "ready", generation: 1, projectId }),
    subscribe: () => () => {},
  };
  const state = createCompatibilityState({
    projectContext: context,
    query: {
      async evaluate() {
        attempts += 1;
        return attempts === 1
          ? { ok: false as const, error: { kind: "read-failed" as const } }
          : {
              ok: true as const,
              value: reportOf("compatible", [compatibleResult()]),
            };
      },
    },
  });
  state.start();
  await flush();
  const view = render(<CompatibilityView state={state} />);

  assert.match(view.getByRole("alert").textContent ?? "", /読み込めません/);
  const retry = view.getByRole("button", { name: "再試行" });
  assert.equal(retry.tagName, "BUTTON");

  await act(async () => {
    fireEvent.click(retry);
    await flush();
  });
  assert.ok(view.container.querySelector("[data-status='ready']"));
  assert.equal(attempts, 2);
});

test("英語resolverでも状態見出し・理由・再試行を同じmessage key群から表示する", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({ ok: false, error: { kind: "invalid-reference" } }),
  });
  await state.evaluate(projectId);

  const view = render(
    <MessageProvider resolver={resolverFor("en")}>
      <CompatibilityView state={state} />
    </MessageProvider>,
  );

  assert.ok(view.getByRole("heading", { name: "Check failed" }));
  assert.ok(view.getByRole("button", { name: "Retry" }));
  assert.match(view.getByRole("alert").textContent ?? "", /invalid reference/);
});

test("互換性ありの集約結果と個別根拠を同時に表示する", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({
      ok: true,
      value: reportOf("compatible", [compatibleResult()]),
    }),
  });
  await state.evaluate(projectId);

  const view = render(<CompatibilityView state={state} />);

  const ready = view.container.querySelector(
    "[data-status='ready'][data-aggregate-status='compatible']",
  );
  assert.ok(ready);
  assert.match(
    view.container.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.compatible")),
  );
  assert.match(view.container.textContent ?? "", /架空CPU/);
  assert.match(view.container.textContent ?? "", /架空マザーボード/);
});

test("注意事項ありでは互換と判定不能の個別行を隠さず両方表示する", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({
      ok: true,
      value: reportOf("caution", [compatibleResult(), unknownResult()]),
    }),
  });
  await state.evaluate(projectId);

  const view = render(<CompatibilityView state={state} />);

  assert.match(
    view.container.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.caution")),
  );
  const compatibleRow = view.container.querySelector(
    "[data-rule-id='cpu-motherboard-socket'][data-result-status='compatible']",
  );
  const unknownRow = view.container.querySelector(
    "[data-rule-id='motherboard-memory-ddr'][data-result-status='unknown']",
  );
  assert.ok(compatibleRow, "互換の個別行が隠されている");
  assert.ok(unknownRow, "判定不能の個別行が隠されている");
  assert.match(
    unknownRow?.textContent ?? "",
    new RegExp(
      defaultMessageResolver("compatibility.missingCategory", { side: "" }),
    ),
  );
});

test("非互換の個別結果は比較値と理由を表示する", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({
      ok: true,
      value: reportOf("incompatible", [incompatibleResult()]),
    }),
  });
  await state.evaluate(projectId);

  const view = render(<CompatibilityView state={state} />);

  assert.match(
    view.container.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.incompatible")),
  );
  const row = view.container.querySelector(
    "[data-rule-id='cooler-cpu-socket'][data-result-status='incompatible']",
  );
  assert.ok(row);
  assert.match(row?.textContent ?? "", /LGA1700/);
  assert.match(row?.textContent ?? "", /AM4/);
  assert.match(row?.textContent ?? "", /AM5/);
});

test("外部由来のパーツ名を安全なJSX childとして描画しHTML注入を許さない", async () => {
  const state = createCompatibilityState({
    query: fixedQuery({
      ok: true,
      value: reportOf("compatible", [unnamedUnsafeResult()]),
    }),
  });
  await state.evaluate(projectId);

  const view = render(<CompatibilityView state={state} />);

  assert.match(view.container.textContent ?? "", /危険なマザーボード名/);
  assert.equal(view.container.querySelector("img"), null);
});
