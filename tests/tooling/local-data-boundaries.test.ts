import assert from "node:assert/strict";
import test from "node:test";
import {
  findLocalDataBoundaryViolations,
  validateLocalDataBoundaryRoots,
} from "../../scripts/validate-local-data-boundaries.mjs";

test("current local-data package graph satisfies the boundary gate", async () => {
  assert.deepEqual(
    await validateLocalDataBoundaryRoots([
      "packages/local-data/src",
      "packages/local-data/tests",
    ]),
    [],
  );
});

test("ownership declarations ignore comments and strings", () => {
  const path = "packages/local-data/src/fixture.ts";
  const source = `
    // class ProductLocalDataAdapter {}
    /* type ProductBackupAdapter = {}; */
    export const documentation = "function createProductRuntimeComposition() {}";
  `;
  assert.deepEqual(findLocalDataBoundaryViolations([{ path, source }]), []);
});

const negativeFixtures = [
  [
    "tests/tooling/fixture.ts",
    'import "@pc-build-planner/local-data/internal";',
    "local-data-no-undeclared-subpath",
  ],
  [
    "tests/tooling/fixture.ts",
    'import "@pc-build-planner/local-data/src/contracts.js";',
    "local-data-no-src-deep-import",
  ],
  [
    "tests/tooling/fixture.ts",
    'import "@pc-build-planner/local-data/dist/index.js";',
    "local-data-no-dist-deep-import",
  ],
  [
    "packages/local-data/src/fixture.ts",
    'import "./chrome/index.js";',
    "local-data-core-no-chrome-dependency",
  ],
  [
    "packages/local-data/src/fixture.ts",
    'import "./backup/index.js";',
    "local-data-core-no-backup-dependency",
  ],
  [
    "packages/local-data/src/fixture.ts",
    'import "../../../src/persistence/public.js";',
    "local-data-core-no-product-dependency",
  ],
  [
    "packages/local-data/src/chrome/fixture.ts",
    'import "../../../../src/persistence/public.js";',
    "local-data-chrome-no-product-dependency",
  ],
  [
    "packages/local-data/src/backup/fixture.ts",
    'import "../chrome/index.js";',
    "local-data-backup-no-chrome-dependency",
  ],
  [
    "packages/local-data/src/backup/fixture.ts",
    'import "react-dom/client";',
    "local-data-backup-no-dom-dependency",
  ],
  [
    "packages/local-data/src/backup/fixture.ts",
    'import "react";',
    "local-data-backup-no-react-dependency",
  ],
  [
    "packages/local-data/src/backup/fixture.ts",
    'import "../../../../src/features/backup-restore/public.js";',
    "local-data-backup-no-product-dependency",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export class ProductLocalDataAdapter {}",
    "local-data-no-product-local-data-adapter-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export class /* boundary comment */ ProductLocalDataAdapter {}",
    "local-data-no-product-local-data-adapter-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export interface /* boundary comment */ ProductBackupAdapter {}",
    "local-data-no-product-backup-adapter-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export type /* boundary comment */ ProductBackupAdapter = {};",
    "local-data-no-product-backup-adapter-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export function /* boundary comment */ createProductRuntimeComposition() {}",
    "local-data-no-product-composition-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export const /* boundary comment */ createProductRuntimeComposition = () => ({});",
    "local-data-no-product-composition-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "type ProductBackupAdapter = {};",
    "local-data-no-product-backup-adapter-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export const createProductRuntimeComposition = () => ({});",
    "local-data-no-product-composition-ownership",
  ],
  [
    "packages/local-data/tests/e2e/fixture.test.ts",
    "export {};",
    "local-data-no-e2e-ownership",
  ],
] as const;

for (const [path, source, expectedRule] of negativeFixtures) {
  test(`negative fixture emits only ${expectedRule}`, () => {
    assert.deepEqual(findLocalDataBoundaryViolations([{ path, source }]), [
      { path, rule: expectedRule },
    ]);
  });
}
