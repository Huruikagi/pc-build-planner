import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import {
  CONFIGURED_PROBE_SOURCE,
  inspectProductionProbe as inspect,
  validateRuntimeSchemaFeasibility,
} from "../../scripts/validate-runtime-schema-csp.mjs";

const run = promisify(execFile);

test("設定済みprobeはproduction条件で動的Function呼び出しを一度も行わない", async () => {
  const inspection = await inspect(CONFIGURED_PROBE_SOURCE);

  assert.equal(inspection.dynamicFunctionCalls, 0);
  assert.deepEqual(inspection.staticIssues, []);
  assert.ok(inspection.bytes > 0);
});

test("直接のFunction呼び出しfixtureはgateに検出される", async () => {
  const inspection = await inspect(
    'export const value = Function("return 1")();\n',
  );

  assert.deepEqual(inspection.staticIssues, ["direct Function call"]);
  assert.equal(inspection.dynamicFunctionCalls, 1);
});

test("constructor alias経由のFunction呼び出しfixtureはruntime trapで検出される", async () => {
  const construct = await inspect(
    'const Alias = Function;\nexport const value = new Alias("return 1")();\n',
  );
  const apply = await inspect(
    'const Alias = Function;\nexport const value = Alias("return 1")();\n',
  );

  assert.equal(construct.dynamicFunctionCalls, 1);
  assert.equal(apply.dynamicFunctionCalls, 1);
});

test("build失敗はgateを停止させる", async () => {
  await assert.rejects(() =>
    inspect(
      'import { missing } from "./no-such-module.js";\nexport const value = missing;\n',
    ),
  );
});

test("feasibility gateは成功時に0件の動的呼び出しを報告する", async () => {
  const report = await validateRuntimeSchemaFeasibility();

  assert.equal(report.dynamicFunctionCalls, 0);
});

test("gate commandは成功時に0で終了する", async () => {
  const result = await run(process.execPath, [
    "scripts/validate-runtime-schema-csp.mjs",
  ]);

  assert.match(result.stdout, /dynamicFunctionCalls/);
});

test("動的Function呼び出しを含むprobeではgate commandが非zeroで終了する", async () => {
  await assert.rejects(
    () =>
      run(process.execPath, [
        "scripts/validate-runtime-schema-csp.mjs",
        "--probe-source",
        'const Alias = Function;\nexport const value = new Alias("return 1")();\n',
      ]),
    (error: unknown) => {
      const failure = error as { readonly code?: number };
      assert.notEqual(failure.code, 0);
      return true;
    },
  );
});
