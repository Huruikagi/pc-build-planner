import type { BrowserContext } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  captureStartButton,
  expectedTextFor,
  extensionAction,
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

async function targetTabId(context: BrowserContext): Promise<number> {
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
  return tabId;
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
  const tabId = await targetTabId(context);
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
