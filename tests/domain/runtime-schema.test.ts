import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { z } from "../../src/domain/runtime-schema/zod-mini.js";

const minimalSchema = z.strictObject({
  id: z.string(),
  quantity: z.custom<number>((value) => typeof value === "number"),
});

test("configured Zod Mini decodes a valid value into a typed value", () => {
  const parsed = z.safeParse(minimalSchema, { id: "abc", quantity: 2 });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  const decoded: { readonly id: string; readonly quantity: number } =
    parsed.data;
  assert.deepEqual(decoded, { id: "abc", quantity: 2 });
});

test("configured Zod Mini reports invalid values as internal issues", () => {
  const parsed = z.safeParse(minimalSchema, { id: 1, quantity: "2" });

  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const paths = parsed.error.issues.map((issue) => issue.path.join("."));
  assert.deepEqual(paths.toSorted(), ["id", "quantity"]);
});

test("jitless is configured before any schema is created", async () => {
  const source = await readFile(
    new URL("../../src/domain/runtime-schema/zod-mini.ts", import.meta.url),
    "utf8",
  );
  const configIndex = source.indexOf("jitless");
  assert.ok(configIndex > 0, "canonical entry must configure jitless");
  assert.equal(
    z.config().jitless,
    true,
    "jitless must be active once the canonical entry is loaded",
  );
});

test("zod is imported only through the canonical entry", async () => {
  const source = await readFile(
    new URL("../../src/domain/runtime-schema/zod-mini.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /from "zod\/mini"/);
  // A namespace re-export would reference every vendor export and defeat tree
  // shaking, which is the whole reason this project depends on Zod Mini.
  assert.doesNotMatch(source, /import \* as \w+ from "zod/);
  assert.doesNotMatch(source, /export \* from "zod/);
});
