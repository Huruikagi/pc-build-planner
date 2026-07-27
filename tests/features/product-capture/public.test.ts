import assert from "node:assert/strict";
import test from "node:test";
import { ok } from "../../../src/domain/public.js";
import {
  createProductCapturePublicApi,
  type ManufacturerDomainLookup,
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

test("公開入口だけからメーカー登録domainの一致・非一致を照合できる", () => {
  const api = createProductCapturePublicApi({ manufacturerDomains: lookup });

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
  const api = createProductCapturePublicApi({ manufacturerDomains: lookup });

  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.manufacturerDomains), true);
});
