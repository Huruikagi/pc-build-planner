import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectId } from "../../src/domain/public.js";
import type { ProjectPreferencePort } from "../../src/project-context/contracts.js";
import {
  createChromeProjectPreferencePortIfAvailable,
  createInMemoryProjectPreferencePort,
  createProjectPreferencePort,
  type ProjectPreferenceStorageApi,
} from "../../src/project-context/preference-store.js";

/** 架空 project ID。実データ由来の値を fixture に含めない。 */
const PROJECT_A = "11111111-2222-4333-8444-555555555555" as ProjectId;
const PROJECT_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" as ProjectId;

const KEY = "projectContextPreference";

interface StorageProbe {
  readonly storage: ProjectPreferenceStorageApi;
  readonly touchedKeys: string[];
  readonly written: Record<string, unknown>[];
  readonly removed: string[];
  readonly backing: Record<string, unknown>;
}

/**
 * `chrome.storage.local` の最小 double。触れた key をすべて記録し、
 * 専用 key 以外へ read/write/clear が及ばないことを検証できるようにする。
 */
const storageProbe = (
  overrides: {
    readonly initial?: Record<string, unknown>;
    readonly failGet?: boolean;
    readonly failSet?: boolean;
    readonly failRemove?: boolean;
  } = {},
): StorageProbe => {
  const backing: Record<string, unknown> = { ...overrides.initial };
  const touchedKeys: string[] = [];
  const written: Record<string, unknown>[] = [];
  const removed: string[] = [];
  return {
    backing,
    touchedKeys,
    written,
    removed,
    storage: {
      async get(key) {
        touchedKeys.push(key);
        if (overrides.failGet) throw new Error("storage rejected get");
        return key in backing ? { [key]: backing[key] } : {};
      },
      async set(items) {
        for (const key of Object.keys(items)) touchedKeys.push(key);
        if (overrides.failSet) throw new Error("storage rejected set");
        written.push(items);
        Object.assign(backing, items);
      },
      async remove(key) {
        touchedKeys.push(key);
        if (overrides.failRemove) throw new Error("storage rejected remove");
        removed.push(key);
        delete backing[key];
      },
    },
  };
};

const validDocument = (selectedProjectId: ProjectId) => ({
  version: 1,
  selectedProjectId,
});

test("readは保存値が無い場合missingを返す", async () => {
  const probe = storageProbe();
  const port = createProjectPreferencePort(probe.storage);
  assert.deepEqual(await port.read(), {
    ok: true,
    value: { kind: "missing" },
  });
  assert.deepEqual(probe.touchedKeys, [KEY]);
});

test("readはversion 1の正当なdocumentをvalidとして返す", async () => {
  const port = createProjectPreferencePort(
    storageProbe({ initial: { [KEY]: validDocument(PROJECT_A) } }).storage,
  );
  assert.deepEqual(await port.read(), {
    ok: true,
    value: { kind: "valid", selectedProjectId: PROJECT_A },
  });
});

test("readは形式が不正な保存値をinvalidとして返す", async () => {
  const brokenValues: readonly unknown[] = [
    null,
    42,
    "projectId",
    [],
    {},
    // version 欠落
    { selectedProjectId: PROJECT_A },
    // project ID 欠落
    { version: 1 },
    // UUID ではない project ID
    { version: 1, selectedProjectId: "not-a-uuid" },
    { version: 1, selectedProjectId: "" },
    { version: 1, selectedProjectId: 7 },
    // 未知 key の混入は strict object として拒否する
    {
      version: 1,
      selectedProjectId: PROJECT_A,
      projectName: "架空プロジェクト",
    },
    // 禁止 payload（project 内容や URL）を持ち込ませない
    {
      version: 1,
      selectedProjectId: PROJECT_A,
      sourceUrl: "https://example.invalid/parts",
    },
  ];

  for (const value of brokenValues) {
    const port = createProjectPreferencePort(
      storageProbe({ initial: { [KEY]: value } }).storage,
    );
    assert.deepEqual(
      await port.read(),
      { ok: true, value: { kind: "invalid" } },
      JSON.stringify(value ?? null),
    );
  }
});

test("readは未知versionをinvalidへ閉じ、推測migrationを行わない", async () => {
  for (const version of [0, 2, 99, "1", 1.5, null, true]) {
    const port = createProjectPreferencePort(
      storageProbe({
        initial: { [KEY]: { version, selectedProjectId: PROJECT_A } },
      }).storage,
    );
    assert.deepEqual(
      await port.read(),
      { ok: true, value: { kind: "invalid" } },
      String(version),
    );
  }
});

test("readは保存API拒否をstorage-unavailableへ閉じ、例外を漏らさない", async () => {
  const port = createProjectPreferencePort(
    storageProbe({ failGet: true }).storage,
  );
  assert.deepEqual(await port.read(), {
    ok: false,
    error: { kind: "storage-unavailable" },
  });
});

test("writeはversionとproject IDだけを専用keyへ書く", async () => {
  const probe = storageProbe();
  const port = createProjectPreferencePort(probe.storage);
  assert.deepEqual(await port.write(PROJECT_B), { ok: true, value: undefined });
  assert.deepEqual(probe.written, [
    { [KEY]: { version: 1, selectedProjectId: PROJECT_B } },
  ]);
  assert.deepEqual(Object.keys(probe.written[0] ?? {}), [KEY]);
  assert.deepEqual(
    Object.keys(
      (probe.written[0]?.[KEY] ?? {}) as Record<string, unknown>,
    ).sort(),
    ["selectedProjectId", "version"],
  );
});

test("writeは書き込み拒否をstorage-write-failedへ閉じる", async () => {
  const port = createProjectPreferencePort(
    storageProbe({ failSet: true }).storage,
  );
  assert.deepEqual(await port.write(PROJECT_A), {
    ok: false,
    error: { kind: "storage-write-failed" },
  });
});

test("clearは専用keyだけを消去し、以後readはmissingになる", async () => {
  const probe = storageProbe({ initial: { [KEY]: validDocument(PROJECT_A) } });
  const port = createProjectPreferencePort(probe.storage);
  assert.deepEqual(await port.clear(), { ok: true, value: undefined });
  assert.deepEqual(probe.removed, [KEY]);
  assert.deepEqual(await port.read(), { ok: true, value: { kind: "missing" } });
});

test("clearは消去拒否をstorage-write-failedへ閉じる", async () => {
  const port = createProjectPreferencePort(
    storageProbe({ failRemove: true }).storage,
  );
  assert.deepEqual(await port.clear(), {
    ok: false,
    error: { kind: "storage-write-failed" },
  });
});

test("read/write/clearは専用key以外へ一切触れない", async () => {
  const probe = storageProbe({
    initial: {
      [KEY]: validDocument(PROJECT_A),
      localDataRoot: { untouched: true },
      uiLanguage: "ja",
    },
  });
  const port = createProjectPreferencePort(probe.storage);
  await port.read();
  await port.write(PROJECT_B);
  await port.clear();

  assert.deepEqual([...new Set(probe.touchedKeys)], [KEY]);
  assert.deepEqual(probe.backing.localDataRoot, { untouched: true });
  assert.equal(probe.backing.uiLanguage, "ja");
});

test("errorは保存値・project ID・vendor例外を含まない", async () => {
  const failing = createProjectPreferencePort(
    storageProbe({ failGet: true, failSet: true, failRemove: true }).storage,
  );
  const results = [
    await failing.read(),
    await failing.write(PROJECT_A),
    await failing.clear(),
  ];
  for (const result of results) {
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.deepEqual(Object.keys(result.error), ["kind"]);
    assert.equal(typeof result.error.kind, "string");
    assert.ok(!JSON.stringify(result.error).includes(PROJECT_A));
  }
});

/** Chrome adapter と in-memory adapter が同じ port 契約を満たすことを確認する。 */
const portParityCases: readonly {
  readonly name: string;
  readonly create: (initialStoredValue?: unknown) => ProjectPreferencePort;
}[] = [
  {
    name: "chrome storage adapter",
    create: (initialStoredValue) =>
      createProjectPreferencePort(
        storageProbe(
          initialStoredValue === undefined
            ? {}
            : { initial: { [KEY]: initialStoredValue } },
        ).storage,
      ),
  },
  {
    name: "in-memory adapter",
    create: (initialStoredValue) =>
      createInMemoryProjectPreferencePort(initialStoredValue),
  },
];

for (const { name, create } of portParityCases) {
  test(`${name}は同じport契約でmissing/valid/invalidを区別する`, async () => {
    assert.deepEqual(await create().read(), {
      ok: true,
      value: { kind: "missing" },
    });
    assert.deepEqual(await create(validDocument(PROJECT_A)).read(), {
      ok: true,
      value: { kind: "valid", selectedProjectId: PROJECT_A },
    });
    assert.deepEqual(await create({ version: 2 }).read(), {
      ok: true,
      value: { kind: "invalid" },
    });
  });

  test(`${name}はwrite後にvalid、clear後にmissingを返す`, async () => {
    const port = create();
    assert.deepEqual(await port.write(PROJECT_B), {
      ok: true,
      value: undefined,
    });
    assert.deepEqual(await port.read(), {
      ok: true,
      value: { kind: "valid", selectedProjectId: PROJECT_B },
    });
    assert.deepEqual(await port.clear(), { ok: true, value: undefined });
    assert.deepEqual(await port.read(), {
      ok: true,
      value: { kind: "missing" },
    });
  });

  test(`${name}は同じ入力に対して決定的な結果を返す`, async () => {
    const port = create(validDocument(PROJECT_A));
    assert.deepEqual(await port.read(), await port.read());
  });
}

test("in-memory adapterはinvalidな保存値をwriteで修復できる", async () => {
  const port = createInMemoryProjectPreferencePort({ version: 99 });
  assert.deepEqual(await port.read(), { ok: true, value: { kind: "invalid" } });
  await port.write(PROJECT_A);
  assert.deepEqual(await port.read(), {
    ok: true,
    value: { kind: "valid", selectedProjectId: PROJECT_A },
  });
});

test("in-memory adapter同士のインスタンスは状態を共有しない", async () => {
  const first = createInMemoryProjectPreferencePort();
  const second = createInMemoryProjectPreferencePort();
  await first.write(PROJECT_A);
  assert.deepEqual(await second.read(), {
    ok: true,
    value: { kind: "missing" },
  });
});

test("Chrome APIが存在しない実行環境ではundefinedを返す", () => {
  assert.equal(createChromeProjectPreferencePortIfAvailable(), undefined);
});
