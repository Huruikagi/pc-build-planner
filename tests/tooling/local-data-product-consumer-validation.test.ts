import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  localDataProductConsumerGates,
  runLocalDataProductConsumerGates,
  validateProductConsumerSource,
} from "../../scripts/validate-local-data-product-consumers.mjs";

test("root manifestはfoundation所有のproduct consumer contract commandを公開する", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };

  assert.equal(
    manifest.scripts?.["validate:local-data-product-consumers"],
    "node scripts/validate-local-data-product-consumers.mjs",
  );
  assert.deepEqual(localDataProductConsumerGates, [
    ["pnpm", "typecheck:local-data-product-consumers"],
    [
      "node",
      "--import",
      "tsx",
      "--test",
      "tests/domain/app-data-error.test.ts",
      "tests/tooling/local-data-product-consumer-validation.test.ts",
    ],
  ]);
});

test("consumer contractは所有権違反を一件ずつ決定的に拒否する", async () => {
  const cases = [
    {
      file: "candidate-owned-data-error.fixture.txt",
      code: "candidate-owned-data-error",
    },
    {
      file: "foundation-error-direct-import.fixture.txt",
      code: "foundation-error-direct-import",
    },
    {
      file: "product-adapter-redefinition.fixture.txt",
      code: "product-adapter-redefinition",
    },
    {
      file: "package-deep-import.fixture.txt",
      code: "package-deep-import",
    },
    {
      file: "backup-capability-mixing.fixture.txt",
      code: "backup-capability-mixing",
    },
    {
      file: "normal-capability-mixing.fixture.txt",
      code: "normal-capability-mixing",
    },
  ] as const;

  for (const fixture of cases) {
    const source = await readFile(
      `tests/tooling/local-data-product-consumer-negatives/${fixture.file}`,
      "utf8",
    );
    assert.deepEqual(validateProductConsumerSource(source), [fixture.code]);
  }
});

test("公開AppDataErrorと用途別capabilityだけのconsumer sourceを許可する", () => {
  const source = [
    'import type { AppDataError } from "../../src/domain/public.js";',
    'import type { BackupRestoreDataPort, FoundationScopedDataPort } from "../../src/persistence/public.js";',
    "declare const error: AppDataError;",
    "declare const backup: BackupRestoreDataPort;",
    "declare const data: FoundationScopedDataPort;",
    "void error.code; void backup.commit; void data.query;",
  ].join("\n");

  assert.deepEqual(validateProductConsumerSource(source), []);
});

test("consumer commandは最初のfailure statusを変更せず後続gateを停止する", async () => {
  const calls: string[][] = [];
  const status = await runLocalDataProductConsumerGates(
    localDataProductConsumerGates,
    (command, args) => {
      calls.push([command, ...args]);
      return { status: 23 };
    },
  );

  assert.equal(status, 23);
  assert.deepEqual(calls, [localDataProductConsumerGates[0]]);
});
