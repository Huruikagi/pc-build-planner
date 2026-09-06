---
type: SpecBind Implementation Notes
artifact_id: main
---

# `project-candidate-management` の実装メモ — `main`

<!-- specbind:instruction maintain
次にこの変更を実装する担当者のための、永続的な自由記述メモ。
却下した方針、環境固有の癖、Requirements・Design・Contract が保持していない判断など、
自明でないことを記録する。
-->

<!-- specbind:instruction consume
これは実装上の記憶であり、仕様の権威ではない。この文書が承認ゲートの入力になることはない。
-->

## 実装上の注意

<!-- specbind:instruction maintain
独立して参照する話題ごとに、内容を表すH3見出しを付ける。次の実装者が必要とする事実、理由、
影響、確認または回避方法を一緒に記載する。単なる作業履歴、現在のコードから明らかなこと、
Requirements・Design・Contractがすでに所有することは残さない。合致する注意がなくなった場合は
空の節を残さず、この文書自体の削除を検討する。
-->

### 後続の実取り込みを候補モデルTaskの完了条件へ混入させない

Task 1の独立レビューで、実ページ取得から属性元表記を生成して渡す処理まで未充足として
扱ったため、候補管理の受入境界を実装してもレビューを通せない停止が発生した。独立診断は
原因を`PLAN`（完了判定対象の混入）に分類した。診断はTask 1全体の承認ではない。

再開時は[Design](design.md)とCLIのTask 1 completion criteriaに対し、完全な
`CandidateCaptureHandoff`を与えたモデル・変換・保存・再編集・削除整理の証拠を独立に
レビューする。実入口の不足を発見した場合は、[page-captureのDesign](../page-capture/design.md)
と同SpecのTask 1.1を読み、現Taskの欠陥か後続所有者の未実装かを判別してから指摘する。
レビュー指摘だけを根拠に、待機中の別Specの実装を候補管理Taskへ取り込まない。
