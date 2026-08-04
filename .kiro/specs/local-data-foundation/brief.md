# Brief: local-data-foundation

## Problem

後続機能が共有できる、安全で移行可能なChrome拡張の実行基盤とローカルデータ契約がまだない。基盤が曖昧なままでは、各機能が異なるモデルや保存方法を持ち、データ破損や将来の移行困難を招く。

## Current State

要求文書と最小限のNode.js設定だけがあり、Chrome拡張のmanifest、実装、データモデル、保存層は存在しない。

## Desired Outcome

Chrome 116以降のManifest V3拡張として読み込め、プロジェクト、候補パーツ、現在構成、正規化属性、出典情報を一貫したバージョン付きモデルで安全に保存・取得できる。

## Approach

拡張の骨格と共有ドメイン型を定義し、`chrome.storage.local` を隠蔽する検証付きリポジトリを提供する。ストレージを信頼済みコンテキストに限定し、容量確認、エラー処理、スキーマバージョンと移行境界を最初から設ける。

## Scope

- **In**: MV3 manifestと拡張骨格、共有ドメインモデル、IDと日時の規約、バージョン付き保存スキーマ、検証付きCRUD基盤、容量監視、ストレージアクセス制限、架空データによる基盤テスト。
- **Out**: 個別管理画面、商品ページ抽出、構成選択、互換性ルール、JSONファイル入出力、サイト別アダプター。

## Boundary Candidates

- 拡張ランタイムと権限設定
- ドメインモデルと永続化リポジトリ
- 入力検証とスキーマ移行

## Out of Boundary

- ページDOMや実サイト固有構造の解釈
- ユーザー向けの業務操作UI
- `unlimitedStorage` を前提とした無制限保存

## Upstream / Downstream

- **Upstream**: `docs/requirements-v0.1.0.md`、Chrome Manifest V3とStorage APIの制約。
- **Downstream**: project-candidate-management、product-page-capture、current-build-management、compatibility-checking、backup-restore。

## Existing Spec Touchpoints

- **Extends**: なし。
- **Adjacent**: すべての後続specがこのデータ契約を利用するが、各機能固有のルールは所有しない。

## Constraints

Chrome 116以降、既定10MB上限、生HTML・画像の保存禁止、service workerメモリへの永続状態依存禁止、content scriptからのストレージ直接アクセス禁止、MV3 CSP準拠。

## Change Brief: v0.4.0

### Problem

schema versionの定数が永続化、replacement、backup境界へ重複し、version変更時の追従漏れが起こり得る。また、canonical rootが破損または未対応versionの場合、利用者が有効なbackupから明示的に回復するproduction経路の契約と証拠が不足している。

### Current State

foundationは現行rootの検証、未知version拒否、原子的置換、maintenance fencingを提供する。一方、現行schema versionのliteralが複数箇所にあり、replacementの事前評価が既存rootの正常性を前提とする経路では、破損rootを上書きせずに評価済みbackupへ置換する回復を開始できない。

### Desired Outcome

保存schema versionはfoundationの一つの公開定数を唯一のsource of truthとする。破損・未対応rootを正常値として公開せず、利用者の明示操作と検証済みreplacement候補がある場合だけ、安全な回復を実行できる。失敗時は既存rootを暗黙更新せず、回復後は通常の候補管理を再利用できる。

### Scope

- **In**: canonical schema versionの一元化、foundation・replacement・backup round tripの同一定数参照、未知version拒否、既存root非置換を保つ回復評価・置換契約、破損rootからの明示的回復に必要なerror区分、原子的commit、foundation/replacement関連の回帰検証。
- **Out**: schema versionの値自体の変更、保存データの意味・構造変更、backup file I/O・確認UI、暗黙の初期化や自動破棄、maintenance fencing・write authorityの弱体化。

### Boundary Impact

- **Extends**: `local-data-foundation`のschema version所有、replacement評価、破損root回復、原子的置換契約。
- **Preserves**: 単一write authority、`Result`とcanonical error path、未知versionのfail-closed拒否、既存有効データの保持、commit直前のgeneration・owner検証。
- **Adjacent**: `backup-restore`は回復候補のfile入出力・利用者確認・E2Eを所有し、schema versionやreplacementの安全性を再定義しない。

### Dependencies

- **Upstream**: `runtime-schema-validation`。
- **Downstream**: `backup-restore`の破損canonical data回復とproduction E2E。

### Source

- Milestone v0.4.0 roadmap `local-data-foundation` update、GitHub Issue #24。

## Change Brief: 2026-08-03 backup restore capability unification

### Problem

正常rootの置換操作は内部の完全`FoundationDataPort`にあり、破損・未対応rootの回復操作はbackup専用`RecoveryDataPort`に分かれている。一方、production runtime handleは通常feature向けのscoped data portと回復専用portだけを公開するため、backup-restoreが通常復元と異常root回復の両方を最小権限で実行できない。

### Desired Outcome

backup-restoreだけが利用する一つの能力別契約から、正常rootの評価・保守・原子的置換と、異常rootの評価・回復保守・原子的回復を実行できる。通常CRUD、raw root、Storage、lock、内部write authorityは公開しない。

### Scope

- **In**: backup復元専用公開capability、正常置換と異常root回復のfacade統合、production runtime handle、公開境界とnegative contract test。
- **Out**: 置換・回復アルゴリズム、保存schema、RecoveryControl、backup交換形式・file UI、通常feature向けCRUD portの意味変更。

### Boundary Impact

- **Extends**: foundation runtime contributionの用途別公開handleとbackup向けcapability facade。
- **Preserves**: 単一write authority、同一Web Lock、maintenance/recovery fencing、raw root非公開、通常featureの最小権限。
- **Adjacent**: backup-restoreは専用portを消費して正常/回復経路を選び、application-shellは完成済みportをbackup section factoryへだけ注入する。
