import assert from "node:assert/strict";
import { test } from "node:test";

test("the built package root exposes the public API", async () => {
  const publicEntry = await import("@pc-build-planner/typed-messages-core");

  assert.deepEqual(Object.keys(publicEntry).sort(), [
    "createMessageDescriptorFactory",
    "createMessageResolver",
    "flattenCatalog",
    "formatMessage",
    "validateCatalogParity",
  ]);
});

test("internal package subpaths are not exported", async () => {
  await assert.rejects(
    // @ts-expect-error The export map intentionally makes this subpath unavailable.
    import("@pc-build-planner/typed-messages-core/contracts"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});
