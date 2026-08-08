import { rm, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { buildUnpackedExtension } from "./build.mjs";
import { validateArtifactDirectory } from "./validate-artifacts.mjs";
import { validateBoundaryRoots } from "./validate-boundaries.mjs";
import {
  findFixtureAssetViolations,
  isArtifactFixturePath,
  isArtifactFixtureViolation,
} from "./validate-fixture-assets.mjs";

/** @param {string} label @param {readonly { path: string, rule: string }[]} violations */
const throwViolations = (label, violations) => {
  if (violations.length === 0) return;
  throw new Error(
    `${label} failed:\n${violations.map(({ path, rule }) => `${path}: ${rule}`).join("\n")}`,
  );
};

/** @param {string} outputDirectory @param {string} name */
const requireNonemptyArtifact = async (outputDirectory, name) => {
  const path = `${outputDirectory}/${name}`;
  const artifact = await stat(path).catch(() => undefined);
  if (artifact === undefined || !artifact.isFile() || artifact.size === 0)
    throw new Error(`required nonempty artifact is missing: ${name}`);
};

/**
 * @param {{ outputDirectory?: string, boundaryRoots?: string[], fixtureRoots?: string[], build?: (outputDirectory?: string) => Promise<void> }} [options]
 */
export async function runFinalGate({
  outputDirectory = "dist",
  boundaryRoots,
  fixtureRoots = ["tests/fixtures"],
  build = buildUnpackedExtension,
} = {}) {
  const sourceBoundaryRoots =
    boundaryRoots ??
    (
      await Promise.all(
        [
          "src/application-shell",
          "src/features",
          "src/runtime",
          "src/ui-language",
          "src/persistence",
          "src/index.ts",
          "src/content-scripts",
          "tests/tooling/public-api-consumer.ts",
        ].map(async (root) =>
          (await stat(root).catch(() => undefined)) ? root : undefined,
        ),
      )
    ).filter((root) => root !== undefined);
  throwViolations(
    "source boundary validation",
    await validateBoundaryRoots(sourceBoundaryRoots),
  );
  for (const root of fixtureRoots)
    throwViolations(
      "source fixture validation",
      await findFixtureAssetViolations(root),
    );

  await rm(outputDirectory, { recursive: true, force: true });
  await build(outputDirectory);
  await requireNonemptyArtifact(outputDirectory, "build-contract.js");
  await requireNonemptyArtifact(outputDirectory, "foundation.js");
  await validateArtifactDirectory(outputDirectory);
  throwViolations(
    "artifact boundary validation",
    await validateBoundaryRoots([outputDirectory]),
  );
  throwViolations(
    "artifact fixture validation",
    (
      await findFixtureAssetViolations(
        outputDirectory,
        [],
        isArtifactFixturePath,
      )
    ).filter(isArtifactFixtureViolation),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  await runFinalGate({ outputDirectory: process.argv[2] ?? "dist" });
