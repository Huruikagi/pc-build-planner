import type { ConsoleMessage, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";

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
  await page.getByRole("button", { name: "候補管理" }).click();
  await page
    .locator("input[name='project-name']")
    .fill("E2E 現在構成プロジェクト");
  await page.getByRole("button", { name: "プロジェクトを作成" }).click();
  await expect(
    page.getByRole("button", {
      name: "E2E 現在構成プロジェクト",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "候補を作成" }).click();
  await page.locator("input[name='candidate-name']").fill("E2E 現在構成CPU");
  await page.locator("select[name='candidate-category']").selectOption("cpu");
  await page.locator("input[name='attribute-socket']").fill("SYN-E2E-CPU");
  await page
    .getByRole("form", { name: "候補編集" })
    .getByRole("button", { name: "保存" })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "E2E 現在構成CPU" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "候補を作成" }).click();
  await page.locator("input[name='candidate-name']").fill("E2E 現在構成メモリ");
  await page
    .locator("select[name='candidate-category']")
    .selectOption("memory");
  await page
    .locator("input[name='attribute-memoryStandard']")
    .fill("SYN-E2E-DDR");
  await page
    .getByRole("form", { name: "候補編集" })
    .getByRole("button", { name: "保存" })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "E2E 現在構成メモリ" }),
  ).toBeVisible();

  // The feature must be reachable from shell navigation, not just registered.
  await page.getByRole("button", { name: "現在構成", exact: true }).click();
  const buildRegion = page.getByRole("region", { name: "現在構成" });
  await expect(buildRegion).toBeVisible();
  await expect(
    buildRegion.getByRole("button", {
      name: "E2E 現在構成プロジェクト",
      exact: true,
    }),
  ).toBeVisible();

  // Single-select category: adopt the CPU candidate.
  await buildRegion.getByRole("button", { name: "CPU", exact: true }).click();
  const cpuRow = buildRegion
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成CPU" });
  await cpuRow.getByRole("button", { name: "選択" }).click();
  await expect(cpuRow.getByRole("button", { name: "解除" })).toBeVisible();

  // Multiple-select category: add the memory candidate and confirm a quantity.
  await buildRegion
    .getByRole("button", { name: "メモリ", exact: true })
    .click();
  const memoryRow = buildRegion
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成メモリ" });
  await memoryRow.getByRole("button", { name: "追加" }).click();
  await expect(
    memoryRow.getByRole("button", { name: "数量を確定" }),
  ).toBeVisible();
  await memoryRow.locator("input[data-quantity-input]").fill("2");
  await memoryRow.getByRole("button", { name: "数量を確定" }).click();
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
  await page.getByRole("button", { name: "現在構成", exact: true }).click();
  const reopenedRegion = page.getByRole("region", { name: "現在構成" });
  await expect(
    reopenedRegion.getByRole("button", { name: "CPU", exact: true }),
  ).toBeVisible();
  await reopenedRegion
    .getByRole("button", { name: "CPU", exact: true })
    .click();
  await expect(
    reopenedRegion
      .getByRole("listitem")
      .filter({ hasText: "E2E 現在構成CPU" })
      .getByRole("button", { name: "解除" }),
  ).toBeVisible();
  await reopenedRegion
    .getByRole("button", { name: "メモリ", exact: true })
    .click();
  const reopenedMemoryRow = reopenedRegion
    .getByRole("listitem")
    .filter({ hasText: "E2E 現在構成メモリ" });
  await expect(
    reopenedMemoryRow.locator("input[data-quantity-input]"),
  ).toHaveValue("2");

  // Unselect the memory candidate; the CPU selection must be unaffected.
  await reopenedMemoryRow.getByRole("button", { name: "解除" }).click();
  await expect(
    reopenedMemoryRow.getByRole("button", { name: "追加" }),
  ).toBeVisible();
  await reopenedRegion
    .getByRole("button", { name: "CPU", exact: true })
    .click();
  await expect(
    reopenedRegion
      .getByRole("listitem")
      .filter({ hasText: "E2E 現在構成CPU" })
      .getByRole("button", { name: "解除" }),
  ).toBeVisible();

  expect(diagnostics.pageErrors, "boot must not raise runtime errors").toEqual(
    [],
  );
  expect(diagnostics.consoleErrors, "boot must not log console errors").toEqual(
    [],
  );
});
