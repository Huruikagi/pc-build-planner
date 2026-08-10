import type { BrowserContext, ConsoleMessage, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Resolves the unpacked extension id from the loaded service worker so the side
 * panel document can be opened directly as a trusted extension page.
 */
export async function extensionId(context: BrowserContext): Promise<string> {
  const existing = context.serviceWorkers()[0];
  const worker = existing ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  expect(id).toMatch(/^[a-p]{32}$/);
  return id;
}

export interface Diagnostics {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
}

/** Collects runtime diagnostics so a spec can assert a clean boot. */
export function watchDiagnostics(page: Page): Diagnostics {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

/**
 * The persisted shape the backup must round trip. Only the three owned
 * collections are compared; revision, dedupe and maintenance are storage
 * bookkeeping that the exchange format deliberately drops.
 */
export interface StoredData {
  readonly projects: readonly unknown[];
  readonly candidateParts: readonly unknown[];
  readonly currentBuilds: readonly unknown[];
}

/** Reads the persisted root straight from real extension storage. */
export async function readStoredData(page: Page): Promise<StoredData> {
  return page.evaluate(
    async () =>
      new Promise<StoredData>((resolve) => {
        chrome.storage.local.get("localDataRoot", (result) => {
          const root = (result as { localDataRoot?: StoredData }).localDataRoot;
          resolve({
            projects: root?.projects ?? [],
            candidateParts: root?.candidateParts ?? [],
            currentBuilds: root?.currentBuilds ?? [],
          });
        });
      }),
  );
}
