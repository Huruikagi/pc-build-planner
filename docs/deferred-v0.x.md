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
| DEF-003 | project-context / 1.2 | design.md の ProjectPreferenceStore 節「Chrome API の存在確認は `runtime.ts` の composition seam 内へ限定」が同 design の ProjectContextBoundaryGate 節「direct `chrome.storage.local` は `preference-store.ts` のみ許可」と矛盾する。実装は要件8.4 に裏付けられた後者へ寄せたので design.md 側の記述を実装に合わせる | 文書整合のみ。挙動への影響なし | v1.0 | 未着手 | |
| DEF-004 | project-context / 1.2 | task 1.3 の AST gate は `preference-store.ts` を file-scope で検査する形（key 引数が literal `projectContextPreference` であること、storage area 参照が `chrome.storage.local` のみであること）にする必要がある。storage API が注入されるため式チェーンを辿る実装にはできない | 後続 task 向けの tooling メモであり 1.2 の欠陥ではない | v1.0 | 未着手 | |
| DEF-005 | project-context / 1.2 | `createProductionProjectPreferencePort` は `chrome.storage` 不在時に非永続な in-memory port へ黙って fallback する。実 extension では到達しないが、真の API 欠如時は無通知で永続性を失う | 通常操作で到達しない異常系。preference は復元可能な UI state でありドメインデータではない | v1.0 | 未着手 | |
| DEF-006 | project-context / 1.2 | `runtime.ts` が `createInMemoryProjectPreferencePort` を再 export しており、composition seam に test 支援 surface がわずかに露出する | 命名・構造の好みに属する。fallback 実装上いずれにせよ必要 | v1.0 | 未着手 | |
| DEF-007 | product-page-capture / 9.2 | `side-panel-contributions.ts` の deferred manufacturer lookup は composition 完了前に呼ばれると `invalid-page-url` を返し、classifier が黙って `retail` へ倒れる。既存の `duplicateRefreshPort` と同じ遅延解決パターンで、実際には composition 戻り値の後にしか classify されない | 通常操作で到達しない異常系分岐 | v1.0 | 未着手 | |
| DEF-008 | product-page-capture / 9.1 | `source.siteName` を含む pre-edit draft が実 candidate service の保存経路を通ることは `candidateSourceSchema` の `siteName: optionalField(safeString())` で裏付けたのみで、end-to-end の保存 test は張っていない | 保存経路の統合検証は task 11.1 の所有範囲 | v1.0 | 未着手 | |
