// @ts-nocheck 公開APIとfeature import境界を検証する。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findBoundaryViolations,
  validateBoundaryRoots,
} from "../../scripts/validate-boundaries.mjs";

test("domain と persistence の公開入口は許可された契約だけを公開する", async () => {
  const domainPublic = await readFile("src/domain/public.ts", "utf8");
  const persistencePublic = await readFile("src/persistence/public.ts", "utf8");

  assert.match(domainPublic, /Result/);
  assert.match(domainPublic, /model\.js/);
  assert.match(persistencePublic, /FoundationDataPort/);
  assert.doesNotMatch(domainPublic, /DataCommand/);
  assert.match(persistencePublic, /createDataWorkerRegistration/);
  assert.match(persistencePublic, /RootOperation/);
  assert.match(persistencePublic, /ReplacementCommand/);
  assert.match(persistencePublic, /MaintenanceCommand/);
  assert.match(persistencePublic, /FoundationRuntimePlatform/);
  assert.match(persistencePublic, /FoundationRuntimeContribution/);
  assert.match(persistencePublic, /initializeFoundationRuntimeContribution/);
  assert.doesNotMatch(
    persistencePublic,
    /StoragePort|RootWriteLock|ChromeStorageAdapter|WebLocksAdapter|ReplacementToken|RootQuery|RootTransactionRunner|MutationPipeline|WriteAuthority|MaintenanceFence|MaintenanceOwner|MaintenanceLease/,
  );
});

test("production contribution はshellがcomposeする最小handleだけを公開する", async () => {
  const runtimeContribution = await readFile(
    "src/persistence/runtime-contribution.ts",
    "utf8",
  );
  const publicHandle = runtimeContribution.match(
    /export interface FoundationRuntimeContribution\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(publicHandle);
  assert.match(publicHandle, /maintenanceSource:\s*MaintenanceSnapshotSource/);
  assert.match(publicHandle, /workerRegistration:\s*DataWorkerRegistration/);
  assert.match(publicHandle, /dispose\(\)/);
  assert.doesNotMatch(
    publicHandle,
    /storage|repository|lock|runner|pipeline|authority|serviceWorker|compositionRoot/i,
  );
  assert.doesNotMatch(
    await readFile("src/persistence/public.ts", "utf8"),
    /createCompositionRoot|startApplicationShell|startServiceWorker/,
  );
});

test("専用consumer型検査と境界検査が共通validateに組み込まれる", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(
    packageJson.scripts["typecheck:public-consumer"],
    /tsconfig\.public-consumer\.json/,
  );
  assert.match(
    packageJson.scripts["validate:boundaries"],
    /validate-boundaries/,
  );
  assert.match(packageJson.scripts.validate, /typecheck:public-consumer/);
  assert.match(packageJson.scripts.validate, /validate:boundaries/);
});

test("模擬feature consumerの公開importだけを許可する", () => {
  const sources = [
    {
      path: "src/features/mock/public-consumer.ts",
      source:
        'import type { LocalDataRoot, Result } from "../../domain/public.js";\n' +
        'import type { FoundationDataPort } from "../../persistence/public.js";\n' +
        "export type MockConsumer = Result<LocalDataRoot, never> | FoundationDataPort;",
    },
  ];

  assert.deepEqual(findBoundaryViolations(sources), []);
});

test("deep import、直接Storage、固定lock迂回を拒否する", () => {
  const violations = findBoundaryViolations([
    {
      path: "src/features/mock/deep.ts",
      source:
        'import type { Internal } from "../../persistence/internal/foo.js";',
    },
    {
      path: "src/features/mock/storage.ts",
      source:
        'const storageApi = chrome["stor" + "age"]["local"]; await storageApi["set"]({ root });',
    },
    {
      path: "src/features/mock/lock.ts",
      source:
        'const lockApi = navigator["locks"]; lockApi.request("pc-build-planner:" + "local-data-root-write", callback);',
    },
    {
      path: "src/features/mock/runtime.ts",
      source:
        'import { createDataWorkerRegistration } from "../../runtime/worker-registration.js";',
    },
    {
      path: "src/features/mock/global-storage.ts",
      source:
        'const local = globalThis["chrome"]["storage"].local; await local.set({ root });',
    },
    {
      path: "src/features/mock/destructured-storage.ts",
      source:
        "const { storage } = chrome; storage.local.get(); const { storage: s } = chrome; s.local.set({ root });",
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "public-import-only",
      "no-direct-storage",
      "no-root-lock-bypass",
      "public-import-only",
      "no-direct-storage",
      "no-direct-storage",
    ],
  );
});

test("application shell固有のsecurity・ownership境界違反をowner付きで拒否する", () => {
  const violations = findBoundaryViolations([
    {
      path: "src/application-shell/storage.ts",
      source: "chrome.storage.local.get();",
    },
    {
      path: "src/application-shell/redefined-maintenance.ts",
      source: "interface MaintenanceSnapshotSource { getSnapshot(): unknown }",
    },
    {
      path: "src/application-shell/unsafe-view.tsx",
      source:
        "element.innerHTML = external; return <div dangerouslySetInnerHTML={{__html: external}} />;",
    },
    {
      path: "src/runtime/dummy-maintenance.ts",
      source:
        'const maintenanceSource = { getSnapshot: async () => ({ status: "inactive" }), subscribe: () => () => {} };',
    },
    {
      path: "src/runtime/noop-observer.ts",
      source: "start({ onStateChange: () => {} });",
    },
    {
      path: "src/features/mock/self-register.ts",
      source:
        'import { featureContributionCatalog } from "../../application-shell/feature-contribution-catalog.js";',
    },
    {
      path: "src/application-shell/runtime-jsx.ts",
      source:
        'import Babel from "@babel/standalone"; Babel.transform(source, { presets: ["react"] });',
    },
    {
      path: "src/application-shell/feature-loader.ts",
      source: 'import { secret } from "../features/foo/internal.js";',
    },
  ]);

  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/application-shell/storage.ts: application-shell-no-direct-storage",
      "src/application-shell/redefined-maintenance.ts: application-shell-no-maintenance-contract-redefinition",
      "src/application-shell/unsafe-view.tsx: no-dangerous-html-rendering",
      "src/runtime/dummy-maintenance.ts: no-dummy-maintenance-source",
      "src/runtime/noop-observer.ts: no-noop-shell-state-observer",
      "src/features/mock/self-register.ts: no-shared-entry-self-registration",
      "src/application-shell/runtime-jsx.ts: no-runtime-jsx-transform",
      "src/application-shell/feature-loader.ts: application-shell-feature-public-import-only",
    ],
  );
});

test("存在しないscan rootをfail closedに拒否する", async () => {
  await assert.rejects(
    validateBoundaryRoots(["src/features/__missing__"]),
    /boundary scan root does not exist/,
  );
});
