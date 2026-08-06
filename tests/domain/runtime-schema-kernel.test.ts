import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalPath,
  decodeWithProfile,
  httpUrl,
  inspectJsonSafety,
  optionalField,
  plainObject,
  positiveInteger,
  projectIssues,
  revision,
  type SchemaIssueView,
  type SchemaNode,
  safeBoolean,
  safeString,
  selectPrimaryIssue,
  tagged,
  utcTimestamp,
  uuid,
  z,
} from "../../src/domain/runtime-schema/public.js";

/** Reduces a parse failure to the deterministic `[code, tag, path]` triple. */
const failureOf = (schema: SchemaNode, input: unknown, base = "$") => {
  const parsed = z.safeParse(schema, input);
  if (parsed.success) return undefined;
  const issue = selectPrimaryIssue(projectIssues(parsed.error.issues));
  return {
    code: issue.code,
    tag: issue.tag,
    path: canonicalPath(issue.path, base),
  };
};

const accepts = (schema: SchemaNode, input: unknown) =>
  z.safeParse(schema, input).success;

test("uuid accepts the same identifiers as the foundation predicate", () => {
  for (const value of [
    "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
    "00000000-0000-8000-b000-000000000000",
  ])
    assert.equal(accepts(uuid(), value), true, value);
  for (const value of [
    "00000000-0000-0000-0000-000000000000",
    "3f2504e0-4f89-91d3-9a0c-0305e82c3301",
    "3f2504e0-4f89-41d3-ca0c-0305e82c3301",
    "3f2504e0-4f89-41d3-9a0c-0305e82c330",
    "",
    1,
    null,
  ])
    assert.equal(accepts(uuid(), value), false, String(value));
});

test("utcTimestamp accepts only canonical round-tripping UTC values", () => {
  for (const value of ["2026-01-02T03:04:05Z", "2026-01-02T03:04:05.123Z"])
    assert.equal(accepts(utcTimestamp(), value), true, value);
  for (const value of [
    "2026-01-02T03:04:05+00:00",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-02T03:04:05.1Z",
    "2026-01-02 03:04:05Z",
    1_767_312_245_000,
  ])
    assert.equal(accepts(utcTimestamp(), value), false, String(value));
});

test("httpUrl accepts only absolute http(s) URLs", () => {
  for (const value of ["https://example.test/a?b=1", "http://example.test"])
    assert.equal(accepts(httpUrl(), value), true, value);
  for (const value of [
    "ftp://example.test",
    "javascript:alert(1)",
    "data:text/plain,x",
    "/relative",
    "example.test",
    null,
  ])
    assert.equal(accepts(httpUrl(), value), false, String(value));
});

test("revision and positiveInteger keep the existing numeric boundaries", () => {
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER])
    assert.equal(accepts(revision(), value), true, String(value));
  for (const value of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, "1"])
    assert.equal(accepts(revision(), value), false, String(value));
  assert.equal(accepts(positiveInteger(), 1), true);
  for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY])
    assert.equal(accepts(positiveInteger(), value), false, String(value));
});

test("safeString and safeBoolean never coerce", () => {
  assert.equal(accepts(safeString(), ""), true);
  assert.equal(accepts(safeString(), 1), false);
  assert.equal(accepts(safeBoolean(), false), true);
  assert.equal(accepts(safeBoolean(), "false"), false);
  assert.equal(accepts(safeBoolean(), 0), false);
});

test("tagged carries the owner failure vocabulary on the failing node", () => {
  const schema = plainObject({
    id: tagged(uuid(), "invalid-uuid"),
    name: tagged(safeString(), "invalid-string"),
  });

  assert.deepEqual(failureOf(schema, { id: "nope", name: "a" }), {
    code: "custom",
    tag: "invalid-uuid",
    path: "$.id",
  });
  assert.deepEqual(
    failureOf(schema, {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      name: 1,
    }),
    { code: "custom", tag: "invalid-string", path: "$.name" },
  );
  // Tagging clones the node, so the shared primitive stays untagged.
  assert.equal(failureOf(uuid(), "nope")?.tag, undefined);
});

test("plain strict object rejects the whole structural vocabulary", () => {
  const schema = plainObject(
    {
      id: tagged(uuid(), "invalid-uuid"),
      note: optionalField(tagged(safeString(), "invalid-string")),
    },
    { nonObjectTag: "missing-field", unsafeObjectTag: "forbidden-payload" },
  );
  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  assert.deepEqual(failureOf(schema, [id]), {
    code: "custom",
    tag: "missing-field",
    path: "$",
  });
  assert.deepEqual(failureOf(schema, "x"), {
    code: "custom",
    tag: "missing-field",
    path: "$",
  });
  assert.deepEqual(failureOf(schema, {}), {
    code: "missing_key",
    tag: undefined,
    path: "$.id",
  });
  assert.deepEqual(failureOf(schema, { id, extra: 1 }), {
    code: "unexpected_key",
    tag: undefined,
    path: "$.extra",
  });
  const poisoned = Object.create({ inherited: 1 }) as Record<string, unknown>;
  poisoned.id = id;
  assert.deepEqual(failureOf(schema, poisoned), {
    code: "custom",
    tag: "forbidden-payload",
    path: "$",
  });
  const symbolKeyed: Record<string, unknown> = { id };
  Object.defineProperty(symbolKeyed, Symbol("s"), {
    value: 1,
    enumerable: true,
  });
  assert.deepEqual(failureOf(schema, symbolKeyed), {
    code: "custom",
    tag: "forbidden-payload",
    path: "$",
  });
});

test("plain strict object treats a present undefined value as the field failure", () => {
  const schema = plainObject({
    id: tagged(uuid(), "invalid-uuid"),
    note: optionalField(tagged(safeString(), "invalid-string")),
  });
  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  assert.deepEqual(failureOf(schema, { id, note: undefined }), {
    code: "custom",
    tag: "invalid-string",
    path: "$.note",
  });
  assert.equal(accepts(schema, { id }), true);
});

test("plain strict object returns a typed value and strips nothing", () => {
  const schema = plainObject({
    id: tagged(uuid(), "invalid-uuid"),
    quantity: tagged(positiveInteger(), "invalid-positive-integer"),
    note: optionalField(tagged(safeString(), "invalid-string")),
  });
  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const parsed = z.safeParse(schema, { id, quantity: 2, note: "n" });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  const decoded: {
    readonly id: string;
    readonly quantity: number;
    readonly note?: string | undefined;
  } = parsed.data;
  assert.deepEqual(decoded, { id, quantity: 2, note: "n" });
});

test("nested shapes report the first violation with a canonical path", () => {
  const item = plainObject({
    q: tagged(positiveInteger(), "invalid-positive"),
  });
  const schema = plainObject({
    items: tagged(z.array(item), "invalid-array"),
  });

  assert.deepEqual(failureOf(schema, { items: [{ q: 1 }, { q: 0 }] }), {
    code: "custom",
    tag: "invalid-positive",
    path: "$.items[1].q",
  });
  // The vendor code varies by node kind, so owners map the tag, not the code.
  assert.deepEqual(failureOf(schema, { items: {} }), {
    code: "invalid_type",
    tag: "invalid-array",
    path: "$.items",
  });
});

test("canonicalPath composes base, property and array index", () => {
  assert.equal(canonicalPath([]), "$");
  assert.equal(canonicalPath(["a", 0, "b"]), "$.a[0].b");
  assert.equal(canonicalPath(["b"], "$.proposedRoot"), "$.proposedRoot.b");
});

test("selectPrimaryIssue is deterministic: depth, declaration order, tag", () => {
  const shallow: SchemaIssueView = { code: "unexpected_key", path: ["b"] };
  const deep: SchemaIssueView = { code: "custom", tag: "t", path: ["a", 0] };
  assert.equal(selectPrimaryIssue([deep, shallow]), shallow);

  const firstDeclared: SchemaIssueView = { code: "custom", path: ["a"] };
  const laterDeclared: SchemaIssueView = { code: "custom", path: ["b"] };
  assert.equal(
    selectPrimaryIssue([firstDeclared, laterDeclared]),
    firstDeclared,
  );

  const untagged: SchemaIssueView = { code: "custom", path: ["a"] };
  const taggedIssue: SchemaIssueView = {
    code: "custom",
    tag: "t",
    path: ["a"],
  };
  assert.equal(selectPrimaryIssue([untagged, taggedIssue]), taggedIssue);
});

test("decodeWithProfile maps the primary issue to the owner error union", () => {
  const schema = plainObject({
    id: tagged(uuid(), "invalid-uuid"),
    quantity: tagged(positiveInteger(), "invalid-positive-integer"),
  });
  const profile = {
    toError: (issue: SchemaIssueView, path: string) => ({
      code: issue.tag ?? (issue.code === "missing_key" ? "missing-field" : "?"),
      path,
    }),
  };

  const failed = decodeWithProfile(schema, { quantity: 1 }, profile);
  assert.deepEqual(failed, {
    ok: false,
    error: { code: "missing-field", path: "$.id" },
  });

  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const nested = decodeWithProfile(
    schema,
    { id, quantity: 0 },
    profile,
    "$.proposedRoot",
  );
  assert.deepEqual(nested, {
    ok: false,
    error: {
      code: "invalid-positive-integer",
      path: "$.proposedRoot.quantity",
    },
  });

  const decoded = decodeWithProfile(schema, { id, quantity: 3 }, profile);
  assert.deepEqual(decoded, { ok: true, value: { id, quantity: 3 } });
});

test("decodeWithProfile never leaks the vendor error object", () => {
  const schema = plainObject({ id: tagged(uuid(), "invalid-uuid") });
  const seen: SchemaIssueView[] = [];
  const result = decodeWithProfile(
    schema,
    { id: 1 },
    {
      toError: (issue) => {
        seen.push(issue);
        return "invalid";
      },
    },
  );

  assert.deepEqual(result, { ok: false, error: "invalid" });
  assert.deepEqual(seen, [
    { code: "custom", tag: "invalid-uuid", path: ["id"] },
  ]);
});

test("inspectJsonSafety returns valid JSON unchanged", () => {
  const input = { a: [1, "b", null, { c: true }] };
  const result = inspectJsonSafety(input);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value, input);
});

test("inspectJsonSafety classifies violations by kind and first path", () => {
  const cyclic: Record<string, unknown> = { a: {} };
  (cyclic.a as Record<string, unknown>).self = cyclic;
  const poisoned = Object.create({ inherited: 1 }) as Record<string, unknown>;

  const cases: readonly [unknown, string, string][] = [
    [{ a: { b: Number.NaN } }, "not-json", "$.a.b"],
    [{ a: [1, undefined] }, "not-json", "$.a[1]"],
    [{ a: () => 1 }, "not-json", "$.a"],
    [cyclic, "cycle", "$.a.self"],
    [{ a: { imageData: "x" } }, "forbidden-key", "$.a.imageData"],
    [{ a: [{ raw_html_value: 1 }] }, "forbidden-key", "$.a[0].raw_html_value"],
    [{ a: "data:image/png;base64,AAA" }, "embedded-content", "$.a"],
    [{ a: ["<div>hi</div>"] }, "embedded-content", "$.a[0]"],
    [{ a: poisoned }, "unsafe-object", "$.a"],
  ];

  for (const [input, kind, path] of cases) {
    const result = inspectJsonSafety(input);
    assert.equal(result.ok, false, path);
    if (result.ok) continue;
    assert.deepEqual(result.error, { kind, path });
  }
});

test("inspectJsonSafety honours the caller base path and leaks no values", () => {
  const result = inspectJsonSafety({ a: "<script>x</script>" }, "$.payload");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, {
    kind: "embedded-content",
    path: "$.payload.a",
  });
  assert.doesNotMatch(JSON.stringify(result.error), /script/);
});
