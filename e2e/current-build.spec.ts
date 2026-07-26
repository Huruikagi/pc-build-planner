import type { ConsoleMessage, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  categoryButton,
  confirmQuantityButton,
  createCandidateButton,
  featureRoot,
  formField,
  navItem,
  quantityInput,
  region,
  removeCandidateButton,
  selectCandidateButton,
  submitButton,
} from "./locators.js";

/**
 * Resolves the unpacked extension id from the loaded service worker so the side
 * panel document can be opened directly as a trusted extension page.
 */
async function extensionId(context: {
  serviceWorkers(): readonly { url(): string }[];
  waitForEvent(event: "serviceworker"): Promise<{ url(): string }>;
}): Promise<string> {
  const existing = context.serviceWorkers()[0];
  const worker = existing ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  expect(id).toMatch(/^[a-p]{32}$/);
  return id;
}

interface Diagnostics {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
}

function watchDiagnostics(page: Page): Diagnostics {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

test("side panel drives single・複数選択の採用・数量変更・解除を real storageへ反映し再起動後も復元する", async ({
  context,
}) => {
  const id = await extensionId(context);
  const page = await context.newPage();
  const diagnostics = watchDiagnostics(page);
  await page.goto(`chrome-extension://${id}/side-panel.html`);

  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );

  // Seed a project and two classified candidates through candidate management.
  await navItem(page, "candidate-management").click();
  const candidateManagementRoot = featureRoot(page, "candidate-management");
  await formField(page, "project-name").fill("E2E 現在構成プロジェクト");
  await submitButton(region(candidateManagementRoot, "project-form")).click();
  await expect(
    page.getByRole("button", {
      name: "E2E 現在構成プロジェクト",
      exact: true,
    }),
  ).toBeVisible();

  await createCandidateButton(candidateManagementRoot).click();
  await formField(page, "candidate-name").fill("E2E 現在構成CPU");
  await formField(page, "candidate-category").selectOption("cpu");
  await formField(page, "attribute-socket").fill("SYN-E2E-CPU");
  await submitButton(region(candidateManagementRoot, "candidate-form")).click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 現在構成CPU" }),
  ).toBeVisible();

  await createCandidateButton(candidateManagementRoot).click();
  await formField(page, "candidate-name").fill("E2E 現在構成メモリ");
  await formField(page, "candidate-category").selectOption("memory");
  await formField(page, "attribute-memoryStandard").fill("SYN-E2E-DDR");
  await submitButton(region(candidateManagementRoot, "candidate-form")).click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 現在構成メモリ" }),
  ).toBeVisible();

  // The feature must be reachable from shell navigation, not just registered.
  await navItem(page, "currentBuild").click();
  const buildRegion = featureRoot(page, "currentBuild");
  await expect(buildRegion).toBeVisible();
  await expect(
    buildRegion.getByRole("button", {
      name: "E2E 現在構成プロジェクト",
      exact: true,
    }),
  ).toBeVisible();

  // Single-select category: adopt the CPU candidate.
  await categoryButton(buildRegion, "cpu").click();
  const cpuRow = region(buildRegion, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成CPU" });
  await selectCandidateButton(cpuRow).click();
  await expect(removeCandidateButton(cpuRow)).toBeVisible();

  // Multiple-select category: add the memory candidate and confirm a quantity.
  await categoryButton(buildRegion, "memory").click();
  const memoryRow = region(buildRegion, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成メモリ" });
  await selectCandidateButton(memoryRow).click();
  await expect(confirmQuantityButton(memoryRow)).toBeVisible();
  await quantityInput(memoryRow).fill("2");
  await confirmQuantityButton(memoryRow).click();
  await expect(quantityInput(memoryRow)).toHaveValue("2");

  // chrome.storage.local writes can lag the resolved UI promise under heavy
  // parallel test load; wait for the quantity to be durably persisted before
  // reloading, rather than racing a page navigation against the write.
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            new Promise<number | undefined>((resolve) => {
              chrome.storage.local.get("localDataRoot", (result) => {
                const root = (
                  result as {
                    localDataRoot?: {
                      currentBuilds?: readonly {
                        items?: readonly {
                          candidatePartId: string;
                          quantity: number;
                        }[];
                      }[];
                    };
                  }
                ).localDataRoot;
                const quantities = (root?.currentBuilds?.[0]?.items ?? []).map(
                  (item) => item.quantity,
                );
                resolve(quantities.includes(2) ? 2 : undefined);
              });
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(2);

  // Reload: the adopted parts and confirmed quantity must be restored.
  await page.reload();
  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await navItem(page, "currentBuild").click();
  const reopenedRegion = featureRoot(page, "currentBuild");
  await expect(categoryButton(reopenedRegion, "cpu")).toBeVisible();
  await categoryButton(reopenedRegion, "cpu").click();
  const reopenedCpuRow = region(reopenedRegion, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成CPU" });
  await expect(removeCandidateButton(reopenedCpuRow)).toBeVisible();
  await categoryButton(reopenedRegion, "memory").click();
  const reopenedMemoryRow = region(reopenedRegion, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成メモリ" });
  await expect(quantityInput(reopenedMemoryRow)).toHaveValue("2");

  // Unselect the memory candidate; the CPU selection must be unaffected.
  await removeCandidateButton(reopenedMemoryRow).click();
  await expect(selectCandidateButton(reopenedMemoryRow)).toBeVisible();
  await categoryButton(reopenedRegion, "cpu").click();
  await expect(removeCandidateButton(reopenedCpuRow)).toBeVisible();

  expect(diagnostics.pageErrors, "boot must not raise runtime errors").toEqual(
    [],
  );
  expect(diagnostics.consoleErrors, "boot must not log console errors").toEqual(
    [],
  );
});
