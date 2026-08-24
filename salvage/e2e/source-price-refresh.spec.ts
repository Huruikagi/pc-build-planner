import type { BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  featureRoot,
  navItem,
} from "./models/application-shell.js";
import {
  sourcePriceRefresh,
  sourcePriceRefreshFailureCause,
  sourcePriceRefreshField,
  sourcePriceRefreshGuidance,
  sourcePriceRefreshPreserved,
  sourcePriceRefreshStatus,
} from "./models/source-price-refresh.js";
import {
  createSourcePriceRefreshRoot,
  extensionId,
  grantActiveTabWithExtensionAction,
  putSourcePriceRefreshActivation,
  readSourcePriceRefreshRoot,
  readTransientActivationEnvelope,
  seedSourcePriceRefreshRoot,
  sourcePriceRefreshUrls,
  syntheticPricePage,
  tabIdFor,
} from "./support/source-price-refresh-fixture.js";

interface ActivatedRefresh {
  readonly panel: Page;
  readonly target: Page;
}

async function activateRefresh(
  context: BrowserContext,
  url: string,
  html: string,
  activationId: string,
): Promise<ActivatedRefresh> {
  await context.route("https://refresh.synthetic.invalid/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
  await seedSourcePriceRefreshRoot(context);
  const id = await extensionId(context);
  const target = await context.newPage();
  await target.goto(url);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(panel)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );

  // This action gesture grants production activeTab access. It is deliberately
  // not evidence of selecting the browser-native price-refresh menu item.
  await grantActiveTabWithExtensionAction(context, target, id);
  const tabId = await tabIdFor(context, target);
  await expect
    .poll(async () => {
      const record = (await readTransientActivationEnvelope(context))?.record;
      return {
        stage: record?.stage,
        surfaceId: record?.surfaceId,
        tabId: record?.tabId,
      };
    })
    .toEqual({ stage: "activated", surfaceId: "product-capture", tabId });
  await putSourcePriceRefreshActivation(context, tabId, activationId);
  await expect(sourcePriceRefresh(panel)).toBeVisible();
  return { panel, target };
}

const candidateSource = (
  root: ReturnType<typeof createSourcePriceRefreshRoot>,
  sourceId: string,
) =>
  root.candidateParts
    .flatMap((candidate) => candidate.sources)
    .find((source) => source.id === sourceId);

test("production activation transport後段でprimary価格を一commit更新する", async ({
  context,
}) => {
  const before = createSourcePriceRefreshRoot();
  const { panel } = await activateRefresh(
    context,
    sourcePriceRefreshUrls.primary,
    syntheticPricePage(12_345),
    "e2e-source-price-refresh-success",
  );
  const surface = sourcePriceRefresh(panel);
  await expect(sourcePriceRefreshStatus(surface)).toHaveAttribute(
    "data-status",
    "succeeded",
  );
  await expect(sourcePriceRefreshField(surface, "price")).toHaveText(
    "12345 SYN",
  );
  await expect(sourcePriceRefreshField(surface, "captured-at")).toHaveText(
    /^\d{4}-\d{2}-\d{2}T/,
  );
  await expect(sourcePriceRefreshField(surface, "primary")).toContainText(
    "summary price follows it",
  );
  await expect(navItem(panel, "source-price-refresh")).toHaveCount(0);

  await expect
    .poll(async () => (await readSourcePriceRefreshRoot(context)).revision)
    .toBe(before.revision + 1);
  const after = await readSourcePriceRefreshRoot(context);
  const updated = candidateSource(
    after,
    "30000000-0000-4000-8000-000000000054",
  );
  expect(updated?.price?.confirmed).toEqual({
    amount: 12_345,
    currency: "SYN",
  });
  expect(updated?.capturedAt).not.toBe("2026-08-01T00:00:00.000Z");
  const primaryCandidate = after.candidateParts[0];
  expect(
    primaryCandidate?.sources.find(
      (entry) => entry.id === primaryCandidate.primarySourceId,
    )?.price?.confirmed,
  ).toEqual({ amount: 12_345, currency: "SYN" });
});

test("activation後の実tab遷移は更新面を終了しrootを変更しない", async ({
  context,
}) => {
  const before = createSourcePriceRefreshRoot();
  const { panel, target } = await activateRefresh(
    context,
    sourcePriceRefreshUrls.missing,
    syntheticPricePage(),
    "e2e-source-price-refresh-tab-navigation",
  );
  await target.goto(
    "https://refresh.synthetic.invalid/navigated?sku=SYN-NAVIGATED",
  );

  await expect(sourcePriceRefresh(panel)).toHaveCount(0);
  await expect(featureRoot(panel, "candidate-management")).toBeVisible();
  await expect(navItem(panel, "candidate-management")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect.poll(() => readSourcePriceRefreshRoot(context)).toEqual(before);
});

for (const failure of [
  {
    name: "price missing",
    url: sourcePriceRefreshUrls.missing,
    html: syntheticPricePage(),
    cause: "No valid price could be read",
    guidance: "Check the price shown",
  },
  {
    name: "no match",
    url: sourcePriceRefreshUrls.unmatched,
    html: syntheticPricePage(61_000),
    cause: "No stored source matches",
    guidance: "Review the list of stored sources",
  },
  {
    name: "ambiguous normalized match",
    url: sourcePriceRefreshUrls.ambiguous,
    html: syntheticPricePage(62_000),
    cause: "Several stored sources match",
    guidance: "Tidy up the duplicated stored sources",
  },
  {
    name: "manufacturer is ineligible",
    url: sourcePriceRefreshUrls.manufacturer,
    html: syntheticPricePage(63_000),
    cause: "isn't marked as a retail page",
    guidance: "stored as a retail source",
  },
] as const) {
  test(`${failure.name}はtyped guidanceを表示しcanonical rootを変更しない`, async ({
    context,
  }) => {
    const before = createSourcePriceRefreshRoot();
    const { panel } = await activateRefresh(
      context,
      failure.url,
      failure.html,
      `e2e-source-price-refresh-${failure.name.replaceAll(" ", "-")}`,
    );
    const surface = sourcePriceRefresh(panel);
    await expect(sourcePriceRefreshStatus(surface)).toHaveAttribute(
      "data-status",
      "failed",
    );
    await expect(sourcePriceRefreshFailureCause(surface)).toContainText(
      failure.cause,
    );
    await expect(sourcePriceRefreshGuidance(surface)).toContainText(
      failure.guidance,
    );
    await expect(sourcePriceRefreshPreserved(surface)).toBeVisible();
    await expect
      .poll(() => readSourcePriceRefreshRoot(context))
      .toEqual(before);
  });
}

for (const dismissal of [
  "tab invalidation",
  "persistent navigation",
] as const) {
  test(`${dismissal}はtransient面を終了し保存を変更しない`, async ({
    context,
  }) => {
    const before = createSourcePriceRefreshRoot();
    const { panel, target } = await activateRefresh(
      context,
      sourcePriceRefreshUrls.missing,
      syntheticPricePage(),
      `e2e-source-price-refresh-${dismissal.replaceAll(" ", "-")}`,
    );

    if (dismissal === "tab invalidation") {
      await target.close();
    } else {
      await navItem(panel, "settings").click();
    }
    await expect(sourcePriceRefresh(panel)).toHaveCount(0);
    await expect
      .poll(() => readSourcePriceRefreshRoot(context))
      .toEqual(before);
  });
}
