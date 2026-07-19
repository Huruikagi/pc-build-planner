// @ts-nocheck テストfixtureを意図的に破損させ、unknown境界を検証する。
import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node 26のtype strippingでTypeScript sourceを直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";

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
