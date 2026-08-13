import assert from "node:assert/strict";
import test from "node:test";

import { localDataPublicConsumerGates } from "../../scripts/validate-local-data-public-consumers.mjs";

test("public consumer validation executes the replacement and backup runtime contract", () => {
  const commands = localDataPublicConsumerGates.map((gate) => gate.join(" "));

  assert.ok(
    commands.some((command) =>
      command.includes("local-data-replacement-backup-runtime-contract.ts"),
    ),
  );
});
