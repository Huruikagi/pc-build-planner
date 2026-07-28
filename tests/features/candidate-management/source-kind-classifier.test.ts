import assert from "node:assert/strict";
import test from "node:test";
import { err, ok } from "../../../src/domain/public.js";
import {
  createSourceKindClassifier,
  resolveSourceKind,
} from "../../../src/features/candidate-management/source-kind-classifier.js";

test("公開lookupの一致だけをmanufacturerへ写像し失敗と非一致はretailにする", () => {
  const manufacturer = createSourceKindClassifier({
    findManufacturer: () =>
      ok({ manufacturer: "Example", sourceLabel: "example.invalid" }),
  });
  const retail = createSourceKindClassifier({
    findManufacturer: () => ok(undefined),
  });
  const unsafe = createSourceKindClassifier({
    findManufacturer: () => err({ kind: "invalid-page-url" }),
  });
  assert.equal(
    manufacturer.classify("https://example.invalid"),
    "manufacturer",
  );
  assert.equal(retail.classify("https://shop.invalid"), "retail");
  assert.equal(unsafe.classify("bad"), "retail");
});

test("利用者が明示した種別ではclassifierを呼ばない", () => {
  let calls = 0;
  assert.equal(
    resolveSourceKind("https://example.invalid", "retail", {
      classify: () => {
        calls += 1;
        return "manufacturer";
      },
    }),
    "retail",
  );
  assert.equal(calls, 0);
});
