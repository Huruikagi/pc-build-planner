import assert from "node:assert/strict";
import test from "node:test";
import {
  err,
  ok,
  type ProjectId,
  type Result,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import {
  createProjectCatalogProjection,
  createProjectContextSnapshot,
  resolveProjectCatalogSelection,
  unavailableProjectContextSnapshot,
} from "../../src/project-context/catalog.js";
import type {
  ProjectCatalogError,
  ProjectCatalogItem,
  ProjectCatalogSource,
} from "../../src/project-context/contracts.js";

// 架空の project ID・名前だけを使う（steering: testing.md テストデータ）。
const ALPHA_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const BRAVO_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;
const CHARLIE_ID = "33333333-3333-4333-8333-333333333333" as ProjectId;
const ABSENT_ID = "99999999-9999-4999-8999-999999999999" as ProjectId;

const at = (value: string): UtcTimestamp => value as UtcTimestamp;

const project = (
  id: ProjectId,
  name: string,
  updatedAt: string,
): ProjectCatalogItem => ({ id, name, updatedAt: at(updatedAt) });

/** source 順を維持しているかを確認するため、名前・日時の並びは意図的にばらけさせる。 */
const ALPHA = project(
  ALPHA_ID,
  "架空プロジェクト・ゼータ",
  "2026-03-01T00:00:00Z",
);
const BRAVO = project(
  BRAVO_ID,
  "架空プロジェクト・アルファ",
  "2026-01-05T00:00:00Z",
);
const CHARLIE = project(
  CHARLIE_ID,
  "架空プロジェクト・ミュー",
  "2026-02-10T00:00:00Z",
);

const CATALOG = [ALPHA, BRAVO, CHARLIE] as const;

/** entry 検証を確かめるため、型を外した値も渡せる stub source。 */
const sourceOf = (entries: unknown): ProjectCatalogSource => ({
  async list() {
    return ok(entries as readonly ProjectCatalogItem[]);
  },
});

const failingSource = (error: ProjectCatalogError): ProjectCatalogSource => ({
  async list() {
    return err(error);
  },
});

const throwingSource: ProjectCatalogSource = {
  async list() {
    throw new Error("owner query rejected");
  },
};

const expectOk = <T>(result: Result<T, ProjectCatalogError>): T => {
  assert.ok(result.ok, `expected ok result, got ${JSON.stringify(result)}`);
  return result.value;
};

const expectErr = <T>(
  result: Result<T, ProjectCatalogError>,
): ProjectCatalogError => {
  assert.ok(!result.ok, "expected err result");
  return result.error;
};

// --- projection ------------------------------------------------------------

test("要件2.4: projection は source 順を保ち id/name/updatedAt だけを複製する", async () => {
  const projection = createProjectCatalogProjection(
    sourceOf([
      { ...ALPHA, secret: "内部 field", archived: true },
      { ...BRAVO },
      { ...CHARLIE },
    ]),
  );

  const catalog = expectOk(await projection.load());

  assert.deepEqual(
    catalog.map((item) => item.id),
    [ALPHA_ID, BRAVO_ID, CHARLIE_ID],
  );
  assert.deepEqual(Object.keys(catalog[0] ?? {}).sort(), [
    "id",
    "name",
    "updatedAt",
  ]);
  assert.deepEqual(catalog[0], ALPHA);
});

test("要件1.2: project が存在しない source は空 catalog を成功として返す", async () => {
  const catalog = expectOk(
    await createProjectCatalogProjection(sourceOf([])).load(),
  );
  assert.deepEqual(catalog, []);
});

test("要件1.3: duplicate ID は部分 catalog にせず invalid-catalog として拒否する", async () => {
  const projection = createProjectCatalogProjection(
    sourceOf([ALPHA, BRAVO, { ...ALPHA, name: "架空プロジェクト・複製" }]),
  );

  assert.deepEqual(expectErr(await projection.load()), {
    kind: "invalid-catalog",
  });
});

test("要件1.3: 不正 entry は一件でも catalog 全体を拒否する", async () => {
  const invalidEntries: readonly (readonly [string, unknown])[] = [
    ["非オブジェクト", "架空プロジェクト"],
    ["null entry", null],
    ["ID 欠落", { name: ALPHA.name, updatedAt: ALPHA.updatedAt }],
    ["ID が UUID でない", { ...ALPHA, id: "project-1" }],
    ["名前が空文字", { ...ALPHA, name: "" }],
    ["名前が空白のみ", { ...ALPHA, name: "   " }],
    ["名前が非文字列", { ...ALPHA, name: 42 }],
    ["updatedAt が不正", { ...ALPHA, updatedAt: "2026-03-01" }],
    ["updatedAt 欠落", { id: ALPHA.id, name: ALPHA.name }],
  ];

  for (const [label, invalid] of invalidEntries) {
    const projection = createProjectCatalogProjection(
      sourceOf([BRAVO, invalid, CHARLIE]),
    );
    assert.deepEqual(
      expectErr(await projection.load()),
      { kind: "invalid-catalog" },
      label,
    );
  }
});

test("要件1.3: source 自体が配列を返さない場合も invalid-catalog にする", async () => {
  const projection = createProjectCatalogProjection(
    sourceOf({ projects: [ALPHA] }),
  );
  assert.deepEqual(expectErr(await projection.load()), {
    kind: "invalid-catalog",
  });
});

test("要件1.3: source failure は部分 catalog にせず失敗のまま伝える", async () => {
  assert.deepEqual(
    expectErr(
      await createProjectCatalogProjection(
        failingSource({ kind: "source-unavailable" }),
      ).load(),
    ),
    { kind: "source-unavailable" },
  );
  assert.deepEqual(
    expectErr(
      await createProjectCatalogProjection(
        failingSource({ kind: "invalid-catalog" }),
      ).load(),
    ),
    { kind: "invalid-catalog" },
  );
  assert.deepEqual(
    expectErr(await createProjectCatalogProjection(throwingSource).load()),
    { kind: "source-unavailable" },
  );
});

test("projection が返す catalog と item は変更できない", async () => {
  const catalog = expectOk(
    await createProjectCatalogProjection(sourceOf([ALPHA])).load(),
  );

  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(catalog[0]));
});

// --- selection resolution --------------------------------------------------

test("要件4.2: 現在選択が catalog に存在すれば維持する", () => {
  assert.equal(resolveProjectCatalogSelection(CATALOG, CHARLIE_ID), CHARLIE_ID);
});

test("要件2.3, 2.4, 4.3: 選択が無い・存在しない場合は source 順の先頭だけを fallback にする", () => {
  assert.equal(resolveProjectCatalogSelection(CATALOG, null), ALPHA_ID);
  assert.equal(resolveProjectCatalogSelection(CATALOG, ABSENT_ID), ALPHA_ID);
});

test("要件1.2: catalog が空なら選択は null になる", () => {
  assert.equal(resolveProjectCatalogSelection([], ABSENT_ID), null);
});

// --- snapshot --------------------------------------------------------------

test("要件1.1, 1.4: ready snapshot の選択は catalog に一意に存在する", () => {
  const snapshot = createProjectContextSnapshot({
    generation: 3,
    catalog: ok(CATALOG),
    preferredProjectId: BRAVO_ID,
  });

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.generation, 3);
  assert.equal(snapshot.selectedProjectId, BRAVO_ID);
  assert.deepEqual(
    snapshot.catalog.map((item) => item.id),
    [ALPHA_ID, BRAVO_ID, CHARLIE_ID],
  );
  assert.equal(
    snapshot.catalog.filter((item) => item.id === snapshot.selectedProjectId)
      .length,
    1,
  );
});

test("要件1.2, 1.5: empty snapshot は空 catalog と null 選択を公開する", () => {
  const snapshot = createProjectContextSnapshot({
    generation: 1,
    catalog: ok([]),
    preferredProjectId: ALPHA_ID,
  });

  assert.equal(snapshot.status, "empty");
  assert.equal(snapshot.selectedProjectId, null);
  assert.deepEqual(snapshot.catalog, []);
});

test("要件1.3, 1.5: unavailable snapshot は catalog も以前の選択も公開しない", () => {
  const snapshot = createProjectContextSnapshot({
    generation: 7,
    catalog: err({ kind: "source-unavailable" }),
    preferredProjectId: ALPHA_ID,
  });

  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.generation, 7);
  assert.equal(snapshot.selectedProjectId, null);
  assert.equal(snapshot.reason, "catalog-unavailable");
  assert.ok(!("catalog" in snapshot));
});

test("要件1.5: 明示的な unavailable snapshot も選択を公開しない", () => {
  const snapshot = unavailableProjectContextSnapshot(0, "not-initialized");

  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.selectedProjectId, null);
  assert.equal(snapshot.reason, "not-initialized");
  assert.ok(!("catalog" in snapshot));
});

test("要件1.6: 同じ catalog fixture から全 consumer が同一 snapshot を得る", async () => {
  const source = sourceOf([ALPHA, BRAVO, CHARLIE]);

  const buildSnapshot = async () =>
    createProjectContextSnapshot({
      generation: 5,
      // consumer は独自 fallback を持たず、希望値を渡すだけで選択が確定する。
      catalog: await createProjectCatalogProjection(source).load(),
      preferredProjectId: ABSENT_ID,
    });

  const first = await buildSnapshot();
  const second = await buildSnapshot();

  assert.deepEqual(first, second);
  assert.equal(first.status, "ready");
  assert.equal(first.selectedProjectId, ALPHA_ID);
});

test("snapshot は凍結されており consumer が書き換えられない", () => {
  const snapshot = createProjectContextSnapshot({
    generation: 2,
    catalog: ok(CATALOG),
    preferredProjectId: null,
  });

  assert.ok(Object.isFrozen(snapshot));
  assert.equal(snapshot.status, "ready");
  assert.ok(Object.isFrozen(snapshot.catalog));
});
