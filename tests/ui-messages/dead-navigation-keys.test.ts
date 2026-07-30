import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import test from "node:test";

const SCAN_ROOTS = ["src/ui-messages/catalog", "src", "tests", "e2e"] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const LEGACY_NAVIGATION_KEYS = [
  ["nav", "productCapture"].join("."),
  ["nav", "backupRestore"].join("."),
] as const;
const THIS_FILE = "tests/ui-messages/dead-navigation-keys.test.ts";

const containsLegacyKey = (source: string, key: string): boolean =>
  source.includes(key) || source.replace(/["'`+\s]/g, "").includes(key);

const sourceFiles = async (root: string): Promise<readonly string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
};

test("廃止navigation keyはcatalogとconsumerに残らない", async () => {
  const files = [
    ...new Set((await Promise.all(SCAN_ROOTS.map(sourceFiles))).flat()),
  ];
  const violations: string[] = [];

  for (const file of files) {
    const normalizedPath = relative(".", file).replaceAll("\\", "/");
    if (normalizedPath === THIS_FILE) continue;
    const source = await readFile(file, "utf8");
    for (const key of LEGACY_NAVIGATION_KEYS) {
      if (containsLegacyKey(source, key)) {
        violations.push(`${normalizedPath}: ${key}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("dead-key gateは文字列連結で隠された廃止キーも拒否する", () => {
  const splitConsumer = ["nav", ".", "product", "Capture"].join('" + "');
  assert.equal(
    containsLegacyKey(
      `const labelKey = "${splitConsumer}";`,
      "nav.productCapture",
    ),
    true,
  );
});
