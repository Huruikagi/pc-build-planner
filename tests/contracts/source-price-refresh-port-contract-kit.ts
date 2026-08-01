import type {
  CandidatePartId,
  CandidateSource,
  CandidateSourceId,
  MoneyValue,
  SourcedValue,
  UtcTimestamp,
} from "../../src/domain/public.js";
import {
  candidateSourceMatchScope,
  catalogSourceMatchScope,
  type SourceMatchScope,
  type SourcePriceRefreshPort,
} from "../../src/features/source-price-refresh/public.js";

export interface SourcePriceRefreshContractSource {
  readonly candidateId: CandidatePartId;
  readonly source: CandidateSource;
  readonly isPrimary: boolean;
}

export interface SourcePriceRefreshContractObservation {
  readonly commits: number;
  readonly sources: readonly SourcePriceRefreshContractSource[];
}

export interface SourcePriceRefreshContractProbe {
  readonly refresh: SourcePriceRefreshPort;
  observe(): Promise<SourcePriceRefreshContractObservation>;
}

export interface SourcePriceRefreshPortContractSubject {
  readonly candidateId: CandidatePartId;
  readonly otherCandidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly storedPageUrl: string;
  readonly observedPageUrl: string;
  readonly refreshedAt: UtcTimestamp;
  readonly refreshedPrice: SourcedValue<MoneyValue>;
  probe(): SourcePriceRefreshContractProbe;
}

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const collectScopeRefreshViolations = async (
  subject: SourcePriceRefreshPortContractSubject,
  scope: SourceMatchScope,
  label: "catalog" | "candidate",
): Promise<readonly string[]> => {
  const violations: string[] = [];
  const probe = subject.probe();
  const before = await probe.observe();
  const matched = await probe.refresh.matchSource({
    scope,
    pageUrl: subject.observedPageUrl,
  });
  if (!matched.ok) {
    violations.push(`${label}.match: 同一URLを一意なsourceへ照合しない`);
    return violations;
  }
  if (
    matched.value.candidateId !== subject.candidateId ||
    matched.value.sourceId !== subject.sourceId
  )
    violations.push(`${label}.match: scope内の対象source IDを固定しない`);

  const updated = await probe.refresh.refreshCapturedPrice({
    target: matched.value,
    observedPageUrl: subject.observedPageUrl,
    capturedAt: subject.refreshedAt,
    price: subject.refreshedPrice,
  });
  if (!updated.ok) {
    violations.push(`${label}.update: 照合したsourceを更新できない`);
    return violations;
  }

  const after = await probe.observe();
  if (after.commits !== before.commits + 1)
    violations.push(`${label}.atomic: 一回のmutationで確定しない`);

  const previousTarget = before.sources.find(
    (entry) =>
      entry.candidateId === subject.candidateId &&
      entry.source.id === subject.sourceId,
  );
  const currentTarget = after.sources.find(
    (entry) =>
      entry.candidateId === subject.candidateId &&
      entry.source.id === subject.sourceId,
  );
  if (previousTarget === undefined || currentTarget === undefined) {
    violations.push(`${label}.stored: 対象sourceを保持しない`);
  } else {
    const expected = {
      ...previousTarget,
      source: {
        ...previousTarget.source,
        price: subject.refreshedPrice,
        capturedAt: subject.refreshedAt,
      },
    };
    if (!same(currentTarget, expected))
      violations.push(
        `${label}.stored: priceとcapturedAt以外のsource fieldを変更した`,
      );
  }

  const untouchedBefore = before.sources.filter(
    (entry) =>
      entry.candidateId !== subject.candidateId ||
      entry.source.id !== subject.sourceId,
  );
  const untouchedAfter = after.sources.filter(
    (entry) =>
      entry.candidateId !== subject.candidateId ||
      entry.source.id !== subject.sourceId,
  );
  if (!same(untouchedAfter, untouchedBefore))
    violations.push(`${label}.stored: 対象外sourceを変更した`);

  return violations;
};

/**
 * Consumer-owned contract kit for the public same-URL recapture flow. Both
 * scopes must resolve through the same conservative URL identity and then use
 * the same single-mutation update capability; the kit never imports an
 * implementation module from either feature.
 */
export const collectSourcePriceRefreshPortContractViolations = async (
  subject: SourcePriceRefreshPortContractSubject,
): Promise<readonly string[]> => {
  const catalogProbe = subject.probe();
  const candidateProbe = subject.probe();
  const [catalogMatch, candidateMatch] = await Promise.all([
    catalogProbe.refresh.matchSource({
      scope: catalogSourceMatchScope(),
      pageUrl: subject.observedPageUrl,
    }),
    candidateProbe.refresh.matchSource({
      scope: candidateSourceMatchScope(subject.candidateId),
      pageUrl: subject.observedPageUrl,
    }),
  ]);
  const violations: string[] = [];
  if (!catalogMatch.ok || !candidateMatch.ok) {
    violations.push(
      "identity.shared: catalog/candidate scopeが同じURLを照合しない",
    );
  } else if (
    catalogMatch.value.normalizedPageUrl !==
      candidateMatch.value.normalizedPageUrl ||
    catalogMatch.value.candidateId !== candidateMatch.value.candidateId ||
    catalogMatch.value.sourceId !== candidateMatch.value.sourceId
  ) {
    violations.push(
      "identity.shared: catalog/candidate scopeが同じURL identityとtargetを共有しない",
    );
  }

  const excluded = await subject.probe().refresh.matchSource({
    scope: candidateSourceMatchScope(subject.otherCandidateId),
    pageUrl: subject.observedPageUrl,
  });
  if (excluded.ok || excluded.error.kind !== "no-match")
    violations.push("candidate.scope: 他候補のsourceを照合対象に含めた");

  return [
    ...violations,
    ...(await collectScopeRefreshViolations(
      subject,
      catalogSourceMatchScope(),
      "catalog",
    )),
    ...(await collectScopeRefreshViolations(
      subject,
      candidateSourceMatchScope(subject.candidateId),
      "candidate",
    )),
  ];
};
