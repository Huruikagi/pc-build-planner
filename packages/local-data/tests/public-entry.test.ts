import assert from "node:assert/strict";
import test from "node:test";

test("all declared public entries resolve from built package output", async () => {
  const entries = await Promise.all([
    import("@pc-build-planner/local-data"),
    import("@pc-build-planner/local-data/chrome"),
    import("@pc-build-planner/local-data/backup"),
  ]);

  assert.deepEqual(entries.map(Object.keys), [
    [
      "createCapacityPolicy",
      "createFencingPolicy",
      "createReplacementCoordinator",
      "createTransactionEngine",
    ],
    ["createChromeExclusiveLockAdapter", "createChromeStorageAdapter"],
    [],
  ]);
});

test("undeclared package subpaths are not exported", async () => {
  await assert.rejects(
    // @ts-expect-error The export map intentionally makes this subpath unavailable.
    import("@pc-build-planner/local-data/internal"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});
