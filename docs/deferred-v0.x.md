# v0.x 先送り一覧

`.kiro/steering/delivery-policy.md` の方針に従い、レビュー等で `Suggestion` に分類してブロックしないと判断した指摘を記録する。

ここは捨て場ではなく、v1.0 へ向けた棚卸しの入力である。

## 運用

- レビュアーは `Suggestion` を review 出力の `DEFERRED` 欄に出す。読み取り専用なのでファイルへは直接書かない。
- 制御側（`kiro-impl`）が APPROVED 時に本ファイルへ追記し、そのタスクのコミットへ含める。
- 追記によって完了扱いにできるのは**その指摘への処置**のみ。実装タスク自体の完了可否は、従来どおり受け入れ基準とレビュー判定で決まる。

## 列の意味

| 列 | 内容 |
|---|---|
| ID | `DEF-001` から連番。以後変更しない |
| 由来 | spec 名 / タスク番号 |
| 指摘 | 何を指摘されたか |
| 非ブロック理由 | `delivery-policy.md` のどの非ブロック分類に当たるか |
| 対象 | 再検討する時期（`v1.0` / `未定`） |
| 状態 | `未着手` / `対応済` / `破棄` |
| 関連 | Issue / PR 番号（あれば） |

## 一覧

| ID | 由来 | 指摘 | 非ブロック理由 | 対象 | 状態 | 関連 |
|---|---|---|---|---|---|---|
| DEF-001 | project-context / 1.1 | `createProjectContextSnapshot` が `catalog` 入力を信頼しており、不変条件1（ready の selected ID は catalog に一度だけ存在）の一意性検査は上流の `projectEntries` のみ。duplicate を含む手組み catalog を渡すと `ready` が構築できる | 型の厳密化（動作は正しく、境界は守られている） | v1.0 | 未着手 | |
| DEF-002 | project-context / 1.1 | 要件1.6「全 consumer が同一 snapshot」は現状 2 つの独立構築 snapshot の構造的等価で証明しており、instance 共有は `ProjectContextService`（task 2.3）まで示せない | 稀な入力ではなく boundary 外の検証範囲。task 1.1 の完了条件（consumer 独自 fallback 不要）は充足 | v1.0 | 未着手 | |
