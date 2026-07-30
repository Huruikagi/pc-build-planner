import type { BrowserContext, Page, Request } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  featureRoot,
  navItem,
} from "./models/application-shell.js";
import {
  addCandidateSourceButton,
  candidateSourceField,
  candidateSourceRows,
  candidateSources,
  createCandidateButton,
  editCandidateButton,
  openCandidateSourceButton,
  openPrimaryCandidateSourceButton,
  primaryCandidateSourceInput,
} from "./models/candidate-management.js";
import {
  formField,
  region,
  submitButton,
} from "./models/locator-primitives.js";

const primaryUrl =
  "https://manufacturer.synthetic-maker.example.invalid/products/e2e-cpu";
const secondaryUrl =
  "https://shop.synthetic-retailer.example.invalid/products/e2e-cpu";

async function extensionId(context: BrowserContext): Promise<string> {
  const existing = context.serviceWorkers()[0];
  const worker = existing ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  expect(id).toMatch(/^[a-p]{32}$/);
  return id;
}

async function expectNewTab(
  context: BrowserContext,
  trigger: () => Promise<void>,
  expectedUrl: string,
): Promise<Page> {
  const before = context.pages().length;
  const matchingNavigationRequests: Request[] = [];
  const trackRequest = (request: Request) => {
    if (request.isNavigationRequest() && request.url() === expectedUrl) {
      matchingNavigationRequests.push(request);
    }
  };
  context.on("request", trackRequest);
  const opened = context.waitForEvent("page");
  try {
    await trigger();
    const page = await opened;
    await expect.poll(() => context.pages().length).toBe(before + 1);
    await expect
      .poll(() =>
        matchingNavigationRequests.some(
          (request) =>
            request.frame() === page.mainFrame() &&
            request.frame().page() === page,
        ),
      )
      .toBe(true);
    return page;
  } finally {
    context.off("request", trackRequest);
  }
}

test("multiple sources persist and revisit in new tabs without losing panel work", async ({
  context,
}) => {
  const id = await extensionId(context);
  const originalTab = await context.newPage();
  const originalUrl = originalTab.url();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(panel)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );

  await navItem(panel, "candidate-management").click();
  const management = featureRoot(panel, "candidate-management");
  await formField(panel, "project-name").fill("E2E ソース再訪プロジェクト");
  await submitButton(region(management, "project-form")).click();
  const selectedProject = region(management, "projects").getByRole("button", {
    name: "E2E ソース再訪プロジェクト",
    exact: true,
  });
  await expect(selectedProject).toHaveAttribute("aria-current", "page");

  await createCandidateButton(management).click();
  await formField(panel, "candidate-name").fill("E2E 複数ソースCPU");
  await formField(panel, "candidate-category").selectOption("cpu");
  const editor = region(management, "candidate-form");
  const sources = candidateSources(editor);

  await addCandidateSourceButton(sources).click();
  await addCandidateSourceButton(sources).click();
  const rows = candidateSourceRows(sources);
  await expect(rows).toHaveCount(2);

  const first = rows.nth(0);
  await candidateSourceField(first, 0, "url").fill(primaryUrl);
  await candidateSourceField(first, 0, "site-name").fill("架空メーカーサイト");
  await candidateSourceField(first, 0, "captured-at").fill(
    "2026-07-30T01:00:00.000Z",
  );
  await candidateSourceField(first, 0, "kind").selectOption("manufacturer");

  const second = rows.nth(1);
  await candidateSourceField(second, 1, "url").fill(secondaryUrl);
  await candidateSourceField(second, 1, "site-name").fill("架空販売サイト");
  await candidateSourceField(second, 1, "captured-at").fill(
    "2026-07-30T02:00:00.000Z",
  );
  await candidateSourceField(second, 1, "kind").selectOption("retail");
  await primaryCandidateSourceInput(second).check();

  await submitButton(editor).click();
  let candidateRow = region(management, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 複数ソースCPU" });
  await expect(candidateRow).toBeVisible();
  await expect(openPrimaryCandidateSourceButton(candidateRow)).toBeVisible();

  await panel.reload();
  await expect(applicationShell(panel)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await navItem(panel, "candidate-management").click();
  await expect(selectedProject).toHaveAttribute("aria-current", "page");
  candidateRow = region(management, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "E2E 複数ソースCPU" });
  await expect(candidateRow).toBeVisible();

  await editCandidateButton(candidateRow).click();
  const restoredRows = candidateSourceRows(candidateSources(editor));
  await expect(restoredRows).toHaveCount(2);
  await expect(candidateSourceField(restoredRows.nth(0), 0, "url")).toHaveValue(
    primaryUrl,
  );
  await expect(
    candidateSourceField(restoredRows.nth(0), 0, "kind"),
  ).toHaveValue("manufacturer");
  await expect(candidateSourceField(restoredRows.nth(1), 1, "url")).toHaveValue(
    secondaryUrl,
  );
  await expect(
    candidateSourceField(restoredRows.nth(1), 1, "kind"),
  ).toHaveValue("retail");
  await expect(primaryCandidateSourceInput(restoredRows.nth(1))).toBeChecked();

  await formField(panel, "candidate-name").fill("E2E 未保存の作業状態");
  const primaryTab = await expectNewTab(
    context,
    () => openPrimaryCandidateSourceButton(candidateRow).click(),
    secondaryUrl,
  );
  await expect(originalTab).toHaveURL(originalUrl);
  await expect(panel).toHaveURL(`chrome-extension://${id}/side-panel.html`);
  await expect(selectedProject).toHaveAttribute("aria-current", "page");
  await expect(formField(panel, "candidate-name")).toHaveValue(
    "E2E 未保存の作業状態",
  );

  await panel.bringToFront();
  const detailTab = await expectNewTab(
    context,
    () => openCandidateSourceButton(restoredRows.nth(0)).click(),
    primaryUrl,
  );
  await expect(primaryTab).not.toBe(detailTab);
  await expect(originalTab).toHaveURL(originalUrl);
  await expect(panel).toHaveURL(`chrome-extension://${id}/side-panel.html`);
  await expect(selectedProject).toHaveAttribute("aria-current", "page");
  await expect(formField(panel, "candidate-name")).toHaveValue(
    "E2E 未保存の作業状態",
  );

  // The visible draft survived both revisits, but it was never persisted.
  await panel.reload();
  await expect(applicationShell(panel)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await navItem(panel, "candidate-management").click();
  await expect(selectedProject).toHaveAttribute("aria-current", "page");
  await expect(
    region(management, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 複数ソースCPU" }),
  ).toBeVisible();
  await expect(
    region(management, "candidate-list")
      .getByRole("listitem")
      .filter({ hasText: "E2E 未保存の作業状態" }),
  ).toHaveCount(0);
});
