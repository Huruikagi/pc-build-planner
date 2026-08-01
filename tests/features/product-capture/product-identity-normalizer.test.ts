import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductIdentityNormalizer,
  type ProductIdentityField,
} from "../../../src/features/product-capture/public.js";

const normalizer = createProductIdentityNormalizer();

const normalize = (
  field: ProductIdentityField,
  original: string | null,
  confirmed?: string,
) =>
  normalizer.normalize(field, {
    original,
    ...(confirmed !== undefined ? { confirmed } : {}),
  });

test("confirmedを優先し、欠損時だけoriginalを比較keyに使う", () => {
  assert.equal(normalize("name", "  ORIGINAL  ", "  Confirmed  "), "confirmed");
  assert.equal(normalize("manufacturer", "  ORIGINAL  "), "original");
});

test("NFKC・大文字小文字・制御文字・連続空白の差を吸収する", () => {
  assert.equal(
    normalize("name", null, "\u0000 Ｆｉｃｔｉｏｎａｌ\t  ＣＰＵ \n"),
    "fictional cpu",
  );
  assert.equal(normalize("manufacturer", null, "ＡＣＭＥ"), "acme");
});

test("型番だけは空白・ハイフン・アンダースコアの差を吸収する", () => {
  const variants = ["ZX 9000", "zx-9000", "ＺＸ＿９０００"];
  assert.deepEqual(
    variants.map((value) => normalize("model-number", null, value)),
    ["zx9000", "zx9000", "zx9000"],
  );
  assert.equal(normalize("name", null, "ZX-9000"), "zx-9000");
});

test("欠損値とcleaning後の空値から推測keyを作らない", () => {
  assert.equal(normalizer.normalize("name", undefined), undefined);
  assert.equal(normalize("name", null), undefined);
  assert.equal(normalize("manufacturer", "\u0000\t "), undefined);
  assert.equal(normalize("model-number", "---___  "), undefined);
});

test("照合用の正規化は入力の保存・表示値を変更しない", () => {
  const value = {
    original: "  ＺＸ-９０００  ",
    confirmed: " ZX_9000 ",
  } as const;
  const before = structuredClone(value);

  assert.equal(normalizer.normalize("model-number", value), "zx9000");
  assert.deepEqual(value, before);
});
