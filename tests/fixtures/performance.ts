import { performance } from "node:perf_hooks";

import type { LocalDataRoot } from "../../src/domain/model.js";
// @ts-expect-error Node 26 の type stripping でTypeScript sourceを直接検証する。
import { schemaValidator } from "../../src/domain/validation.ts";
// @ts-expect-error Node 26 の type stripping でTypeScript sourceを直接検証する。
import { createInMemoryStorageAdapter } from "../../src/persistence/in-memory-storage-adapter.ts";
// @ts-expect-error Node 26 の type stripping でTypeScript sourceを直接検証する。
import { createMigrationRegistry } from "../../src/persistence/migration-registry.ts";
// @ts-expect-error Node 26 の type stripping でTypeScript sourceを直接検証する。
import { referenceRepairPolicy } from "../../src/persistence/reference-repair-policy.ts";
// @ts-expect-error Node 26 の type stripping でTypeScript sourceを直接検証する。
import { canonicalJson } from "../../src/persistence/replacement.ts";
// @ts-expect-error Node 26 の type stripping でTypeScript fixtureを直接検証する。
import { buildFoundationRoot } from "./foundation.ts";

const MEBIBYTE = 1024 * 1024;
const TARGET_ROOT_BYTES = 9.5 * MEBIBYTE;
const encoder = new TextEncoder();

export const PERFORMANCE_OPERATION_NAMES = [
  "read",
  "migration",
  "validation",
  "repair",
  "canonical-serialization",
  "single-write",
] as const;

type PerformanceOperation = (typeof PERFORMANCE_OPERATION_NAMES)[number];

export interface PerformanceMeasurement {
  readonly operation: PerformanceOperation;
  readonly durationMs: number;
  readonly bytes: number;
}

export interface FoundationPerformanceReport {
  readonly rootBytes: number;
  readonly measurements: readonly PerformanceMeasurement[];
}

const serializedBytes = (root: LocalDataRoot): number =>
  encoder.encode(JSON.stringify(root)).byteLength;

/** 実サイト値やassetを使わず、ASCIIの架空paddingだけで10MB近傍へ拡張する。 */
export const buildNearQuotaFoundationRoot = (): LocalDataRoot => {
  const root = structuredClone(buildFoundationRoot());
  const baseBytes = serializedBytes(root);
  const paddingLength = Math.max(0, Math.floor(TARGET_ROOT_BYTES - baseBytes));
  const projects = root.projects.map((project, index) =>
    index === 0
      ? {
          ...project,
          name: `架空性能計測-${"SYNTHETIC-DATA-".repeat(Math.ceil(paddingLength / 15)).slice(0, paddingLength)}`,
        }
      : project,
  );
  return { ...root, projects };
};

const measure = async (
  operation: PerformanceOperation,
  bytes: number,
  action: () => unknown | Promise<unknown>,
): Promise<PerformanceMeasurement> => {
  const startedAt = performance.now();
  await action();
  return { operation, durationMs: performance.now() - startedAt, bytes };
};

/** 各段階を独立実行し、速度閾値を設けず測定値をreportへ集約する。 */
export const measureFoundationPerformance = async (
  root: LocalDataRoot,
): Promise<FoundationPerformanceReport> => {
  const rootBytes = serializedBytes(root);
  const measurements: PerformanceMeasurement[] = [];

  const readStorage = createInMemoryStorageAdapter();
  const seeded = await readStorage.writeRoot(root);
  if (!seeded.ok)
    throw new Error(`performance fixture seed failed: ${seeded.error.code}`);
  measurements.push(
    await measure("read", rootBytes, async () => {
      const result = await readStorage.readRoot();
      if (!result.ok || result.value === undefined)
        throw new Error("performance read failed");
    }),
  );

  const migrations = createMigrationRegistry(1, [], schemaValidator);
  measurements.push(
    await measure("migration", rootBytes, () => {
      const result = migrations.toCurrent(root);
      if (!result.ok)
        throw new Error(`performance migration failed: ${result.error.code}`);
    }),
  );

  measurements.push(
    await measure("validation", rootBytes, () => {
      const result = schemaValidator.validateRoot(root);
      if (!result.ok)
        throw new Error(`performance validation failed: ${result.error.code}`);
    }),
  );

  measurements.push(
    await measure("repair", rootBytes, () => {
      const candidate = root.candidateParts[0];
      if (!candidate)
        throw new Error("performance repair fixture has no candidate");
      const proposed = {
        ...root,
        candidateParts: root.candidateParts.slice(1),
      };
      const result = referenceRepairPolicy.repair(root, proposed, {
        kind: "candidate-deleted",
        candidatePartId: candidate.id,
      });
      if (!result.ok)
        throw new Error(`performance repair failed: ${result.error.code}`);
    }),
  );

  measurements.push(
    await measure("canonical-serialization", rootBytes, () => {
      canonicalJson(root as never);
    }),
  );

  const writeStorage = createInMemoryStorageAdapter();
  measurements.push(
    await measure("single-write", rootBytes, async () => {
      const result = await writeStorage.writeRoot(root);
      if (!result.ok)
        throw new Error(`performance write failed: ${result.error.code}`);
    }),
  );

  return { rootBytes, measurements };
};
