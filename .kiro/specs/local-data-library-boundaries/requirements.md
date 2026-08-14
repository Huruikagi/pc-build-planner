# Requirements Document

## Introduction

local data library boundariesは、PC Build Plannerから既に抽出され、synthetic fixtureで独立検証できる保存・排他・transaction・置換・backupの汎用primitiveをprivate workspace packageとして維持する。MVPでは実product runtimeをpackage factoryへ全面移行せず、3つの公開entry、製品非依存、deep import禁止、package単独検証を完成条件とする。

## Boundary Context

- **In scope**: 既存generic storage・lock port、revision・request dedupe・transaction、容量評価、atomic replacement primitive、Chrome storage・Web Locks・quota adapter、generic backup orchestration、3つのworkspace公開entry、package単独検証、synthetic public contract、deep import・逆依存gate。
- **Out of scope**: `LocalDataRoot`の具体schemaと意味、PCドメイン操作、具体migration・reference repair・worker認可・製品固有error、backup metadata・交換形式・file I/O・UI・project-context lifecycle、実product runtime composition、consumer固有maintenance fenceのpackage command化、generic recovery cleanup/finalization resumption、下流product contractの上流gate化、新規package API、保存schemaや交換形式の意味変更、Chrome以外のproduction adapter、npm公開、stable API宣言。
- **Adjacent expectations**: `local-data-foundation`は現行product-local runtime、PC固有root、validator、migration、repair、error mapping、maintenance/recovery controlとruntime compositionをcanonical ownerとして保持する。`backup-restore`は既存backup専用capability、PC固有交換形式、file I/O、利用者確認、UI、project-context連携を保持し、`application-shell`はproduction compositionと横断E2Eを保持する。本specは実`ProductLocalDataAdapter` composition、consumer固有fence command、recovery cleanup/finalization resumption、下流product contractの上流gate化を要求しない。これらの汎用化は2番目の実consumer evidenceが得られた時点で再発見する。

## Change Integration

- **Integrated Change Brief**: `mvp-local-data-simplification`
- **In-scope trace**: 抽出済みtransaction・capacity・replacement primitiveの維持はRequirements 1–4、Chrome adapterはRequirement 6、backup orchestrationはRequirement 5、3公開entry・synthetic contract・package単独validation・deep import gateはRequirement 7で扱う。
- **Out-of-scope preservation**: 実`ProductLocalDataAdapter` composition、consumer-owned maintenance fenceのpackage command化、generic recovery cleanup/finalization resumption、下流product contractの上流gate化、新しいpackage API追加を要求しない。packageの製品非依存、3公開entry、既存transaction/Chrome/backup primitive、synthetic consumer、MV3/CSP、deep import禁止は維持する。

## Requirements

### Requirement 1: 製品非依存のlocal data契約

**Objective:** As a ローカルファースト製品の開発者, I want 保存対象と製品policyを設定できる汎用契約, so that PCドメインやplatform APIを持ち込まず安全な永続化mechanismを再利用できる

#### Acceptance Criteria

1. When consumerが保存対象、初期値、検証、移行、変更、参照修復のpolicyを設定する, the local data library shall consumer固有のroot型を保持した読取・変更契約を提供する
2. The local data library shall 保存対象の具体field、PCパーツカテゴリ、製品固有識別子、または製品固有schema versionを汎用契約へ固定しない
3. The local data library shall platform固有のstorage値、lock値、quota例外を公開結果へ漏らさず、安定した汎用成功結果またはerror分類として返す
4. The local data library shall schema vendorのinstance、error class、locale、または動的検証設定を公開契約へ含めない
5. When consumerが製品固有errorを必要とする, the local data library shall consumerが明示したerror adapterを通してpolicy errorの種類、payload、判定contextを出力errorへ意味不変に写像できる
6. If consumerが未検証の保存値を読み取る, the local data library shall consumerが設定した検証と移行を通過するまで正常なrootとして公開しない
7. If policy errorがdecode、migration、mutation、repair、またはvalidationで返される, the local data library shall そのerrorをstage名だけの汎用分類へ縮退させずconsumerのerror adapterへ渡す
8. If consumerのerror adapterがpolicy errorを出力errorへ写像できない, the local data library shall 成功または別の既知errorとして処理を継続しない

### Requirement 2: 競合に強い原子的transaction

**Objective:** As a local data consumer developer, I want 全writerが同じtransaction規則に従うこと, so that 同時操作やruntime再生成でも更新消失と中間状態を防げる

#### Acceptance Criteria

1. When mutationが要求される, the local data library shall 排他取得後に最新の保存状態を読み、検証、変更、容量判定、単一commitを一つのtransaction結果として扱う
2. When mutationが成功する, the local data library shall revisionを単調に進め、consumerが成功結果と適用後revisionを識別できるようにする
3. If mutationの期待revisionが最新状態と一致しない, the local data library shall 変更を適用せず識別可能な競合結果を返す
4. When 同じrequest IDと同じ内容の要求が安全に再試行される, the local data library shall 同じ変更を重複適用しない
5. If 同じrequest IDが異なる内容に再利用される, the local data library shall 変更を適用せずrequest競合として返す
6. If 検証、移行、修復、容量判定、lock取得、または保存が失敗する, the local data library shall 成功を報告せず既存の有効データを保持する
7. If runtime processがtransaction間で再生成される, the local data library shall process memoryだけをrevision、dedupe、maintenance、または排他の正しさの根拠にしない

### Requirement 3: 容量管理とplatform error正規化

**Objective:** As a consumer developer, I want 保存先ごとの差を共通結果として扱えること, so that 容量不足や一時的なplatform障害で既存データを壊さず案内できる

#### Acceptance Criteria

1. When 保存候補が評価される, the local data library shall 現在使用量、候補適用後の見込み使用量、警告閾値、利用可能上限をconsumerが判定可能な結果として返す
2. When 見込み使用量が設定済み警告閾値へ達する, the local data library shall 書き込み成功可否と区別できるwarning状態を返す
3. If 見込み使用量が利用可能上限を超える, the local data library shall commit前に書き込みを拒否し既存データを保持する
4. If platformが実書き込みを容量不足として拒否する, the local data library shall 成功を報告せず汎用容量errorへ正規化する
5. If storageまたはlock operationが利用不能になる, the local data library shall 未知の例外値を公開せず安定した汎用error分類を返す
6. The local data library shall 無制限容量または特定製品の固定容量を汎用coreの前提にしない

### Requirement 4: 評価済みroot置換とmaintenance fencing

**Objective:** As a 保守operation developer, I want root全体を事前評価後に一度だけ置換できること, so that 復元や移行中の競合と部分置換を防げる

#### Acceptance Criteria

1. When root置換候補が渡される, the local data library shall 永続状態を変更せず、検証、移行、参照policy、容量を適用した評価結果とopaque ticketを返す
2. When 有効な評価ticketによる置換が確定される, the local data library shall 候補root全体を単一の成功または失敗としてcommitする
3. If 評価後に候補、保存状態、root内maintenance判定、期待revision、またはowner-provided recovery protocolのopaque capabilityが無効になる, the local data library shall staleな置換を拒否し既存rootを変更しない
4. While maintenanceまたはrecovery fenceがactiveである, the local data library shall fence所有者以外のmutationと競合する置換を一貫して拒否する
5. If runtime processが再生成される, the local data library shall process memoryへ依存せず、consumerが永続状態から再構成したopaque recovery capabilityと保存済みrevisionに基づいてactive fenceを再判定する
6. When maintenanceが正常終了または明示的に中止される, the local data library shall 後続mutationが再開できる状態を返す
7. If 現行rootが破損または未対応版である, the local data library shall 現行rootを正常値として公開せず、明示された回復候補だけを副作用なしで評価可能にする

### Requirement 5: 再利用可能なbackup orchestration

**Objective:** As a backup機能の開発者, I want 製品交換形式とUIを持ち込まずbackupとrestoreのprotocolを再利用できること, so that preflightからcommit後cleanupまでデータ保全規則を一貫させられる

#### Acceptance Criteria

1. When consumerが検証済みsnapshot、交換形式mapper、serializer、時刻、file命名policyを設定してbackup作成を要求する, the backup orchestration shall 製品固有metadataを解釈せずartifactまたは分類済み失敗を返す
2. When consumerが未信頼のrestore入力を渡す, the backup orchestration shall consumerが設定したdecode、version変換、mappingとlocal data評価を順に完了するまでcommitを許可しない
3. When restore preflightが成功する, the backup orchestration shall preview用summaryとopaque assessment ticketを返し、candidate、raw root、lock、fenceの内部値を公開しない
4. When consumerが利用者確認済みの有効ticketをcommitする, the backup orchestration shall 正常root置換または異常root回復の期待modeを保持した一回のcommit結果を返す
5. If commit前の既存primitiveがcleanup未完了を検出する, the backup orchestration shall root未変更を示す分類済み失敗を返す
6. The backup orchestration shall consumer固有recovery cleanupまたはfinalization resumptionをMVPの新しい公開契約として要求しない
7. While PC Build Plannerが唯一の実consumerである, the backup orchestration shall product-local recovery capabilityの再実装をpackage completion条件にしない
8. The backup orchestration shall backup metadataの具体内容、PCドメインの交換entity、file chooser、download、利用者向け確認文言、UI state、project-context lifecycleを汎用契約へ固定しない

### Requirement 6: Chrome adapterと製品境界の分離

**Objective:** As a PC Build Planner maintainer, I want Chrome adapterの公開境界を製品policyから分離したい, so that 製品adapterを本libraryで実装せずplatform能力を独立検証できる

#### Acceptance Criteria

1. When Chrome runtimeでlocal data libraryが構成される, the Chrome adapter shall storage read/write、使用量・quota、信頼済みcontext制限、storage変更通知を汎用portへ適合させる
2. When Chrome runtimeで排他が要求される, the Chrome adapter shall 同じ保存rootを扱う全writerを共通のexclusive lock identityで直列化する
3. If Chrome APIが例外または不正な応答を返す, the Chrome adapter shall platform値を漏らさず汎用storage、capacity、access、またはlock errorへ正規化する
4. The platform-independent local data core shall Chrome API、DOM、React、runtime message、PCドメイン型へruntime依存または型依存を持たない
5. When synthetic public contractがpackage rootを検証する, the workspace shall consumer-owned root、policy error、出力error、root maintenance control、persistent recovery controlを別々の型としてfactoryへ接続できることを確認する
6. When synthetic public contractがbackup subpathを検証する, the workspace shall 製品codecに相当するconsumer型を入力として接続できても製品交換形式、mapping、policy、adapter実装をpackage成果物へ取り込まない
7. If package sourceまたはpackage testが製品composition、製品adapter、またはE2Eを直接所有しようとする, the workspace validation shall 境界違反として成功させない
8. When package declarationが生成される, the workspace shall 既存transaction・replacement・Chrome・backup契約を3つの宣言済みentryだけから解決できるようにする

### Requirement 7: Private workspace公開境界と変更影響検証

**Objective:** As a repository maintainer, I want libraryの公開面と検証範囲を再現可能にしたい, so that 汎用mechanism変更と製品policy変更の影響を区別できる

#### Acceptance Criteria

1. When workspace consumerがlocal data能力を利用する, the workspace shall 宣言されたpackage公開入口だけから必要な型とruntime能力を解決する
2. If consumerがpackage内部moduleをdeep importする, the workspace validation shall その依存を拒否する
3. The workspace shall core、Chrome adapter、backup orchestrationの依存方向を機械検証し、generic coreからChrome、React、PCドメイン、製品schemaへの逆依存を拒否する
4. While 2番目のconsumerが存在しない, the workspace shall 抽出境界をprivateかつ外部stable API未宣言として扱い、package数を成果条件として固定しない
5. When local data coreが単独検証される, the workspace shall app sourceを同時実行せず型、transaction、競合、容量、置換、fencingを架空fixtureだけで検証する
6. When Chrome adapterが単独検証される, the workspace shall Chrome実体を起動せずstorage、quota、access制限、変更通知、lockのcontractを決定的に検証する
7. When backup orchestrationが単独検証される, the workspace shall 製品交換形式やUIを必要とせずpreflight、ticket、commit、cleanup、finalizationを架空fixtureだけで検証する
8. When workspaceのtopological buildが実行される, the workspace shall library成果物をconsumerより先にbuildし、consumerが公開成果物だけを解決できる状態にする
9. When generic contractまたはruntime mechanismが変更される, the workspace validation shall package単独検証、公開consumer contract、synthetic app contract、boundary gateを実行する
10. When PC Build Planner固有schema、migration、repair、交換形式、adapter、composition、またはUIだけが変更される, the workspace validation shall package公開契約へ影響しない限り製品ownerの検証へ委譲できる
11. If package単独検証、consumer contract、synthetic app contract、topological build、またはboundary gateのいずれかが失敗する, the workspace validation shall 成功として完了しない
12. While PC Build Plannerが唯一の実consumerである, the workspace validation shall 実product runtime compositionまたはconsumer固有recovery/finalization contractをpackage completion gateとして要求しない
