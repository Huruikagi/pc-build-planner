# Requirements Document

## Introduction

後続機能を実装する開発者が共通かつ安全な契約を利用できるように、Chrome 116以降のManifest V3拡張として動作する実行骨格、バージョン付きPCドメインモデル、検証付きローカル永続化を提供する。本機能により、機能ごとのモデル分岐、未信頼データによる破損、容量超過、将来のスキーマ移行困難を予防する。さらに、保存スキーマの現行版を一つの公開契約から判定できるようにし、保存ルートが破損または未対応版で通常利用できない場合も、利用者が明示的に選んだ有効なバックアップ候補による回復を安全に開始できるようにする。v0.5.0では、汎用storage・lock・transaction・replacement mechanismを上流workspace packageへ委譲し、本仕様は保存データの意味を決める製品adapter、PC固有policy、用途別runtime capability、および共有data operation errorのcanonical ownerとして既存挙動を維持する。

## Boundary Context

- **In scope**: MV3拡張骨格、共有PCドメイン契約、ID・日時規約、現行保存スキーマ版の一元的な公開、バージョン付き保存スキーマ、入力検証、具体migration・reference repair、汎用packageへPC policyを設定するproduct local-data adapter、検証付きCRUD、正常・破損・未対応版rootの用途別runtime capability、低位`FoundationError`と一対一対応する共有`AppDataError`、容量監視、保存アクセス制限、架空データによるcharacterization・contract検証。
- **Out of scope**: generic storage・lock・transaction・capacity・replacement mechanism、Chrome adapter、generic backup orchestrationの実装、保存スキーマ版の値または保存データの意味・構造の変更、error種類・意味・粒度の変更、管理UI、商品ページ解析、候補・構成の業務操作、互換性規則、JSONファイルの入出力と回復確認UI、暗黙の初期化または自動破棄、サイト別処理、表示言語などドメイン外の利用者インターフェース設定の保存、npm公開。
- **Adjacent expectations**: `local-data-library-boundaries`は汎用mechanism、Chrome adapter、generic backup orchestrationを所有し、本仕様はその公開APIだけを使ってPC固有policyと用途別能力を構成する。候補管理、現在構成、互換性、candidate source、価格更新は共有`AppDataError`だけを公開入口から利用し、低位errorやproduct adapterを再所有しない。バックアップ復元機能は製品交換形式、file I/O、利用者確認、product backup adapterを所有し、本仕様の用途限定replacement capabilityを利用する。表示言語のようなドメイン外設定は独立保存領域を用い、本基盤はその整合性・容量・schema versionを保証しない。

## Change Integration

- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **In-scope trace**: product adapterとPC policy injectionは9.1–9.3、共有`AppDataError` vocabulary・一対一mapping・公開exportは9.4–9.6、用途別runtime capabilityとpackage公開API限定compositionは9.7–9.8、characterization・contract・変更種別別検証は9.9–9.10で扱う。
- **Out-of-scope preservation**: generic core、Chrome adapter、generic backup orchestration、保存schemaの意味、`FoundationError`の種類・意味・粒度、raw rootと内部adapterの非公開、single write authority、atomicity、maintenance/recovery fencing、reference repair、worker認可を変更しない。

## Requirements

### Requirement 1: Manifest V3実行基盤
**Objective:** As a 拡張開発者, I want Chrome 116以降で読み込める最小実行基盤, so that 後続機能を同一の安全なランタイム条件で構築できる

#### Acceptance Criteria
1. When 未パッケージ拡張をChrome 116以降へ読み込む, the ローカルデータ基盤 shall Manifest V3拡張としてエラーなく起動する
2. The ローカルデータ基盤 shall リモートコード、動的コード評価、インラインJavaScriptを必要としない
3. The ローカルデータ基盤 shall 永続状態をバックグラウンド処理のメモリ寿命へ依存させない
4. The ローカルデータ基盤 shall 必要最小限の権限だけを宣言し、全サイトへの恒久的なアクセス権限を要求しない

### Requirement 2: 共有ドメイン契約
**Objective:** As a 後続機能の開発者, I want 一貫した共有モデル, so that 機能間でデータを安全に交換できる

#### Acceptance Criteria
1. The ローカルデータ基盤 shall プロジェクト、候補パーツ、現在構成、正規化属性、出典情報を表現できるバージョン付き契約を提供する
2. The ローカルデータ基盤 shall CPU、CPUクーラー、マザーボード、メモリ、GPU、ストレージ、電源、ケース、ケースファン、拡張カード、その他、未分類を区別できる
3. The ローカルデータ基盤 shall 自動取得された元表記とユーザーが確認または修正した値を区別して保持できる
4. The ローカルデータ基盤 shall 欠損可能な商品情報とカテゴリ別の正規化属性を明示的に表現できる
5. The ローカルデータ基盤 shall 識別子の一意性と日時のタイムゾーン非依存な表現規約を定める
6. The ローカルデータ基盤 shall プロジェクト、候補パーツ、現在構成の参照関係を検証可能な形で表現する
7. The ローカルデータ基盤 shall 取得URL、取得日時、元表記スナップショットをそれぞれ欠損可能な独立情報として表現し、欠損時に代替値を生成せず保持できる
8. The ローカルデータ基盤 shall 保存ルートおよび交換形式に、プロジェクト・候補パーツ・現在構成に属さない利用者インターフェース設定(表示言語等)を含めない

### Requirement 3: 検証付き永続化
**Objective:** As a 後続機能の開発者, I want 保存境界で検証されるCRUD操作, so that 不正な状態を永続化または利用しない

#### Acceptance Criteria
1. When 有効なデータの作成、取得、更新、削除を要求する, the ローカルデータ基盤 shall 操作結果を明示して永続状態へ反映する
2. When 保存前の入力を受け取る, the ローカルデータ基盤 shall 契約適合性と参照整合性を検証する
3. When 保存済みデータを読み取る, the ローカルデータ基盤 shall 利用側へ返す前に契約適合性を検証する
4. If 入力または保存済みデータが不正である, the ローカルデータ基盤 shall 破損データを正常値として返さず、原因を識別可能な失敗結果を返す
5. If 保存処理が失敗する, the ローカルデータ基盤 shall 成功を報告せず、既存の有効データを可能な限り保持する
6. When 同一の変更要求が安全に再試行される, the ローカルデータ基盤 shall 重複エンティティや不整合な参照を生じさせない
7. When 候補パーツの削除またはカテゴリ変更が現在構成の参照へ影響する, the ローカルデータ基盤 shall 参照修復を同一の変更結果へ含め、利用側から参照不整合な中間状態を観測できないようにする
8. When 複数の保存要求が競合する, the ローカルデータ基盤 shall 変更の取りこぼしを防ぎ、適用できない要求へ識別可能な競合結果を返す
9. When プロジェクトの削除を要求する, the ローカルデータ基盤 shall そのプロジェクトに所属する候補パーツと現在構成を同一の変更結果から削除し、他のプロジェクトのデータを保持する
10. When 信頼済み拡張UIコンテキストが保存データの参照と変更を要求する, the ローカルデータ基盤 shall 参照と原子的ルート変更だけに限定した保存ポートを実行時貢献として提供し、置換・保守・Storage・排他制御の操作手段を同じポートから公開しない
11. When 保存前の候補パーツ入力を識別子と日時を伴わない形で検証する, the ローカルデータ基盤 shall 同一のcanonical規則で項目単位の失敗位置を返し、利用側が保存用の完全な値を組み立てずに検証できるようにする

### Requirement 4: スキーマバージョンと移行境界
**Objective:** As a 拡張保守者, I want 保存データを判別し段階的に移行できる契約, so that 将来のモデル変更で既存データを失わない

#### Acceptance Criteria
1. The ローカルデータ基盤 shall 保存ルートに明示的なスキーマバージョンを保持する
2. When 対応可能な旧バージョンを読み込む, the ローカルデータ基盤 shall 現行契約へ順序立てて移行してから利用可能にする
3. If 未知または未対応の将来バージョンを読み込む, the ローカルデータ基盤 shall データを上書きせず識別可能な非対応エラーを返す
4. If 移行中に検証または保存が失敗する, the ローカルデータ基盤 shall 元データを破壊せず失敗結果を返す
5. The ローカルデータ基盤 shall 各移行が入力バージョンと出力バージョンを明示する契約を提供する
6. The ローカルデータ基盤 shall 現行の保存スキーマバージョンを一つの公開された正規値として提供する
7. When 保存、置換評価、または交換形式の往復で現行スキーマバージョンを判定する, the ローカルデータ基盤 shall 公開された同一の正規値に一致する結果を返す

### Requirement 5: 容量管理と保存データ抑制
**Objective:** As a 拡張利用者, I want ローカル容量の制約内で安全に保存されること, so that 容量超過による予期しないデータ損失を避けられる

#### Acceptance Criteria
1. When 保存を要求する, the ローカルデータ基盤 shall 保存前後の使用量と既定10MB上限に対する状態を確認可能にする
2. When 使用量が設定済み警告閾値へ達する, the ローカルデータ基盤 shall 後続の表示層が警告できる識別可能な状態を返す
3. If 保存によって利用可能容量を超える見込みである, the ローカルデータ基盤 shall 書き込みを拒否し既存データを保持する
4. The ローカルデータ基盤 shall 生HTMLおよび商品画像を保存契約として受け付けない
5. The ローカルデータ基盤 shall 無制限ストレージ権限を前提としない

### Requirement 6: 信頼境界と安全なアクセス
**Objective:** As a 拡張利用者, I want 保存領域が未信頼コンテキストから隔離されること, so that ページ由来データによる直接改変を防げる

#### Acceptance Criteria
1. The ローカルデータ基盤 shall 保存領域へのアクセスを信頼済み拡張コンテキストに限定する
2. If ページ由来データまたはcontent script由来メッセージを受け取る, the ローカルデータ基盤 shall 未信頼入力として検証が完了するまで永続化しない
3. The ローカルデータ基盤 shall content scriptへ保存領域の直接操作手段を公開しない
4. If 許可されていない呼び出し元が保存操作を要求する, the ローカルデータ基盤 shall 操作を拒否し永続状態を変更しない

### Requirement 7: 保存ルート置換と保守操作
**Objective:** As a バックアップ復元機能の開発者, I want 保存ルートを安全に評価・置換できる保守契約, so that 復元中の競合や不完全な置換を防げる

#### Acceptance Criteria
1. When 保存ルートの置換候補を受け取る, the ローカルデータ基盤 shall 永続状態を変更せずに契約適合性、参照整合性、スキーマ対応状況、必要容量を評価する
2. When 評価済みの置換を要求する, the ローカルデータ基盤 shall 保存ルート全体を単一の成功または失敗として置換する
3. If 置換の検証または保存が失敗する, the ローカルデータ基盤 shall 置換前の有効な保存ルートを保持し識別可能な失敗結果を返す
4. While 保守操作が有効である, the ローカルデータ基盤 shall 保守操作の所有者以外からのすべての保存要求を一貫して拒否する
5. If 保守操作の所有権または世代が変更された後に以前の所有者が保存を要求する, the ローカルデータ基盤 shall その要求を拒否し永続状態を変更しない
6. If バックグラウンド処理が中断または再生成される, the ローカルデータ基盤 shall 保守操作の有効性をメモリ状態だけで判定せず、競合する保存を許可しない
7. When 保守操作が正常終了または明示的に中止される, the ローカルデータ基盤 shall 後続の保存要求が再開可能な状態を返す
8. When 信頼済み拡張contextが保守状態を監視する, the ローカルデータ基盤 shall 検証済みのgeneration・revision・active状態をread-only snapshotおよび変更通知として提供する
9. If 現在の保存ルートが破損または未対応バージョンである, the ローカルデータ基盤 shall その保存ルートを正常値として公開せず、破損と未対応バージョンを識別可能な失敗結果として返す
10. When 現在の保存ルートが破損または未対応バージョンであり、回復用の置換候補を受け取る, the ローカルデータ基盤 shall 現在の保存ルートを変更せずに候補の契約適合性、参照整合性、スキーマ対応状況、必要容量を評価する
11. If 回復用の置換候補が不正、未対応バージョン、または容量超過である, the ローカルデータ基盤 shall 現在の保存ルートを変更せず、現在ルートの異常と候補の拒否理由を区別可能な失敗結果を返す
12. When 利用者の明示操作を受けた復元機能が評価済みの回復用置換を要求する, the ローカルデータ基盤 shall 保守操作の所有権、世代、および評価後の保存状態を再確認してから、候補を一回の原子的な保存結果として適用する
13. If 評価後に候補、保存状態、保守操作の所有権、または世代が変化する, the ローカルデータ基盤 shall 回復用置換を拒否し、置換前の保存ルートを変更しない
14. When 回復用置換が成功する, the ローカルデータ基盤 shall 回復した保存ルートを通常の検証付き取得および変更操作で利用可能にする
15. The ローカルデータ基盤 shall バックアップ復元機能に対し、正常な保存ルートの評価・保守・全体置換と、破損または未対応ルートの評価・回復保守・全体置換を一つの用途限定契約として提供する
16. The ローカルデータ基盤 shall バックアップ復元用の用途限定契約から通常CRUD、未検証の保存ルート、保存adapter、排他制御、および内部write authorityを操作可能にしない
17. When production runtime contributionの初期化が成功する, the ローカルデータ基盤 shall 通常feature向けの操作能力とバックアップ復元向けの置換・回復能力を分離し、信頼済みのcomposition ownerが後者をbackup-restoreだけへ提供可能にする

### Requirement 8: 基盤の検証可能性
**Objective:** As a 拡張保守者, I want 実サイトデータに依存しない自動検証, so that 公開可能な形で基盤の品質を継続確認できる

#### Acceptance Criteria
1. When 基盤テストを実行する, the ローカルデータ基盤 shall 架空の商品、プロジェクト、構成データだけで主要契約を検証する
2. The ローカルデータ基盤 shall CRUD、入力拒否、破損読取、未知バージョン拒否、容量不足、移行成功、移行失敗、アクセス拒否、参照修復、競合拒否、正常ルート置換、破損または未対応ルートからの回復用置換、およびbackup専用能力から通常CRUD・未検証root・保存adapter・排他制御へ到達できないことを自動検証可能にする
3. The ローカルデータ基盤 shall 実サイト由来のHTML、画像、取得商品データをテスト資産として必要としない

### Requirement 9: 製品adapterと共有data operation error境界

**Objective:** As a PC Build Planner feature developer, I want PC固有の保存policyと共有data operation errorを一つの公開境界から利用したい, so that generic packageや候補管理featureへ製品責務を重複させず既存挙動を維持できる

#### Acceptance Criteria
1. When PC Build Plannerが汎用local data packageを構成する, the ローカルデータ基盤 shall 現行のPC root、schema version、validator、migration、reference repair、mutation operationを製品policyとして設定する
2. The ローカルデータ基盤 shall 汎用packageの公開入口だけを利用して製品adapterを構成し、package内部moduleへ依存しない
3. When 製品adapter経由で既存のread、mutation、replacement、maintenance、recovery操作を実行する, the ローカルデータ基盤 shall 保存schema、revision、repair、atomicity、fencing、認可、および失敗結果の意味を変更しない
4. The ローカルデータ基盤 shall data operationの失敗を候補管理featureに属さない共有`AppDataError` vocabularyとして公開する
5. When 低位`FoundationError`を共有errorへ変換する, the ローカルデータ基盤 shall 各error種類、意味、粒度、および利用側が判定する文脈を一対一に保持する
6. If 未知の低位error値または不完全なerror値を受け取る, the ローカルデータ基盤 shall 既知の別errorへ推測で畳み込まずfail closedな型付き失敗として扱う
7. When 候補管理、現在構成、互換性、candidate source、または価格更新がdata operation errorを扱う, the ローカルデータ基盤 shall 共有公開入口から同じ`AppDataError`契約を利用可能にし、各consumerへ`FoundationError`、product adapter、またはcandidate-owned errorの再定義を要求しない
8. When backup-restoreが保存rootの評価、置換、回復、またはfinalizationを要求する, the ローカルデータ基盤 shall 通常CRUDとraw rootと内部adapterを含まない用途限定runtime capabilityを提供する
9. When product local-data adapterまたはPC policyだけが変更される, the ローカルデータ基盤 shall 汎用packageの公開契約を変更せず製品ownerのcharacterization・consumer contractで影響を検証可能にする
10. If 汎用packageの公開契約またはgeneric error分類が変更される, the ローカルデータ基盤 shall product adapter、`AppDataError` mapping、候補管理、現在構成、互換性、candidate source、価格更新、backup-restoreの接続を再検証対象として識別する
