import type {
  CandidatePart,
  CandidatePartId,
  CandidateSourceId,
  MoneyValue,
  SourcedValue,
  UtcTimestamp,
} from "../../src/domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSummary,
} from "../../src/features/candidate-management/public.js";
import type { SourcePriceRefreshPort } from "../../src/features/source-price-refresh/public.js";
import {
  candidateSourceMatchScope,
  catalogSourceMatchScope,
} from "../../src/features/source-price-refresh/public.js";

/**
 * Everything a consumer can observe about the stored state after the source
 * facet has been used. `revision` is included on purpose: requirement 5.1 asks
 * that a failed refresh leave the *whole* saved state untouched, and the root
 * revision is the one part of it that no feature-level projection exposes.
 */
export interface StoredStateObservation {
  readonly revision: number;
  /** Every persisted candidate part, read back from the storage adapter. */
  readonly candidates: readonly CandidatePart[];
  /** `query.listCandidates` projections — the representative price surface. */
  readonly summaries: readonly CandidateSummary[];
  /** The compatibility verdict computed from the same stored candidates. */
  readonly compatibility: unknown;
}

/**
 * One assembled candidate-management stack plus the two things a port return
 * value cannot show: how many root commits the write authority performed, and
 * what the persisted root looks like afterwards.
 */
export interface CandidateSourceIntegrationProbe {
  readonly refresh: SourcePriceRefreshPort;
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: import("../../src/features/candidate-management/public.js").CandidateSourceMutationPort;
  /** Inserts one competing foundation commit after the next expected-revision read. */
  readonly armRevisionConflict: () => void;
  readonly observe: () => Promise<StoredStateObservation>;
  /** Number of root writes the persistence layer actually committed. */
  readonly rootCommits: () => number;
}

/** A stored retail source plus the page URL a re-visit would report for it. */
export interface StoredSourceTarget {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  /** The URL stored on the source. */
  readonly pageUrl: string;
  /** The same page as seen again, with tracking-only differences. */
  readonly observedPageUrl: string;
}

export interface CandidateSourceIntegrationSubject {
  /** The primary source of the candidate under test. */
  readonly primary: StoredSourceTarget;
  /** A second, non-primary source of the same candidate. */
  readonly nonPrimary: StoredSourceTarget;
  /** A source that belongs to another candidate; catalog scope must see it. */
  readonly foreign: StoredSourceTarget;
  /** A URL no stored source designates, used to force a re-validation failure. */
  readonly unmatchedPageUrl: string;
  readonly refreshedPrice: SourcedValue<MoneyValue>;
  readonly refreshedAt: UtcTimestamp;
  /** A fresh stack whose stored state has not been mutated yet. */
  readonly probe: () => Promise<CandidateSourceIntegrationProbe>;
  /** A fresh stack whose persistence layer fails the next root write. */
  readonly probeWithFailingWrite: () => Promise<CandidateSourceIntegrationProbe>;
}

/** The exact keys the confirmed catalog projection may expose. */
const REFERENCE_KEYS: ReadonlySet<string> = new Set([
  "candidateId",
  "sourceId",
  "pageUrl",
  "kind",
  "isPrimary",
]);

/** The exact keys the receipt may expose; a revision would show up here. */
const RECEIPT_KEYS = "candidateId,capturedAt,isPrimary,price,sourceId";

const keysOf = (value: object): string => Object.keys(value).sort().join(",");

/**
 * Key-order independent structural comparison. The updated entry is rebuilt by
 * spreading the stored one, so a source that previously carried no price ends
 * up with its keys in a different order; comparing raw serializations would
 * report that as a change it is not.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  );
  return entries.map(([key, item]) => [key, canonical(item)]);
};

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const without = <T extends object>(
  value: T,
  omitted: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.includes(key)),
  );

const candidateOf = (
  observation: StoredStateObservation,
  id: CandidatePartId,
): CandidatePart | undefined =>
  observation.candidates.find((candidate) => candidate.id === id);

const summaryOf = (
  observation: StoredStateObservation,
  id: CandidatePartId,
): CandidateSummary | undefined =>
  observation.summaries.find((summary) => summary.id === id);

/**
 * Confirms that both catalog scopes are served by the same read-only facet and
 * that neither of them widens the confirmed projection (requirements 2.5, 2.6).
 */
const collectCatalogViolations = async (
  subject: CandidateSourceIntegrationSubject,
): Promise<readonly string[]> => {
  const violations: string[] = [];
  const probe = await subject.probe();

  const all = await probe.catalog.listSourceReferences({});
  if (!all.ok) {
    violations.push("catalog.all: catalog全体のsource参照を取得できない");
  } else {
    const listed = all.value.map((reference) => reference.sourceId);
    for (const expected of [
      subject.primary.sourceId,
      subject.nonPrimary.sourceId,
      subject.foreign.sourceId,
    ]) {
      if (!listed.includes(expected))
        violations.push("catalog.all: 保存済みsourceを列挙しない");
    }
    for (const reference of all.value) {
      if (Object.keys(reference).some((key) => !REFERENCE_KEYS.has(key))) {
        violations.push(
          "catalog.projection: 限定参照がsiteName・price・capturedAtを公開した",
        );
        break;
      }
    }
  }

  const scoped = await probe.catalog.listSourceReferences({
    candidateId: subject.primary.candidateId,
  });
  if (!scoped.ok) {
    violations.push("catalog.candidate: 候補内source参照を取得できない");
  } else {
    if (
      scoped.value.some(
        (reference) => reference.candidateId !== subject.primary.candidateId,
      )
    )
      violations.push("catalog.candidate: 候補外のsourceを返した");
    if (
      !same(
        scoped.value.map((reference) => reference.sourceId).sort(),
        [subject.primary.sourceId, subject.nonPrimary.sourceId].sort(),
      )
    )
      violations.push("catalog.candidate: 候補内sourceを網羅しない");
  }

  for (const [label, scope] of [
    ["catalog", catalogSourceMatchScope()],
    ["candidate", candidateSourceMatchScope(subject.nonPrimary.candidateId)],
  ] as const) {
    const matched = await probe.refresh.matchSource({
      scope,
      pageUrl: subject.nonPrimary.observedPageUrl,
    });
    if (!matched.ok) {
      violations.push(`match.${label}: 保存済みsourceを一意に特定しない`);
      continue;
    }
    if (
      matched.value.candidateId !== subject.nonPrimary.candidateId ||
      matched.value.sourceId !== subject.nonPrimary.sourceId
    )
      violations.push(`match.${label}: 別のcandidate/source IDを返した`);
    if (matched.value.isPrimary)
      violations.push(`match.${label}: 非primary sourceをprimaryと報告した`);
  }

  return violations;
};

/**
 * Compares the persisted candidates before and after a refresh: only the target
 * source's `price` and `capturedAt` may differ, and only the owning candidate's
 * bookkeeping timestamp may move with it (requirements 3.4, 4.1, 4.2).
 */
const collectStoredDelta = (
  label: string,
  before: StoredStateObservation,
  after: StoredStateObservation,
  target: StoredSourceTarget,
  subject: CandidateSourceIntegrationSubject,
): readonly string[] => {
  const violations: string[] = [];
  if (before.candidates.length !== after.candidates.length) {
    violations.push(`${label}.stored: 候補の件数が変わった`);
    return violations;
  }

  for (const [index, previous] of before.candidates.entries()) {
    const current = after.candidates[index];
    if (current === undefined || current.id !== previous.id) {
      violations.push(`${label}.stored: 候補の並びが変わった`);
      return violations;
    }
    if (previous.id !== target.candidateId) {
      if (!same(previous, current))
        violations.push(`${label}.stored: 対象外の候補が変わった`);
      continue;
    }
    if (
      !same(
        without(previous, ["sources", "updatedAt"]),
        without(current, ["sources", "updatedAt"]),
      )
    )
      violations.push(
        `${label}.stored: 商品値・正規化属性・primary参照が変わった`,
      );
    if (previous.sources.length !== current.sources.length) {
      violations.push(`${label}.stored: sourceの件数が変わった`);
      continue;
    }
    for (const [sourceIndex, previousSource] of previous.sources.entries()) {
      const currentSource = current.sources[sourceIndex];
      if (
        currentSource === undefined ||
        currentSource.id !== previousSource.id
      ) {
        violations.push(`${label}.stored: sourceの並びが変わった`);
        break;
      }
      if (previousSource.id !== target.sourceId) {
        if (!same(previousSource, currentSource))
          violations.push(`${label}.stored: 対象外のsourceが変わった`);
        continue;
      }
      if (
        !same(
          without(previousSource, ["price", "capturedAt"]),
          without(currentSource, ["price", "capturedAt"]),
        )
      )
        violations.push(
          `${label}.stored: 対象sourceのURL・siteName・種別・IDが変わった`,
        );
      if (!same(currentSource.price, subject.refreshedPrice))
        violations.push(`${label}.stored: 対象sourceへ新しい価格を反映しない`);
      if (currentSource.capturedAt !== subject.refreshedAt)
        violations.push(`${label}.stored: 対象sourceへ取得日時を反映しない`);
    }
  }

  return violations;
};

/**
 * Runs one successful refresh against a fresh stack and pins everything the
 * task's completion condition names: a single root mutation, a price and a
 * captured timestamp on the target source only, the representative price
 * projection following a primary update and holding still for a non-primary
 * one, and unchanged compatibility input.
 */
const collectRefreshViolations = async (
  subject: CandidateSourceIntegrationSubject,
  target: StoredSourceTarget,
  expectedPrimary: boolean,
): Promise<readonly string[]> => {
  const label = expectedPrimary ? "refresh.primary" : "refresh.nonPrimary";
  const violations: string[] = [];
  const probe = await subject.probe();
  const before = await probe.observe();
  const commitsBefore = probe.rootCommits();

  const matched = await probe.refresh.matchSource({
    scope: catalogSourceMatchScope(),
    pageUrl: target.observedPageUrl,
  });
  if (!matched.ok) {
    violations.push(`${label}: 更新対象を一意に特定できない`);
    return violations;
  }

  const result = await probe.refresh.refreshCapturedPrice({
    target: {
      candidateId: matched.value.candidateId,
      sourceId: matched.value.sourceId,
    },
    observedPageUrl: target.observedPageUrl,
    capturedAt: subject.refreshedAt,
    price: subject.refreshedPrice,
  });
  if (!result.ok) {
    violations.push(`${label}: 価格更新を確定できない`);
    return violations;
  }

  const receipt = result.value;
  if (keysOf(receipt) !== RECEIPT_KEYS)
    violations.push(
      `${label}.receipt: revision contextなど契約外の値をconsumerへ公開した`,
    );
  if (receipt.isPrimary !== expectedPrimary)
    violations.push(`${label}.receipt: primary反映有無を正しく報告しない`);
  if (receipt.sourceId !== target.sourceId)
    violations.push(`${label}.receipt: 別のsource IDを報告した`);

  const after = await probe.observe();
  if (probe.rootCommits() - commitsBefore !== 1)
    violations.push(`${label}.mutation: 一回のroot mutationで確定しない`);
  if (after.revision !== before.revision + 1)
    violations.push(`${label}.mutation: root revisionが一度だけ進まない`);

  violations.push(...collectStoredDelta(label, before, after, target, subject));

  const previousSummary = summaryOf(before, target.candidateId);
  const currentSummary = summaryOf(after, target.candidateId);
  if (previousSummary === undefined || currentSummary === undefined) {
    violations.push(`${label}.summary: 候補の代表projectionを読み出せない`);
  } else {
    const omitted = ["price", "primarySource", "updatedAt"];
    if (
      !same(without(previousSummary, omitted), without(currentSummary, omitted))
    )
      violations.push(`${label}.summary: 価格以外の代表projectionが変わった`);
    if (expectedPrimary) {
      if (!same(currentSummary.price, subject.refreshedPrice))
        violations.push(
          `${label}.summary: primary更新後の代表価格が新価格へ追従しない`,
        );
      if (!same(currentSummary.primarySource?.price, subject.refreshedPrice))
        violations.push(
          `${label}.summary: primary source projectionが新価格を保存値と別に持った`,
        );
      if (currentSummary.primarySource?.capturedAt !== subject.refreshedAt)
        violations.push(
          `${label}.summary: primary source projectionが新しい取得日時へ追従しない`,
        );
      if (
        currentSummary.primarySource?.pageUrl !==
          previousSummary.primarySource?.pageUrl ||
        currentSummary.primarySource?.siteName !==
          previousSummary.primarySource?.siteName
      )
        violations.push(
          `${label}.summary: primary source projectionのURL・siteNameを保持しない`,
        );
    } else {
      if (!same(currentSummary.price, previousSummary.price))
        violations.push(`${label}.summary: 非primary更新で代表価格が変わった`);
      if (!same(currentSummary.primarySource, previousSummary.primarySource))
        violations.push(
          `${label}.summary: 非primary更新でprimary sourceが変わった`,
        );
    }
  }

  for (const summary of before.summaries) {
    if (summary.id === target.candidateId) continue;
    if (!same(summary, summaryOf(after, summary.id)))
      violations.push(`${label}.summary: 対象外候補の代表projectionが変わった`);
  }

  if (!same(before.compatibility, after.compatibility))
    violations.push(
      `${label}.compatibility: 正規化属性に基づく判定結果が変わった`,
    );

  const foreign = candidateOf(after, subject.foreign.candidateId);
  if (!same(foreign, candidateOf(before, subject.foreign.candidateId)))
    violations.push(`${label}.stored: 別候補のsourceが変わった`);

  return violations;
};

/**
 * The two ways a refresh can fail after the target has been matched: the stored
 * source no longer designates the observed page, and the write authority
 * refuses the commit. Both must leave every saved byte — root revision included
 * — exactly as it was (requirements 4.5, 5.1, 5.2, 5.3, 5.4).
 */
const collectFailureViolations = async (
  subject: CandidateSourceIntegrationSubject,
): Promise<readonly string[]> => {
  const violations: string[] = [];

  const stale = await subject.probe();
  const beforeStale = await stale.observe();
  const commitsBeforeStale = stale.rootCommits();
  const staleResult = await stale.refresh.refreshCapturedPrice({
    target: {
      candidateId: subject.primary.candidateId,
      sourceId: subject.primary.sourceId,
    },
    observedPageUrl: subject.unmatchedPageUrl,
    capturedAt: subject.refreshedAt,
    price: subject.refreshedPrice,
  });
  if (staleResult.ok) {
    violations.push("failure.staleTarget: 古い照合結果で更新を確定した");
  } else if (staleResult.error.kind !== "stale-target") {
    violations.push("failure.staleTarget: 再試行可能な競合として報告しない");
  }
  if (stale.rootCommits() !== commitsBeforeStale)
    violations.push("failure.staleTarget: 失敗時にroot mutationを実行した");
  if (!same(await stale.observe(), beforeStale))
    violations.push(
      "failure.staleTarget: 失敗時にroot revisionを含む保存状態が変わった",
    );

  const failing = await subject.probeWithFailingWrite();
  const beforeWrite = await failing.observe();
  const commitsBeforeWrite = failing.rootCommits();
  const matched = await failing.refresh.matchSource({
    scope: catalogSourceMatchScope(),
    pageUrl: subject.primary.observedPageUrl,
  });
  if (!matched.ok) {
    violations.push("failure.write: 更新対象を一意に特定できない");
    return violations;
  }
  const writeResult = await failing.refresh.refreshCapturedPrice({
    target: {
      candidateId: matched.value.candidateId,
      sourceId: matched.value.sourceId,
    },
    observedPageUrl: subject.primary.observedPageUrl,
    capturedAt: subject.refreshedAt,
    price: subject.refreshedPrice,
  });
  if (writeResult.ok) {
    violations.push("failure.write: 保存に失敗したのに成功として報告した");
  } else if (writeResult.error.kind !== "storage") {
    violations.push("failure.write: 保存失敗を識別可能な理由へ写像しない");
  }
  if (failing.rootCommits() !== commitsBeforeWrite)
    violations.push("failure.write: 保存失敗後に部分更新をcommitした");
  if (!same(await failing.observe(), beforeWrite))
    violations.push(
      "failure.write: 保存失敗後にroot revisionを含む保存状態が変わった",
    );

  return violations;
};

/**
 * Consumer-side contract for the candidate-management source facet as
 * source-price-refresh uses it: both catalog scopes, one root mutation reached
 * by candidate/source ID with no revision context in sight, a price and a
 * captured timestamp written to exactly one source, non-regressing primary and
 * compatibility projections, and an untouched saved state on failure.
 *
 * Returns field-qualified violation strings so the driving suite can report
 * every breach at once instead of stopping at the first.
 */
export const collectCandidateSourcePortContractViolations = async (
  subject: CandidateSourceIntegrationSubject,
): Promise<readonly string[]> => [
  ...(await collectCatalogViolations(subject)),
  ...(await collectRefreshViolations(subject, subject.nonPrimary, false)),
  ...(await collectRefreshViolations(subject, subject.primary, true)),
  ...(await collectFailureViolations(subject)),
];
