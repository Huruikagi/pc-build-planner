import assert from "node:assert/strict";
import test from "node:test";

import { renderReleaseNotes } from "../../scripts/release-notes.mjs";

test("labelごとにグルーピングし優先順位表の見出し順に出力する", () => {
  const notes = renderReleaseNotes({
    tag: "v0.1.0",
    issues: [
      {
        number: 12,
        title: "候補管理を追加する",
        url: "https://github.com/Huruikagi/pc-build-planner/issues/12",
        labels: [{ name: "enhancement" }],
      },
      {
        number: 15,
        title: "起動時のsnapshotがstale扱いされる",
        url: "https://github.com/Huruikagi/pc-build-planner/issues/15",
        labels: [{ name: "bug" }],
      },
      {
        number: 18,
        title: "CI/リリースワークフローの整備",
        url: "https://github.com/Huruikagi/pc-build-planner/issues/18",
        labels: [{ name: "documentation" }],
      },
    ],
  });

  assert.equal(
    notes,
    [
      "## v0.1.0",
      "",
      "### 新機能・改善",
      "- 候補管理を追加する ([#12](https://github.com/Huruikagi/pc-build-planner/issues/12))",
      "",
      "### 不具合修正",
      "- 起動時のsnapshotがstale扱いされる ([#15](https://github.com/Huruikagi/pc-build-planner/issues/15))",
      "",
      "### ドキュメント",
      "- CI/リリースワークフローの整備 ([#18](https://github.com/Huruikagi/pc-build-planner/issues/18))",
      "",
    ].join("\n"),
  );
});

test("複数labelを持つissueは最初に一致したグループへ1回だけ掲載する", () => {
  const notes = renderReleaseNotes({
    tag: "v0.2.0",
    issues: [
      {
        number: 1,
        title: "複合ラベル issue",
        url: "https://example.invalid/issues/1",
        labels: [{ name: "bug" }, { name: "enhancement" }],
      },
    ],
  });

  const occurrences = notes.split("#1]").length - 1;
  assert.equal(occurrences, 1);
  assert.match(notes, /### 新機能・改善/);
  assert.doesNotMatch(notes, /### 不具合修正/);
});

test("未知labelのみのissueとlabel未付与のissueをその他へ分類し欠落させない", () => {
  const notes = renderReleaseNotes({
    tag: "v0.3.0",
    issues: [
      {
        number: 2,
        title: "未知labelのみ",
        url: "https://example.invalid/issues/2",
        labels: [{ name: "wontfix" }],
      },
      {
        number: 3,
        title: "label未付与",
        url: "https://example.invalid/issues/3",
        labels: [],
      },
    ],
  });

  assert.match(notes, /### その他/);
  assert.match(notes, /#2\]/);
  assert.match(notes, /#3\]/);
});

test("該当issueが0件のグループを出力しない", () => {
  const notes = renderReleaseNotes({
    tag: "v0.4.0",
    issues: [
      {
        number: 4,
        title: "bugのみ",
        url: "https://example.invalid/issues/4",
        labels: [{ name: "bug" }],
      },
    ],
  });

  assert.doesNotMatch(notes, /### 新機能・改善/);
  assert.doesNotMatch(notes, /### ドキュメント/);
  assert.doesNotMatch(notes, /### その他/);
  assert.match(notes, /### 不具合修正/);
});

test("入力issue件数と出力issue数が一致する", () => {
  const issues = [
    {
      number: 10,
      title: "A",
      url: "https://example.invalid/10",
      labels: [{ name: "bug" }],
    },
    {
      number: 11,
      title: "B",
      url: "https://example.invalid/11",
      labels: [{ name: "enhancement" }],
    },
    { number: 12, title: "C", url: "https://example.invalid/12", labels: [] },
    {
      number: 13,
      title: "D",
      url: "https://example.invalid/13",
      labels: [{ name: "documentation" }],
    },
  ];
  const notes = renderReleaseNotes({ tag: "v0.5.0", issues });

  for (const issue of issues) {
    assert.match(notes, new RegExp(`#${issue.number}\\]`));
  }
});

test("入力が空の場合に失敗させる", () => {
  assert.throws(() => renderReleaseNotes({ tag: "v0.1.0", issues: [] }));
});

test("必須フィールドを欠く要素を含む場合に失敗させる", () => {
  assert.throws(() =>
    renderReleaseNotes({
      tag: "v0.1.0",
      issues: [
        { number: 1, title: "", url: "https://example.invalid/1", labels: [] },
      ],
    }),
  );
  assert.throws(() =>
    renderReleaseNotes({
      tag: "v0.1.0",
      // @ts-expect-error missing url intentionally for failure-path coverage
      issues: [{ number: 1, title: "no url", labels: [] }],
    }),
  );
});
