# Brief: project-candidate-management

## Problem

ユーザーは複数サイトで見つけたパーツ候補をPC構成の検討単位ごとに整理したいが、現在はスプレッドシートへ手作業で転記している。

## Current State

プロジェクトと候補パーツの概念は要求文書に定義されているが、作成・編集・削除やカテゴリ別表示を行う管理機能はない。

## Desired Outcome

ユーザーがプロジェクトを管理し、欠損を許容する候補パーツをプロジェクトへ直接所属させ、カテゴリ別に確認・編集・削除できる。未分類の商品も後から補正して利用可能にできる。商品取り込みからproject未解決または空名の編集内容を受け取った場合も、保存可能な候補と混同せず常設画面へ保持し、project作成後または入力補正後に同じ編集を継続できる。

## Approach

管理画面にプロジェクトと候補パーツの垂直スライスを実装する。共通項目とカテゴリ別の正規化属性を分け、抽出元表記とユーザー確認値を保持したまま、カテゴリ変更や再編集を安全に行う。

## Scope

- **In**: プロジェクトCRUD、候補パーツCRUD、カテゴリ別一覧、未分類管理、共通項目とカテゴリ別互換性属性の詳細編集、価格と取得日時、欠損値、削除確認、project未解決・空名pre-editの受理とsession内保持、編集開始と保存時の検証段階分離。
- **Out**: ページからの自動抽出、現在構成への選択、互換性結果、共通パーツライブラリ、プロジェクト複製・ステータス、商品画像。

## Boundary Candidates

- プロジェクトのライフサイクル
- 候補パーツとカテゴリ分類
- 共通項目・正規化属性・元表記の編集
- 解決前pre-edit draft、project解決、保存可能なcanonical draftへの遷移

## Out of Boundary

- 候補を現在構成へ採用する選択ルール
- 抽出精度やサイト固有解析
- 候補の自動推薦と横断比較

## Upstream / Downstream

- **Upstream**: local-data-foundation。
- **Downstream**: product-page-capture、product-capture-transient-migration、current-build-management、candidate-source-bookmarks、duplicate-product-merge、backup-restore。

## Existing Spec Touchpoints

- **Extends**: なし。
- **Adjacent**: product-page-captureは候補作成契約を利用し、current-build-managementは候補参照契約を利用する。

## Constraints

商品は単一プロジェクトへ直接所属し、各項目は欠損可能とする。未分類は現在構成に利用できない。共通項目はカテゴリ変更時にも失わない。

## Change Brief: v0.4.0

### Problem

候補管理が独自のproject選択を持つため、他画面の作業対象とずれる可能性がある。商品取り込みからのpre-editを保持している最中や候補編集中に共通projectを切り替えると、入力を黙って失う危険もある。

### Current State

本specはproject CRUD、候補CRUD、独自の選択project、project未解決pre-editの解決とsession保持を所有する。activationはpayloadのproject ID、feature stateの選択、一覧先頭へfallbackし得る。snapshotは`selectedProjectId`を必須fieldとして持ち、現在は選択authorityにも利用するため、runtime schema同等性を保ったままcontext authorityへ切り替えるowner-local移行が必要である。

### Desired Outcome

候補管理はproject-contextの検証済み現在選択を唯一の作業対象として利用する。owner-local adapterがCRUD前後のguard・mutation・refresh順序、candidate draftの保持、forced change通知を処理する。handoffはcurrent contextだけから保存先を解決し、未選択またはunavailableならpre-editを保持して選択・作成を求める。snapshotの`selectedProjectId`はversion/shapeを維持した一致検査用metadataとなり、contextを上書きしない。

### Scope

- **In**: owner-local context consumer adapter、独自selectorとlist-first fallbackの撤去、CRUD前guard・成功後refresh・失敗時非refresh、削除・強制fallback時のdraft保持、取り込みpre-editのcurrent-context binding、未選択・unavailable時の`project-required`保持、payload IDのadvisory/legacy扱い、snapshot version/shape維持と非権威的ID検査、feature-owned unit・contract・DOM・E2E。
- **Out**: project-context core・preference・fallback実装、shell singleton・selector slot・production wiring、snapshot field削除やversion bump、独立project管理画面、複数project同時編集、候補CRUD・保存規則の他境界への移管、product-capture側のintent retry。

### Boundary Impact

- **Extends**: `project-candidate-management`のcontext adapter、CRUD lifecycle hook、candidate/pre-edit guard、activationの保存先解決、snapshot restore semantics。
- **Preserves**: project・candidate CRUD、保存時検証、pre-edit内容のsession保持、snapshot version/shape、候補管理が確認・補正・保存を所有する境界。
- **Adjacent**: `project-context`は選択transaction・fallback・guard protocolを、application shellはport注入を、`product-capture-transient-migration`は未解決intentとretryを所有する。候補管理だけが検証済みcurrent contextへdraftをbindする。

### Dependencies

- **Upstream**: `runtime-schema-validation`の既存snapshot同等性、`project-context` core contract。
- **Downstream**: `product-capture-transient-migration`のhandoff retry、application shellのproduction wiring、現在構成・互換性確認が同じprojectへ追従する利用者フロー。

### Source

- Milestone v0.4.0 roadmap `project-candidate-management` update、GitHub Issue #29。

## Change Brief: v0.5.0

### Problem

candidate-managementがproject lifecycleと、candidate固有ではない共有`ManagementError`を所有しているため、project概念とデータ操作エラーのcanonical ownerがfeature境界と一致せず、複数featureがcandidate contractへ依存している。

### Current State

本specはproject CRUD、candidate CRUD、project deletion confirmation、project関連message、`ManagementError`とFoundationError mappingを所有する。compatibility、current-build、source-price-refresh等が`ManagementError`をcandidate-managementからimportする。

### Desired Outcome

本specはcandidateの作成・確認・編集・削除、pre-edit、current project binding、draft guard、source editor UIへ責務を限定する。project lifecycleは`project-context`へ移し、共有データ操作errorはfeature外のcanonical coreへ移して、種類・粒度と利用者挙動を変えず公開importを差し替える。

### Scope

- **In**: project CRUD/state/confirmation/messageの撤去とproject-context接続、candidate-only contractへの縮小、`ManagementError`の共有owner移動と改名、FoundationErrorからapp共有errorへのmapping、consumer import移行、既存candidate操作とエラー挙動の回帰検証。
- **Out**: error種類・粒度・表示の再設計、candidate UI layout変更、project管理画面の情報設計、保存形式変更、candidate CRUDやdraft ownershipの移管。

### Boundary Impact

- **Extends**: candidate-only featureとしてproject lifecycle/shared errorを公開境界外へ移すmigration contractを追加する。
- **Preserves**: candidate CRUD、pre-edit保持、保存時検証、current-context binding、draft guard、既存error semantics。
- **Adjacent**: `project-context`がproject lifecycleを、app共有error coreがcross-feature error vocabularyを、foundationが低位の保存errorを所有する。

### Dependencies

- **Upstream**: `spec:project-context`、`spec:local-data-library-boundaries`で定めるgeneric errorとapp errorのseam。
- **Downstream**: `candidate-source-bookmarks`の独立owner化、compatibility/current-build/source-price-refreshのimport移行。

### Source

- Milestone v0.5.0、GitHub Issues #44・#45。
