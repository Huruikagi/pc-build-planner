# Brief: duplicate-product-merge

出典: GitHub issue [#13](https://github.com/Huruikagi/pc-build-planner/issues/13)（milestone v0.3.0）

## Problem

`candidate-source-bookmarks`（#10）は「同一商品に複数ページを束ねる」構造を提供するが、**その"既存パーツ"を見つける導線がない**。別サイトで同じパーツを見つけたとき、統合先を利用者が手作業で探して紐づける必要がある。

この検知・統合がないと、複数ソース構造は「理屈はあるが、紐づけが手作業で面倒」になり実質使われない。結果として利用者は従来どおり新規パーツとして重複登録し、価格比較（#12 を含む一連の体験）が成立しない。

つまり本 spec は #10 の構造を実際に使えるものにする接着剤であり、steering `product.md` の「一つの商品の検討は本来複数ページにまたがる。同一商品を複数の出典で束ね、比較を支える」を成立させる最後のピースになる。

## Current State

- 取り込みフローに、プロジェクト内の既存候補と照合する処理は存在しない。保存すると常に新規候補が作られる。
- `src/features/product-capture/normalizer.ts`: 取り込み値の正規化を実装済み。照合用の正規化はこれと揃える必要がある。
- `src/features/candidate-management/view.tsx`: 統合を提示する UI は無い。
- `candidate-source-bookmarks` 完了後、既存パーツへソースを追加する契約が利用可能になる見込み。

## Desired Outcome

取り込み時に「これ、もう入ってるやつでは」と気づける。

- 取り込み（または保存）時に、対象プロジェクト内の既存候補との一致が評価される。
- 有力な一致があれば、新規パーツとして保存する前に「**既存パーツ『◯◯』の別ソースとして追加**」の選択肢が提示される。
- 統合を選べば、ソースコレクションへ新しいソース（URL / 価格 / 取得日時 / 種別）が追加される。
- 一致しなければ従来どおり新規候補として保存される。誤検知で保存が止まらない。
- 誤統合が起きない。自動では統合しない。

## Approach

**照合は自動、統合はユーザー確定。** 誤統合は取り返しがつきにくいため、自動統合はせず一致候補を提示して利用者が確定する方式を基本とする（#13 の論点4）。

照合キーは `modelNumber` の一致を最有力とし、`manufacturer` + `name` の正規化一致を補助とする。正規化（大文字小文字・全角半角・型番の区切りゆれ）は既存 `normalizer.ts` と揃える。

**同一 URL の再取り込みは新規ソース追加ではなく価格更新へ寄せる**（#13 の論点6）。この振り分けの責任分界は `source-price-refresh` と揃える。

## Scope

- **In**:
  - 取り込み / 保存時のプロジェクト内既存候補との類似度評価
  - 照合キーの定義と優先度（`modelNumber` 最有力、`manufacturer` + `name` 補助）
  - 照合用の正規化（既存 normalizer と整合）
  - 一致候補の提示 UI と、統合 / 新規保存のユーザー確定
  - 統合時のソース追加と値マージ規則
  - 既存ソース URL と重複する場合の振り分け
- **Out**:
  - ソースコレクション・プライマリ導出そのもの（`candidate-source-bookmarks` が所有）
  - 価格の再取得処理（`source-price-refresh` が所有）
  - プロジェクトをまたいだ重複検知
  - 保存済み候補どうしの事後マージ（一覧から2件選んで統合する操作）。必要なら別途判断する
  - 抽出ロジック・ランカーの変更
  - 商品マスターの構築、外部 DB 照合

## Boundary Candidates

- **照合ロジック**（純粋関数として分離したい）: 候補集合と取り込み値を受け取り、一致候補を確信度つきで返す。UI と永続化から独立させてテストする。
- **正規化**: `product-capture/normalizer.ts` の正規化との関係。同じ規則を再実装するのではなく canonical owner を決めて共有する。
- **統合実行**: 既存パーツへのソース追加。`candidate-source-bookmarks` が提供する契約を呼ぶだけにし、ドメイン操作を本 spec で再実装しない。
- **提示 UI**: 取り込みフロー内（product-capture 側）に出すか、候補管理側に出すか。取り込みの一過性ビュー（`transient-feature-surface`）の中で完結させるかも判断点。

## 設計で詰めるべき論点（issue より）

1. **一致キーと優先度** -- 型番が取れない候補（URL だけ・未分類）をどう扱うか。
2. **正規化・表記ゆれ** -- 既存 normalizer との整合。
3. **カテゴリ整合** -- カテゴリが異なる候補を統合対象から除外するか。未分類の扱いに注意。
4. **確信度と UI** -- 複数一致時の提示順。既定をどちらにするか（新規保存 or 統合提示）。
5. **統合時の値マージ** -- 既存パーツの `product` 値・正規化属性と新ソースの取得値が食い違う場合。既存を尊重し、新ソースは出典として追加するのが素直。
6. **URL 重複** -- 既に同じソース URL が登録済みなら、新規追加ではなく該当ソースの更新（`source-price-refresh`）へ寄せる。

## Out of Boundary

- 抽出精度そのもの（product-page-capture）
- 互換性判定（compatibility-checking）
- 候補の CRUD（project-candidate-management）

## Upstream / Downstream

- **Upstream**: `candidate-source-bookmarks`（統合先のデータ構造とソース追加契約）、`product-page-capture`（取り込みフローと normalizer）、`project-candidate-management`（候補参照・更新契約）
- **Downstream**: なし（v0.3.0 内の後続なし）

## Existing Spec Touchpoints

- **Extends**:
  - `product-page-capture` -- 要件5（プロジェクト選択と候補保存）。保存確定前に統合提示という分岐が挟まる
  - `project-candidate-management` -- 要件2（候補の作成と所属）、要件6.3（取り込みが単一プロジェクトへ候補を作成できる契約）
- **Adjacent**:
  - `source-price-refresh` -- 同一 URL 再取り込みの振り分け先。責任分界を揃える
  - `transient-feature-surface` -- 統合提示 UI を一過性ビュー内で完結させる場合、その表示制約を踏まえる

## Constraints

- 自動統合しない。統合は必ず利用者の明示確定を経る。
- 誤検知で保存が止まらない。一致しなければ従来どおり新規保存される。
- 照合はプロジェクト内に閉じる。
- 保存失敗時に入力内容を失わない（product-page-capture 要件5.6、project-candidate-management 要件2.5）。
- 永続化 mutation は単一 write authority へ集約する（steering `structure.md`）。「新規保存してから統合」のような二段 write で整合性を作らない。
- 抽出元表記をユーザー確認値で暗黙に上書きしない（project-candidate-management 要件4.6）。統合時のマージでもこの原則を守る。
- 照合ロジックは架空データだけで検証可能にする。
