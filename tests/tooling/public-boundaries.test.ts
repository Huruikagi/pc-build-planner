// @ts-nocheck 公開APIとfeature import境界を検証する。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateFoundationPublicContract } from "../../scripts/validate-artifacts.mjs";
import {
  findBoundaryViolations,
  findStorageAccessViolations,
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
  assert.match(
    persistencePublic,
    /initializeProductionFoundationRuntimeContribution/,
  );
  assert.match(persistencePublic, /initializeFoundationRuntimeContribution/);
  // MaintenanceFenceはbackup-restoreの復元commit（fence受け渡し）用途にだけ公開する最小型。
  // owner/lease操作capability自体（acquire/renew等の実行手段）は引き続き非公開のまま。
  assert.match(persistencePublic, /export type \{ MaintenanceFence \}/);
  assert.doesNotMatch(
    persistencePublic,
    /StoragePort|RootWriteLock|ChromeStorageAdapter|WebLocksAdapter|ReplacementToken|RootQuery|RootTransactionRunner|MutationPipeline|WriteAuthority|MaintenanceOwner|MaintenanceLease/,
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

test("foundation artifactはno-arg production factoryを必須としlegacy DI bridgeを許容する", () => {
  assert.throws(
    () =>
      validateFoundationPublicContract(
        "export { initializeFoundationRuntimeContribution };",
        "dist/foundation.js",
      ),
    /foundation production contribution factory is not exported/,
  );
  assert.doesNotThrow(() =>
    validateFoundationPublicContract(
      "export { initializeProductionFoundationRuntimeContribution, initializeFoundationRuntimeContribution };",
      "dist/foundation.js",
    ),
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
  assert.match(
    packageJson.scripts["validate:boundaries"],
    /src\/application-shell/,
  );
  assert.match(packageJson.scripts["validate:boundaries"], /src\/ui-language/);
  assert.match(packageJson.scripts["validate:boundaries"], /src\/persistence/);
  const finalGate = await readFile("scripts/validate-final-gate.mjs", "utf8");
  assert.match(finalGate, /"src\/ui-language"/);
  assert.match(finalGate, /"src\/persistence"/);
  assert.match(packageJson.scripts["validate:ci"], /typecheck:public-consumer/);
  assert.match(packageJson.scripts["validate:ci"], /validate:boundaries/);
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

test("owner schema は共通validation入口と設定済みvendor moduleだけを許可する", () => {
  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "src/features/mock/schema.ts",
        source:
          'import { plainObject, uuid } from "../../domain/runtime-schema/public.js";\n' +
          "export const schema = plainObject({ id: uuid() });",
      },
      {
        path: "src/domain/runtime-schema/zod-mini.ts",
        source:
          'import * as zodMini from "zod/mini";\n' +
          "zodMini.config({ jitless: true });\n" +
          "export { zodMini as z };",
      },
    ]),
    [],
  );

  const violations = findBoundaryViolations([
    {
      path: "src/features/mock/direct-vendor.ts",
      source:
        'import { object } from "zod/mini";\nexport const s = object({});',
    },
    {
      path: "src/domain/candidate-schema.ts",
      source: 'import * as z from "zod";\nexport const s = z.string();',
    },
    {
      path: "src/features/mock/kernel-deep.ts",
      source:
        'import { tagged } from "../../domain/runtime-schema/primitives.js";\n' +
        "export const t = tagged;",
    },
    {
      path: "src/features/mock/feature-schema-deep.ts",
      source:
        'import { candidateSchema } from "../candidate-management/candidate-schema.js";\n' +
        "export const s = candidateSchema;",
    },
  ]);

  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/features/mock/direct-vendor.ts: canonical-runtime-schema-import-only",
      "src/domain/candidate-schema.ts: canonical-runtime-schema-import-only",
      "src/features/mock/kernel-deep.ts: public-import-only",
      "src/features/mock/feature-schema-deep.ts: cross-feature-public-import-only",
    ],
  );
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
    ["public-import-only", "no-root-lock-bypass", "public-import-only"],
  );
});

test("capture・candidate-management間は公開entry pointだけを許可する", () => {
  const violations = findBoundaryViolations([
    {
      path: "src/features/product-capture/deep.ts",
      source:
        'import type { Draft } from "../candidate-management/contracts.js";',
    },
    {
      path: "src/features/candidate-management/deep.ts",
      source: 'import { capture } from "../product-capture/coordinator.js";',
    },
    {
      path: "src/features/product-capture/legacy.ts",
      source:
        "interface CandidateManagementPublicApi { createCandidateEditorIntent(): unknown }\n" +
        "const port: CaptureCandidatePort = openCandidateEditor;",
    },
    {
      path: "src/features/product-capture/registration.ts",
      source:
        'const registration = { presentation: "transient", navigation: { labelKey: "nav.settings" } };',
    },
    {
      path: "src/features/product-capture/reordered-registration.ts",
      source:
        'const registration = { navigation: { labelKey: "capture" }, presentation: "transient" };',
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      "cross-feature-public-import-only",
      "cross-feature-public-import-only",
      "product-capture-no-public-api-redefinition",
      "product-capture-no-legacy-candidate-port",
      "product-capture-no-legacy-editor-navigation",
      "product-capture-transient-no-navigation",
      "product-capture-transient-no-navigation",
    ],
  );
});

test("cross-spec consumerはcaptureのprice portだけを公開入口から利用する", () => {
  const forbiddenSources = [
    {
      path: "tests/tooling/source-price-refresh-upstream-consumer.ts",
      source:
        'import type { ProductCapturePublicApi } from "../../src/features/product-capture/public.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-upstream-consumer.ts",
      source:
        'import type { PagePriceExtractionPort } from "../../src/features/product-capture/contracts.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-upstream-consumer.ts",
      source:
        'import type * as Capture from "../../src/features/product-capture/public.js"; type Port = Capture.ProductCapturePublicApi;',
    },
    {
      path: "tests/tooling/source-price-refresh-upstream-consumer.ts",
      source:
        'import Capture, { type PagePriceExtractionPort } from "../../src/features/product-capture/public.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-upstream-consumer.ts",
      source:
        'type Port = import("../../src/features/product-capture/public.js").PagePriceExtractionPort;',
    },
    {
      path: "tests/tooling/source-price-refresh-upstream-consumer.ts",
      source:
        'const capture = import("../../src/features/product-capture/public.js");',
    },
    {
      path: "tests/tooling/source-price-refresh-upstream-consumer.ts",
      source:
        'export type { PagePriceExtractionPort } from "../../src/features/product-capture/public.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-upstream-consumer.ts",
      source: 'import type { Result } from "../../src/domain/public.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-public-consumer.ts",
      source:
        'import type { PagePriceObservation } from "../../src/features/product-capture/contracts.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-public-consumer.ts",
      source:
        'import type { ProductCapturePublicApi } from "../../src/features/product-capture/public.js";',
    },
  ];
  const violations = findBoundaryViolations([
    ...forbiddenSources,
    {
      path: "src/features/candidate-source-bookmarks/integration.ts",
      source: "const legacy: CaptureCandidatePort = dependencies.capture;",
    },
  ]);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    [
      ...forbiddenSources.map(
        () => "source-price-refresh-product-capture-price-port-only",
      ),
      "candidate-source-bookmarks-no-legacy-capture-port",
    ],
  );

  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "tests/tooling/source-price-refresh-upstream-consumer.ts",
        source:
          'import type { PagePriceExtractionPort } from "../../src/features/product-capture/public.js";',
      },
      {
        path: "tests/tooling/source-price-refresh-public-consumer.ts",
        source:
          'import type { PagePriceExtractionPort } from "../../src/features/product-capture/public.js";',
      },
      {
        path: "src/features/candidate-source-bookmarks/integration.ts",
        source:
          'import type { CandidateSourceCatalogPort } from "../candidate-management/public.js";',
      },
    ]),
    [],
  );
});

test("settingsは許可された公開依存だけを利用する", () => {
  const allowed = findBoundaryViolations([
    {
      path: "src/features/settings/allowed.ts",
      source:
        'import type { FeatureId } from "../../application-shell/public.js";\n' +
        'import { LanguageSelectControl } from "../../ui-language/public.js";\n' +
        'import { useMessages } from "../../ui-messages/public.js";\n' +
        'import type { BackupRestoreSectionMount } from "../backup-restore/public.js";',
    },
  ]);
  assert.deepEqual(allowed, []);

  const violations = findBoundaryViolations([
    {
      path: "src/features/settings/foundation-leak.ts",
      source:
        'import type { FoundationDataPort } from "../../persistence/public.js";',
    },
    {
      path: "src/features/settings/catalog-leak.ts",
      source: 'import { MESSAGES } from "../../ui-messages/catalog/index.js";',
    },
    {
      path: "src/features/settings/backup-leak.ts",
      source: 'import { state } from "../backup-restore/state.js";',
    },
    {
      path: "src/features/settings/storage-leak.ts",
      source: "chrome.storage.local.get();",
    },
    {
      path: "src/features/settings/domain-leak.ts",
      source: 'import type { LocalDataRoot } from "../../domain/public.js";',
    },
    {
      path: "src/features/settings/feature-leak.ts",
      source:
        'import type { CandidateManagementPublicApi } from "../candidate-management/public.js";',
    },
  ]);

  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/features/settings/foundation-leak.ts: settings-public-dependencies-only",
      "src/features/settings/catalog-leak.ts: settings-public-dependencies-only",
      "src/features/settings/backup-leak.ts: settings-public-dependencies-only",
      "src/features/settings/domain-leak.ts: settings-public-dependencies-only",
      "src/features/settings/feature-leak.ts: settings-public-dependencies-only",
    ],
  );
});

test("settings公開入口はregistration契約だけを公開する", async () => {
  const publicSource = await readFile(
    "src/features/settings/public.ts",
    "utf8",
  );

  assert.match(publicSource, /createSettingsFeatureRegistration/);
  assert.doesNotMatch(publicSource, /mountSettingsReactRoot/);
  assert.doesNotMatch(publicSource, /SettingsReactRoot/);
  assert.doesNotMatch(publicSource, /mountSettingsSectionResources/);
  assert.doesNotMatch(publicSource, /SettingsSectionHostRoot/);
});

test("ui-languageとconsumerは公開境界を越えて逆依存・catalog deep importしない", () => {
  const violations = findBoundaryViolations([
    {
      path: "src/ui-language/reverse-settings.ts",
      source: 'import { SettingsView } from "../features/settings/view.js";',
    },
    {
      path: "src/ui-language/reverse-shell.ts",
      source: 'import { ShellView } from "../application-shell/shell-view.js";',
    },
    {
      path: "src/ui-language/catalog-leak.ts",
      source: 'import { messages } from "../ui-messages/catalog/en/index.js";',
    },
    {
      path: "src/application-shell/language-internal.ts",
      source: 'import { languageStore } from "../ui-language/store.js";',
    },
    {
      path: "src/runtime/language-internal.ts",
      source: 'import { initializeUiLanguage } from "../ui-language/store.js";',
    },
  ]);

  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/ui-language/reverse-settings.ts: ui-language-public-dependencies-only",
      "src/ui-language/reverse-shell.ts: ui-language-public-dependencies-only",
      "src/ui-language/catalog-leak.ts: ui-language-public-dependencies-only",
      "src/application-shell/language-internal.ts: ui-language-consumer-public-entry-only",
      "src/runtime/language-internal.ts: ui-language-consumer-public-entry-only",
    ],
  );
});

test("runtimeはui-languageのpublicまたはruntime seamだけを利用する", () => {
  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "src/runtime/language-public.ts",
        source: 'import { LanguageProvider } from "../ui-language/public.js";',
      },
      {
        path: "src/runtime/language-composition.ts",
        source:
          'import { initializeUiLanguage, syncDocumentLanguage } from "../ui-language/runtime.js";',
      },
    ]),
    [],
  );
});

test("ui-language consumerはsource別に許可された公開seamだけを利用する", () => {
  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "src/application-shell/language-runtime.ts",
        source:
          'import { initializeUiLanguage } from "../ui-language/runtime.js";',
      },
      {
        path: "src/features/settings/language-runtime.ts",
        source:
          'import { initializeUiLanguage } from "../../ui-language/runtime.js";',
      },
      {
        path: "src/features/mock/runtime/language-runtime.ts",
        source:
          'import { initializeUiLanguage } from "../../../ui-language/runtime.js";',
      },
      {
        path: "src/features/product-capture/language-runtime.ts",
        source:
          'import { initializeUiLanguage } from "../../ui-language/runtime.js";',
      },
      {
        path: "src/features/candidate-management/language-internal.ts",
        source: 'import { languageStore } from "../../ui-language/store.js";',
      },
      {
        path: "src/features/mock/ui-language/language-runtime.ts",
        source:
          'import { initializeUiLanguage } from "src/ui-language/runtime.js";',
      },
      {
        path: "src/application-shell/ui-language/language-internal.ts",
        source: 'import { languageStore } from "../../ui-language/store.js";',
      },
    ]).map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/application-shell/language-runtime.ts: ui-language-consumer-public-entry-only",
      "src/features/settings/language-runtime.ts: ui-language-consumer-public-entry-only",
      "src/features/mock/runtime/language-runtime.ts: ui-language-consumer-public-entry-only",
      "src/features/product-capture/language-runtime.ts: ui-language-consumer-public-entry-only",
      "src/features/candidate-management/language-internal.ts: ui-language-consumer-public-entry-only",
      "src/features/mock/ui-language/language-runtime.ts: ui-language-consumer-public-entry-only",
      "src/application-shell/ui-language/language-internal.ts: ui-language-consumer-public-entry-only",
    ],
  );

  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "src/application-shell/language-public.ts",
        source: 'import { LanguageProvider } from "../ui-language/public.js";',
      },
      {
        path: "src/features/settings/language-public.ts",
        source:
          'import { LanguageSelectControl } from "../../ui-language/public.js";',
      },
      {
        path: "src/features/product-capture/language-public.ts",
        source:
          'import { LanguageProvider } from "../../ui-language/public.js";',
      },
      {
        path: "src/runtime/language-public.ts",
        source: 'import { LanguageProvider } from "../ui-language/public.js";',
      },
      {
        path: "src/runtime/language-runtime.ts",
        source:
          'import { initializeUiLanguage } from "../ui-language/runtime.js";',
      },
    ]),
    [],
  );
});

test("backup-restoreの公開面はsettings埋め込みsectionだけに限定する", async () => {
  const publicSource = await readFile(
    "src/features/backup-restore/public.ts",
    "utf8",
  );

  assert.match(publicSource, /BackupRestoreSectionMount/);
  assert.match(publicSource, /createBackupRestoreSectionMount/);
  assert.doesNotMatch(publicSource, /FeatureRegistration/);
  assert.doesNotMatch(publicSource, /backupRestoreFeatureId/);
  await assert.rejects(readFile("src/features/backup-restore/registration.ts"));
  await assert.rejects(
    readFile("src/features/backup-restore/feature-contribution.ts"),
  );
});

test("source catalog公開consumerは公開facetだけを利用する", () => {
  const forbiddenSources = [
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'import type { LocalDataRoot } from "../../src/domain/public.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'import type { FoundationDataPort } from "../../src/persistence/public.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'import type { CandidateDraft } from "../../src/features/candidate-management/public.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'import { query } from "../../src/features/candidate-management/source-catalog.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'import "../../src/features/candidate-management/source-catalog.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'const internal = import("../../src/features/candidate-management/source-catalog.js");',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'export { createCandidateSourceCatalog } from "../../src/features/candidate-management/source-catalog.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'export * from "../../src/features/candidate-management/source-catalog.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'import * as candidate from "../../src/features/candidate-management/public.js";',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'type Internal = import("../../src/features/candidate-management/source-catalog.js").CandidateSourceCatalogDependencies;',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'const modulePath = "../../src/features/candidate-management/public.js"; const candidate = await import(modulePath);',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        "const candidate = await import(`../../src/features/candidate-management/${" +
        "entry}.js`);",
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'const candidate = await import("../../src/features/candidate-management/" + entry + ".js");',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'const candidate = await import("../../src/features/candidate-management/public.js"); void candidate.CandidateDraft;',
    },
    {
      path: "tests/tooling/source-price-refresh-consumer.ts",
      source:
        'import type { CandidateDraft as Draft } from "../../src/features/candidate-management/public.js";',
    },
  ];
  const violations = findBoundaryViolations(forbiddenSources);

  assert.equal(violations.length, forbiddenSources.length);
  assert.ok(
    violations.every(
      ({ rule }) => rule === "source-catalog-consumer-public-contract-only",
    ),
  );

  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "tests/tooling/source-price-refresh-consumer.ts",
        source:
          'import type { Result } from "../../src/domain/public.js";\n' +
          'import type { CandidateSourceCatalogPort as Catalog, CandidateSourceReference, ManagementError } from "../../src/features/candidate-management/public.js";\n' +
          'import type { PagePriceExtractionError } from "../../src/features/product-capture/public.js";',
      },
    ]),
    [],
  );
});

test("candidate source catalogへURL正規化・一致判定を持ち込まない", () => {
  const forbiddenSources = [
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source:
        "const normalized = new URL(reference.pageUrl).hostname.toLowerCase();",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source:
        "const matches = references.filter((item) => item.pageUrl === pageUrl);",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source:
        "const match = references.find((item) => pageUrl === item['pageUrl']);",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source: "const key = canonicalize(reference.pageUrl);",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source: 'const key = normalizeUrl(reference["pageUrl"]);',
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source: "const unique = new Set(references.map((item) => item.pageUrl));",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source:
        "const url = source.pageUrl; const references = dedupeByPageUrl(allReferences, url);",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source:
        'const url = source.pageUrl; const matches = references.filter((item) => item.pageUrl === url); const selection = matches.length > 1 ? { kind: "ambiguous", matches } : matches[0];',
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source: "const key = source.pageUrl?.toLowerCase();",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source: "const url = source.pageUrl; const same = url === requestedUrl;",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source: "const url = source.pageUrl; const key = url.trim();",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source: "const url = source.pageUrl; const key = canonicalize(url);",
    },
    {
      path: "src/features/candidate-management/source-catalog.ts",
      source:
        "const { pageUrl: url } = source; const found = references.find((item) => item.pageUrl === url);",
    },
  ];
  const violations = findBoundaryViolations(forbiddenSources);

  assert.equal(violations.length, forbiddenSources.length);
  assert.ok(
    violations.every(
      ({ rule }) => rule === "candidate-source-catalog-no-url-matching",
    ),
  );

  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "src/features/candidate-management/source-catalog.ts",
        source:
          "const projected = source.pageUrl === undefined ? {} : { pageUrl: source.pageUrl }; const ids = new Set(references.map((item) => item.sourceId)); normalizeProjectName(name);",
      },
    ]),
    [],
  );

  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "src/features/candidate-management/source-catalog.ts",
        source:
          "const matches = candidates.filter((item) => item.id === candidateId); const unique = new Set(matches.map((item) => item.sourceId));",
      },
      {
        path: "src/features/candidate-management/source-catalog.ts",
        source:
          "const projected = source.pageUrl == null ? {} : { pageUrl: source.pageUrl };",
      },
    ]),
    [],
  );
});

test("candidate source catalogのcomputed・Reflect pageUrl利用も所有違反として拒否する", () => {
  const forbiddenSources = [
    "const key = 'page' + 'Url'; const normalized = source[key].trim();",
    "const key = `pageUrl`; const same = Reflect.get(source, key) === requestedUrl;",
    "const prefix = 'page'; const key = prefix + 'Url'; const unique = new Set([source[key]]);",
    "const property = 'page' + 'Url'; const url = Reflect.get(source, property); canonicalize(url);",
  ].map((source) => ({
    path: "src/features/candidate-management/source-catalog.ts",
    source,
  }));

  assert.deepEqual(
    findBoundaryViolations(forbiddenSources).map(({ rule }) => rule),
    forbiddenSources.map(() => "candidate-source-catalog-no-url-matching"),
  );

  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "src/features/candidate-management/source-catalog.ts",
        source:
          "const key = 'page' + 'Url'; const url = source[key]; const projected = url == null ? {} : { pageUrl: url };",
      },
    ]),
    [],
  );
});

test("candidate source catalogはconst alias・computed binding・Reflect alias経由のpageUrl所有違反を拒否する", () => {
  const forbiddenSources = [
    "const key = 'pageUrl'; const first = source[key]; const second = first; canonicalize(second);",
    "const key = 'pageUrl'; const { [key]: first } = source; const second = first; second.trim();",
    "const reflection = Reflect; const get = reflection.get; const key = 'page' + 'Url'; const first = get(source, key); normalizeUrl(first);",
    "const reflection = Reflect; const get = reflection['get']; const read = get; canonicalize(read(source, 'pageUrl'));",
    "const copied = { ...source }; const key = 'pageUrl'; const first = copied[key]; const compare = (value) => value === requestedUrl; compare(first);",
    "const key = runtimeKey; const value = source[key]; const projected = { pageUrl: value };",
    "const get = Reflect.get; const value = get(source, runtimeKey); const projected = { pageUrl: value };",
  ].map((source) => ({
    path: "src/features/candidate-management/source-catalog.ts",
    source,
  }));

  assert.deepEqual(
    findBoundaryViolations(forbiddenSources).map(({ rule }) => rule),
    forbiddenSources.map(() => "candidate-source-catalog-no-url-matching"),
  );

  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "src/features/candidate-management/source-catalog.ts",
        source:
          "const key = 'pageUrl'; const value = source[key]; const projected = value == null ? {} : { pageUrl: value }; const ids = references.map(({ candidateId, sourceId }) => ({ candidateId, sourceId }));",
      },
    ]),
    [],
  );
});

test("TypeScript AST gateは構文エラーをconsumer実行前にfail closedで拒否する", () => {
  assert.throws(
    () =>
      findBoundaryViolations([
        {
          path: "src/features/candidate-management/source-catalog.ts",
          source: "const broken = ;",
        },
      ]),
    /TypeScript syntactic diagnostics/,
  );
});

test("TypeScript AST gateは全TS・JS入力をrule判定前に構文preflightする", () => {
  const paths = [
    "src/features/source-price-refresh/public.ts",
    "src/application-shell/application-composition.ts",
    "tests/tooling/public-api-consumer.ts",
    "src/features/candidate-management/source-catalog.ts",
    "tests/tooling/source-price-refresh-consumer.ts",
    "tests/tooling/source-price-refresh-upstream-consumer.ts",
  ];
  for (const path of paths)
    assert.throws(
      () => findBoundaryViolations([{ path, source: "const broken = ;" }]),
      /TypeScript syntactic diagnostics/,
      path,
    );
});

test("application shell固有のsecurity・ownership境界違反をowner付きで拒否する", () => {
  const violations = findBoundaryViolations([
    {
      path: "src/application-shell/storage.ts",
      source: "chrome.storage.local.get();",
    },
    {
      path: "src/application-shell/legacy-platform.ts",
      source:
        'import type { FoundationRuntimePlatform } from "../persistence/public.js";',
    },
    {
      path: "src/application-shell/legacy-initializer.ts",
      source:
        'import { initializeFoundationRuntimeContribution } from "../persistence/public.js";',
    },
    {
      path: "src/application-shell/lock.ts",
      source: "navigator.locks.request('other-lock', callback);",
    },
    {
      path: "src/application-shell/authority.ts",
      source: "const authority = createWriteAuthority(dependencies);",
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
      "src/application-shell/legacy-platform.ts: application-shell-no-foundation-platform-injection",
      "src/application-shell/legacy-initializer.ts: application-shell-no-foundation-di-initializer",
      "src/application-shell/lock.ts: application-shell-no-direct-locks",
      "src/application-shell/authority.ts: application-shell-no-foundation-authority",
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

test("source-price-refreshはshellのpublicとworker-public以外へ到達しない", async () => {
  assert.deepEqual(
    findBoundaryViolations([
      {
        path: "src/features/source-price-refresh/ui-port.ts",
        source:
          'import type { FeatureId } from "../../application-shell/public.js";',
      },
      {
        path: "src/features/source-price-refresh/worker/menu-port.ts",
        source:
          'import { parseTargetTabId } from "../../../application-shell/worker-public.js";',
      },
    ]),
    [],
  );

  const violations = findBoundaryViolations([
    {
      path: "src/features/source-price-refresh/shell-leak.ts",
      source:
        'import { createSidePanelHost } from "../../application-shell/side-panel-host.js";',
    },
  ]);
  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/features/source-price-refresh/shell-leak.ts: source-price-refresh-shell-public-dependencies-only",
    ],
  );

  const root = await mkdtemp(join(tmpdir(), "source-price-refresh-boundary-"));
  try {
    const nested = join(
      root,
      "src",
      "features",
      "source-price-refresh",
      "nested",
    );
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(nested, "shell-leak.ts"),
      'import { createSidePanelHost } from "../../../application-shell/side-panel-host.js";',
    );
    assert.deepEqual(
      (await validateBoundaryRoots([root])).map(({ rule }) => rule),
      ["source-price-refresh-shell-public-dependencies-only"],
      "subdirectoryを含む再帰scanでdeep importを取りこぼさない",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("存在しないscan rootをfail closedに拒否する", async () => {
  await assert.rejects(
    validateBoundaryRoots(["src/features/__missing__"]),
    /boundary scan root does not exist/,
  );
});

test("localはdomain/language adapter、sessionはtransient adapterだけへ限定する(StorageAccessGuard)", () => {
  const violations = findStorageAccessViolations([
    {
      path: "src/persistence/chrome-storage-adapter.ts",
      source: "export const readRoot = () => chrome.storage.local.get();",
    },
    {
      path: "src/ui-language/preference-store.ts",
      source: "export const read = () => chrome.storage.local.get();",
    },
    {
      path: "src/runtime/transient-activation-store.ts",
      source: "export const read = () => chrome.storage.session.get();",
    },
    {
      path: "dist/foundation.js",
      source: "var readRoot = () => chrome.storage.local.get();",
    },
    {
      path: "dist/side-panel.js",
      source: "var read = () => chrome.storage.local.get();",
    },
    {
      path: "src/features/mock/leak.ts",
      source: "export const readCache = () => chrome.storage.local.get();",
    },
    {
      path: "dist/service-worker.js",
      source: "var readCache = () => chrome.storage.local.get();",
    },
    {
      path: "src/features/mock/aliased-leak.ts",
      source:
        "const area = chrome.storage; export const readCache = () => area.local.get();",
    },
    {
      path: "src/runtime/optional-leak.ts",
      source: "export const readSession = () => chrome.storage?.session.get();",
    },
    {
      path: "src/persistence/chrome-storage-adapter.ts",
      source: "export const wrongArea = () => chrome.storage.session.get();",
    },
    {
      path: "src/ui-language/preference-store.ts",
      source: "export const wrongArea = () => chrome.storage.session.get();",
    },
    {
      path: "src/runtime/transient-activation-store.ts",
      source: "export const wrongArea = () => chrome.storage.local.get();",
    },
    {
      path: "src/ui-language/preference-store.ts",
      source:
        "const storage = chrome.storage; export const read = () => storage.local.get();",
    },
    {
      path: "src/persistence/chrome-storage-adapter.ts",
      source:
        "const { session } = chrome.storage; export const read = () => session.get();",
    },
    {
      path: "src/runtime/transient-activation-store.ts",
      source:
        "const { session: storedSession } = chrome.storage; export const read = () => storedSession.get();",
    },
    {
      path: "src/ui-language/preference-store.ts",
      source: "export const read = () => chrome.storage?.session.get();",
    },
    {
      path: "src/features/mock/foundation.js",
      source: "export const read = () => chrome.storage.local.get();",
    },
    {
      path: "tmp/side-panel.js",
      source: "export const read = () => chrome.storage.local.get();",
    },
    {
      path: "dist/unexpected/foundation.js",
      source: "export const read = () => chrome.storage.local.get();",
    },
  ]);

  assert.deepEqual(
    violations.map(({ path, rule }) => `${path}: ${rule}`),
    [
      "src/features/mock/leak.ts: no-direct-storage-access",
      "src/features/mock/aliased-leak.ts: no-direct-storage-access",
      "src/runtime/optional-leak.ts: no-direct-storage-access",
      "src/persistence/chrome-storage-adapter.ts: no-direct-storage-access",
      "src/ui-language/preference-store.ts: no-direct-storage-access",
      "src/runtime/transient-activation-store.ts: no-direct-storage-access",
      "src/ui-language/preference-store.ts: no-direct-storage-access",
      "src/persistence/chrome-storage-adapter.ts: no-direct-storage-access",
      "src/runtime/transient-activation-store.ts: no-direct-storage-access",
      "src/ui-language/preference-store.ts: no-direct-storage-access",
      "src/features/mock/foundation.js: no-direct-storage-access",
      "tmp/side-panel.js: no-direct-storage-access",
      "dist/unexpected/foundation.js: no-direct-storage-access",
    ],
  );
});

test("application shell公開入口はtransient concrete実装を公開しない", async () => {
  const publicApi = await readFile("src/application-shell/public.ts", "utf8");
  assert.match(publicApi, /TransientSurfaceLifecyclePort/);
  assert.match(publicApi, /TransientGestureRegistrationPort/);
  assert.match(publicApi, /TransientApplicationFeatureRegistration/);
  assert.doesNotMatch(
    publicApi,
    /createTransientSurfaceController|TransientSurfaceController|createLateBoundLifecycle|createTransientGestureRegistrar|TransientWatchReadyRequest|TransientActivationStore|TransientDismissReason|TransientSurfaceState/,
  );
});

test("production side panelは許可store外からsession storageへ到達しない", async () => {
  const sources = await Promise.all(
    [
      "src/runtime/side-panel.ts",
      "src/runtime/production-transient-panel.ts",
      "src/runtime/transient-activation-store.ts",
    ].map(async (path) => ({ path, source: await readFile(path, "utf8") })),
  );
  assert.deepEqual(findStorageAccessViolations(sources), []);
});

test("production workerもstore以外からsession storageへ到達しない", async () => {
  const sources = await Promise.all(
    [
      "src/runtime/service-worker.ts",
      "src/runtime/transient-activation-store.ts",
    ].map(async (path) => ({ path, source: await readFile(path, "utf8") })),
  );
  assert.deepEqual(findStorageAccessViolations(sources), []);
  assert.doesNotMatch(sources[0]?.source ?? "", /\bchrome\.storage\b/);
});

test("validateBoundaryRootsはStorageAccessGuardの違反も返す", async () => {
  const directory = await mkdtemp(join(tmpdir(), "storage-access-guard-"));
  try {
    await mkdir(join(directory, "src", "features", "mock"), {
      recursive: true,
    });
    await writeFile(
      join(directory, "src", "features", "mock", "leak.ts"),
      "export const readCache = () => chrome.storage.local.get();",
    );
    const violations = await validateBoundaryRoots([directory]);
    assert.deepEqual(
      violations.map(({ rule }) => rule),
      ["no-direct-storage-access"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
