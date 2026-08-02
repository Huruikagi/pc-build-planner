import type { BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  featureRoot,
  navItem,
} from "./models/application-shell.js";
import {
  candidateEditor,
  candidateManufacturerField,
  candidateModelNumberField,
  candidateSourcePriceField,
  candidateSourceRows,
  candidateSources,
  createCandidateButton,
  editCandidateButton,
} from "./models/candidate-management.js";
import {
  formField,
  region,
  submitButton,
} from "./models/locator-primitives.js";
import {
  captureStartButton,
  extensionAction,
} from "./models/product-capture.js";

async function extensionId(context: BrowserContext): Promise<string> {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  return new URL(worker.url()).host;
}

async function triggerCapture(
  context: BrowserContext,
  id: string,
  target: Page,
): Promise<void> {
  const browser = context.browser();
  if (browser === null) throw new Error("browser CDP session is unavailable");
  const cdp = await browser.newBrowserCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets", {
    filter: [{ type: "tab", exclude: false }],
  });
  const targetInfo = targetInfos.find(
    (item) => item.type === "tab" && item.url === target.url(),
  );
  if (targetInfo === undefined)
    throw new Error("capture target is unavailable");
  await target.bringToFront();
  await cdp.send("Extensions.triggerAction", {
    id,
    targetId: targetInfo.targetId,
  });
}

async function openSyntheticProduct(
  context: BrowserContext,
  url: string,
  model: string,
  price: number,
): Promise<Page> {
  await context.route(`${url}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>SYN ${model}</title><script type="application/ld+json">${JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "Product",
          name: `SYN Processor ${model}`,
          brand: { "@type": "Brand", name: "SYN Labs" },
          sku: model,
          offers: { "@type": "Offer", price, priceCurrency: "XTS" },
        },
      )}</script>`,
    }),
  );
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

test("capture merge, same-URL refresh, no-match create and explicit save-new remain exclusive", async ({
  context,
}) => {
  test.setTimeout(90_000);
  const id = await extensionId(context);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(panel)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await navItem(panel, "candidate-management").click();
  const management = featureRoot(panel, "candidate-management");

  await formField(panel, "project-name").fill("SYN duplicate merge project");
  await submitButton(region(management, "project-form")).click();
  await createCandidateButton(management).click();
  await formField(panel, "candidate-name").fill("SYN existing processor");
  await candidateManufacturerField(candidateEditor(panel)).fill("SYN Labs");
  await candidateModelNumberField(candidateEditor(panel)).fill("SYN-100");
  await formField(panel, "candidate-category").selectOption("cpu");
  await submitButton(candidateEditor(panel)).click();

  const mergeTarget = region(management, "candidate-list")
    .getByRole("listitem")
    .filter({ hasText: "SYN existing processor" });
  await expect(mergeTarget).toBeVisible();

  const first = await openSyntheticProduct(
    context,
    "http://pcbp.test/merge-source",
    "SYN-100",
    100,
  );
  await triggerCapture(context, id, first);
  await captureStartButton(extensionAction(panel)).click();
  await expect(candidateEditor(panel)).toBeVisible();
  await submitButton(candidateEditor(panel)).click();
  const decision = region(management, "duplicate-merge-decision");
  await expect(decision).toBeVisible();
  await decision.getByRole("radio").check();
  await decision.getByRole("button", { name: /統合|Merge/ }).click();
  await expect(
    region(management, "candidate-list").getByRole("listitem"),
  ).toHaveCount(1);
  await editCandidateButton(mergeTarget).click();
  await expect(
    candidateSourceRows(candidateSources(candidateEditor(panel))),
  ).toHaveCount(1);
  await submitButton(candidateEditor(panel)).click();

  const same = await openSyntheticProduct(
    context,
    "http://pcbp.test/merge-source",
    "SYN-100",
    125,
  );
  await triggerCapture(context, id, same);
  await captureStartButton(extensionAction(panel)).click();
  await submitButton(candidateEditor(panel)).click();
  await region(management, "duplicate-merge-decision")
    .getByRole("radio")
    .check();
  await region(management, "duplicate-merge-decision")
    .getByRole("button", { name: /統合|Merge/ })
    .click();
  await expect(
    region(management, "candidate-list").getByRole("listitem"),
  ).toHaveCount(1);
  await editCandidateButton(mergeTarget).click();
  const refreshedSources = candidateSourceRows(
    candidateSources(candidateEditor(panel)),
  );
  await expect(refreshedSources).toHaveCount(1);
  await expect(
    candidateSourcePriceField(refreshedSources.nth(0), 0),
  ).toHaveValue("125");
  await expect(formField(panel, "candidate-name")).toHaveValue(
    "SYN existing processor",
  );
  await expect(candidateModelNumberField(candidateEditor(panel))).toHaveValue(
    "SYN-100",
  );
  await submitButton(candidateEditor(panel)).click();

  const unique = await openSyntheticProduct(
    context,
    "http://pcbp.test/unique-source",
    "SYN-999",
    200,
  );
  await triggerCapture(context, id, unique);
  await captureStartButton(extensionAction(panel)).click();
  await submitButton(candidateEditor(panel)).click();
  await expect(
    region(management, "candidate-list").getByRole("listitem"),
  ).toHaveCount(2);
  await editCandidateButton(mergeTarget).click();
  await expect(
    candidateSourceRows(candidateSources(candidateEditor(panel))),
  ).toHaveCount(1);
  await expect(formField(panel, "candidate-name")).toHaveValue(
    "SYN existing processor",
  );
  await expect(candidateModelNumberField(candidateEditor(panel))).toHaveValue(
    "SYN-100",
  );
  await submitButton(candidateEditor(panel)).click();

  const explicit = await openSyntheticProduct(
    context,
    "http://pcbp.test/explicit-new",
    "SYN-999",
    300,
  );
  await triggerCapture(context, id, explicit);
  await captureStartButton(extensionAction(panel)).click();
  await submitButton(candidateEditor(panel)).click();
  const explicitDecision = region(management, "duplicate-merge-decision");
  await expect(explicitDecision).toBeVisible();
  await explicitDecision
    .getByRole("button", {
      name: /新規候補として保存|Save as a new candidate/,
    })
    .click();
  await expect(
    region(management, "candidate-list").getByRole("listitem"),
  ).toHaveCount(3);
  await editCandidateButton(mergeTarget).click();
  await expect(
    candidateSourceRows(candidateSources(candidateEditor(panel))),
  ).toHaveCount(1);
  await expect(formField(panel, "candidate-name")).toHaveValue(
    "SYN existing processor",
  );
  await expect(candidateModelNumberField(candidateEditor(panel))).toHaveValue(
    "SYN-100",
  );
});
