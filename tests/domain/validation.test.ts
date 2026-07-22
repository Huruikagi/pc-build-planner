// @ts-nocheck テストfixtureを意図的に破損させ、unknown境界を検証する。
import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import {
  schemaValidator,
  validateSerializablePayload,
} from "../../src/domain/validation.ts";

const root = () => ({
  schemaVersion: 1,
  revision: 2,
  projects: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "架空構成",
      createdAt: "2026-07-18T01:00:00.000Z",
      updatedAt: "2026-07-18T02:00:00.000Z",
    },
  ],
  candidateParts: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      projectId: "11111111-1111-4111-8111-111111111111",
      category: "cpu",
      product: { name: { original: "架空CPU", confirmed: "Synthetic CPU" } },
      sourceInfo: {
        pageUrl: "https://example.invalid/products/1",
        capturedAt: "2026-07-18T01:30:00.000Z",
      },
      normalizedAttributes: {
        category: "cpu",
        socket: { original: "EX-1", confirmed: "EX-1" },
      },
      createdAt: "2026-07-18T01:30:00.000Z",
      updatedAt: "2026-07-18T01:30:00.000Z",
    },
  ],
  currentBuilds: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      projectId: "11111111-1111-4111-8111-111111111111",
      items: [
        {
          candidatePartId: "22222222-2222-4222-8222-222222222222",
          quantity: 1,
        },
      ],
      updatedAt: "2026-07-18T02:00:00.000Z",
    },
  ],
  requestDedupe: [
    {
      requestId: "44444444-4444-4444-8444-444444444444",
      payloadDigest: "sha256:synthetic",
      committedRevision: 2,
    },
  ],
  maintenance: { generation: 0, active: false },
});

const assertError = (result, code, path) => {
  assert.equal(result.ok, false);
  assert.deepEqual(result.error, { code, path });
};

test("有効なroot、command、replacementを入力を変更せず受理する", () => {
  const input = root();
  const before = structuredClone(input);
  assert.deepEqual(schemaValidator.validateRoot(input), {
    ok: true,
    value: input,
  });
  assert.deepEqual(input, before);
  assert.equal(schemaValidator.validateReplacement(input).ok, true);
  assert.equal(
    schemaValidator.validateCommand({ kind: "query-root" }).ok,
    true,
  );
  assert.equal(
    schemaValidator.validateCommand({
      kind: "mutate-root",
      requestId: "55555555-5555-4555-8555-555555555555",
      expectedRevision: 2,
      proposedRoot: input,
    }).ok,
    true,
  );
});

test("取得元の完全欠損・部分欠損・snapshotのnullを入力どおり受理する", () => {
  const withoutSource = root();
  delete withoutSource.candidateParts[0].sourceInfo;
  const partialSources = [
    { pageUrl: "https://example.invalid/products/url-only" },
    { capturedAt: "2026-07-22T03:04:05.000Z" },
    {},
  ];

  for (const sourceInfo of partialSources) {
    const input = structuredClone(withoutSource);
    input.candidateParts[0].sourceInfo = sourceInfo;
    const result = schemaValidator.validateRoot(input);
    assert.equal(result.ok, true);
    assert.strictEqual(result.value, input);
    assert.deepEqual(result.value.candidateParts[0].sourceInfo, sourceInfo);
  }

  withoutSource.candidateParts[0].sourceSnapshot = {
    name: "架空 CPU",
    manufacturer: null,
  };
  const result = schemaValidator.validateRoot(withoutSource);
  assert.equal(result.ok, true);
  assert.strictEqual(result.value, withoutSource);
  assert.equal("sourceInfo" in result.value.candidateParts[0], false);
  assert.deepEqual(result.value.candidateParts[0].sourceSnapshot, {
    name: "架空 CPU",
    manufacturer: null,
  });

  const nullPrototypeSnapshot = Object.assign(Object.create(null), {
    name: "架空 null prototype CPU",
    manufacturer: null,
  });
  const nullPrototypeInput = root();
  nullPrototypeInput.candidateParts[0].sourceSnapshot = nullPrototypeSnapshot;
  const nullPrototypeResult = schemaValidator.validateRoot(nullPrototypeInput);
  assert.equal(nullPrototypeResult.ok, true);
  assert.strictEqual(nullPrototypeResult.value, nullPrototypeInput);
  assert.strictEqual(
    nullPrototypeResult.value.candidateParts[0].sourceSnapshot,
    nullPrototypeSnapshot,
  );
});

test("存在する取得元値だけへURL・UTC規約を適用する", () => {
  for (const [sourceInfo, code, path] of [
    [
      { pageUrl: "not a URL" },
      "invalid-url",
      "$.candidateParts[0].sourceInfo.pageUrl",
    ],
    [
      { capturedAt: "2026-07-22T12:04:05+09:00" },
      "invalid-utc-timestamp",
      "$.candidateParts[0].sourceInfo.capturedAt",
    ],
  ]) {
    const input = root();
    input.candidateParts[0].sourceInfo = sourceInfo;
    assertError(schemaValidator.validateRoot(input), code, path);
  }
});

test("不正なsourceSnapshotを値のpath付きで拒否する", () => {
  for (const [snapshot, code, path] of [
    [
      { name: 123 },
      "invalid-string",
      "$.candidateParts[0].sourceSnapshot.name",
    ],
    [
      { name: undefined },
      "forbidden-payload",
      "$.candidateParts[0].sourceSnapshot.name",
    ],
    [
      { name: "<article>raw</article>" },
      "forbidden-payload",
      "$.candidateParts[0].sourceSnapshot.name",
    ],
    [
      { image: "encoded bytes" },
      "forbidden-payload",
      "$.candidateParts[0].sourceSnapshot.image",
    ],
    [
      { name: "data:image/png;base64,AAAA" },
      "forbidden-payload",
      "$.candidateParts[0].sourceSnapshot.name",
    ],
  ]) {
    const input = root();
    input.candidateParts[0].sourceSnapshot = snapshot;
    assertError(schemaValidator.validateRoot(input), code, path);
  }
});

test("sourceSnapshotのexotic objectをsnapshot pathで拒否する", () => {
  for (const snapshot of [new Date("2026-07-22T00:00:00.000Z"), new Map()]) {
    const input = root();
    input.candidateParts[0].sourceSnapshot = snapshot;
    assertError(
      schemaValidator.validateRoot(input),
      "forbidden-payload",
      "$.candidateParts[0].sourceSnapshot",
    );
  }
});

test("循環payloadをthrowせず循環先pathで拒否し、非循環の共有参照は受理する", () => {
  const circularSnapshot = {};
  circularSnapshot.self = circularSnapshot;
  const input = root();
  input.candidateParts[0].sourceSnapshot = circularSnapshot;
  assertError(
    schemaValidator.validateRoot(input),
    "forbidden-payload",
    "$.candidateParts[0].sourceSnapshot.self",
  );

  const shared = { label: "架空共有値" };
  assert.deepEqual(
    validateSerializablePayload({ left: shared, right: shared }),
    { ok: true, value: { left: shared, right: shared } },
  );
});

test("全12カテゴリの欠損可能な正規化属性を受理する", () => {
  const categories = [
    "cpu",
    "cpu-cooler",
    "motherboard",
    "memory",
    "gpu",
    "storage",
    "power-supply",
    "case",
    "case-fan",
    "expansion-card",
    "other",
    "uncategorized",
  ];
  for (const category of categories) {
    const value = root();
    value.candidateParts[0].category = category;
    value.candidateParts[0].normalizedAttributes = { category };
    assert.equal(schemaValidator.validateRoot(value).ok, true, category);
  }
});

test("UUID、UTC、URL、category整合をpathとcode付きで拒否する", () => {
  for (const [change, path, code] of [
    [
      (value) => {
        value.projects[0].id = "bad";
      },
      "$.projects[0].id",
      "invalid-uuid",
    ],
    [
      (value) => {
        value.projects[0].createdAt = "2026-07-18T10:00:00+09:00";
      },
      "$.projects[0].createdAt",
      "invalid-utc-timestamp",
    ],
    [
      (value) => {
        value.candidateParts[0].sourceInfo.pageUrl = "not a URL";
      },
      "$.candidateParts[0].sourceInfo.pageUrl",
      "invalid-url",
    ],
    [
      (value) => {
        value.candidateParts[0].normalizedAttributes.category = "gpu";
      },
      "$.candidateParts[0].normalizedAttributes.category",
      "category-mismatch",
    ],
  ]) {
    const value = root();
    change(value);
    const result = schemaValidator.validateRoot(value);
    assert.equal(result.ok, false);
    assert.deepEqual(result.error, { code, path });
  }
});

test("重複ID、project外参照、非正整数を拒否する", () => {
  const duplicate = root();
  duplicate.projects.push(structuredClone(duplicate.projects[0]));
  assert.deepEqual(schemaValidator.validateRoot(duplicate).error, {
    code: "duplicate-id",
    path: "$.projects[1].id",
  });
  const cross = root();
  cross.currentBuilds[0].projectId = "66666666-6666-4666-8666-666666666666";
  assert.deepEqual(schemaValidator.validateRoot(cross).error, {
    code: "missing-reference",
    path: "$.currentBuilds[0].projectId",
  });
  const quantity = root();
  quantity.currentBuilds[0].items[0].quantity = 0;
  assert.deepEqual(schemaValidator.validateRoot(quantity).error, {
    code: "invalid-positive-integer",
    path: "$.currentBuilds[0].items[0].quantity",
  });
});

test("candidate、build、request IDの重複を正確なpathで拒否する", () => {
  for (const [collection, idPath] of [
    ["candidateParts", "id"],
    ["currentBuilds", "id"],
    ["requestDedupe", "requestId"],
  ]) {
    const value = root();
    value[collection].push(structuredClone(value[collection][0]));
    assertError(
      schemaValidator.validateRoot(value),
      "duplicate-id",
      `$.${collection}[1].${idPath}`,
    );
  }
});

test("実在する別projectのcandidate参照を拒否する", () => {
  const value = root();
  value.projects.push({
    id: "66666666-6666-4666-8666-666666666666",
    name: "架空別構成",
    createdAt: "2026-07-18T01:00:00.000Z",
    updatedAt: "2026-07-18T02:00:00.000Z",
  });
  value.currentBuilds[0].projectId = value.projects[1].id;
  assertError(
    schemaValidator.validateRoot(value),
    "missing-reference",
    "$.currentBuilds[0].items[0].candidatePartId",
  );
});

test("quantityの負数、小数、非数値を個別に拒否する", () => {
  for (const quantity of [-1, 1.5, "1"]) {
    const value = root();
    value.currentBuilds[0].items[0].quantity = quantity;
    assertError(
      schemaValidator.validateRoot(value),
      "invalid-positive-integer",
      "$.currentBuilds[0].items[0].quantity",
    );
  }
});

test("生HTML、画像/data URL、余剰payloadと破損commandをfail closedする", () => {
  const html = root();
  html.candidateParts[0].product.html = "<main>secret</main>";
  assert.deepEqual(schemaValidator.validateRoot(html).error, {
    code: "forbidden-payload",
    path: "$.candidateParts[0].product.html",
  });
  const dataUrl = root();
  dataUrl.candidateParts[0].product.notes = {
    original: "data:image/png;base64,AAAA",
  };
  assert.deepEqual(schemaValidator.validateRoot(dataUrl).error, {
    code: "forbidden-payload",
    path: "$.candidateParts[0].product.notes.original",
  });
  const rawHtml = root();
  rawHtml.candidateParts[0].product.notes = {
    original: "<main>secret</main>",
  };
  assertError(
    schemaValidator.validateRoot(rawHtml),
    "forbidden-payload",
    "$.candidateParts[0].product.notes.original",
  );
  const nestedReplacement = root();
  nestedReplacement.candidateParts[0].product.notes = {
    original: "prefix <img src=x> suffix",
  };
  assertError(
    schemaValidator.validateReplacement(nestedReplacement),
    "forbidden-payload",
    "$.candidateParts[0].product.notes.original",
  );
  assert.equal(
    schemaValidator.validateReplacement({ schemaVersion: 1 }).ok,
    false,
  );
});

test("command decoderはfieldとkindをexact path/codeでfail closedする", () => {
  const valid = {
    kind: "mutate-root",
    requestId: "55555555-5555-4555-8555-555555555555",
    expectedRevision: 2,
    proposedRoot: root(),
  };
  const forbiddenRoot = root();
  forbiddenRoot.candidateParts[0].product.notes = { original: "<p>x</p>" };
  for (const [input, code, path] of [
    [{}, "missing-field", "$.kind"],
    [{ kind: "query-root", extra: true }, "unexpected-field", "$.extra"],
    [{ kind: "unknown" }, "invalid-string", "$.kind"],
    [{ ...valid, requestId: "bad" }, "invalid-uuid", "$.requestId"],
    [
      { ...valid, expectedRevision: -1 },
      "invalid-integer",
      "$.expectedRevision",
    ],
    [
      { kind: "mutate-root", expectedRevision: 2, proposedRoot: root() },
      "missing-field",
      "$.requestId",
    ],
    [{ ...valid, extra: true }, "unexpected-field", "$.extra"],
    [
      { ...valid, proposedRoot: forbiddenRoot },
      "forbidden-payload",
      "$.proposedRoot.candidateParts[0].product.notes.original",
    ],
  ]) {
    assertError(schemaValidator.validateCommand(input), code, path);
  }
});
