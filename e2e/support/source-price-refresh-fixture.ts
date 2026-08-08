import type { BrowserContext, Page } from "@playwright/test";

export const SOURCE_PRICE_REFRESH_STORAGE_KEY = "localDataRoot";
export const SOURCE_PRICE_REFRESH_ACTIVATION_KEY =
  "transientActivationEnvelope";

export const sourcePriceRefreshUrls = {
  primary:
    "https://refresh.synthetic.invalid/primary?sku=SYN-PRIMARY&utm_source=fixture",
  missing: "https://refresh.synthetic.invalid/missing?sku=SYN-MISSING",
  unmatched: "https://refresh.synthetic.invalid/unmatched?sku=SYN-NONE",
  ambiguous:
    "https://refresh.synthetic.invalid/ambiguous?sku=SYN-AMBIGUOUS&utm_source=fixture",
  manufacturer:
    "https://refresh.synthetic.invalid/manufacturer?sku=SYN-MANUFACTURER",
} as const;

const timestamp = "2026-08-01T00:00:00.000Z";
const projectId = "10000000-0000-4000-8000-000000000054";

const source = (
  id: string,
  pageUrl: string,
  kind: "retail" | "manufacturer",
  amount: number,
) => ({
  id,
  pageUrl,
  siteName: `SYN ${kind} fixture`,
  capturedAt: timestamp,
  price: {
    original: `SYN old ${amount}`,
    confirmed: { amount, currency: "SYN" },
  },
  kind,
});

const candidate = (
  id: string,
  name: string,
  sources: readonly ReturnType<typeof source>[],
  primarySourceId?: string,
) => ({
  id,
  projectId,
  category: "gpu",
  product: { name: { original: name, confirmed: name } },
  normalizedAttributes: { category: "gpu" },
  sources,
  ...(primarySourceId === undefined ? {} : { primarySourceId }),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const createSourcePriceRefreshRoot = () => {
  const primaryId = "30000000-0000-4000-8000-000000000054";
  return {
    schemaVersion: 1,
    revision: 54,
    projects: [
      {
        id: projectId,
        name: "SYN price refresh project",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    candidateParts: [
      candidate(
        "20000000-0000-4000-8000-000000000054",
        "SYN primary candidate",
        [
          source(
            primaryId,
            "https://refresh.synthetic.invalid/primary?sku=SYN-PRIMARY",
            "retail",
            5_400,
          ),
          source(
            "30000000-0000-4000-8000-000000000055",
            "https://refresh.synthetic.invalid/non-primary?sku=SYN-SECONDARY",
            "retail",
            5_500,
          ),
        ],
        primaryId,
      ),
      candidate(
        "20000000-0000-4000-8000-000000000055",
        "SYN missing-price candidate",
        [
          source(
            "30000000-0000-4000-8000-000000000056",
            sourcePriceRefreshUrls.missing,
            "retail",
            5_600,
          ),
        ],
        "30000000-0000-4000-8000-000000000056",
      ),
      candidate(
        "20000000-0000-4000-8000-000000000056",
        "SYN ambiguous candidate A",
        [
          source(
            "30000000-0000-4000-8000-000000000057",
            "https://refresh.synthetic.invalid/ambiguous?sku=SYN-AMBIGUOUS",
            "retail",
            5_700,
          ),
        ],
        "30000000-0000-4000-8000-000000000057",
      ),
      candidate(
        "20000000-0000-4000-8000-000000000057",
        "SYN ambiguous candidate B",
        [
          source(
            "30000000-0000-4000-8000-000000000058",
            "https://refresh.synthetic.invalid/ambiguous?utm_medium=e2e&sku=SYN-AMBIGUOUS",
            "retail",
            5_800,
          ),
        ],
        "30000000-0000-4000-8000-000000000058",
      ),
      candidate(
        "20000000-0000-4000-8000-000000000058",
        "SYN manufacturer candidate",
        [
          source(
            "30000000-0000-4000-8000-000000000059",
            sourcePriceRefreshUrls.manufacturer,
            "manufacturer",
            5_900,
          ),
        ],
        "30000000-0000-4000-8000-000000000059",
      ),
    ],
    currentBuilds: [],
    requestDedupe: [],
    maintenance: { generation: 0, active: false },
  };
};

export const syntheticPricePage = (amount?: number): string => `<!doctype html>
  <html><head><title>SYN price refresh target</title>
  ${
    amount === undefined
      ? ""
      : `<meta property="product:price:amount" content="${amount}">
         <meta property="product:price:currency" content="SYN">`
  }
  </head><body><main>SYN fictional product page</main></body></html>`;

export async function extensionWorker(context: BrowserContext) {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

export async function extensionId(context: BrowserContext): Promise<string> {
  return new URL((await extensionWorker(context)).url()).host;
}

export async function seedSourcePriceRefreshRoot(
  context: BrowserContext,
): Promise<void> {
  await (await extensionWorker(context)).evaluate(
    async ({ key, root }) => chrome.storage.local.set({ [key]: root }),
    {
      key: SOURCE_PRICE_REFRESH_STORAGE_KEY,
      root: createSourcePriceRefreshRoot(),
    },
  );
}

export async function readSourcePriceRefreshRoot(context: BrowserContext) {
  return (await extensionWorker(context)).evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key);
    return stored[key];
  }, SOURCE_PRICE_REFRESH_STORAGE_KEY) as Promise<
    ReturnType<typeof createSourcePriceRefreshRoot>
  >;
}

export async function readTransientActivationEnvelope(
  context: BrowserContext,
): Promise<
  | {
      readonly record?: {
        readonly activationId?: string;
        readonly surfaceId?: string;
        readonly tabId?: number;
        readonly stage?: string;
      };
      readonly tombstones?: readonly {
        readonly tabId?: number;
        readonly seq?: number;
      }[];
    }
  | undefined
> {
  return (await extensionWorker(context)).evaluate(async (key) => {
    const stored = await chrome.storage.session.get(key);
    return stored[key];
  }, SOURCE_PRICE_REFRESH_ACTIVATION_KEY);
}

export async function putSourcePriceRefreshActivation(
  context: BrowserContext,
  tabId: number,
  activationId: string,
): Promise<void> {
  await (await extensionWorker(context)).evaluate(
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
            surfaceId: "source-price-refresh",
            tabId: targetTabId,
            seq,
            stage: "pending",
          },
          tombstones: current?.tombstones ?? [],
        },
      });
    },
    {
      key: SOURCE_PRICE_REFRESH_ACTIVATION_KEY,
      targetTabId: tabId,
      id: activationId,
    },
  );
}

export async function tabIdFor(
  context: BrowserContext,
  page: Page,
): Promise<number> {
  await page.bringToFront();
  return (await extensionWorker(context)).evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) throw new Error("SYN target tab is unavailable");
    return tab.id;
  });
}

export async function grantActiveTabWithExtensionAction(
  context: BrowserContext,
  page: Page,
  id: string,
): Promise<void> {
  const browser = context.browser();
  if (browser === null) throw new Error("browser CDP session is unavailable");
  const cdp = await browser.newBrowserCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets", {
    filter: [{ type: "tab", exclude: false }],
  });
  const target = targetInfos.find(
    (entry) => entry.type === "tab" && entry.url === page.url(),
  );
  if (target === undefined) throw new Error("SYN target is unavailable");
  const existingTargets = new Set(targetInfos.map((entry) => entry.targetId));
  await page.bringToFront();
  await cdp.send("Extensions.triggerAction", { id, targetId: target.targetId });
  const sidePanelUrl = `chrome-extension://${id}/side-panel.html`;
  const deadline = Date.now() + 5_000;
  let openedSidePanels: readonly { readonly targetId: string }[] = [];
  while (openedSidePanels.length === 0) {
    const after = await cdp.send("Target.getTargets", {
      filter: [{ type: "tab", exclude: false }],
    });
    openedSidePanels = after.targetInfos.filter(
      (entry) =>
        !existingTargets.has(entry.targetId) && entry.url === sidePanelUrl,
    );
    if (openedSidePanels.length > 0) break;
    if (Date.now() >= deadline)
      throw new Error("production side panel target did not open");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  for (const opened of openedSidePanels) {
    await cdp.send("Target.closeTarget", { targetId: opened.targetId });
  }
  const closedIds = new Set(openedSidePanels.map((entry) => entry.targetId));
  while (true) {
    const remaining = await cdp.send("Target.getTargets", {
      filter: [{ type: "tab", exclude: false }],
    });
    if (!remaining.targetInfos.some((entry) => closedIds.has(entry.targetId)))
      break;
    if (Date.now() >= deadline)
      throw new Error("production side panel target did not close");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
