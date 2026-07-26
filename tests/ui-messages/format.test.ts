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

test("MultiPluralDefinitionは複数のselectorの組み合わせでフォームを選ぶ", () => {
  const definition = {
    selectors: ["projectCount", "partCount", "currentBuildCount"] as const,
    forms: {
      "one|one|zero":
        "{projectCount} project, {partCount} part, no current builds",
      "other|one|one":
        "{projectCount} projects, {partCount} part, {currentBuildCount} current build",
      other:
        "{projectCount} projects, {partCount} parts, {currentBuildCount} current builds",
    },
  };

  assert.equal(
    formatMessage(definition, {
      projectCount: 1,
      partCount: 1,
      currentBuildCount: 0,
    }),
    "1 project, 1 part, no current builds",
  );
  assert.equal(
    formatMessage(definition, {
      projectCount: 2,
      partCount: 1,
      currentBuildCount: 1,
    }),
    "2 projects, 1 part, 1 current build",
  );
});

test("MultiPluralDefinitionはselector不足または組み合わせ未定義ならotherへ後退する", () => {
  const definition = {
    selectors: ["projectCount", "partCount"] as const,
    forms: {
      "one|one": "各1件",
      other: "{projectCount}プロジェクト、{partCount}パーツ",
    },
  };

  assert.equal(
    formatMessage(definition, { projectCount: 2, partCount: 2 }),
    "2プロジェクト、2パーツ",
  );
  assert.equal(
    formatMessage(definition, { projectCount: 1 }),
    "1プロジェクト、{partCount}パーツ",
  );
});

test("MultiPluralDefinitionの誤記された組み合わせキーには到達せずotherへ後退する", () => {
  const definition = {
    selectors: ["projectCount", "partCount"] as const,
    forms: {
      "one|one|other": "selector数と一致しない誤記フォーム",
      other: "安全な既定フォーム",
    },
  };

  assert.equal(
    formatMessage(definition, { projectCount: 1, partCount: 1 }),
    "安全な既定フォーム",
  );
});

test("副作用を持たず、同じ入力には同じ出力を返す", () => {
  const params = { name: "CPU" };
  const first = formatMessage("{name}を編集", params);
  const second = formatMessage("{name}を編集", params);
  assert.equal(first, second);
  assert.deepEqual(params, { name: "CPU" });
});
