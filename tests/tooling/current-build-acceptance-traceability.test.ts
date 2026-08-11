import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requirementsPath = ".kiro/specs/current-build-management/requirements.md";
const traceabilityPath =
  "docs/current-build-management-acceptance-validation.md";

const requirementIds = (source: string): string[] => {
  const ids: string[] = [];
  let requirement: string | null = null;
  for (const line of source.split(/\r?\n/u)) {
    const heading = /^### Requirement (\d+):/u.exec(line);
    if (heading?.[1] !== undefined) {
      requirement = heading[1];
      continue;
    }
    const criterion = /^(\d+)\. /u.exec(line);
    if (requirement !== null && criterion?.[1] !== undefined) {
      ids.push(`${requirement}.${criterion[1]}`);
    }
  }
  return ids;
};

const tracedIds = (source: string): string[] =>
  source
    .split(/\r?\n/u)
    .map((line) => /^\| (\d+\.\d+) \|/u.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);

test("current-build-managementの全53受入基準が追跡表に一度ずつ対応する", async () => {
  const [requirements, traceability] = await Promise.all([
    readFile(requirementsPath, "utf8"),
    readFile(traceabilityPath, "utf8"),
  ]);
  const expected = requirementIds(requirements);
  const actual = tracedIds(traceability);

  assert.equal(expected.length, 53);
  assert.equal(new Set(actual).size, actual.length, "追跡IDは重複させない");
  assert.deepEqual(actual, expected);
});
