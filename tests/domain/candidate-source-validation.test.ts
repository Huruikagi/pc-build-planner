import assert from "node:assert/strict";
import test from "node:test";

import { schemaValidator } from "../../src/domain/validation.js";

const root = () => ({
  schemaVersion: 1,
  revision: 0,
  projects: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "架空プロジェクト",
      createdAt: "2026-07-28T01:02:03Z",
      updatedAt: "2026-07-28T01:02:03Z",
    },
  ],
  candidateParts: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      projectId: "11111111-1111-4111-8111-111111111111",
      category: "cpu",
      product: { name: { original: "架空CPU" } },
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          pageUrl: "https://shop.example.invalid/cpu",
          siteName: "架空ショップ",
          capturedAt: "2026-07-28T01:02:03Z",
          price: {
            original: "12,345 JPY",
            confirmed: { amount: 12345, currency: "JPY" },
          },
          kind: "retail",
        },
      ],
      primarySourceId: "33333333-3333-4333-8333-333333333333",
      sourceSnapshot: { title: "架空CPU" },
      normalizedAttributes: { category: "cpu" },
      createdAt: "2026-07-28T01:02:03Z",
      updatedAt: "2026-07-28T01:02:03Z",
    },
  ],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
});

const candidate = (input: ReturnType<typeof root>) => {
  const value = input.candidateParts.at(0);
  assert.ok(value);
  return value;
};

const source = (input: ReturnType<typeof root>) => {
  const value = candidate(input).sources.at(0);
  assert.ok(value);
  return value;
};

test("canonical schema 1 validatorは独立したsourceとprimaryを受理する", () => {
  assert.equal(schemaValidator.validateRoot(root()).ok, true);
});

test("sourceの固定fieldと未信頼値をpath付きで拒否する", () => {
  const cases = [
    ["pageUrl", "data:text/plain,bad", "forbidden-payload"],
    ["capturedAt", "2026-07-28", "invalid-utc-timestamp"],
    ["kind", "marketplace", "invalid-string"],
    ["siteName", "<img src=x>", "forbidden-payload"],
  ] as const;
  for (const [field, value, code] of cases) {
    const input = root();
    Object.assign(source(input), { [field]: value });
    assert.deepEqual(schemaValidator.validateRoot(input), {
      ok: false,
      error: {
        code,
        path: `$.candidateParts[0].sources[0].${field}`,
      },
    });
  }

  const input = root();
  Object.assign(source(input), { extra: "no" });
  assert.deepEqual(schemaValidator.validateRoot(input), {
    ok: false,
    error: {
      code: "unexpected-field",
      path: "$.candidateParts[0].sources[0].extra",
    },
  });
});

test("source ID重複とprimary不整合を拒否する", () => {
  const duplicate = root();
  candidate(duplicate).sources.push({ ...source(duplicate) });
  assert.deepEqual(schemaValidator.validateRoot(duplicate), {
    ok: false,
    error: {
      code: "duplicate-id",
      path: "$.candidateParts[0].sources[1].id",
    },
  });

  const missing = root();
  candidate(missing).primarySourceId = "44444444-4444-4444-8444-444444444444";
  assert.deepEqual(schemaValidator.validateRoot(missing), {
    ok: false,
    error: {
      code: "missing-reference",
      path: "$.candidateParts[0].primarySourceId",
    },
  });

  const noPrimary = root();
  delete (candidate(noPrimary) as { primarySourceId?: string }).primarySourceId;
  assert.deepEqual(schemaValidator.validateRoot(noPrimary), {
    ok: false,
    error: {
      code: "missing-field",
      path: "$.candidateParts[0].primarySourceId",
    },
  });

  const empty = root();
  candidate(empty).sources = [];
  assert.deepEqual(schemaValidator.validateRoot(empty), {
    ok: false,
    error: {
      code: "unexpected-field",
      path: "$.candidateParts[0].primarySourceId",
    },
  });
});

test("canonical validatorは商品共通priceと単数sourceInfoを拒否する", () => {
  for (const [field, value] of [
    ["sourceInfo", {}],
    ["product", { price: { original: "100 JPY" } }],
  ] as const) {
    const input = root();
    if (field === "product") Object.assign(candidate(input).product, value);
    else Object.assign(candidate(input), { [field]: value });
    assert.equal(schemaValidator.validateRoot(input).ok, false);
  }
  assert.equal(
    schemaValidator.validateRoot({ ...root(), schemaVersion: 2 }).ok,
    false,
  );
});
