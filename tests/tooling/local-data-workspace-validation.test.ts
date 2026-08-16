import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  localDataValidationRoutes,
  runLocalDataValidationRoute,
} from "../../scripts/validate-local-data-workspace.mjs";
import {
  localDataPackageImpactGates,
  localDataProductOwnerGates,
  localDataWorkspaceGates,
  runLocalDataChangedValidation,
  runLocalDataWorkspaceGates,
} from "../../scripts/validate-local-data-workspace-final.mjs";

const flattened = (route: keyof typeof localDataValidationRoutes) =>
  localDataValidationRoutes[route].map((gate) => gate.join(" "));

test("変更種別ごとに必要なpackage gateだけを構成する", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.deepEqual(flattened("core"), [
    "pnpm --filter @pc-build-planner/local-data build",
    "pnpm --filter @pc-build-planner/local-data typecheck",
    "pnpm --filter @pc-build-planner/local-data test:core",
    "node --import tsx tests/tooling/local-data-core-consumer.ts",
    "pnpm validate:local-data-boundaries",
  ]);
  assert.match(flattened("chrome")[0] ?? "", /test:chrome/u);
  assert.match(flattened("chrome")[1] ?? "", /local-data-chrome-consumer/u);
  assert.match(flattened("backup")[0] ?? "", /test:backup/u);
  assert.match(flattened("backup")[1] ?? "", /local-data-backup-consumer/u);
  assert.deepEqual(flattened("contracts").slice(0, 2), [
    "pnpm validate:local-data-public-consumers",
    "pnpm validate:local-data-read-only-app-contract",
  ]);
  for (const route of Object.keys(localDataValidationRoutes)) {
    assert.equal(
      manifest.scripts[`validate:local-data-${route}`],
      `node scripts/validate-local-data-workspace.mjs ${route}`,
    );
  }
});

test("各routeは最初のfailure statusを呼出元へ伝播する", () => {
  for (const route of Object.keys(localDataValidationRoutes) as Array<
    keyof typeof localDataValidationRoutes
  >) {
    const calls: string[] = [];
    const status = runLocalDataValidationRoute(route, (command, args) => {
      calls.push([command, ...args].join(" "));
      return { status: calls.length === 2 ? 37 : 0 };
    });
    assert.equal(status, 37);
    assert.deepEqual(calls, flattened(route).slice(0, 2));
  }
});

test("package単独routeはapp、Chrome実体、DOM、E2Eを起動しない", () => {
  const forbidden =
    /(?:\bsrc\/|playwright|e2e|jsdom|setup-dom|react|file api|chrome(?:\.exe| binary| runtime| api))/iu;
  for (const route of ["core", "chrome", "backup"] as const) {
    for (const gate of flattened(route)) assert.doesNotMatch(gate, forbidden);
  }
});

test("workspace validation diagnosticsは安定codeとstatusだけを出力する", () => {
  let diagnostic = "";
  const original = process.stderr.write;
  process.stderr.write = ((value: string | Uint8Array) => {
    diagnostic += String(value);
    return true;
  }) as typeof process.stderr.write;
  try {
    assert.equal(
      runLocalDataValidationRoute("core", () => ({ status: 41 })),
      41,
    );
  } finally {
    process.stderr.write = original;
  }
  assert.equal(diagnostic, "local-data-validation core gate-1 exit-41\n");
  assert.doesNotMatch(
    diagnostic,
    /https?:|product|candidate|exception|error object/iu,
  );
});

test("実boundary runnerの違反をroute failureとして伝播する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "local-data-boundary-"));
  const fixture = join(directory, "fixture.ts");
  await writeFile(
    fixture,
    'import "@pc-build-planner/local-data/internal";\n',
    "utf8",
  );
  try {
    const status = runLocalDataValidationRoute("core", (command, args) =>
      command === "pnpm" && args[0] === "validate:local-data-boundaries"
        ? spawnSync(process.execPath, [
            "scripts/validate-local-data-boundaries.mjs",
            fixture,
          ])
        : { status: 0 },
    );
    assert.equal(status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("changed-scope entrypointはgenericとunknownをfull gateへ安全側分類する", () => {
  for (const changedPaths of [
    ["packages/local-data/tests/transaction.test.ts"],
    ["scripts/validate-local-data-workspace-final.mjs"],
    ["docs/unknown-shared-contract.md"],
    [],
  ]) {
    const calls: string[] = [];
    assert.equal(
      runLocalDataChangedValidation(changedPaths, (command, args) => {
        calls.push([command, ...args].join(" "));
        return { status: 0 };
      }),
      0,
    );
    assert.deepEqual(
      calls,
      localDataWorkspaceGates.map((gate) => gate.join(" ")),
    );
    assert.ok(calls.includes("pnpm validate:local-data-product-contract"));
    assert.ok(calls.includes("pnpm validate:local-data-product-consumers"));
  }
});

test("changed-scope entrypointはproduct-only変更をowner validationへ委譲する", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const calls: string[] = [];
  const status = runLocalDataChangedValidation(
    [
      "src/domain/schema.ts",
      "src/persistence/product-local-data-adapter.ts",
      "src/features/backup-restore/exchange.ts",
      "src/application-shell/application-composition.ts",
    ],
    (command, args) => {
      calls.push([command, ...args].join(" "));
      return { status: calls.length === 2 ? 23 : 0 };
    },
  );
  assert.equal(status, 23);
  assert.deepEqual(
    calls,
    localDataProductOwnerGates.slice(0, 2).map((gate) => gate.join(" ")),
  );
  assert.deepEqual(calls, [
    "pnpm validate:local-data-product-contract",
    "pnpm validate:local-data-product-consumers",
  ]);
  assert.equal(
    manifest.scripts["validate:local-data:changed"],
    "node scripts/validate-local-data-workspace-final.mjs --changed",
  );
});

test("package公開契約変更はpackage gate後に影響するproduct contractだけを再検証する", () => {
  for (const changedPath of [
    "packages/local-data/src/contracts.ts",
    "packages/local-data/package.json",
  ]) {
    const calls: string[] = [];
    const status = runLocalDataChangedValidation(
      [changedPath],
      (command, args) => {
        calls.push([command, ...args].join(" "));
        return { status: 0 };
      },
    );

    assert.equal(status, 0);
    assert.deepEqual(
      calls,
      localDataPackageImpactGates.map((gate) => gate.join(" ")),
    );
    assert.equal(
      calls.filter(
        (gate) => gate === "pnpm validate:local-data-product-contract",
      ).length,
      1,
    );
    assert.equal(
      calls.filter(
        (gate) => gate === "pnpm validate:local-data-product-consumers",
      ).length,
      1,
    );
  }
});

test("package公開契約後のproduct gate失敗を変更せず伝播し後続を停止する", () => {
  const calls: string[] = [];
  const productContractIndex = localDataPackageImpactGates.findIndex(
    (gate) => gate.join(" ") === "pnpm validate:local-data-product-contract",
  );
  const status = runLocalDataChangedValidation(
    ["packages/local-data/src/public.ts"],
    (command, args) => {
      calls.push([command, ...args].join(" "));
      return { status: calls.length === productContractIndex + 1 ? 31 : 0 };
    },
  );

  assert.equal(status, 31);
  assert.deepEqual(
    calls,
    localDataPackageImpactGates
      .slice(0, productContractIndex + 1)
      .map((gate) => gate.join(" ")),
  );
});

test("root local-data gateはfresh packageからconsumer、boundary、topological buildを順に実行する", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.deepEqual(
    localDataWorkspaceGates.map((gate) => gate.join(" ")),
    [
      "pnpm --filter @pc-build-planner/local-data validate",
      "pnpm validate:local-data-public-consumers",
      "pnpm validate:local-data-read-only-app-contract",
      "pnpm validate:local-data-boundaries",
      "pnpm build",
      "pnpm validate:local-data-product-contract",
      "pnpm validate:local-data-product-consumers",
    ],
  );
  assert.equal(
    manifest.scripts["validate:local-data"],
    "node scripts/validate-local-data-workspace-final.mjs",
  );
  assert.match(manifest.scripts["validate:ci"] ?? "", /validate:local-data/u);
  assert.doesNotMatch(
    localDataWorkspaceGates.flat().join(" "),
    /playwright|e2e|composition/iu,
  );
});

test("root local-data gateは最初のfailureを伝播し後続gateを停止する", () => {
  const calls: string[] = [];
  const status = runLocalDataWorkspaceGates(
    localDataWorkspaceGates,
    (command, args) => {
      calls.push([command, ...args].join(" "));
      return { status: calls.length === 3 ? 29 : 0 };
    },
  );
  assert.equal(status, 29);
  assert.deepEqual(
    calls,
    localDataWorkspaceGates.slice(0, 3).map((gate) => gate.join(" ")),
  );
});
