import { rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { buildUnpackedExtension } from "./build.mjs";
import { validateArtifactDirectory } from "./validate-artifacts.mjs";
import { validateBoundaryRoots } from "./validate-boundaries.mjs";
import { findFixtureAssetViolations } from "./validate-fixture-assets.mjs";

/** @param {string} label @param {readonly { path: string, rule: string }[]} violations */
const throwViolations = (label, violations) => {
  if (violations.length === 0) return;
  throw new Error(
    `${label} failed:\n${violations.map(({ path, rule }) => `${path}: ${rule}`).join("\n")}`,
  );
};

export async function runFinalGate({
  outputDirectory = "dist",
  boundaryRoots = ["src/features", "tests/tooling/public-api-consumer.ts"],
  fixtureRoots = ["tests/fixtures"],
  build = buildUnpackedExtension,
} = {}) {
  throwViolations(
    "source boundary validation",
    await validateBoundaryRoots(boundaryRoots),
  );
  for (const root of fixtureRoots)
    throwViolations(
      "source fixture validation",
      await findFixtureAssetViolations(root),
    );

  await rm(outputDirectory, { recursive: true, force: true });
  await build(outputDirectory);
  await validateArtifactDirectory(outputDirectory);
  throwViolations(
    "artifact boundary validation",
    await validateBoundaryRoots([outputDirectory]),
  );
  throwViolations(
    "artifact fixture validation",
    await findFixtureAssetViolations(outputDirectory),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  await runFinalGate({ outputDirectory: process.argv[2] ?? "dist" });
