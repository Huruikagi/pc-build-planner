import type { TargetTabId } from "../../src/application-shell/public.js";
import type { MoneyValue, SourcedValue } from "../../src/domain/public.js";
import type { PagePriceExtractionPort } from "../../src/features/product-capture/public.js";

/**
 * One assembled port plus the tabs it actually resolved while serving a call.
 * The counter is what makes "only the pinned tab" observable from the consumer
 * side: the port's return value alone cannot show which tab was touched.
 */
export interface PagePriceExtractionProbe {
  readonly port: PagePriceExtractionPort;
  readonly resolvedTabs: () => readonly number[];
}

/**
 * Everything a consumer of `ProductCapturePublicApi.pagePriceExtraction` needs
 * in order to pin the producer's guarantees. Each factory returns a fresh probe
 * so the resolved-tab counters of the scenarios never interfere.
 */
export interface PagePriceExtractionContractSubject {
  /** The tab the gesture pinned; the only tab the port may resolve. */
  readonly tabId: TargetTabId;
  /** A tab that is never pinned, used to prove the port resolves no other tab. */
  readonly unrelatedTabId: TargetTabId;
  /** The URL the injected page reports for itself. */
  readonly pageUrl: string;
  /** The single price the existing extractor, ranker and normalizer select. */
  readonly expectedPrice: SourcedValue<MoneyValue>;
  /** The page payload agrees with the pinned tab. */
  readonly onTarget: () => PagePriceExtractionProbe;
  /** The page reports a different URL than the pinned tab was opened at. */
  readonly navigatedAway: () => PagePriceExtractionProbe;
  /** The page carries no usable price candidate. */
  readonly withoutPrice: () => PagePriceExtractionProbe;
  /** The injected document returned a payload that fails producer validation. */
  readonly invalidPayload: () => PagePriceExtractionProbe;
}

/**
 * The exact observation surface the port may expose. `pageUrl` is part of the
 * confirmed contract because the consumer matches its stored sources against a
 * page-derived URL; everything the producer knows beyond these three keys —
 * candidates, request identifiers, product values, raw markup — stays inside
 * product-capture.
 */
const OBSERVATION_KEYS = ["capturedAt", "pageUrl", "price"] as const;
const PRICELESS_OBSERVATION_KEYS = ["capturedAt", "pageUrl"] as const;
const PRICE_KEYS = ["confirmed", "original"] as const;

const keysOf = (value: object): string => Object.keys(value).sort().join(",");

const sameMoney = (
  actual: MoneyValue | undefined,
  expected: MoneyValue | undefined,
): boolean =>
  actual?.amount === expected?.amount &&
  actual?.currency === expected?.currency;

/**
 * A typed failure may carry a discriminant and nothing else. Checking the shape
 * rather than searching for forbidden substrings keeps the guarantee total: no
 * URL, price, product value or exception dump can hide in a result whose only
 * key is `kind`.
 */
const failureShapeViolation = (
  label: string,
  result: { readonly ok: boolean } & Record<string, unknown>,
  expectedKind: string,
): string | undefined => {
  if (keysOf(result) !== "error,ok")
    return `${label}: 失敗結果に余分なfieldがある`;
  const error = result.error;
  if (typeof error !== "object" || error === null)
    return `${label}: 判別可能なerrorを返さない`;
  if (keysOf(error) !== "kind")
    return `${label}: errorがkind以外の値を持ち出した`;
  if ((error as { readonly kind?: unknown }).kind !== expectedKind)
    return `${label}: ${expectedKind} として報告しない`;
  return undefined;
};

/**
 * Consumer-side contract for `PagePriceExtractionPort`. It states, as
 * requirements 3.1–3.3 and 3.6 do, that the port resolves only the pinned tab,
 * selects exactly one price with the producer's own extractor, ranker and
 * normalizer, reports the URL the page derived for itself, fails closed when
 * that URL no longer matches the pinned tab, and exposes nothing else.
 *
 * Returns field-qualified violation strings so the suite that owns the
 * assertion can report every breach of the contract at once.
 */
export const collectPagePriceExtractionContractViolations = async (
  subject: PagePriceExtractionContractSubject,
): Promise<readonly string[]> => {
  const violations: string[] = [];

  const onTarget = subject.onTarget();
  let observed: Awaited<ReturnType<PagePriceExtractionPort["extractPrice"]>>;
  try {
    observed = await onTarget.port.extractPrice(subject.tabId);
  } catch {
    violations.push("extract.settle: portが例外で終了した");
    return violations;
  }

  if (!observed.ok) {
    violations.push("extract.result: 固定tabの価格観測に成功しない");
  } else {
    const observation = observed.value;
    if (keysOf(observation) !== OBSERVATION_KEYS.join(","))
      violations.push(
        "extract.exposure: page URL・取得時点・価格以外をconsumerへ公開した",
      );
    if (observation.pageUrl !== subject.pageUrl)
      violations.push("extract.pageUrl: page-derived URLを返さない");
    if (
      typeof observation.capturedAt !== "string" ||
      observation.capturedAt.length === 0
    )
      violations.push("extract.capturedAt: canonical取得時点を返さない");
    const price = observation.price;
    if (price === undefined) {
      violations.push("extract.price: 価格候補から一件を選ばない");
    } else {
      if (keysOf(price) !== PRICE_KEYS.join(","))
        violations.push(
          "extract.price.exposure: 元表記と確定金額以外をconsumerへ公開した",
        );
      if (price.original !== subject.expectedPrice.original)
        violations.push(
          "extract.price.original: 既存extractor由来の元表記を保持しない",
        );
      if (!sameMoney(price.confirmed, subject.expectedPrice.confirmed))
        violations.push(
          "extract.price.confirmed: 既存normalizer由来の確定金額を保持しない",
        );
    }
  }

  const resolvedOnTarget = onTarget.resolvedTabs();
  if (resolvedOnTarget.length === 0)
    violations.push("extract.pinnedTab: 固定tabを解決していない");
  if (resolvedOnTarget.some((tab) => tab !== subject.tabId))
    violations.push("extract.pinnedTab: 固定tab以外を解決した");

  // A tab the gesture never pinned must not reach the pinned tab's page either:
  // the port resolves exactly the tab it is handed, and nothing else.
  const unrelated = subject.onTarget();
  const unrelatedResult = await unrelated.port.extractPrice(
    subject.unrelatedTabId,
  );
  if (unrelated.resolvedTabs().includes(subject.tabId))
    violations.push("extract.pinnedTab: 別tab要求で固定tabを解決した");
  if (unrelatedResult.ok)
    violations.push("extract.unrelatedTab: 権限のないtabの観測を成功させた");

  const navigated = subject.navigatedAway();
  const navigatedResult = await navigated.port.extractPrice(subject.tabId);
  if (navigatedResult.ok) {
    violations.push(
      "extract.tabChanged: page-derived URLが対象と異なるのに成功させた",
    );
  } else {
    const breach = failureShapeViolation(
      "extract.tabChanged",
      navigatedResult,
      "tab-changed",
    );
    if (breach !== undefined) violations.push(breach);
  }

  const priceless = subject.withoutPrice();
  const pricelessResult = await priceless.port.extractPrice(subject.tabId);
  if (!pricelessResult.ok) {
    violations.push("extract.priceless: 価格欠損を失敗として報告した");
  } else if (
    keysOf(pricelessResult.value) !== PRICELESS_OBSERVATION_KEYS.join(",")
  ) {
    violations.push("extract.priceless: 価格欠損を欠損として区別しない");
  }

  const invalid = subject.invalidPayload();
  const invalidResult = await invalid.port.extractPrice(subject.tabId);
  if (invalidResult.ok) {
    violations.push("extract.invalidPayload: 不正payloadを成功させた");
  } else {
    const breach = failureShapeViolation(
      "extract.invalidPayload",
      invalidResult,
      "invalid-payload",
    );
    if (breach !== undefined) violations.push(breach);
  }

  return violations;
};
