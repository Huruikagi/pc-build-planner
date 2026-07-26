import assert from "node:assert/strict";
import test from "node:test";
import type { MESSAGES } from "../../src/ui-messages/catalog/ja/index.js";
import type {
  AssertCatalogParity,
  FlattenLocalizedCatalog,
} from "../../src/ui-messages/catalog-parity.js";

// Compile-time guarantee (1.2): dropping a single key from a target catalog
// makes it fail `LocalizedCatalog`'s mapped-type coverage, so it can no
// longer be passed to `AssertCatalogParity` at all — this is the "欠落は
// マップ型の網羅性で検出する" mechanism from design.md's CatalogParityTypes
// component. Excess keys are separately caught by `satisfies` at each
// catalog's own declaration site (see `catalog/{ja,en}/index.ts`).
type _CompleteFlatCatalog = FlattenLocalizedCatalog<typeof MESSAGES>;
type _CatalogMissingASingleKey = Omit<_CompleteFlatCatalog, "common.save">;
// @ts-expect-error "common.save" is missing, so this no longer satisfies LocalizedCatalog.
type _AssertFailsOnDroppedKey = AssertCatalogParity<_CatalogMissingASingleKey>;
void (0 as unknown as _AssertFailsOnDroppedKey);

test("完全なカタログはAssertCatalogParityがtrueに解決される", () => {
  type Assertion = AssertCatalogParity<_CompleteFlatCatalog>;
  const assertion: Assertion = true;
  assert.equal(assertion, true);
});
