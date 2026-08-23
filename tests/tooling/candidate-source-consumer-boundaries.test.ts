import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  candidateSourceConsumerScanRoots,
  findCandidateSourceConsumerViolations,
  validateCandidateSourceConsumerRoots,
} from "../../scripts/validate-candidate-source-consumers.mjs";

const negativeCases = [
  ["price-workflow.fixture.txt", "source-consumer-no-price-workflow"],
  ["product-identity.fixture.txt", "source-consumer-no-product-identity"],
  [
    "foundation-internals.fixture.txt",
    "source-consumer-no-foundation-internals",
  ],
  ["candidate-internals.fixture.txt", "source-consumer-no-candidate-internals"],
  ["shell-composition.fixture.txt", "source-consumer-no-shell-composition"],
  [
    "candidate-source-deep-import.fixture.txt",
    "candidate-sources-public-entry-only",
  ],
] as const;

test("source consumer negative fixtureは一違反ずつfail closedで拒否される", async () => {
  for (const [file, expected] of negativeCases) {
    const path = `tests/tooling/candidate-source-consumer-negatives/${file}`;
    const source = await readFile(path, "utf8");
    assert.deepEqual(
      findCandidateSourceConsumerViolations([{ path, source }]),
      [{ path, rule: expected }],
    );
  }
});

test("candidate sources coreはfeature/shellへ依存せずcandidate publicに再公開されない", async () => {
  assert.deepEqual(
    await validateCandidateSourceConsumerRoots([
      "src/candidate-sources",
      "src/features/candidate-management/public.ts",
    ]),
    [],
  );
});

test("candidate publicの実source再exportだけを拒否しコメントと通常文字列は許容する", async () => {
  const reexport = await readFile(
    "tests/tooling/candidate-source-consumer-negatives/candidate-owned-source-reexport.fixture.txt",
    "utf8",
  );
  assert.deepEqual(
    findCandidateSourceConsumerViolations([
      { path: "src/features/candidate-management/public.ts", source: reexport },
    ]),
    [
      {
        path: "src/features/candidate-management/public.ts",
        rule: "candidate-management-no-source-re-export",
      },
    ],
  );

  const harmless = await readFile(
    "tests/tooling/candidate-source-consumer-negatives/candidate-source-text-control.fixture.txt",
    "utf8",
  );
  assert.deepEqual(
    findCandidateSourceConsumerViolations([
      { path: "src/features/candidate-management/public.ts", source: harmless },
    ]),
    [],
  );
});

test("positive consumer fixtureとscan rootは双方向に完全である", async () => {
  assert.deepEqual(
    await validateCandidateSourceConsumerRoots([
      "tests/tooling/source-price-candidate-sources-consumer.ts",
      "tests/tooling/duplicate-product-candidate-sources-consumer.ts",
    ]),
    [],
  );

  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const command = packageJson.scripts["validate:candidate-source-consumers"];
  assert.equal(
    command,
    `node scripts/validate-candidate-source-consumers.mjs ${candidateSourceConsumerScanRoots.join(" ")}`,
  );
  assert.match(
    packageJson.scripts["validate:ci"] ?? "",
    /validate:candidate-source-consumers/,
  );

  const consumerConfig = JSON.parse(
    await readFile("tsconfig.public-consumer.json", "utf8"),
  ) as { include: string[] };
  for (const fixture of candidateSourceConsumerScanRoots.filter((root) =>
    root.startsWith("tests/"),
  ))
    assert.ok(consumerConfig.include.includes(fixture), fixture);
});
