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

test("synthetic types, product identifiers, and type-safe protocol conversions remain allowed", () => {
  const sources = [
    {
      path: "packages/local-data/tests/public-core.ts",
      source: `
        interface SyntheticProtocolError { readonly code: "synthetic" }
        interface SyntheticRecoveryControl { readonly state: "clear" | "held"; readonly "leaseUntil": number }
        class SyntheticRecoveryControlClass { readonly leaseUntil: number = 0 }
        interface Metrics { readonly leaseDuration: number }
        const productIdentifier: string = "synthetic-product";
        const documentation = "pendingCommitMarker";
        const toControl = (value: SyntheticRecoveryControl): SyntheticRecoveryControl => value;
      `,
    },
    {
      path: "packages/local-data/tests/public-chrome.ts",
      source: 'import "@pc-build-planner/local-data/chrome";',
    },
    {
      path: "packages/local-data/tests/public-backup.ts",
      source: 'import "@pc-build-planner/local-data/backup";',
    },
  ];
  assert.deepEqual(findLocalDataBoundaryViolations(sources), []);
});

test("ownership shape detection ignores non-instance and nested anonymous members", () => {
  const path = "packages/local-data/src/fixture.ts";
  const sources = [
    `interface ProductRecoveryControl { run(): void }
     function work() { interface MethodLocal { ownerId: string } }
     type Wrapper = { nested: { ownerId: string; leaseUntil: number } };`,
    `class ProductRecoveryControl {
       static ownerId: string;
       constructor(ownerId: string) { this.value = { ownerId }; }
       value = { ownerId: "nested", leaseUntil: 1 };
       run() { class MethodLocal { ownerId!: string } }
     }`,
    `interface PersistentRecoveryState { method(): { leaseUntil: number } }
     type PersistentRecoveryEnvelope = ({ nested: { leaseUntil: number } });`,
  ];
  for (const source of sources)
    assert.deepEqual(findLocalDataBoundaryViolations([{ path, source }]), []);
});

test("cyclic local aliases terminate without ownership false positives", () => {
  const path = "packages/local-data/tests/fixture.ts";
  const sources = [
    `type LeaseA = LeaseB; type LeaseB = LeaseA;
     interface PersistentRecoveryState { readonly leaseUntil: LeaseA }`,
    `const pendingA = pendingB; const pendingB = pendingA;
     const recovery = { [pendingA]: true };`,
  ];
  for (const source of sources)
    assert.deepEqual(findLocalDataBoundaryViolations([{ path, source }]), []);
});

test("type alias resolution respects lexical shadowing", () => {
  const path = "packages/local-data/tests/fixture.ts";
  const fixtures = [
    {
      source: `type LeaseValue = number;
        { type LeaseValue = string; type Nested = LeaseValue }
        interface PersistentRecoveryState { readonly leaseUntil: LeaseValue }`,
      expected: "local-data-no-numeric-recovery-lease-ownership",
    },
    {
      source: `type LeaseValue = string;
        { type LeaseValue = number; type Nested = LeaseValue }
        interface PersistentRecoveryState { readonly leaseUntil: LeaseValue }`,
      expected: undefined,
    },
    {
      source: `type LeaseValue = NextLease; type NextLease = number;
        { type NextLease = string; type Nested = LeaseValue }
        interface PersistentRecoveryState { readonly leaseUntil: LeaseValue }`,
      expected: "local-data-no-numeric-recovery-lease-ownership",
    },
    {
      source: `type LeaseValue = string;
        { type LeaseValue = (number); type Nested = LeaseValue }
        interface PersistentRecoveryState { readonly leaseUntil: (LeaseValue) }`,
      expected: undefined,
    },
  ];
  for (const { source, expected } of fixtures)
    assert.deepEqual(
      findLocalDataBoundaryViolations([{ path, source }]),
      expected === undefined ? [] : [{ path, rule: expected }],
    );
});

test("generic type parameters shadow outer numeric aliases", () => {
  const path = "packages/local-data/tests/fixture.ts";
  const sources = [
    `type Lease = number;
     interface PersistentRecoveryState<Lease> { readonly leaseUntil: Lease }`,
    `type Lease = number;
     type PersistentRecoveryState<Lease> = { readonly leaseUntil: Lease };`,
    `type Lease = number;
     class PersistentRecoveryState<Lease> { declare readonly leaseUntil: Lease }`,
  ];
  for (const source of sources)
    assert.deepEqual(findLocalDataBoundaryViolations([{ path, source }]), []);
});

test("computed property aliases respect lexical shadowing", () => {
  const path = "packages/local-data/tests/fixture.ts";
  const fixtures = [
    {
      source: `const marker = "pendingCommitMarker";
        { const marker = "benign"; const nested = { [marker]: true }; }
        const recovery = { [marker]: true };`,
      expected: "local-data-no-recovery-pending-marker-ownership",
    },
    {
      source: `const marker = "benign";
        { const marker = "pendingCommitMarker"; const nested = marker; }
        const recovery = { [marker]: true };`,
      expected: undefined,
    },
    {
      source: `const marker = nextMarker; const nextMarker = "pendingCommitMarker";
        { const nextMarker = "benign"; const nested = { [marker]: true }; }
        const recovery = { [marker]: true };`,
      expected: "local-data-no-recovery-pending-marker-ownership",
    },
    {
      source: `const marker = "benign";
        { const marker = ((("pendingCommitMarker"))); const nested = { [marker]: true }; }`,
      expected: "local-data-no-recovery-pending-marker-ownership",
    },
  ];
  for (const { source, expected } of fixtures)
    assert.deepEqual(
      findLocalDataBoundaryViolations([{ path, source }]),
      expected === undefined ? [] : [{ path, rule: expected }],
    );
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
  [
    "packages/local-data/src/fixture.ts",
    "export interface ProductRecoveryControl { readonly ownerId: string; readonly state: string }",
    "local-data-no-product-recovery-control-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export class ProductRecoveryControl { readonly ownerId!: string; readonly state!: string }",
    "local-data-no-product-recovery-control-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export class ProductRuntimeAdapter {}",
    "local-data-no-product-adapter-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "export interface PersistentRecoveryState { readonly leaseExpiresAt: number; readonly state: string }",
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "export class PersistentRecoveryState { readonly leaseUntil: number = 0 }",
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "const protocol = value as unknown as RecoveryProtocol<object, object, object, object, object, object>;",
    "local-data-no-unsafe-recovery-protocol-cast",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    'const recoveryPendingMarker = "pending-recovery";',
    "local-data-no-recovery-pending-marker-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    'type LeaseValue = number; interface PersistentRecoveryState { readonly "leaseUntil": LeaseValue }',
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    'type LeaseValue = number; interface PersistentRecoveryState { readonly ["leaseDeadline"]: LeaseValue }',
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "type Unchecked = unknown; const protocol = <RecoveryProtocol<object, object, object, object, object, object>>(<Unchecked>value);",
    "local-data-no-unsafe-recovery-protocol-cast",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "type Unchecked = unknown; const control = ((value as Unchecked)) as PersistentRecoveryControl;",
    "local-data-no-unsafe-recovery-protocol-cast",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export interface ProductRecoveryControlState { readonly ownerToken: string; readonly phase: string }",
    "local-data-no-product-recovery-control-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    'const markerName = "pendingCommitMarker"; const recovery = { [markerName]: true };',
    "local-data-no-recovery-pending-marker-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    'const markerName = "pendingCommitMarker"; const pendingAlias = markerName; const recovery = { [pendingAlias]: true };',
    "local-data-no-recovery-pending-marker-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    'const leaseName = "leaseUntil"; const leaseAlias = leaseName; interface PersistentRecoveryState { readonly [leaseAlias]: number }',
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export class ProductRecoveryControl { get ownerId(): string { return 'x' } }",
    "local-data-no-product-recovery-control-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export class ProductRecoveryControl { set phase(value: string) {} }",
    "local-data-no-product-recovery-control-ownership",
  ],
  [
    "packages/local-data/src/fixture.ts",
    "export class ProductRecoveryControl { constructor(readonly ownerId: string) {} }",
    "local-data-no-product-recovery-control-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "class PersistentRecoveryState { get leaseUntil(): number { return 0 } }",
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "class PersistentRecoveryState { set leaseUntil(value: number) {} }",
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "class PersistentRecoveryState { constructor(private leaseUntil: number) {} }",
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "type PersistentRecoveryState = ({ readonly leaseUntil: number });",
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "function outer() { class PersistentRecoveryState { readonly leaseUntil: number = 0 } }",
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "interface PersistentRecoveryState { readonly leaseUntil: (number) }",
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    "class PersistentRecoveryState { get leaseUntil(): (number) { return 0 } }",
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    `type Lease0 = Lease1; type Lease1 = Lease2; type Lease2 = Lease3;
     type Lease3 = Lease4; type Lease4 = Lease5; type Lease5 = Lease6;
     type Lease6 = Lease7; type Lease7 = Lease8; type Lease8 = Lease9;
     type Lease9 = Lease10; type Lease10 = number;
     interface PersistentRecoveryState { readonly leaseUntil: Lease0 }`,
    "local-data-no-numeric-recovery-lease-ownership",
  ],
  [
    "packages/local-data/tests/fixture.ts",
    `const pending0 = pending1; const pending1 = pending2; const pending2 = pending3;
     const pending3 = pending4; const pending4 = pending5; const pending5 = pending6;
     const pending6 = pending7; const pending7 = pending8; const pending8 = pending9;
     const pending9 = pending10; const pending10 = "pendingCommitMarker";
     const recovery = { [pending0]: true };`,
    "local-data-no-recovery-pending-marker-ownership",
  ],
] as const;

for (const [path, source, expectedRule] of negativeFixtures) {
  test(`negative fixture emits only ${expectedRule}`, () => {
    assert.deepEqual(findLocalDataBoundaryViolations([{ path, source }]), [
      { path, rule: expectedRule },
    ]);
  });
}
