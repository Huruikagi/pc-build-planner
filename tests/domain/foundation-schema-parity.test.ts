import assert from "node:assert/strict";
import test from "node:test";

import type { Result } from "../../src/domain/result.js";
import {
  candidateSourcePageUrlPath,
  schemaValidator,
  type ValidationError,
  type ValidationErrorCode,
  validateCandidatePartContent,
  validateCandidatePartDraft,
  validateCandidatePartValue,
} from "../../src/domain/validation.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const candidateId = "22222222-2222-4222-8222-222222222222";
const buildId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const ownerId = "55555555-5555-4555-8555-555555555555";
const sourceId = "66666666-6666-4666-8666-666666666666";
const timestamp = "2026-08-01T00:00:00.000Z";

type Mutable = Record<string, unknown>;

const candidate = (): Mutable => ({
  id: candidateId,
  projectId,
  category: "cpu",
  product: { name: { original: "架空CPU", confirmed: "架空CPU X1" } },
  sources: [{ id: sourceId, pageUrl: "https://shop.example.invalid/cpu" }],
  primarySourceId: sourceId,
  normalizedAttributes: {
    category: "cpu",
    socket: { original: "EX-1", confirmed: "EX-1" },
  },
  createdAt: timestamp,
  updatedAt: timestamp,
});

const root = (): Mutable => ({
  schemaVersion: 1,
  revision: 3,
  projects: [
    {
      id: projectId,
      name: "架空構成",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  candidateParts: [candidate()],
  currentBuilds: [
    {
      id: buildId,
      projectId,
      items: [{ candidatePartId: candidateId, quantity: 2 }],
      updatedAt: timestamp,
    },
  ],
  requestDedupe: [
    { requestId, payloadDigest: "sha256:架空", committedRevision: 3 },
  ],
  maintenance: { generation: 0, active: false },
});

/** Applies one targeted corruption to an otherwise valid aggregate. */
const corrupted = (change: (value: Mutable) => void): Mutable => {
  const value = root();
  change(value);
  return value;
};

/** Narrows a collection slot of a fixture without an unchecked assertion. */
const at2 = (value: unknown): Mutable[] => {
  assert.ok(Array.isArray(value));
  return value as Mutable[];
};

const at = (value: unknown, index: number): Mutable => {
  const item = at2(value)[index];
  assert.ok(item);
  return item;
};

const errorOf = (result: { ok: boolean; error?: ValidationError }) => {
  assert.equal(result.ok, false);
  return result.error;
};

const decoded = <T>(result: Result<T, ValidationError>): T => {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.value;
};

const assertRejects = (
  input: unknown,
  code: ValidationErrorCode,
  path: string,
) => {
  assert.deepEqual(errorOf(schemaValidator.validateRoot(input)), {
    code,
    path,
  });
  // Replacement applies the same shape, version and reference rules as a root.
  assert.deepEqual(errorOf(schemaValidator.validateReplacement(input)), {
    code,
    path,
  });
};

test("project・build・dedupe fragmentの型違反を既存code/pathで拒否する", () => {
  const cases: readonly [
    (value: Mutable) => void,
    ValidationErrorCode,
    string,
  ][] = [
    [
      (value) => {
        at(value.projects, 0).name = 12;
      },
      "invalid-string",
      "$.projects[0].name",
    ],
    [
      (value) => {
        delete at(value.projects, 0).updatedAt;
      },
      "missing-field",
      "$.projects[0].updatedAt",
    ],
    [
      (value) => {
        at(value.currentBuilds, 0).items = {};
      },
      "invalid-array",
      "$.currentBuilds[0].items",
    ],
    [
      (value) => {
        at(value.currentBuilds, 0).label = "架空";
      },
      "unexpected-field",
      "$.currentBuilds[0].label",
    ],
    [
      (value) => {
        at(value.requestDedupe, 0).payloadDigest = 1;
      },
      "invalid-string",
      "$.requestDedupe[0].payloadDigest",
    ],
    [
      (value) => {
        at(value.requestDedupe, 0).committedRevision = -1;
      },
      "invalid-integer",
      "$.requestDedupe[0].committedRevision",
    ],
    [
      (value) => {
        value.projects = {};
      },
      "invalid-array",
      "$.projects",
    ],
    [
      (value) => {
        value.revision = 1.5;
      },
      "invalid-integer",
      "$.revision",
    ],
    [
      (value) => {
        value.schemaVersion = 2;
      },
      "unsupported-schema",
      "$.schemaVersion",
    ],
  ];

  for (const [change, code, path] of cases)
    assertRejects(corrupted(change), code, path);
});

test("maintenanceのactive/inactiveで許容fieldが切り替わる", () => {
  const active = corrupted((value) => {
    value.maintenance = {
      generation: 2,
      active: true,
      ownerId,
      leaseExpiresAt: timestamp,
    };
  });
  assert.equal(schemaValidator.validateRoot(active).ok, true);

  const cases: readonly [unknown, ValidationErrorCode, string][] = [
    [
      { generation: 0, active: true, leaseExpiresAt: timestamp },
      "missing-field",
      "$.maintenance.ownerId",
    ],
    [
      { generation: 0, active: true, ownerId },
      "missing-field",
      "$.maintenance.leaseExpiresAt",
    ],
    [
      {
        generation: 0,
        active: true,
        ownerId: "bad",
        leaseExpiresAt: timestamp,
      },
      "invalid-uuid",
      "$.maintenance.ownerId",
    ],
    [
      { generation: 0, active: true, ownerId, leaseExpiresAt: "2026-08-01" },
      "invalid-utc-timestamp",
      "$.maintenance.leaseExpiresAt",
    ],
    [
      { generation: 0, active: false, ownerId },
      "unexpected-field",
      "$.maintenance.ownerId",
    ],
    [
      { generation: -1, active: false },
      "invalid-integer",
      "$.maintenance.generation",
    ],
    [
      { generation: 0, active: "no" },
      "invalid-boolean",
      "$.maintenance.active",
    ],
    [{ active: false }, "missing-field", "$.maintenance.generation"],
    ["inactive", "missing-field", "$.maintenance"],
  ];

  for (const [maintenance, code, path] of cases)
    assertRejects(
      corrupted((value) => {
        value.maintenance = maintenance;
      }),
      code,
      path,
    );
});

test("candidate内部の入れ子shapeを違反したnested pathで拒否する", () => {
  const cases: readonly [
    (value: Mutable) => void,
    ValidationErrorCode,
    string,
  ][] = [
    [
      (value) => {
        (value.product as Mutable).name = { original: "架空", extra: 1 };
      },
      "unexpected-field",
      "$.product.name.extra",
    ],
    [
      (value) => {
        (value.product as Mutable).name = { confirmed: "架空" };
      },
      "missing-field",
      "$.product.name.original",
    ],
    [
      (value) => {
        (value.normalizedAttributes as Mutable).socket = {
          original: null,
          confirmed: ["EX-1"],
        };
      },
      "invalid-string",
      "$.normalizedAttributes.socket.confirmed",
    ],
    [
      (value) => {
        value.category = "cpu-cooler";
        value.normalizedAttributes = {
          category: "cpu-cooler",
          supportedSockets: { original: null, confirmed: "EX-1" },
        };
      },
      "invalid-array",
      "$.normalizedAttributes.supportedSockets.confirmed",
    ],
    [
      (value) => {
        at(value.sources, 0).price = {
          original: "12,345 JPY",
          confirmed: { amount: "12345", currency: "JPY" },
        };
      },
      "invalid-integer",
      "$.sources[0].price.confirmed.amount",
    ],
    [
      (value) => {
        at(value.sources, 0).price = {
          original: "12,345 JPY",
          confirmed: { amount: 12_345 },
        };
      },
      "missing-field",
      "$.sources[0].price.confirmed.currency",
    ],
    [
      (value) => {
        value.category = "gpu";
        value.normalizedAttributes = { category: "gpu", socket: null };
      },
      "unexpected-field",
      "$.normalizedAttributes.socket",
    ],
    [
      (value) => {
        value.category = "unknown-category";
      },
      "category-mismatch",
      "$.category",
    ],
  ];

  for (const [change, code, path] of cases) {
    const value = candidate();
    change(value);
    assert.deepEqual(errorOf(validateCandidatePartValue(value)), {
      code,
      path,
    });
  }
});

test("draft・content・valueの公開入口が同じ規則を別の必須集合で適用する", () => {
  const value = candidate();
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...content
  } = value;
  const { projectId: _projectId, ...draft } = content;

  assert.strictEqual(decoded(validateCandidatePartValue(value)), value);
  assert.strictEqual(decoded(validateCandidatePartContent(content)), content);
  assert.strictEqual(decoded(validateCandidatePartDraft(draft)), draft);

  // A draft may carry no source at all; saved content may not.
  const {
    sources: _sources,
    primarySourceId: _primary,
    ...sourceless
  } = content;
  const { projectId: _sourcelessProject, ...sourcelessDraft } = sourceless;
  assert.equal(validateCandidatePartDraft(sourcelessDraft).ok, true);
  assert.deepEqual(errorOf(validateCandidatePartContent(sourceless)), {
    code: "missing-field",
    path: "$.sources",
  });
  assert.deepEqual(errorOf(validateCandidatePartDraft(content)), {
    code: "unexpected-field",
    path: "$.projectId",
  });
  assert.deepEqual(errorOf(validateCandidatePartContent(value)), {
    code: "unexpected-field",
    path: "$.id",
  });

  // The public URL path helper still addresses the same canonical field.
  assert.equal(candidateSourcePageUrlPath(0), "sources[0].pageUrl");
  assert.deepEqual(
    errorOf(
      validateCandidatePartDraft({
        ...draft,
        sources: [{ id: sourceId, pageUrl: "not a URL" }],
      }),
    ),
    { code: "invalid-url", path: `$.${candidateSourcePageUrlPath(0)}` },
  );
});

test("aggregate参照とownershipをshape成功後に既存順序で検査する", () => {
  const foreignProject = "77777777-7777-4777-8777-777777777777";
  assertRejects(
    corrupted((value) => {
      at(value.candidateParts, 0).projectId = foreignProject;
    }),
    "missing-reference",
    "$.candidateParts[0].projectId",
  );
  assertRejects(
    corrupted((value) => {
      at(value.currentBuilds, 0).items = [
        {
          candidatePartId: "88888888-8888-4888-8888-888888888888",
          quantity: 1,
        },
      ];
    }),
    "missing-reference",
    "$.currentBuilds[0].items[0].candidatePartId",
  );
  assertRejects(
    corrupted((value) => {
      const source = at(value.candidateParts, 0);
      source.primarySourceId = "99999999-9999-4999-8999-999999999999";
    }),
    "missing-reference",
    "$.candidateParts[0].primarySourceId",
  );
  assertRejects(
    corrupted((value) => {
      at2(value.requestDedupe).push({
        requestId,
        payloadDigest: "sha256:架空2",
        committedRevision: 3,
      });
    }),
    "duplicate-id",
    "$.requestDedupe[1].requestId",
  );
});

test("commandはkindごとの必須・許容fieldをhandlerより前に閉じる", () => {
  assert.equal(
    schemaValidator.validateCommand({ kind: "query-root" }).ok,
    true,
  );
  const mutate = {
    kind: "mutate-root",
    requestId,
    expectedRevision: 3,
    proposedRoot: root(),
  };
  assert.equal(schemaValidator.validateCommand(mutate).ok, true);

  const cases: readonly [unknown, ValidationErrorCode, string][] = [
    ["mutate-root", "missing-field", "$"],
    [[], "missing-field", "$"],
    [{ kind: 1 }, "invalid-string", "$.kind"],
    [{ kind: "assess-replacement" }, "invalid-string", "$.kind"],
    [
      { kind: "query-root", expectedRevision: 3 },
      "unexpected-field",
      "$.expectedRevision",
    ],
    [
      { ...mutate, expectedRevision: "3" },
      "invalid-integer",
      "$.expectedRevision",
    ],
    [
      { ...mutate, proposedRoot: {} },
      "missing-field",
      "$.proposedRoot.schemaVersion",
    ],
    [
      {
        ...mutate,
        proposedRoot: corrupted((value) => {
          value.revision = -1;
        }),
      },
      "invalid-integer",
      "$.proposedRoot.revision",
    ],
    [
      {
        ...mutate,
        proposedRoot: corrupted((value) => {
          value.maintenance = { generation: 0, active: true, ownerId };
        }),
      },
      "missing-field",
      "$.proposedRoot.maintenance.leaseExpiresAt",
    ],
  ];

  for (const [input, code, path] of cases)
    assert.deepEqual(errorOf(schemaValidator.validateCommand(input)), {
      code,
      path,
    });
});

test("有効なroot・command・replacementは入力を変更せず同一参照で返す", () => {
  const input = root();
  const before = structuredClone(input);
  const validated = schemaValidator.validateRoot(input);

  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.strictEqual(validated.value, input);
  assert.deepEqual(input, before);

  const replaced = schemaValidator.validateReplacement(input);
  assert.equal(replaced.ok, true);
  if (!replaced.ok) return;
  assert.strictEqual(replaced.value, input);
  assert.deepEqual(input, before);
});
