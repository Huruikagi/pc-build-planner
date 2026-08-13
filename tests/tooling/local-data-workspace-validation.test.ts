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
