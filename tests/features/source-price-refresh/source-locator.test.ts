import assert from "node:assert/strict";
import test from "node:test";
import {
  type AppDataError,
  type CandidatePartId,
  type CandidateSourceId,
  err,
  ok,
  type Result,
} from "../../../src/domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceReference,
} from "../../../src/features/candidate-management/public.js";
import type {
  MatchedCandidateSource,
  MatchStoredSourceInput,
  SourcePriceRefreshError,
} from "../../../src/features/source-price-refresh/contracts.js";
import { createStoredSourceLocator } from "../../../src/features/source-price-refresh/source-locator.js";

const candidateA = "30000000-0000-4000-8000-00000000000a" as CandidatePartId;
const candidateB = "30000000-0000-4000-8000-00000000000b" as CandidatePartId;

const sourceId = (suffix: string): CandidateSourceId =>
  `40000000-0000-4000-8000-00000000000${suffix}` as CandidateSourceId;

const pageUrl = "https://shop.example.invalid/p/1";

interface ListCall {
  readonly candidateId?: CandidatePartId;
}

interface StubCatalog {
  readonly port: CandidateSourceCatalogPort;
  readonly listCalls: readonly ListCall[];
  readonly referenceCalls: readonly unknown[];
}

/**
 * Mirrors the upstream read-only projection: `listSourceReferences` filters by
 * candidate id exactly like `candidate-management` does, so the locator cannot
 * hide a missing scope mapping behind an over-permissive stub.
 */
const createStubCatalog = (
  references: readonly CandidateSourceReference[],
  listFailure?: AppDataError,
): StubCatalog => {
  const listCalls: ListCall[] = [];
  const referenceCalls: unknown[] = [];
  const port: CandidateSourceCatalogPort = {
    async listSourceReferences(
      input,
    ): Promise<Result<readonly CandidateSourceReference[], AppDataError>> {
      listCalls.push(input);
      if (listFailure !== undefined) return err(listFailure);
      const { candidateId } = input;
      return ok(
        candidateId === undefined
          ? references
          : references.filter(
              (reference) => reference.candidateId === candidateId,
            ),
      );
    },
    async getSourceReference(
      input,
    ): Promise<Result<CandidateSourceReference, AppDataError>> {
      referenceCalls.push(input);
      return err({
        code: "validation",
        reason: "entity-not-found",
        message: "source",
      });
    },
  };
  return { port, listCalls, referenceCalls };
};

const retailSource = (
  overrides: Partial<CandidateSourceReference> & {
    readonly sourceId: CandidateSourceId;
  },
): CandidateSourceReference => ({
  candidateId: candidateA,
  pageUrl,
  kind: "retail",
  isPrimary: false,
  ...overrides,
});

const match = async (
  references: readonly CandidateSourceReference[],
  input: MatchStoredSourceInput = { scope: { kind: "catalog" }, pageUrl },
): Promise<Result<MatchedCandidateSource, SourcePriceRefreshError>> => {
  const catalog = createStubCatalog(references);
  return createStoredSourceLocator({ catalog: catalog.port }).matchStoredSource(
    input,
  );
};

const expectError = (
  result: Result<MatchedCandidateSource, SourcePriceRefreshError>,
  kind: SourcePriceRefreshError["kind"],
): void => {
  assert.equal(result.ok, false, `失敗を期待したが成功した: ${kind}`);
  if (result.ok) return;
  assert.equal(result.error.kind, kind);
};

const expectMatch = (
  result: Result<MatchedCandidateSource, SourcePriceRefreshError>,
): MatchedCandidateSource => {
  assert.equal(
    result.ok,
    true,
    `一致を期待したが失敗した: ${JSON.stringify(result)}`,
  );
  if (!result.ok) throw new Error("expected matched source");
  return result.value;
};

test("一件だけ一致したsourceを候補ID・source ID・正規化URL・primary flagとして固定する", async () => {
  const matched = expectMatch(
    await match([
      retailSource({ sourceId: sourceId("1"), isPrimary: true }),
      retailSource({
        sourceId: sourceId("2"),
        pageUrl: "https://shop.example.invalid/p/2",
      }),
    ]),
  );

  assert.deepEqual(matched, {
    candidateId: candidateA,
    sourceId: sourceId("1"),
    normalizedPageUrl: "https://shop.example.invalid/p/1",
    isPrimary: true,
  });
});

test("非primaryのsourceに一致した場合もprimary flagをそのまま保持する", async () => {
  const matched = expectMatch(
    await match([retailSource({ sourceId: sourceId("1"), isPrimary: false })]),
  );

  assert.equal(matched.isPrimary, false);
});

test("追跡query、末尾slash、fragmentだけが異なる保存URLをURL同一性規則どおり一致させる", async () => {
  const matched = expectMatch(
    await match(
      [
        retailSource({
          sourceId: sourceId("1"),
          pageUrl: "https://SHOP.example.invalid:443/p/1/?utm_source=mail#top",
        }),
      ],
      {
        scope: { kind: "catalog" },
        pageUrl: "https://shop.example.invalid/p/1",
      },
    ),
  );

  assert.equal(matched.normalizedPageUrl, "https://shop.example.invalid/p/1");
});

test("商品を識別し得るqueryが異なる保存URLは一致させない", async () => {
  expectError(
    await match(
      [
        retailSource({
          sourceId: sourceId("1"),
          pageUrl: "https://shop.example.invalid/p/1?variant=black",
        }),
      ],
      {
        scope: { kind: "catalog" },
        pageUrl: "https://shop.example.invalid/p/1",
      },
    ),
    "no-match",
  );
});

test("catalog scopeでは候補IDを渡さず保存済みsource全体を照合対象にする", async () => {
  const catalog = createStubCatalog([
    retailSource({ sourceId: sourceId("1"), candidateId: candidateB }),
  ]);

  const matched = expectMatch(
    await createStoredSourceLocator({
      catalog: catalog.port,
    }).matchStoredSource({ scope: { kind: "catalog" }, pageUrl }),
  );

  assert.deepEqual(catalog.listCalls, [{}]);
  assert.equal(catalog.referenceCalls.length, 0);
  assert.equal(matched.candidateId, candidateB);
});

test("candidate scopeでは候補IDを上流portへ渡し他候補のsourceを照合対象にしない", async () => {
  const catalog = createStubCatalog([
    retailSource({ sourceId: sourceId("1"), candidateId: candidateA }),
    retailSource({ sourceId: sourceId("2"), candidateId: candidateB }),
  ]);

  const matched = expectMatch(
    await createStoredSourceLocator({
      catalog: catalog.port,
    }).matchStoredSource({
      scope: { kind: "candidate", candidateId: candidateB },
      pageUrl,
    }),
  );

  assert.deepEqual(catalog.listCalls, [{ candidateId: candidateB }]);
  assert.equal(matched.candidateId, candidateB);
  assert.equal(matched.sourceId, sourceId("2"));
});

test("一致する保存済みsourceが無い場合は no-match を返す", async () => {
  expectError(
    await match([
      retailSource({
        sourceId: sourceId("1"),
        pageUrl: "https://other.example.invalid/p/1",
      }),
    ]),
    "no-match",
  );
  expectError(await match([]), "no-match");
});

test("二件以上一致した場合はprimaryや配列順で暗黙選択せず ambiguous-match を返す", async () => {
  const references = [
    retailSource({ sourceId: sourceId("1"), isPrimary: false }),
    retailSource({
      sourceId: sourceId("2"),
      candidateId: candidateB,
      isPrimary: true,
    }),
  ];

  expectError(await match(references), "ambiguous-match");
  expectError(await match([...references].reverse()), "ambiguous-match");
});

test("同一候補内で二件一致した場合も ambiguous-match を返す", async () => {
  expectError(
    await match([
      retailSource({ sourceId: sourceId("1") }),
      retailSource({ sourceId: sourceId("2") }),
    ]),
    "ambiguous-match",
  );
});

test("retailと非retailが同一URLで並ぶ場合もretailを暗黙選択せず ambiguous-match を返す", async () => {
  const references = [
    retailSource({ sourceId: sourceId("1"), kind: "manufacturer" }),
    retailSource({ sourceId: sourceId("2"), kind: "retail" }),
  ];

  expectError(await match(references), "ambiguous-match");
  expectError(await match([...references].reverse()), "ambiguous-match");
});

test("pageUrlが欠損したsourceは照合対象から除外する", async () => {
  const withoutUrl: CandidateSourceReference = {
    candidateId: candidateA,
    sourceId: sourceId("9"),
    kind: "retail",
    isPrimary: true,
  };

  expectError(await match([withoutUrl]), "no-match");

  const matched = expectMatch(
    await match([withoutUrl, retailSource({ sourceId: sourceId("1") })]),
  );
  assert.equal(matched.sourceId, sourceId("1"));
});

test("正規化できない保存URLのsourceは照合対象から除外する", async () => {
  const invalidStored = retailSource({
    sourceId: sourceId("9"),
    pageUrl: "ftp://shop.example.invalid/p/1",
  });

  expectError(await match([invalidStored]), "no-match");

  const matched = expectMatch(
    await match([invalidStored, retailSource({ sourceId: sourceId("1") })]),
  );
  assert.equal(matched.sourceId, sourceId("1"));
});

test("一件一致してもkindが retail でないsourceは ineligible-source を返す", async () => {
  expectError(
    await match([
      retailSource({ sourceId: sourceId("1"), kind: "manufacturer" }),
    ]),
    "ineligible-source",
  );
});

test("一件一致してもkindが欠損したsourceは ineligible-source を返す", async () => {
  expectError(
    await match([
      {
        candidateId: candidateA,
        sourceId: sourceId("1"),
        pageUrl,
        isPrimary: true,
      },
    ]),
    "ineligible-source",
  );
});

test("source配列順を変えても同じ集合からは同じ結果を返す", async () => {
  const references = [
    retailSource({ sourceId: sourceId("1"), isPrimary: true }),
    retailSource({
      sourceId: sourceId("2"),
      pageUrl: "https://shop.example.invalid/p/2",
      isPrimary: false,
    }),
    {
      candidateId: candidateB,
      sourceId: sourceId("3"),
      isPrimary: true,
    } satisfies CandidateSourceReference,
    retailSource({
      sourceId: sourceId("4"),
      candidateId: candidateB,
      kind: "manufacturer",
      pageUrl: "https://maker.example.invalid/p/1",
    }),
  ];

  const forward = await match(references);
  const reversed = await match([...references].reverse());
  const rotated = await match([
    ...references.slice(2),
    ...references.slice(0, 2),
  ]);

  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, rotated);
  assert.equal(expectMatch(forward).sourceId, sourceId("1"));
});

test("照合対象ページのURLが受理できない場合はcatalogを読まずに invalid-url を返す", async () => {
  for (const value of [
    "ftp://shop.example.invalid/p/1",
    "chrome://extensions",
    "not a url",
    "",
  ]) {
    const catalog = createStubCatalog([
      retailSource({ sourceId: sourceId("1") }),
    ]);
    const result = await createStoredSourceLocator({
      catalog: catalog.port,
    }).matchStoredSource({ scope: { kind: "catalog" }, pageUrl: value });

    expectError(result, "invalid-url");
    assert.equal(
      catalog.listCalls.length,
      0,
      `catalogを読んではならない: ${value}`,
    );
  }
});

test("catalog読み取り失敗のmanagement errorを握り潰さず伝播する", async () => {
  const failures = [
    [{ code: "maintenance-active" }, { kind: "maintenance" }],
    [{ code: "storage-unavailable" }, { kind: "storage" }],
    [{ code: "quota-exceeded" }, { kind: "quota" }],
    [{ code: "revision-conflict" }, { kind: "conflict" }],
    [{ code: "unsupported-version" }, { kind: "unsupported-data" }],
  ] as const;

  for (const [failure, outputFailure] of failures) {
    const catalog = createStubCatalog([], failure);
    const result = await createStoredSourceLocator({
      catalog: catalog.port,
    }).matchStoredSource({ scope: { kind: "catalog" }, pageUrl });

    assert.deepEqual(result, { ok: false, error: outputFailure });
  }
});

test("candidate scopeで候補が存在しない not-found は no-match として提示する", async () => {
  const catalog = createStubCatalog([], {
    code: "validation" as const,
    reason: "entity-not-found" as const,
    message: "candidate",
  });

  expectError(
    await createStoredSourceLocator({
      catalog: catalog.port,
    }).matchStoredSource({
      scope: { kind: "candidate", candidateId: candidateB },
      pageUrl,
    }),
    "no-match",
  );
});
