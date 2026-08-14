import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  localDataProductContractGates,
  runLocalDataProductContractGates,
} from "../../scripts/validate-local-data-product-contract.mjs";

test("root manifestはfoundation所有のproduct runtime characterization commandを公開する", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };

  assert.equal(
    manifest.scripts?.["validate:local-data-product-contract"],
    "node scripts/validate-local-data-product-contract.mjs",
  );
  assert.deepEqual(localDataProductContractGates, [
    ["node", "--import", "tsx", "--test", "tests/persistence/*.test.ts"],
  ]);
});

test("characterization commandは一回だけ実行しfailure statusを変更せず返す", () => {
  const calls: string[][] = [];
  const status = runLocalDataProductContractGates(
    localDataProductContractGates,
    (command, args) => {
      calls.push([command, ...args]);
      return { status: 23 };
    },
  );

  assert.equal(status, 23);
  assert.deepEqual(calls, [localDataProductContractGates[0]]);
});
