import type { ConsoleMessage, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import { navItem, region } from "./locators.js";

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

  await expect(page.locator("#application-shell")).toHaveAttribute(
    "data-runtime-state",
    "started",
  );

  // Seed a project and two classified candidates through candidate management.
  await navItem(page, "candidate-management").click();
  const candidateManagementRoot = page.locator(
    '.shell-feature[data-feature-id="candidate-management"]',
  );
  await page
    .locator("input[name='project-name']")
    .fill("E2E 現在構成プロジェクト");
  await region(candidateManagementRoot, "project-form")
    .locator('button[type="submit"]')
    .click();
  await expect(
    page.getByRole("button", {
      name: "E2E 現在構成プロジェクト",
      exact: true,
    }),
  ).toBeVisible();

  await candidateManagementRoot.locator("[data-create-candidate]").click();
  await page.locator("input[name='candidate-name']").fill("E2E 現在構成CPU");
  await page.locator("select[name='candidate-category']").selectOption("cpu");
  await page.locator("input[name='attribute-socket']").fill("SYN-E2E-CPU");
  await region(candidateManagementRoot, "candidate-form")
    .locator('button[type="submit"]')
    .click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 現在構成CPU" }),
  ).toBeVisible();

  await candidateManagementRoot.locator("[data-create-candidate]").click();
  await page.locator("input[name='candidate-name']").fill("E2E 現在構成メモリ");
  await page
    .locator("select[name='candidate-category']")
    .selectOption("memory");
  await page
    .locator("input[name='attribute-memoryStandard']")
    .fill("SYN-E2E-DDR");
  await region(candidateManagementRoot, "candidate-form")
    .locator('button[type="submit"]')
    .click();
  await expect(
    region(candidateManagementRoot, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 現在構成メモリ" }),
  ).toBeVisible();

  // The feature must be reachable from shell navigation, not just registered.
  await navItem(page, "currentBuild").click();
  const buildRegion = page.locator(
    '.shell-feature[data-feature-id="currentBuild"]',
  );
  await expect(buildRegion).toBeVisible();
  await expect(
    buildRegion.getByRole("button", {
      name: "E2E 現在構成プロジェクト",
      exact: true,
    }),
  ).toBeVisible();

  // Single-select category: adopt the CPU candidate.
  await buildRegion.locator('[data-category="cpu"]').click();
  const cpuRow = region(buildRegion, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成CPU" });
  await cpuRow.locator("[data-select-candidate-id]").click();
  await expect(cpuRow.locator("[data-remove-candidate-id]")).toBeVisible();

  // Multiple-select category: add the memory candidate and confirm a quantity.
  await buildRegion.locator('[data-category="memory"]').click();
  const memoryRow = region(buildRegion, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成メモリ" });
  await memoryRow.locator("[data-select-candidate-id]").click();
  await expect(memoryRow.locator("[data-confirm-quantity]")).toBeVisible();
  await memoryRow.locator("input[data-quantity-input]").fill("2");
  await memoryRow.locator("[data-confirm-quantity]").click();
  await expect(memoryRow.locator("input[data-quantity-input]")).toHaveValue(
    "2",
  );

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
  await expect(page.locator("#application-shell")).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await navItem(page, "currentBuild").click();
  const reopenedRegion = page.locator(
    '.shell-feature[data-feature-id="currentBuild"]',
  );
  await expect(reopenedRegion.locator('[data-category="cpu"]')).toBeVisible();
  await reopenedRegion.locator('[data-category="cpu"]').click();
  await expect(
    region(reopenedRegion, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 現在構成CPU" })
      .locator("[data-remove-candidate-id]"),
  ).toBeVisible();
  await reopenedRegion.locator('[data-category="memory"]').click();
  const reopenedMemoryRow = region(reopenedRegion, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成メモリ" });
  await expect(
    reopenedMemoryRow.locator("input[data-quantity-input]"),
  ).toHaveValue("2");

  // Unselect the memory candidate; the CPU selection must be unaffected.
  await reopenedMemoryRow.locator("[data-remove-candidate-id]").click();
  await expect(
    reopenedMemoryRow.locator("[data-select-candidate-id]"),
  ).toBeVisible();
  await reopenedRegion.locator('[data-category="cpu"]').click();
  await expect(
    region(reopenedRegion, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 現在構成CPU" })
      .locator("[data-remove-candidate-id]"),
  ).toBeVisible();

  expect(diagnostics.pageErrors, "boot must not raise runtime errors").toEqual(
    [],
  );
  expect(diagnostics.consoleErrors, "boot must not log console errors").toEqual(
    [],
  );
});
