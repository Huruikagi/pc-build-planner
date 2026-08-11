import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  featureRoot,
  navItem,
  persistentNavigationItems,
} from "./models/application-shell.js";
import {
  addCandidateSourceButton,
  attributeCustomField,
  attributeField,
  candidateSourceField,
  candidateSourcePriceField,
  candidateSourceRows,
  candidateSources,
  createCandidateButton,
  editCandidateButton,
  primaryCandidateSourceInput,
} from "./models/candidate-management.js";
import {
  categoryButton,
  confirmQuantityButton,
  quantityInput,
  removeCandidateButton,
  selectCandidateButton,
} from "./models/current-build.js";
import {
  action,
  formField,
  region,
  submitButton,
} from "./models/locator-primitives.js";
import {
  projectContextOption,
  selectedProjectContextOption,
} from "./models/project-context.js";
import {
  backupRestoreSection,
  restoreFileInput,
  selectLanguage,
} from "./models/settings.js";
import { expectedText } from "./support/expected-text.js";
import {
  extensionId,
  readStoredData,
  watchDiagnostics,
} from "./support/extension-page.js";

/**
 * The safe restore input ceiling (Requirement 1.7 / 3.4). A generated backup
 * must always fit through the same version's file preflight, so the artifact
 * is measured against this boundary before it is fed back in.
 */
const MAX_RESTORE_INPUT_BYTES = 16 * 1024 * 1024;

const PROJECT_NAME = "E2E バックアップ対象プロジェクト";

/**
 * The artifact is read back as plain JSON. Only the fields this spec asserts
 * on are described, so the exchange contract stays owned by its unit tests.
 */
interface ExchangeData {
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly parts: readonly {
    readonly id: string;
    readonly category: string;
    readonly primarySourceId?: string;
    readonly sources?: readonly { readonly id: string }[];
    readonly normalizedAttributes?: unknown;
  }[];
  readonly currentBuilds: readonly {
    readonly projectId: string;
    readonly items: readonly {
      readonly candidatePartId: string;
      readonly quantity: number;
    }[];
  }[];
}

type AttributeSeed =
  | { readonly key: string; readonly kind: "text"; readonly value: string }
  | { readonly key: string; readonly kind: "select"; readonly value: string }
  | { readonly key: string; readonly kind: "custom"; readonly value: string };

interface CandidateSeed {
  readonly category: string;
  readonly name: string;
  readonly attributes: readonly AttributeSeed[];
}

/**
 * One synthetic candidate per part category, so the exchange format has to
 * carry every attribute variant rather than the single shape a happy-path
 * fixture would exercise.
 */
const CANDIDATE_SEEDS: readonly CandidateSeed[] = [
  {
    category: "cpu",
    name: "E2E 架空プロセッサ",
    attributes: [{ key: "socket", kind: "text", value: "SYN-SOCKET-1" }],
  },
  {
    category: "cpu-cooler",
    name: "E2E 架空CPUクーラー",
    attributes: [
      {
        key: "supportedSockets",
        kind: "text",
        value: "SYN-SOCKET-1, SYN-SOCKET-2",
      },
    ],
  },
  {
    category: "motherboard",
    name: "E2E 架空マザーボード",
    attributes: [
      { key: "socket", kind: "text", value: "SYN-SOCKET-1" },
      { key: "memoryStandard", kind: "text", value: "SYN-DDR-9" },
      { key: "formFactor", kind: "select", value: "Micro-ATX" },
    ],
  },
  {
    category: "memory",
    name: "E2E 架空メモリ",
    attributes: [{ key: "memoryStandard", kind: "text", value: "SYN-DDR-9" }],
  },
  { category: "gpu", name: "E2E 架空GPU", attributes: [] },
  { category: "storage", name: "E2E 架空ストレージ", attributes: [] },
  {
    category: "power-supply",
    name: "E2E 架空電源",
    attributes: [{ key: "formFactor", kind: "select", value: "SFX" }],
  },
  {
    category: "case",
    name: "E2E 架空ケース",
    attributes: [
      {
        key: "supportedMotherboardFormFactors",
        kind: "custom",
        value: "SYN-FF-A, SYN-FF-B",
      },
      {
        key: "supportedPowerSupplyFormFactors",
        kind: "custom",
        value: "SYN-PSU-A",
      },
    ],
  },
  { category: "case-fan", name: "E2E 架空ファン", attributes: [] },
  {
    category: "expansion-card",
    name: "E2E 架空拡張カード",
    attributes: [],
  },
  { category: "other", name: "E2E 架空その他パーツ", attributes: [] },
  { category: "uncategorized", name: "E2E 架空未分類パーツ", attributes: [] },
];

const openCandidateManagement = (page: Page): Promise<void> =>
  navItem(page, "candidate-management").click();

const openBackupRestore = (page: Page): Promise<void> =>
  navItem(page, "settings").click();

const candidateRow = (management: Locator, name: string): Locator =>
  region(management, "candidate-list").getByRole("listitem").filter({
    hasText: name,
  });

async function createProject(page: Page, management: Locator): Promise<void> {
  await formField(page, "project-name").fill(PROJECT_NAME);
  await submitButton(region(management, "project-form")).click();
  await expect(projectContextOption(page, PROJECT_NAME)).toHaveCount(1);
  await expect(selectedProjectContextOption(page)).toHaveText(PROJECT_NAME);
}

async function createCandidate(
  page: Page,
  management: Locator,
  seed: CandidateSeed,
): Promise<void> {
  await createCandidateButton(management).click();
  const form = region(management, "candidate-form");
  await formField(page, "candidate-name").fill(seed.name);
  await formField(page, "candidate-category").selectOption(seed.category);
  for (const attribute of seed.attributes) {
    if (attribute.kind === "select") {
      await attributeField(form, attribute.key).selectOption(attribute.value);
      continue;
    }
    const field =
      attribute.kind === "custom"
        ? attributeCustomField(form, attribute.key)
        : attributeField(form, attribute.key);
    await field.fill(attribute.value);
  }
  await submitButton(form).click();
  await expect(candidateRow(management, seed.name)).toBeVisible();
}

/** Adds two classified sources so source identity and price survive the trip. */
async function addSources(management: Locator, name: string): Promise<void> {
  await editCandidateButton(candidateRow(management, name)).click();
  const form = region(management, "candidate-form");
  const sources = candidateSources(form);
  await addCandidateSourceButton(sources).click();
  await addCandidateSourceButton(sources).click();
  const rows = candidateSourceRows(sources);
  await expect(rows).toHaveCount(2);

  const first = rows.nth(0);
  await candidateSourceField(first, 0, "url").fill(
    "https://manufacturer.synthetic-maker.example.invalid/products/e2e-cpu",
  );
  await candidateSourceField(first, 0, "site-name").fill("架空メーカーサイト");
  await candidateSourceField(first, 0, "captured-at").fill(
    "2026-07-30T01:00:00.000Z",
  );
  await candidateSourceField(first, 0, "kind").selectOption("manufacturer");
  await primaryCandidateSourceInput(first).check();

  const second = rows.nth(1);
  await candidateSourceField(second, 1, "url").fill(
    "https://shop.synthetic-retailer.example.invalid/products/e2e-cpu",
  );
  await candidateSourceField(second, 1, "site-name").fill("架空販売サイト");
  await candidateSourceField(second, 1, "captured-at").fill(
    "2026-07-30T02:00:00.000Z",
  );
  await candidateSourceField(second, 1, "kind").selectOption("retail");
  await candidateSourcePriceField(second, 1).fill("12345");

  await submitButton(form).click();
  await expect(candidateRow(management, name)).toBeVisible();
}

/** Adopts a single-select and a multi-select part so build references vary. */
async function seedCurrentBuild(page: Page): Promise<void> {
  await navItem(page, "currentBuild").click();
  const build = featureRoot(page, "currentBuild");
  await categoryButton(build, "cpu").click();
  const cpuRow = region(build, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 架空プロセッサ" });
  await selectCandidateButton(cpuRow).click();
  await expect(removeCandidateButton(cpuRow)).toBeVisible();

  await categoryButton(build, "memory").click();
  const memoryRow = region(build, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 架空メモリ" });
  await selectCandidateButton(memoryRow).click();
  await expect(confirmQuantityButton(memoryRow)).toBeVisible();
  await quantityInput(memoryRow).fill("3");
  await confirmQuantityButton(memoryRow).click();
  await expect(quantityInput(memoryRow)).toHaveValue("3");
}

async function exportBackup(
  page: Page,
  outputPath: string,
): Promise<{ readonly json: string; readonly filename: string }> {
  const backupRegion = region(backupRestoreSection(page), "export");
  await expect(backupRegion).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await action(backupRegion, "export").click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  expect(filename).toMatch(/^pc-build-planner-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await download.saveAs(outputPath);
  await expect(backupRegion.getByRole("status")).toContainText(
    expectedText("backup.downloaded", { filename: "" }),
  );
  return { json: await readFile(outputPath, "utf8"), filename };
}

test("side panelからexportした全カテゴリのバックアップが実storageを復元し再起動後も維持される", async ({
  context,
}, testInfo) => {
  const id = await extensionId(context);
  const page = await context.newPage();
  const diagnostics = watchDiagnostics(page);
  await page.goto(`chrome-extension://${id}/side-panel.html`);

  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  // This spec's assertions expect Japanese text; pin it explicitly rather
  // than depending on the test machine's ambient browser locale (8.1, 8.2).
  await selectLanguage(page, "ja");
  const management = featureRoot(page, "candidate-management");
  const backupRestoreRoot = backupRestoreSection(page);
  await expect(persistentNavigationItems(page)).toHaveCount(4);

  // An empty root must already produce a restorable artifact (Requirement 1.4).
  const emptyBackupPath = testInfo.outputPath("empty-backup.json");
  const emptyExport = await exportBackup(page, emptyBackupPath);
  expect(JSON.parse(emptyExport.json)).toMatchObject({
    product: "pc-build-planner",
    formatVersion: 1,
    data: { projects: [], parts: [], currentBuilds: [] },
  });

  // Seed one candidate per category, sources on the CPU, and a current build.
  await openCandidateManagement(page);
  await createProject(page, management);
  for (const seed of CANDIDATE_SEEDS) {
    await createCandidate(page, management, seed);
  }
  await addSources(management, "E2E 架空プロセッサ");
  await seedCurrentBuild(page);
  await expect
    .poll(async () => {
      const stored = await readStoredData(page);
      const currentBuild = stored.currentBuilds[0] as
        | ExchangeData["currentBuilds"][number]
        | undefined;
      return currentBuild?.items.some((item) => item.quantity === 3);
    })
    .toBe(true);

  const beforeBackup = await readStoredData(page);
  expect(beforeBackup.projects).toHaveLength(1);
  expect(beforeBackup.candidateParts).toHaveLength(CANDIDATE_SEEDS.length);
  expect(beforeBackup.currentBuilds).toHaveLength(1);

  // Export: the real Blob download path must produce a named JSON artifact.
  await openBackupRestore(page);
  const backupPath = testInfo.outputPath("backup.json");
  const exported = await exportBackup(page, backupPath);

  // The artifact is the versioned exchange envelope, not the persistence root.
  const envelope: unknown = JSON.parse(exported.json);
  expect(envelope).toMatchObject({
    product: "pc-build-planner",
    formatVersion: 1,
  });
  expect(envelope).not.toHaveProperty("schemaVersion");
  // A generated backup must fit the same version's restore input ceiling.
  expect(Buffer.byteLength(exported.json, "utf8")).toBeLessThanOrEqual(
    MAX_RESTORE_INPUT_BYTES,
  );

  // Every category, its normalized attributes, the classified sources and the
  // current build references must all be carried by the artifact itself.
  const data = (envelope as { readonly data: ExchangeData }).data;
  expect(data.projects.map((project) => project.name)).toEqual([PROJECT_NAME]);
  expect(data.parts.map((part) => part.category)).toEqual(
    CANDIDATE_SEEDS.map((seed) => seed.category),
  );
  const cpuPart = data.parts.find((part) => part.category === "cpu");
  expect(cpuPart?.normalizedAttributes).toMatchObject({
    category: "cpu",
    socket: { confirmed: "SYN-SOCKET-1" },
  });
  expect(cpuPart?.sources).toHaveLength(2);
  expect(cpuPart?.primarySourceId).toBe(cpuPart?.sources?.[0]?.id);
  expect(cpuPart?.sources?.[1]).toMatchObject({
    kind: "retail",
    siteName: "架空販売サイト",
    price: { confirmed: { amount: 12345 } },
  });
  expect(
    data.parts.find((part) => part.category === "case")?.normalizedAttributes,
  ).toMatchObject({
    supportedMotherboardFormFactors: { confirmed: ["SYN-FF-A", "SYN-FF-B"] },
    supportedPowerSupplyFormFactors: { confirmed: ["SYN-PSU-A"] },
  });
  const memoryPartId = data.parts.find(
    (part) => part.category === "memory",
  )?.id;
  expect(data.currentBuilds[0]?.projectId).toBe(data.projects[0]?.id);
  expect(data.currentBuilds[0]?.items).toContainEqual({
    candidatePartId: memoryPartId,
    quantity: 3,
  });
  // Derived compatibility results, raw HTML and images stay out of the format.
  for (const part of data.parts) {
    expect(part).not.toHaveProperty("rawHtml");
    expect(part).not.toHaveProperty("imageUrl");
    expect(part).not.toHaveProperty("compatibility");
  }

  // Diverge the stored data after the backup so the restore has to undo it.
  await openCandidateManagement(page);
  await createCandidate(page, management, {
    category: "memory",
    name: "E2E 復元で消える候補",
    attributes: [{ key: "memoryStandard", kind: "text", value: "SYN-DDR-X" }],
  });

  // Preflight: selecting the file must preview counts without writing.
  await openBackupRestore(page);
  const restoreRegion = region(backupRestoreRoot, "restore");
  await restoreFileInput(restoreRegion).setInputFiles(backupPath);

  const confirmation = region(backupRestoreRoot, "restore-confirmation");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(
    expectedText("backup.restoreWarning"),
  );
  await expect(confirmation.getByRole("definition").nth(1)).toHaveText("1");

  // Cancelling must leave the diverged data untouched.
  await action(confirmation, "cancel").click();
  await expect(confirmation).toBeHidden();
  await openCandidateManagement(page);
  await expect(candidateRow(management, "E2E 復元で消える候補")).toBeVisible();

  // Confirming replaces every root in a single Foundation write.
  await openBackupRestore(page);
  await restoreFileInput(restoreRegion).setInputFiles(backupPath);
  await expect(confirmation).toBeVisible();
  await action(confirmation, "confirm").click();
  await expect(restoreRegion.getByRole("status")).toContainText(
    expectedText("backup.restoreCompleted", {
      projectCount: 1,
      partCount: CANDIDATE_SEEDS.length,
      currentBuildCount: 1,
    }),
  );

  // Reload: the restored snapshot must survive a real storage round trip.
  await page.reload();
  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );

  // Projects, parts, sources, normalized attributes and current build
  // references must all come back byte-for-byte, and the post-backup
  // candidate must be gone rather than merged.
  const afterRestore = await readStoredData(page);
  expect(afterRestore).toEqual(beforeBackup);

  await openCandidateManagement(page);
  await expect(projectContextOption(page, PROJECT_NAME)).toHaveCount(1);
  await expect(selectedProjectContextOption(page)).toHaveText(PROJECT_NAME);
  for (const seed of CANDIDATE_SEEDS) {
    await expect(candidateRow(management, seed.name)).toBeVisible();
  }
  await expect(candidateRow(management, "E2E 復元で消える候補")).toHaveCount(0);

  await navItem(page, "currentBuild").click();
  const build = featureRoot(page, "currentBuild");
  await categoryButton(build, "memory").click();
  await expect(
    quantityInput(
      region(build, "candidate-list")
        .getByRole("listitem")
        .filter({ hasText: "E2E 架空メモリ" }),
    ),
  ).toHaveValue("3");

  // Normal CRUD and a second backup must still work after the replacement.
  await openCandidateManagement(page);
  await createCandidate(page, management, {
    category: "cpu",
    name: "E2E 復元後の新候補",
    attributes: [{ key: "socket", kind: "text", value: "SYN-SOCKET-3" }],
  });

  await openBackupRestore(page);
  const secondBackupPath = testInfo.outputPath("backup-2.json");
  await exportBackup(page, secondBackupPath);

  // The empty-root artifact stays restorable, replacing the seeded data.
  await restoreFileInput(restoreRegion).setInputFiles(emptyBackupPath);
  await expect(confirmation).toBeVisible();
  await action(confirmation, "confirm").click();
  await expect(restoreRegion.getByRole("status")).toContainText(
    expectedText("backup.restoreCompleted", {
      projectCount: 0,
      partCount: 0,
      currentBuildCount: 0,
    }),
  );
  expect(await readStoredData(page)).toEqual({
    projects: [],
    candidateParts: [],
    currentBuilds: [],
  });

  expect(diagnostics.pageErrors, "boot must not raise runtime errors").toEqual(
    [],
  );
  expect(diagnostics.consoleErrors, "boot must not log console errors").toEqual(
    [],
  );
});
