import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cleanup, render } from "@testing-library/react";

import type {
  ActivationId,
  TargetTabId,
} from "../../../src/application-shell/public.js";
import {
  type CandidatePartId,
  type CandidateSourceId,
  err,
  ok,
  type Result,
  type UtcTimestamp,
} from "../../../src/domain/public.js";
import type {
  SourcePriceRefreshError,
  SourcePriceRefreshReceipt,
} from "../../../src/features/source-price-refresh/contracts.js";
import {
  createSourcePriceRefreshState,
  isRecoverableSourcePriceRefreshError,
} from "../../../src/features/source-price-refresh/state.js";
import { SourcePriceRefreshView } from "../../../src/features/source-price-refresh/view.js";
import type {
  MessageKey,
  MessageResolver,
  SupportedLanguage,
} from "../../../src/ui-messages/public.js";
import {
  MessageProvider,
  resolverFor,
} from "../../../src/ui-messages/public.js";

const candidateId = "30000000-0000-4000-8000-00000000000a" as CandidatePartId;
const sourceId = "40000000-0000-4000-8000-00000000000a" as CandidateSourceId;
const activationId = "activation-1" as ActivationId;
const tabId = 4242 as TargetTabId;
const capturedAt = "2026-07-31T09:30:00.000Z" as UtcTimestamp;

/**
 * `original` は販売ページ由来の未信頼文字列であり、view は決して描画しない。
 * 完全URL、商品名、raw HTML をすべて含めて「漏れたら必ず落ちる」形にする。
 */
const untrustedOriginal =
  '<img src="x" onerror="fail()">架空グラボ 一号 https://shop.example.invalid/p/1?utm_source=x';

const receiptFor = (
  overrides: Partial<SourcePriceRefreshReceipt> = {},
): SourcePriceRefreshReceipt => ({
  candidateId,
  sourceId,
  price: {
    original: untrustedOriginal,
    confirmed: { amount: 48800, currency: "JPY" },
  },
  capturedAt,
  isPrimary: true,
  ...overrides,
});

type RefreshResult = Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>;

/** Drives the real state so the view is exercised through its production input. */
const renderFor = async (
  outcome: RefreshResult | "pending",
  language: SupportedLanguage = "ja",
) => {
  const state = createSourcePriceRefreshState({
    isCurrent: () => true,
    runRefresh: async () =>
      outcome === "pending"
        ? await new Promise<RefreshResult>(() => {})
        : outcome,
  });
  const activated = state.activate(activationId, tabId);
  if (outcome !== "pending") await activated;

  const view = render(
    <MessageProvider resolver={resolverFor(language)}>
      <SourcePriceRefreshView state={state} />
    </MessageProvider>,
  );
  return {
    ...view,
    text: () => view.container.textContent ?? "",
  };
};

const escapeForRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

const shows = (text: string, resolved: string): void => {
  assert.match(text, new RegExp(escapeForRegExp(resolved)));
};

interface FailureExpectation {
  readonly cause: MessageKey;
  readonly guidance: MessageKey;
  readonly recoverable: boolean;
}

/**
 * design.md のエラー表を唯一の典拠とする期待表。`Record` にすることで
 * `SourcePriceRefreshError` へメンバが増えたら typecheck が落ちる。
 * `recoverable` 列は state 層の `isRecoverableSourcePriceRefreshError` と
 * 突き合わせ、案内文言と分類が食い違わないことを固定する。
 */
const failureExpectations = {
  "no-match": {
    cause: "sourcePriceRefresh.errors.no-match",
    guidance: "sourcePriceRefresh.guidance.reviewStoredSources",
    recoverable: false,
  },
  "ambiguous-match": {
    cause: "sourcePriceRefresh.errors.ambiguous-match",
    guidance: "sourcePriceRefresh.guidance.deduplicateSources",
    recoverable: false,
  },
  validation: {
    cause: "sourcePriceRefresh.errors.validation",
    guidance: "sourcePriceRefresh.guidance.repairStoredSource",
    recoverable: false,
  },
  "unsupported-data": {
    cause: "sourcePriceRefresh.errors.unsupported-data",
    guidance: "sourcePriceRefresh.guidance.repairStoredSource",
    recoverable: false,
  },
  unexpected: {
    cause: "sourcePriceRefresh.errors.unexpected",
    guidance: "sourcePriceRefresh.guidance.reportExtensionDefect",
    recoverable: false,
  },
  "ineligible-source": {
    cause: "sourcePriceRefresh.errors.ineligible-source",
    guidance: "sourcePriceRefresh.guidance.retryOnRetailSource",
    recoverable: true,
  },
  "invalid-url": {
    cause: "sourcePriceRefresh.errors.invalid-url",
    guidance: "sourcePriceRefresh.guidance.retryOnEligiblePage",
    recoverable: true,
  },
  "restricted-page": {
    cause: "sourcePriceRefresh.errors.restricted-page",
    guidance: "sourcePriceRefresh.guidance.retryOnEligiblePage",
    recoverable: true,
  },
  "price-unavailable": {
    cause: "sourcePriceRefresh.errors.price-unavailable",
    guidance: "sourcePriceRefresh.guidance.checkPageThenRetry",
    recoverable: true,
  },
  "permission-lost": {
    cause: "sourcePriceRefresh.errors.permission-lost",
    guidance: "sourcePriceRefresh.guidance.retryFromContextMenu",
    recoverable: true,
  },
  "tab-changed": {
    cause: "sourcePriceRefresh.errors.tab-changed",
    guidance: "sourcePriceRefresh.guidance.retryFromContextMenu",
    recoverable: true,
  },
  "tab-unavailable": {
    cause: "sourcePriceRefresh.errors.tab-unavailable",
    guidance: "sourcePriceRefresh.guidance.retryFromContextMenu",
    recoverable: true,
  },
  "injection-failed": {
    cause: "sourcePriceRefresh.errors.injection-failed",
    guidance: "sourcePriceRefresh.guidance.retryFromContextMenu",
    recoverable: true,
  },
  "invalid-payload": {
    cause: "sourcePriceRefresh.errors.invalid-payload",
    guidance: "sourcePriceRefresh.guidance.retryFromContextMenu",
    recoverable: true,
  },
  "stale-activation": {
    cause: "sourcePriceRefresh.errors.stale-activation",
    guidance: "sourcePriceRefresh.guidance.retryFromContextMenu",
    recoverable: true,
  },
  "stale-target": {
    cause: "sourcePriceRefresh.errors.stale-target",
    guidance: "sourcePriceRefresh.guidance.reloadCandidateThenRetry",
    recoverable: true,
  },
  conflict: {
    cause: "sourcePriceRefresh.errors.conflict",
    guidance: "sourcePriceRefresh.guidance.reloadCandidateThenRetry",
    recoverable: true,
  },
  maintenance: {
    cause: "sourcePriceRefresh.errors.maintenance",
    guidance: "sourcePriceRefresh.guidance.retryAfterMaintenance",
    recoverable: true,
  },
  storage: {
    cause: "sourcePriceRefresh.errors.storage",
    guidance: "sourcePriceRefresh.guidance.checkStorageThenRetry",
    recoverable: true,
  },
  quota: {
    cause: "sourcePriceRefresh.errors.quota",
    guidance: "sourcePriceRefresh.guidance.checkStorageThenRetry",
    recoverable: true,
  },
} as const satisfies Record<
  SourcePriceRefreshError["kind"],
  FailureExpectation
>;

const failureKinds = Object.keys(
  failureExpectations,
) as readonly SourcePriceRefreshError["kind"][];

afterEach(cleanup);

test("running中は進行中であることだけを提示し対象tabを露出しない", async () => {
  const messages: MessageResolver = resolverFor("ja");
  const rendered = await renderFor("pending");

  shows(rendered.text(), messages("sourcePriceRefresh.runningStatus"));
  assert.ok(
    rendered.container.querySelector("[data-status='running']"),
    "進行状態を識別できる領域を描画する",
  );
  assert.doesNotMatch(rendered.text(), /4242/);
});

test("成功時は確定金額・取得日時・代表価格への反映を提示する", async () => {
  const messages: MessageResolver = resolverFor("ja");
  const rendered = await renderFor(ok(receiptFor()));
  const text = rendered.text();

  shows(text, messages("sourcePriceRefresh.succeededStatus"));
  shows(
    text,
    messages("sourcePriceRefresh.priceValue", {
      amount: 48800,
      currency: "JPY",
    }),
  );
  shows(text, capturedAt);
  shows(text, messages("sourcePriceRefresh.primaryUpdated"));
  assert.doesNotMatch(
    text,
    new RegExp(
      escapeForRegExp(messages("sourcePriceRefresh.primaryUnchanged")),
    ),
  );
});

test("非primary成功では代表価格が変わらないことを提示する", async () => {
  const messages: MessageResolver = resolverFor("ja");
  const rendered = await renderFor(ok(receiptFor({ isPrimary: false })));
  const text = rendered.text();

  shows(text, messages("sourcePriceRefresh.succeededStatus"));
  shows(
    text,
    messages("sourcePriceRefresh.priceValue", {
      amount: 48800,
      currency: "JPY",
    }),
  );
  shows(text, capturedAt);
  shows(text, messages("sourcePriceRefresh.primaryUnchanged"));
  assert.doesNotMatch(
    text,
    new RegExp(escapeForRegExp(messages("sourcePriceRefresh.primaryUpdated"))),
  );
});

test("確定金額を持たない受領では金額を捏造せず未入力として提示する", async () => {
  const messages: MessageResolver = resolverFor("ja");
  const rendered = await renderFor(
    ok(receiptFor({ price: { original: untrustedOriginal } })),
  );

  shows(rendered.text(), messages("common.notEntered"));
});

test("失敗kindごとに安定した原因と回復案内を提示する", async () => {
  const messages: MessageResolver = resolverFor("ja");
  for (const kind of failureKinds) {
    const expectation = failureExpectations[kind];
    const rendered = await renderFor(err({ kind } as SourcePriceRefreshError));
    const text = rendered.text();

    shows(text, messages(expectation.cause));
    shows(text, messages(expectation.guidance));
    const preserved = rendered.container.querySelector(
      "[data-region='preserved']",
    );
    if (kind === "unexpected") {
      assert.ok(
        preserved === null,
        "unexpectedはcommit済みの可能性があるため旧価格維持を断言しない",
      );
    } else {
      assert.ok(preserved, `${kind}: 既存価格を維持したことを提示する`);
      shows(
        preserved.textContent ?? "",
        messages("sourcePriceRefresh.preservedNotice"),
      );
    }
    assert.doesNotMatch(
      text,
      new RegExp(escapeForRegExp(kind)),
      `${kind}: error kindそのものを画面へ出さない`,
    );
    cleanup();
  }
});

test("回復案内の分類がstateのrecoverable判定と矛盾しない", () => {
  const repairGuidance = new Set<string>([
    "sourcePriceRefresh.guidance.reviewStoredSources",
    "sourcePriceRefresh.guidance.deduplicateSources",
    "sourcePriceRefresh.guidance.repairStoredSource",
    "sourcePriceRefresh.guidance.reportExtensionDefect",
  ]);
  for (const kind of failureKinds) {
    const expectation = failureExpectations[kind];
    assert.equal(
      isRecoverableSourcePriceRefreshError({
        kind,
      } as SourcePriceRefreshError),
      expectation.recoverable,
      `${kind}: 期待表とstateの分類が一致する`,
    );
    assert.equal(
      repairGuidance.has(expectation.guidance),
      !expectation.recoverable,
      `${kind}: 再実行できない失敗にだけ保存データ修復を案内する`,
    );
  }
});

test("上流port契約違反の原因と再実行を促さない案内を日英双方で描画する", async () => {
  for (const language of ["ja", "en"] as const) {
    const messages: MessageResolver = resolverFor(language);
    const rendered = await renderFor(
      err({ kind: "unexpected" } as SourcePriceRefreshError),
      language,
    );
    const text = rendered.text();

    shows(text, messages("sourcePriceRefresh.errors.unexpected"));
    shows(text, messages("sourcePriceRefresh.guidance.reportExtensionDefect"));
    assert.doesNotMatch(
      text,
      /unexpected/,
      "error kindそのものを画面へ出さない",
    );
    cleanup();
  }

  assert.notEqual(
    resolverFor("ja")("sourcePriceRefresh.guidance.reportExtensionDefect"),
    resolverFor("en")("sourcePriceRefresh.guidance.reportExtensionDefect"),
  );
});

test("panel内に再実行buttonを含むいかなるbuttonも置かない", async () => {
  for (const outcome of [
    "pending",
    ok(receiptFor()),
    err({ kind: "maintenance" } as SourcePriceRefreshError),
  ] as const) {
    const rendered = await renderFor(outcome);
    assert.equal(
      rendered.container.querySelector("button, input, a[href]"),
      null,
      "一過性面に再実行操作を残さない",
    );
    cleanup();
  }
});

test("完全URL・商品値・raw HTML・例外dumpを描画しない", async () => {
  const rendered = await renderFor(ok(receiptFor()));
  const text = rendered.text();

  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(text, /架空グラボ/);
  assert.doesNotMatch(text, /<img/);
  assert.doesNotMatch(text, new RegExp(escapeForRegExp(candidateId)));
  assert.doesNotMatch(text, new RegExp(escapeForRegExp(sourceId)));
});

test("外部由来文字列はHTML要素ではなく安全なtextとして描画される", async () => {
  const rendered = await renderFor(
    ok(
      receiptFor({
        price: {
          original: untrustedOriginal,
          confirmed: {
            amount: 1980,
            currency: '<img src="x" onerror="fail()">',
          },
        },
        capturedAt: "<script>fail()</script>" as UtcTimestamp,
      }),
    ),
  );

  assert.equal(rendered.container.querySelector("img"), null);
  assert.equal(rendered.container.querySelector("script"), null);
  assert.match(rendered.text(), /onerror="fail\(\)"/);
});

test("3状態が日本語・英語のresolverでそれぞれの文言に解決される", async () => {
  for (const language of ["ja", "en"] as const) {
    const messages: MessageResolver = resolverFor(language);
    const running = await renderFor("pending", language);
    shows(running.text(), messages("sourcePriceRefresh.runningStatus"));
    cleanup();

    const succeeded = await renderFor(ok(receiptFor()), language);
    shows(succeeded.text(), messages("sourcePriceRefresh.succeededStatus"));
    cleanup();

    const failed = await renderFor(
      err({ kind: "maintenance" } as SourcePriceRefreshError),
      language,
    );
    shows(failed.text(), messages("sourcePriceRefresh.errors.maintenance"));
    shows(
      failed.text(),
      messages("sourcePriceRefresh.guidance.retryAfterMaintenance"),
    );
    cleanup();
  }

  assert.notEqual(
    resolverFor("ja")("sourcePriceRefresh.runningStatus"),
    resolverFor("en")("sourcePriceRefresh.runningStatus"),
  );
});
