# Brief: source-price-refresh

出典: GitHub issue [#12](https://github.com/Huruikagi/pc-build-planner/issues/12)（milestone v0.3.0）

## Problem

一度保存した候補の価格は時間で変わる。steering `product.md` の「体験の中核：検討中ブックマーク」が掲げる「後から何度でも戻って比較・補正する」を成立させるには、再訪時にワンアクションで価格を最新化できる必要がある。現在それができないため、価格は取り込んだ時点で凍結され、検討し続けるほど情報が古くなる。

さらに、この機能の動線は `activeTab` の付与問題（#6 と同根）に直撃する。「ブックマークを再訪 → パネル内の"価格更新"ボタンを押す」という素朴な設計は、遷移後にパネル内ボタンを押す形になるため、#6 が指摘する「付与失効で黙って失敗する欺瞞的アフォーダンス」にそのまま該当する。

## Current State

- 価格は商品側に1件（`CandidateProductValues.price`）。`candidate-source-bookmarks`（#10）で per-source へ移る予定。
- `src/features/product-capture/extractor.ts`: 抽出は全 field を対象とする。価格のみを再取得する経路は無い。
- `src/runtime/service-worker.ts`: `chrome.contextMenus` は使っていない。
- 保存済み URL と現在タブ URL を突き合わせる仕組みが無い。
- `transient-feature-surface`（#6）で、付与ジェスチャー起動 / 付与失効で畳まれる一過性ビュー契約が導入される予定。

## Desired Outcome

ブックマークしたページを再訪した状態から1操作で価格を更新でき、更新先のソースが正しく特定され、失敗した場合も旧価格を壊さない。

- 再訪ページに対して「価格を更新」を実行すると、そのページから価格を再取得し、対応するソースの価格と取得日時へ反映される。
- 遷移後でも動線が破綻しない（押しても失敗するボタンが存在しない）。
- 更新先がプライマリソースなら、一覧に出る代表価格も追従する。
- URL が保存時と完全一致しない場合や価格が取れなかった場合の挙動が定義されている。

## Approach

**`transient-feature-surface`（#6）が導入する一過性ビュー契約に乗せる。** 具体的には、issue #6 の選択肢 D（コンテキストメニュー「価格を更新」）を主動線とする。右クリックはそれ自体が `activeTab` を付与するジェスチャーであるため、遷移後でも「付与 → 再取得 → 反映」が1操作で完結し、パネル内ボタン単独より動線が破綻しにくい。

コンテキストメニュー項目は本 spec が定義するが、**起動経路の契約そのものは `transient-feature-surface` が所有する**。service worker 側で付与ジェスチャー → ビュー起動の経路を再実装しない。

**書き込み先の特定は `candidate-source-bookmarks`（#10）のソースコレクションに対して行う。** 現在タブの URL を保存済みソースと突き合わせて更新先を決める。価格の置き場所（per-source）は本 spec では再定義せず、確定した契約を利用する。

**価格更新が意味を持つのは基本的に販売ページ（#11 の `retail`）。** メーカー商品紹介ページは価格を持たないことが多く、更新対象外にできる。

## Scope

- **In**:
  - コンテキストメニュー「価格を更新」項目の定義と、一過性ビュー契約への登録
  - 現在タブ URL と保存済みソースの突き合わせによる更新先ソースの特定
  - 価格のみを対象とした再取得（既存 extractor の流用）
  - 対象ソースの価格・`capturedAt` の更新と provenance（`SourceSnapshot`）の扱い
  - 更新先がプライマリの場合の代表価格への反映
  - URL 不一致・価格取得失敗・保存失敗時の挙動
  - ソース種別による対象の絞り込み（`retail` 中心）
- **Out**:
  - 定期巡回・バックグラウンドでの自動価格監視（steering `product.md` の MVP 境界外。この線は越えない）
  - 価格履歴の保持・推移表示
  - 一過性ビュー / 付与ジェスチャーの契約そのもの（`transient-feature-surface` が所有）
  - ソースコレクション・価格の per-source 化・プライマリ導出（`candidate-source-bookmarks` が所有）
  - 価格以外の項目の再取得
  - 通貨換算・為替レート取得

## Boundary Candidates

- **付与ジェスチャーの選択**: コンテキストメニュー経路（#6 D）を主動線にするか、パネル内ボタン（#6 A+B）にするか。前者が遷移後の動線として素直。パネル内ボタンを併設する場合は「現在タブ URL が保存済みソースに一致するときだけ有効化」という文脈依存の活性化が要る。
- **URL 突き合わせの粒度**: 再訪ページの URL は tracking パラメータ・リダイレクト・セッション差で保存時と完全一致しないことがある。完全一致 / 正規化一致 / eTLD+1 + path のどれで紐づけるか。一致しない場合の挙動（新規ソース追加を促すか、何もしないか）も定義する。
- **再取得のスコープ**: 既存 extractor を流用しつつ `price` field のみ取得するのか、全抽出して価格だけ採用するのか。provenance の記録範囲。
- **反映範囲**: プライマリ更新時の代表価格追従（`candidate-source-bookmarks` の導出ルールに従う）。
- **失敗・空取得の扱い**: 価格が取れなかった場合に旧価格を保持するのか、取得失敗を明示するのか。旧価格を黙って消さないことが前提。

## Out of Boundary

- 抽出の優先順位・正規化規則そのもの（product-page-capture が所有）
- 同一商品の検知・統合（duplicate-product-merge が所有）
- 候補の CRUD（project-candidate-management が所有）

## Upstream / Downstream

- **Upstream**: `transient-feature-surface`（付与ジェスチャー起動と自動終了の契約）、`candidate-source-bookmarks`（ソースコレクション・価格の per-source 化・種別）、`product-page-capture`（extractor の流用）、`local-data-foundation`（更新の write authority）
- **Downstream**: なし（v0.3.0 内の後続なし）

## Existing Spec Touchpoints

- **Extends**:
  - `product-page-capture` -- extractor を価格のみの再取得へ流用する。要件2 / 要件3 の抽出・正規化規則は再定義せず利用する
  - `project-candidate-management` -- 候補の更新契約（要件4 / 要件6）
- **Adjacent**:
  - `duplicate-product-merge` -- 同一 URL の再取り込みは新規ソース追加ではなく本 spec の価格更新へ寄せる（#13 の論点6）。この振り分けの責任分界を両 spec で揃える

## Constraints

- バックグラウンドの巡回・定期クロールを行わない。ユーザー操作を契機とする（steering `product.md`、および #14 で明文化されるポリシー）。
- 「価格・在庫の自動監視（定期巡回）」は MVP 対象外。この線を越えない。
- `activeTab` を維持し、全サイトへの恒久的な読み取り許可を要求しない。
- `chrome.contextMenus` 使用時の manifest 権限追加の要否を設計で確認する。
- 更新失敗時に既存データを上書きしない（local-data-foundation の原子的 mutation 規約）。
- ページ由来の商品値または URL を診断ログへ無制限に記録しない（product-page-capture 要件6.5）。
- worker bundle を DOM および React 非依存に保つ（application-shell 要件3.6）。
- テスト資産は架空データのみ。実サイト由来の HTML を使わない。

## Change Brief: v0.5.0

### Problem

価格更新workflowが、CandidateSourceのURL normalization・catalog scope・一意照合・ambiguity判定まで所有し、candidate-managementとの循環依存を形成している。

### Current State

本specはcontext menu起動、固定tabからの価格抽出、source locator、`matchSource`、条件付き価格更新、結果表示を提供する。source照合contractをcandidate-management側へ返すため、双方の公開型と実値が相互依存している。

### Desired Outcome

本specは利用者の明示操作、固定tab、価格抽出、取得結果の検証、source ownerの公開portを使う一意照合、条件付きprice patch、進行・結果表示だけを所有する。URL identity・catalog/matcher・ambiguityのcanonical ownershipは`candidate-source-bookmarks`へ移す。

### Scope

- **In**: source owner公開portへのconsumer移行、match contract差し替え、価格取得workflowとerror mappingの維持、循環依存とshell遅延proxyの撤去、unit/contract/E2E非回帰。
- **Out**: URL同一性規則の変更、価格抽出・正規化規則の変更、定期監視、価格履歴、source collection policy、UI layout変更。

### Boundary Impact

- **Extends**: source ownerの照合・patch capabilityを使う価格更新consumer contractを明確化する。
- **Preserves**: 明示操作、activeTab、固定世代、価格だけの更新、失敗時の既存値保持、transient result UI。
- **Adjacent**: `candidate-source-bookmarks`がURL identity・一意照合・ambiguity・mutationを所有し、product-page-captureは価格抽出portを維持する。

### Dependencies

- **Upstream**: `spec:candidate-source-bookmarks`。
- **Downstream**: `duplicate-product-merge`の同一URL振り分け、application shell composition簡素化。

### Source

- Milestone v0.5.0、GitHub Issue #46。

## Change Brief: v0.5.0-boundary-reconciliation

### Problem

source ownership移管に加え、candidate-owned `ManagementError`を参照するconsumer migrationが本specの依存とscopeに明示されていない。

### Current State

本specはURL identity/matchと価格workflowを所有し、candidate-managementのsource port/errorへ循環依存する。

### Desired Outcome

本specは明示操作、固定tab、価格抽出、結果検証、source coreのmatch/patch利用、共有`AppDataError` mapping、transient表示だけを所有する。

### Scope

- **In**: source public port consumer化、`ManagementError` import撤去、共有error利用、価格workflow非回帰、循環proxy不要化。
- **Out**: URL identity規則、source policy、error semantics、価格抽出規則、監視・履歴、shell composition実装。

### Boundary Impact

- **Extends**: source/error canonical ownerを利用するworkflow consumer contractを明確化する。
- **Preserves**: explicit action、activeTab、固定世代、価格だけの更新、失敗時値保持、transient result UI。
- **Adjacent**: `candidate-source-bookmarks`がsourceを、`local-data-foundation`が共有errorを、application shellがcompositionを所有する。

### Dependencies

- **Upstream**: `spec:candidate-source-bookmarks`、`spec:local-data-foundation`。
- **Downstream**: `spec:application-shell`と価格更新E2E。

### Source

- v0.5.0 `$kiro-spec-update-batch` final review（2026-08-12）。
