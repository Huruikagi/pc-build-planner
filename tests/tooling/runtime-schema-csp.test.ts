import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  assertGateReport,
  CONFIGURED_PROBE_SOURCE,
  inspectProductionProbe as inspect,
  LICENSE_NOTICE_FILE_NAME,
  measureProductionBundles,
  measureSourceBytes,
  PRODUCTION_ENTRIES,
  validateLicenseNoticeAsset,
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

test("production entryごとにbaseline・current・delta bytesが記録される", async () => {
  const bundles = await measureProductionBundles();

  assert.deepEqual(
    bundles.map((bundle) => bundle.entry).toSorted(),
    PRODUCTION_ENTRIES.map((entry) => entry.name).toSorted(),
  );
  for (const bundle of bundles) {
    assert.ok(bundle.baselineBytes > 0, `${bundle.entry} baselineBytes`);
    assert.ok(bundle.currentBytes > 0, `${bundle.entry} currentBytes`);
    assert.equal(
      bundle.deltaBytes,
      bundle.currentBytes - bundle.baselineBytes,
      `${bundle.entry} deltaBytes`,
    );
  }
});

test("baselineは同一run内で再生成され任意commitで再現できる", async () => {
  const first = await measureProductionBundles();
  const second = await measureProductionBundles();

  assert.deepEqual(second, first);
});

test("PRODUCTION_ENTRIESは実在するproduction entry sourceを指す", async () => {
  for (const entry of PRODUCTION_ENTRIES) await access(entry.source);
});

test("配布用license noticeがZodのMIT notice契約を満たす", async () => {
  const notice = await readFile(LICENSE_NOTICE_FILE_NAME, "utf8");

  assert.match(notice, /zod/i);
  assert.match(notice, /MIT License/);
  assert.match(notice, /4\.4\.3/);
  await validateLicenseNoticeAsset(".");
});

test("notice欠落のstaging/archiveはgateで失敗する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-schema-notice-"));
  try {
    await assert.rejects(() => validateLicenseNoticeAsset(directory));
    await writeFile(join(directory, LICENSE_NOTICE_FILE_NAME), "", "utf8");
    await assert.rejects(
      () => validateLicenseNoticeAsset(directory),
      /notice/i,
      "空のnoticeも欠落として扱う",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("report欠落と不正なsize resultはgateで失敗する", () => {
  const valid = {
    dynamicFunctionCalls: 0,
    bundles: [
      {
        entry: "index",
        baselineBytes: 10,
        currentBytes: 12,
        deltaBytes: 2,
      },
    ],
    licenseNoticePresent: true,
  };
  assert.doesNotThrow(() => assertGateReport(valid));

  assert.throws(() => assertGateReport(undefined));
  assert.throws(() => assertGateReport({ ...valid, bundles: [] }));
  assert.throws(() =>
    assertGateReport({ ...valid, licenseNoticePresent: false }),
  );
  assert.throws(() =>
    assertGateReport({
      ...valid,
      bundles: [{ ...valid.bundles[0], currentBytes: Number.NaN }],
    }),
  );
  assert.throws(() =>
    assertGateReport({
      ...valid,
      bundles: [{ ...valid.bundles[0], deltaBytes: 999 }],
    }),
  );
});

test("gate commandはbundle sizeとnoticeを含むmachine-readable reportを出力する", async () => {
  const result = await run(process.execPath, [
    "scripts/validate-runtime-schema-csp.mjs",
  ]);
  const report = JSON.parse(result.stdout);

  assert.doesNotThrow(() => assertGateReport(report));
  assert.equal(report.licenseNoticePresent, true);
  assert.equal(report.dynamicFunctionCalls, 0);
});

test("feasibility gateはsize reportとnoticeを含む完全なreportを返す", async () => {
  const report = await validateRuntimeSchemaFeasibility();

  assert.doesNotThrow(() => assertGateReport(report));
});

test("baseline stubはcanonical Zod moduleを副作用のないstubへ差し替える", async () => {
  const baselineBytes = await measureSourceBytes(CONFIGURED_PROBE_SOURCE, true);
  const currentBytes = await measureSourceBytes(CONFIGURED_PROBE_SOURCE, false);

  assert.ok(
    baselineBytes < currentBytes,
    "stub buildがschema vendorを取り除けていない",
  );
  assert.ok(
    currentBytes - baselineBytes > 1000,
    "delta bytesがvendor取り込み分を反映していない",
  );
});
