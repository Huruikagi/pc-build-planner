import assert from "node:assert/strict";
import test from "node:test";

import { localDataPublicConsumerGates } from "../../scripts/validate-local-data-public-consumers.mjs";

test("public consumer validation includes the transaction type and runtime contracts", () => {
  const commands = localDataPublicConsumerGates.map((gate) => gate.join(" "));

  assert.ok(
    commands.some((command) =>
      command.includes("validate-local-data-transaction-public-contract.mjs"),
    ),
  );
});
