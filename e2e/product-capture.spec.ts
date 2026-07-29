import type { BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  captureStartButton,
  expectedTextFor,
  extensionAction,
  featureRoot,
  navItem,
  selectLanguage,
} from "./locators.js";

const STORAGE_KEY = "transientActivationEnvelope";

async function extensionId(context: BrowserContext): Promise<string> {
  const existing = context.serviceWorkers()[0];
  const worker = existing ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  expect(id).toMatch(/^[a-p]{32}$/);
  return id;
}

async function createTargetTab(
  context: BrowserContext,
): Promise<{ readonly page: Page; readonly tabId: number }> {
  const target = await context.newPage();
  await target.goto(
    `data:text/html,${encodeURIComponent("<!doctype html><title>SYN capture target</title>")}`,
  );
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error("service worker is not available");
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true });
    const id = tabs[0]?.id;
    if (id === undefined) throw new Error("target tab id is unavailable");
    return id;
  });
  return { page: target, tabId };
}

async function putDurableActivation(
  context: BrowserContext,
  tabId: number,
  activationId: string,
): Promise<void> {
  const worker = context.serviceWorkers()[0];
  if (worker === undefined) throw new Error("service worker is not available");
  await worker.evaluate(
    async ({ key, targetTabId, id }) => {
      const current = (await chrome.storage.session.get(key))[key] as
        | {
            readonly lastSequence?: number;
            readonly tombstones?: readonly { readonly seq?: number }[];
          }
        | undefined;
      const seq =
        Math.max(
          current?.lastSequence ?? 0,
          ...(current?.tombstones ?? []).map((item) => item.seq ?? 0),
        ) + 1;
      await chrome.storage.session.set({
        [key]: {
          version: 1,
          lastSequence: seq,
          record: {
            activationId: id,
            surfaceId: "product-capture",
            tabId: targetTabId,
            seq,
            stage: "pending",
          },
          tombstones: current?.tombstones ?? [],
        },
      });
    },
    { key: STORAGE_KEY, targetTabId: tabId, id: activationId },
  );
}

test("durable activationはproduction transportから実product-capture面を提示する", async ({
  context,
}) => {
  const id = await extensionId(context);
  const { tabId } = await createTargetTab(context);
  const activationId = "e2e-durable-product-capture";
  await putDurableActivation(context, tabId, activationId);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(panel)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await selectLanguage(panel, "en");

  const capture = extensionAction(panel);
  await expect(capture).toBeVisible();
  await expect(captureStartButton(capture)).toBeVisible();
  await expect(capture).toContainText(
    expectedTextFor("en")("capture.idleInstruction"),
  );
  await expect(navItem(panel, "product-capture")).toHaveCount(0);
  await expect
    .poll(async () => {
      const worker = context.serviceWorkers()[0];
      if (worker === undefined) return undefined;
      return worker.evaluate(
        async ({ key, expectedId }) => {
          const envelope = (await chrome.storage.session.get(key))[key] as
            | {
                readonly record?: {
                  readonly activationId?: string;
                  readonly stage?: string;
                };
              }
            | undefined;
          return envelope?.record?.activationId === expectedId
            ? envelope.record.stage
            : undefined;
        },
        { key: STORAGE_KEY, expectedId: activationId },
      );
    })
    .toBe("activated");
});

async function openActivatedCapture(
  context: BrowserContext,
  activationId: string,
): Promise<{ readonly panel: Page; readonly target: Page }> {
  const id = await extensionId(context);
  const { page: target, tabId } = await createTargetTab(context);
  await putDurableActivation(context, tabId, activationId);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/side-panel.html`);
  await expect(applicationShell(panel)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await expect(extensionAction(panel)).toBeVisible();
  return { panel, target };
}

for (const invalidation of ["update", "close"] as const) {
  test(`固定tabの${invalidation}でcaptureを終了し常設面へ復帰する`, async ({
    context,
  }) => {
    const { panel, target } = await openActivatedCapture(
      context,
      `e2e-target-${invalidation}`,
    );

    if (invalidation === "update") {
      await target.goto(
        `data:text/html,${encodeURIComponent("<!doctype html><title>SYN updated target</title>")}`,
      );
    } else {
      await target.close();
    }

    await expect(extensionAction(panel)).toHaveCount(0);
    const fallback = navItem(panel, "candidate-management");
    await expect(fallback).toHaveAttribute("aria-current", "page");
    await expect(featureRoot(panel, "candidate-management")).toBeVisible();
  });
}

test("常設navigation選択でcaptureを終了し選択面だけを表示する", async ({
  context,
}) => {
  const { panel } = await openActivatedCapture(
    context,
    "e2e-persistent-navigation",
  );

  const navigation = navItem(panel, "candidate-management");
  await navigation.click();

  await expect(extensionAction(panel)).toHaveCount(0);
  await expect(navigation).toHaveAttribute("aria-current", "page");
  await expect(featureRoot(panel, "candidate-management")).toBeVisible();
});
