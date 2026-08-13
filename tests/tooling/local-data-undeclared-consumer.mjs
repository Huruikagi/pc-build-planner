import assert from "node:assert/strict";

const undeclaredSubpath = "@pc-build-planner/local-data/undeclared";

await assert.rejects(import(undeclaredSubpath), (error) => {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
  );
});
