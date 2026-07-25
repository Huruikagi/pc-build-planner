import assert from "node:assert/strict";
import test from "node:test";

import { formatMessage } from "../../src/ui-messages/format.js";

test("プレースホルダを含まない単純文字列はそのまま返る", () => {
  assert.equal(formatMessage("保存"), "保存");
});

test("{name}をparamsの値で置換する", () => {
  assert.equal(formatMessage("{name}を編集", { name: "CPU" }), "CPUを編集");
});

test("数値paramsは既定の文字列化で置換する", () => {
  assert.equal(formatMessage("{count}件", { count: 3 }), "3件");
});

test("対応するparamsが無いプレースホルダは置換せずそのまま残り、例外を投げない", () => {
  assert.equal(formatMessage("{name}を編集", {}), "{name}を編集");
  assert.doesNotThrow(() => formatMessage("{name}を編集"));
  assert.equal(formatMessage("{name}を編集"), "{name}を編集");
});

test("PluralDefinitionはcountでフォームを選ぶ", () => {
  const definition = {
    forms: { other: "{count}件", one: "1件", zero: "0件" },
  };
  assert.equal(formatMessage(definition, { count: 0 }), "0件");
  assert.equal(formatMessage(definition, { count: 1 }), "1件");
  assert.equal(formatMessage(definition, { count: 5 }), "5件");
});

test("oneまたはzero未定義時はotherへ後退する", () => {
  const definition = { forms: { other: "{count}件" } };
  assert.equal(formatMessage(definition, { count: 0 }), "0件");
  assert.equal(formatMessage(definition, { count: 1 }), "1件");
  assert.equal(formatMessage(definition, { count: 5 }), "5件");
});

test("countが渡されない場合はotherを使う", () => {
  const definition = { forms: { other: "件数不明", one: "1件" } };
  assert.equal(formatMessage(definition), "件数不明");
});

test("副作用を持たず、同じ入力には同じ出力を返す", () => {
  const params = { name: "CPU" };
  const first = formatMessage("{name}を編集", params);
  const second = formatMessage("{name}を編集", params);
  assert.equal(first, second);
  assert.deepEqual(params, { name: "CPU" });
});
