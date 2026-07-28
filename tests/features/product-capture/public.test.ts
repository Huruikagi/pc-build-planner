import assert from "node:assert/strict";
import test from "node:test";
import { ok } from "../../../src/domain/public.js";
import {
  createProductCapturePublicApi,
  type ManufacturerDomainLookup,
  type PagePriceExtractionPort,
} from "../../../src/features/product-capture/public.js";

const lookup: ManufacturerDomainLookup = {
  findManufacturer(pageUrl) {
    return ok(
      new URL(pageUrl).hostname.endsWith("maker.example")
        ? {
            manufacturer: "架空メーカー",
            sourceLabel: "maker.example",
          }
        : undefined,
    );
  },
};

const priceExtraction: PagePriceExtractionPort = {
  async extractPrice() {
    return ok({
      pageUrl: "https://parts.example.invalid/cpu/fictional-9000",
      capturedAt: "2026-07-29T00:00:00.000Z" as never,
      price: {
        original: "$249.99",
        confirmed: { amount: 249.99, currency: "USD" },
      },
    });
  },
};

test("公開入口だけからメーカー登録domainの一致・非一致を照合できる", () => {
  const api = createProductCapturePublicApi({
    manufacturerDomains: lookup,
    pagePriceExtraction: priceExtraction,
  });

  assert.deepEqual(
    api.manufacturerDomains.findManufacturer(
      "https://products.maker.example/parts/cpu",
    ),
    {
      ok: true,
      value: {
        manufacturer: "架空メーカー",
        sourceLabel: "maker.example",
      },
    },
  );
  assert.deepEqual(
    api.manufacturerDomains.findManufacturer(
      "https://retailer.example.invalid/parts/cpu",
    ),
    { ok: true, value: undefined },
  );
});

test("公開APIと公開lookupはconsumerから差し替えられない", () => {
  const api = createProductCapturePublicApi({
    manufacturerDomains: lookup,
    pagePriceExtraction: priceExtraction,
  });

  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.manufacturerDomains), true);
  assert.equal(Object.isFrozen(api.pagePriceExtraction), true);
});

test("公開入口だけからpage-derived URL・取得時点・根拠付き価格を観測できる", async () => {
  const api = createProductCapturePublicApi({
    manufacturerDomains: lookup,
    pagePriceExtraction: priceExtraction,
  });

  const result = await api.pagePriceExtraction.extractPrice(7 as never);

  assert.deepEqual(result, {
    ok: true,
    value: {
      pageUrl: "https://parts.example.invalid/cpu/fictional-9000",
      capturedAt: "2026-07-29T00:00:00.000Z",
      price: {
        original: "$249.99",
        confirmed: { amount: 249.99, currency: "USD" },
      },
    },
  });
});
