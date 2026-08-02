# Brief: product-page-capture

## Problem

閲覧中の商品ページからカテゴリ、メーカー、商品名、型番、URL、価格、主要スペックを手作業で転記する負担が大きい。ページにメーカー表記がないメーカー公式サイトでは、他の情報を取得できてもメーカーだけが欠損する。また、対象ページの一時権限に結び付いた取り込み面で確認・保存まで続けると、ページ遷移後に実行不能な操作を残してしまう。

## Current State

汎用抽出、正規化、取得根拠、候補管理への連携はv0.1.0で実装済みである。v0.3.0では一過性surface契約と候補管理のpre-edit契約が承認され、取り込み面を抽出実行だけへ縮小できる。固定tabから価格だけを観測する`PagePriceExtractionPort`も下流`source-price-refresh`向けの確定契約として本specに属する。

## Desired Outcome

利用者が明示操作で起動した一過性面から現在ページを抽出すると、結果が候補管理の非一過性編集面へ直ちに引き渡される。確認・補正・project解決・保存はページ権限の寿命から切り離される。メーカー公式domainと確認できるページでメーカーだけが欠損する場合は、ローカルなdomain mapが最下位優先度で補完する。

## Approach

JSON-LD、OpenGraph等のメタ情報、タイトル・パンくず、表・定義リスト、共通項目名辞書の順で汎用抽出し、最後にeTLD+1で照合するメーカーdomain mapを候補供給源として適用する。ページ由来の値を未信頼入力として正規化・検証し、抽出成功後はproject未解決draftとして候補管理へ原子的に引き渡す。

## Scope

- **In**: 現行世代の固定タブ取得、汎用抽出、domain mapによるメーカー欠損補完、取得元、正規化、候補管理への即時handoff、stale結果抑止、固定tab価格観測port。
- **Out**: 常時監視、一括取得、サーバーアクセス、AI、画像、サイト固有DOM抽出、取り込み面での確認・補正・project選択・保存、保存済みsource更新、実サイトfixture。

## Boundary Candidates

- product-capture所有の抽出候補、順位、正規化、provenance
- application shell所有の一過性起動世代、固定タブ、寿命、原子的handoff
- candidate-management所有のpre-edit受理、project解決、確認・補正、保存
- product-capture公開のread-only価格観測port

## Out of Boundary

- 登録後候補とsourceの管理
- 現在構成と互換性判定
- domain mapを権限・サイト固有抽出許可・所有証明として扱うこと
- 対象サイトへの正式対応や取得率保証

## Upstream / Downstream

- **Upstream**: `transient-feature-surface`、`product-capture-transient-migration`、`project-candidate-management`、local data foundation。
- **Downstream**: `candidate-source-bookmarks`（domain map参照）、`source-price-refresh`（`PagePriceExtractionPort`利用）。

## Constraints

`activeTab`と`scripting`を明示的な付与ジェスチャーへ結び付け、恒久的host permissionを追加しない。取得対象は起動時に固定した現在ページだけとし、生HTML・画像・完全URL・抽出値を永続化またはログ出力しない。domain mapは公開根拠とownerを持つメーカー公式domainだけを含め、サイト固有DOM抽出の有効化には使用しない。

## Change Brief: v0.4.0

### Problem

複数の販売・メーカーサイトを候補ソースとして保存する利用者は、URLだけでは取得元を識別しにくい。また、OpenGraph、Twitter Card、product拡張の抽出対象がselector文字列として混在しており、対応範囲の意図しない拡大やproperty名の誤りをレビューで把握しにくい。

### Current State

候補ソースは任意の`siteName`を保持・編集・表示できるが、商品取り込みはページの`og:site_name`をsourceへ引き渡していない。metadata抽出は限定されたselector一覧を使っているものの、対応propertyの語彙と取得先fieldが明示的な型付き契約として表現されていない。

### Desired Outcome

ページが有効な`og:site_name`を提供する場合は、商品取り込みから候補編集へ取得元サイト名を引き渡し、保存後のsource識別に利用できる。対応するmetadata propertyは明示的なallowlistとして管理され、未列挙propertyを取得せず、欠損・不正なサイト名があっても既存の取り込みを継続する。

### Scope

- **In**: `og:site_name`の任意抽出、未信頼文字列としての正規化・検証、source `siteName`へのhandoff、欠損・不正値時の継続、OpenGraph・Twitter Card・product拡張を区別するmetadata allowlist、未列挙propertyの非取得、synthetic HTMLによる回帰検証。
- **Out**: `siteName`をURL同一性・source永続識別子・ページ種別判定へ使うこと、ホスト名の推測保存、サイト固有selector、網羅的OpenGraph parser、実サイトfixture、保存済みsourceの意味や交換形式の変更。

### Boundary Impact

- **Extends**: `product-page-capture`の汎用metadata抽出、値のprovenance、正規化、候補編集draftへのhandoff。
- **Preserves**: 明示操作・固定tab・一時権限、fail-closedな未信頼入力処理、欠損許容、候補管理が確認・補正・保存を所有する分離。
- **Adjacent**: `candidate-source-bookmarks`は既存`siteName`の保存・編集・表示を所有し、metadataの採否や抽出語彙は所有しない。

### Dependencies

- **Upstream**: `runtime-schema-validation`、直接実装候補`schema-dts-type-support`。
- **Downstream**: `candidate-source-bookmarks`の複数source表示と再訪体験。

### Source

- Milestone v0.4.0 roadmap `product-page-capture` update、GitHub Issues #21・#23。
