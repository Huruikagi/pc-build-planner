# Design Document

## Overview

本機能は、後続featureが共有するバージョン付きPCドメイン契約、canonical `Result<T, E>`、実行時検証、具体migration・reference repair、および全mutationを統制する用途別runtime capabilityを提供する。Chrome 116以降で読み込める最小Manifest V3骨格と開発基盤を維持し、保存値、runtime message、JSON由来の`unknown`を信頼境界で検証する。MVPでは現行product-local single-root transaction/replacement/recovery runtimeをcanonical compositionとして維持し、`@pc-build-planner/local-data`への全面移行は行わない。

保存は単一の`LocalDataRoot`を業務データの整合性単位とする。現行runtimeはPC固有schema、migration、repair、operation、低位`FoundationError` mapping、容量判定、保守fencing、root置換を同じ固定Web Lockとsingle write authorityの下で構成する。共有service workerとroot compositionは`application-shell`が所有し、本仕様は通常feature向けdata port、backup-restore向けreplacement capability、共有`AppDataError`だけを公開する。

### Goals
- 下流specへ一つの型安全・実行時検証可能なデータ契約を提供する
- すべての永続化mutationを単一authorityへ集約し、参照不整合とlost updateを防ぐ
- worker再生成後も有効なmaintenance fencing、移行、原子的root置換を提供する
- 現行schema versionを一つの公開正規値に集約し、破損・未対応版rootから明示的に回復できる
- 10MB制約、最小権限、MV3 CSPを自動検証可能にする
- 現行product-local runtimeをcharacterizationで固定し、共有`AppDataError`を単独所有する

### Non-Goals
- side panel、管理画面、typed navigation、root runtime composition
- 商品抽出、候補編集、構成選択、互換性判定の業務規則
- JSONファイルI/O、同期、バックエンド、Chrome以外のadapter
- 回復候補の選択、利用者確認、回復後の画面遷移、および自動初期化・自動破棄
- package factoryへの実product runtime全面移行、generic maintenance/recovery resumption、新規package API、npm公開

## Change Integration

- **Integrated Change Brief**: `mvp-local-data-simplification`
- **In-scope trace**: PC root/schema/validation/migration/repairと現行runtimeは既存components、共有error vocabulary/mapping/public exportは`AppDataErrorMapper`と`src/domain/public.ts`、用途別runtime capabilityは`RuntimeContributionFactory`、runtime characterization commandは`ProductRuntimeCharacterization`、変更種別別検証はTesting Strategyとtask 10–12へ反映する。
- **Out-of-scope preservation**: package factoryへの全面移行、`TransactionCommand`変更、generic maintenance fence、generic recovery cleanup/finalization resumption、新規package APIを設計しない。保存schema、schema version、data意味、`FoundationError`の種類・意味・粒度、single write authority、固定Web Lock、atomicity、revision/dedupe、maintenance/recovery fencing、repair、worker認可、raw root非公開を維持する。

## Boundary Commitments

### This Spec Owns
- `manifest.json`の最小MV3・Chrome 116・storage権限・CSP契約とTypeScript/build/test基盤
- 共通ドメイン型、ID・UTC日時、schema version、canonical `Result<T, E>`、runtime validator
- `CURRENT_SCHEMA_VERSION`の唯一の正規値と、保存・置換評価・交換形式が参照する公開契約
- PC固有root/schema/validator/migration/reference repair/mutation operationとschema正規値
- 現行product-local runtimeへPC policyを構成し、既存`FoundationError`の意味を維持するproduct-local adapter境界
- 低位`FoundationError`の種類・意味・粒度を一対一で保持する共有`AppDataError` vocabulary、mapping、`src/domain/public.ts`からの公開export
- 単一write authorityのcommand contract、worker registration factory、revision/request-id競合制御
- foundation不変条件としてのCurrentBuild参照修復、project削除時の所属candidate・CurrentBuildカスケード削除、root評価・置換、maintenance generation/owner fencing
- 異常rootの分類とraw fingerprint、回復候補評価、root外の最小RecoveryControl、評価済み回復置換
- 正常root置換と異常root回復のcommit point、opaque finalization ticket、finalize-only retryを束ね、通常CRUDと内部primitiveを公開しない`BackupRestoreDataPort`
- 信頼済みconsumer向けの検証済みread-only maintenance snapshot/subscribe portと変更検出adapter
- canonical PC runtime policyと現行product-local componentsをfoundation内で構成し、用途別data port、maintenance source、worker registrationを一度だけ組み立てる引数なしproduction runtime contribution factory
- 現行product-local production graphのerror/control semanticsとruntime invariantを固定する`ProductRuntimeCharacterization`、およびroot command `validate:local-data-product-contract`

### Out of Boundary
- `src/index.ts`、`src/runtime/service-worker.ts`、side panel host、feature registryのcomposition（`application-shell`所有）
- runtime sender/tab/URLの業務別認可、ページDOM・content script payloadの意味解釈
- 候補の選択数、編集権限、互換性、表示文言などfeature固有規則
- backup JSON envelopeとファイル選択・download/upload（`backup-restore`所有）
- 回復候補の提示、利用者の明示確認、回復成功後の利用者向け導線（`backup-restore`所有）
- `chrome.runtime.onMessage` adapter、sender metadataのplatform判定、listener登録・解除、side panel/service workerのstart/stop（`application-shell`所有）
- 表示言語などドメイン外の利用者インターフェース設定の保存・整合性・容量管理（`ui-internationalization`が`localDataRoot`外の専用キーで所有。下記Allowed Dependenciesの例外を参照）
- generic storage・lock・transaction・capacity・replacement mechanism、Chrome adapter、generic backup orchestration（`local-data-library-boundaries`所有）
- 実product runtimeのpackage factory全面移行、consumer固有maintenance fenceのgeneric command化、generic recovery cleanup/finalization resumption（2番目の実consumerまで延期）
- candidate/current-build/compatibility/candidate-source/source-price-refresh固有の業務処理とerror表示、およびbackup-restore固有のexchange codec・mapping・policy・`BackupService` / `RestoreService` facade（各下流owner所有）

### Allowed Dependencies
- `@pc-build-planner/local-data`の抽出済みprimitiveと3公開entryは独立した上流成果として利用できるが、現行runtimeをpackage factoryへ移すことは依存条件にしない。package内部moduleへのdeep importは禁止する
- Chrome 116以降のManifest V3、`crypto.randomUUID()`、標準JSON/Web API。productionの`chrome.storage.local`とWeb Locksへの直接到達は現行product-local Chrome adapter内部に限定し、独立package側adapterの到達はpackage内部に閉じる
- Node.js 26、pnpm 11、Biome 2、および実装開始時に互換性確認して固定するTypeScript/build/test/Chrome typings
- `application-shell`はfoundationのproduction runtime contribution factoryだけを公開入口から利用し、返されたworker registrationとmaintenance sourceをcompositionする。foundationからshellへimportしない
- production factoryは現行product-local adapterからstorage/change/lock portを取得し、application-shellからplatform primitiveを構築・注入させない
- package公開contractを利用する場合も抽出済みprimitiveの範囲に限定し、product-local maintenance/recovery controlをgeneric protocolへ昇格させない
- featureは公開portだけを利用し、`chrome.storage`、adapter内部、他feature内部へ直接依存しない
- 通常UI featureは`FoundationScopedDataPort`だけを受け取る。`BackupRestoreDataPort`はbackup-restore compositionだけへ注入し、正常/異常rootの評価、commit point付き置換、opaque ticketによるfinalize-only retryだけを公開する。通常CRUD、raw root、Storage、lock、fence、Repository、内部write authorityを公開しない
- **明示的な例外**: `src/ui-language/preference-store.ts`（`ui-internationalization`所有）は`chrome.storage.local`の専用キー`uiLanguage`1つに限定して直接読み書きしてよい。表示言語はプロジェクト・候補パーツ・現在構成のいずれにも属さないドメイン外の利用者設定であり、`localDataRoot`へは一切触れず、単一write authorityが統制する対象（バージョン付きroot、参照整合性、maintenance fencing、交換形式、容量監視）に加わらない。この例外は到達点を2ファイル（本adapterと`preference-store.ts`）に限定する機械検査（`ui-internationalization`が追加する`scripts/validate-boundaries.mjs`のStorageAccessGuard規則）で固定され、それ以外からの`chrome.storage`直接利用は引き続き拒否される

### Revalidation Triggers
- `LocalDataRoot`、category、normalized attribute、`Result`、error codeの形状変更
- revision、request ID、参照修復、migration、replacement tokenの意味変更
- maintenance generation/owner/lease、commit前fence、write authority routingの変更
- root write lock名、`RootWriteLock`契約、またはWeb Locks APIを使わない排他方式への変更
- storage key分割、quota前提、Storage API以外への移行、runtime registration契約の変更
- production runtime contributionのglobal platform解決、公開handle、caller policy、初期access restriction、cleanup責務の変更
- recovery control key、raw root fingerprint、回復owner/generation、回復用評価cursor、commit outcomeまたはfinalization ticketの変更
- `chrome.storage`直接到達を許可される例外ファイルの追加・変更（現在は`src/persistence/chrome-storage-adapter.ts`と`src/ui-language/preference-store.ts`の2ファイルに限定）、またはドメイン外設定が`localDataRoot`・交換形式・容量監視の対象へ混入する変更提案
- packageの`LocalDataPolicy`、公開error分類、Chrome port、replacement ticket、export mapの変更
- packageの公開transaction/replacement primitive変更、または2番目consumer出現に伴うgeneric maintenance/recovery protocol再設計
- `FoundationError`または`AppDataError`の種類・意味・粒度・一対一mappingの変更
- `ProductLocalDataAdapter`の公開capability shape変更。この場合はcandidate/current-build/compatibility/candidate-source/source-price-refresh/backup-restoreを再検証する
- `validate:local-data-product-contract`のcommand名、現行runtime characterization対象、failure propagation変更

## Architecture

### Existing Architecture Analysis

既存実装にはPC domain contract、validator、migration、reference repair、StoragePort、Chrome/in-memory adapter、capacity・transaction・replacement mechanismが同じ`src/persistence`境界にあり、single-root transactionと正常/回復runtimeが稼働している。上流`local-data-library-boundaries`にはgeneric primitiveとChrome/backup adapterが抽出済みだが、MVPではproduct固有maintenance/recovery semanticsをpackage factoryへ再構成しない。本仕様は現行runtimeをcanonical ownerとしてcharacterizationし、低位errorを`AppDataError`へ一対一写像する。foundation所有のroot service workerと`src/index.ts`は引き続き除外し、application shellとの共有所有を作らない。

### Architecture Pattern & Boundary Map

```mermaid
graph LR
    Feature[Feature consumers] --> Ports[Foundation scoped data port]
    Feature --> AppError[App data error]
    Backup[Backup restore] --> BackupPort[Backup restore data port]
    Shell[Application shell] --> Registration[Worker registration]
    Shell --> Factory[Runtime contribution factory]
    Factory --> Registration
    Factory --> Snapshot[Maintenance snapshot]
    Factory --> ProductRuntime[Product local runtime]
    Registration --> Authority[Write authority]
    Ports --> Authority
    BackupPort --> Authority
    ProductRuntime --> Validator[PC root validator]
    ProductRuntime --> Migration[PC migration]
    ProductRuntime --> Repair[PC reference repair]
    ProductRuntime --> Mapping[Foundation error mapping]
    Mapping --> AppError
    ProductRuntime --> Storage[Chrome storage local]
    ProductRuntime --> WebLocks[Web Locks API]
```

- **Selected pattern**: product-local single-root runtime。PC domain policy、transaction/replacement/recovery、共有app errorを製品境界に残し、抽出済みpackage primitiveは独立成果として維持する。
- **Dependency direction**: `PC domain types → PC validation/migration/repair/error mapping → product-local transaction/replacement/recovery → RuntimeContributionFactory → ProductRuntimeCharacterization / Shell composition`。packageからroot `src/`への逆依存とpackage内部へのdeep importを禁止する。
- **Root ownership**: foundationは登録factoryを公開し、application shellだけが具体service workerへ登録する。
- **Linearization boundary**: 現行product-local runnerが全writerを同一名のexclusive Web Lockで直列化する。package migrationの有無にかかわらずこのidentityとsingle write authorityを変更しない。
- **Restart boundary**: Web Lockはworker終了時に失われる一時的な排他である。generation、owner、lease、revisionを含む永続rootだけを再生成後の認可根拠とし、新workerはlock取得後に必ずrootを再読込する。
- **Atomicity boundary**: 一つのstorage keyに一つのrootを保存し、候補変更、project削除カスケード、参照修復、検証、revision更新、maintenance state更新を一回の`set`へまとめる。これは協調writer間の論理的一括commitであり、Chrome crash時のdurable transaction保証は主張しない。
- **Recovery boundary**: 正常decode不能なrootは公開せず、raw bytes相当のcanonical fingerprintと`corrupt-data`または`unsupported-version`だけを扱う。`RecoveryControl`は別keyにgeneration、owner、lease、active、candidate digest、期待commit revisionを保持し、全writerが同じWeb Lock内で確認する。回復rootのwriteを先、control releaseを後に行う。write後に中断した場合はactive controlと期待commit identityを残して安全側に停止し、root再置換不能なopaque finalization ticketだけを返す。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|---|---|---|---|
| Language | TypeScript 7.0.2 | strict domain/runtime contracts | Node 26.5.0とChrome 116互換、`any`禁止 |
| Build | esbuild 0.28.1 | MV3同梱artifact生成 | remote codeとinline scriptなし |
| Test | test runner + DOM不要のin-memory adapter | unit/contract/integration | versionsは導入時に固定 |
| Data | `chrome.storage.local` Chrome 116+ | 単一root永続化、bytes取得 | 10MB、`unlimitedStorage`なし |
| Concurrency | Web Locks API Chrome 116+ | 協調writerのroot read-check-write排他 | 永続ownershipには使用しない |
| Runtime | Manifest V3 | 最小unpacked extension骨格 | shared worker compositionはshell所有 |

## File Structure Plan

```text
src/
├── domain/
│   ├── result.ts                              # canonical app Resultと既存FoundationError
│   ├── app-data-error.ts                      # 共有AppDataError vocabularyと一対一mapping
│   ├── model.ts                               # Project、CandidatePart、CurrentBuild、LocalDataRoot
│   ├── validation.ts                          # PC rootとcandidate入力のruntime validation
│   └── public.ts                              # domain契約とAppDataErrorの公開入口
└── persistence/
    ├── schema.ts                              # CURRENT_SCHEMA_VERSION、root/control key
    ├── migration-registry.ts                  # PC固有NからN+1 migration
    ├── reference-repair-policy.ts             # CurrentBuild修復とproject削除cascade
    ├── product-local-data-adapter.ts           # 完了済みpackage policy adapter（MVP runtime移行には使用しない）
    ├── runtime-contribution.ts                 # 現行product-local graphから用途別runtime handleを構成
    ├── worker-registration.ts                  # shell向けworker認可とhandler registration
    └── public.ts                              # 通常data portとbackup用途限定capability
tests/
├── domain/app-data-error.test.ts              # FoundationErrorとの全種類一対一mapping
├── persistence/product-local-data-adapter.contract.test.ts # PC policy/error/controlとpackage public factoryの接続
├── persistence/product-local-data-runtime.contract.test.ts # 現行production runtimeのcharacterization
├── persistence/foundation-characterization.test.ts # schema・repair・atomicity・fencing保持
├── persistence/runtime-contribution.test.ts   # 用途別capabilityとworker認可
└── tooling/
    ├── local-data-product-consumer.ts          # 製品公開contract fixture
    ├── local-data-product-contract-command.test.ts # canonical commandの終了status/failure伝播
    └── public-boundaries.test.ts               # package deep import・raw capability・旧error owner拒否
scripts/
└── validate-local-data-product-contract.mjs    # foundation所有contract testだけを実行するroot command本体
packages/local-data/                             # upstream所有、参照は宣言済みpackage exportのみ
├── src/index.ts                                 # `@pc-build-planner/local-data`
├── src/contracts.ts                             # generic storage/lock/policy/error port
├── src/capacity.ts                              # CapacityPolicy
├── src/transaction.ts                           # RootTransactionRunner相当のgeneric mechanism
├── src/fencing.ts                               # Maintenance/Recovery policy mechanism
├── src/replacement.ts                           # Replacement/Recovery coordination mechanism
└── src/chrome/
    ├── index.ts                                 # `@pc-build-planner/local-data/chrome`
    ├── storage-adapter.ts                       # PackageChromeAdapter
    └── web-locks-adapter.ts                     # PackageExclusiveLockPort adapter
```

### Modified Files
- `package.json` — foundation所有の`validate:local-data-product-contract`を現行runtime characterizationへ追加する。既存workspace参照は維持するがruntime移行の完了条件にしない。
- `scripts/validate-boundaries.mjs`、`tests/tooling/public-api-consumer.ts` — package deep import、製品adapterのpackage側所有、candidate-owned data error、backup専用portからの通常CRUD・raw root・内部adapter到達を拒否する。
- 既存`src/persistence`のstorage・lock・transaction・capacity・replacement・Chrome adapter実装はMVPのcanonical product runtimeとして維持する。抽出済みpackage primitiveとの重複は2番目consumerまで解消を要求せず、どちらからもpackage内部moduleへimportしない。

`src/index.ts`と`src/runtime/service-worker.ts`は本仕様では作成・変更しない。worker registrationの実体compositionは`application-shell`のfile boundaryで行う。

`validate:local-data-product-contract`のscript、対象test、fixture、diagnosticは本specがcanonical ownerとなる。このcommandは現行product-local runtimeだけをcharacterizationし、package単独validationの必須gateにはしない。package source/testは製品runtime、`FoundationError`、`MaintenanceState`、`RecoveryControl`をimportまたは再実装しない。

## System Flows

### 通常mutationと参照修復

```mermaid
sequenceDiagram
    participant Consumer
    participant Authority
    participant Runner
    participant Lock
    participant Pipeline
    participant Repair
    participant Store
    Consumer->>Authority: command requestId expectedRevision
    Authority->>Runner: execute root operation
    Runner->>Lock: acquire exclusive root lock
    Runner->>Store: read root
    Runner->>Store: read current bytes and runtime quota
    Runner->>Runner: migrate and validate snapshot
    Runner->>Pipeline: build candidate with capacity input
    Pipeline->>Repair: repair affected references
    Pipeline->>Pipeline: validate and estimate capacity
    Pipeline-->>Runner: candidate and receipt metadata
    Runner->>Runner: authorize fence and validate candidate
    Runner->>Store: set root with next revision
    Store-->>Runner: commit result
    Runner->>Lock: release root lock
    Runner-->>Authority: typed result
    Authority-->>Consumer: typed result
```

authorityは全write commandを`RootTransactionRunner`へ渡す。runnerだけが固定名のexclusive root lock、Storage read、migration、snapshot validation、candidateの最終validation、revision更新、単一writeを所有する。`MutationPipeline`はStorageへ依存せず、runnerから渡された現行snapshotから候補とreceipt metadataを作る。project削除では`ReferenceRepairPolicy`が同じprojectIdのcandidateとCurrentBuildをcandidate rootから除去し、全体検証後のrootだけをcommit候補にする。同じrequest IDの再試行は保存済み結果を返し、異なるpayloadでの再利用は`request-conflict`を返す。worker再生成後は新しいlock requestを開始し、旧メモリqueueを復元しない。

### root置換とmaintenance fencing

```mermaid
sequenceDiagram
    participant Backup
    participant Authority
    participant Runner
    participant Lock
    participant Evaluator
    participant Store
    Backup->>Authority: commit candidate and expected mode
    Authority->>Runner: execute maintenance acquire
    Runner->>Lock: acquire exclusive root lock
    Runner->>Store: persist generation owner lease
    Runner->>Lock: release root lock
    Authority->>Evaluator: assess replacement unknown root
    Evaluator-->>Backup: assessment token
    Authority->>Authority: replace token generation owner
    Authority->>Runner: execute replacement
    Runner->>Lock: acquire exclusive root lock
    Runner->>Store: read generation owner revision
    Runner->>Runner: migrate validate token candidate and fence
    Runner->>Runner: increment revision once
    Runner->>Store: set validated replacement
    Store-->>Runner: commit result
    Runner->>Lock: release root lock
    Runner-->>Authority: replaced or typed failure
    Authority-->>Backup: replaced or typed failure
    Authority->>Authority: release or issue finalization ticket
    Authority-->>Backup: committed outcome
```

assessment tokenは候補rootのdigest、target schema、必要bytes、評価時revisionを束ねる。置換時に再検証し、stale token、owner、generation、revisionのいずれかが不一致なら保存しない。backup専用portはacquire、再assessment、replace、cleanupを一つのprotocolとして隠蔽する。root write前の失敗だけを`Result`のerrorとし、root write後はcleanup成否にかかわらずcommitted outcomeを返す。control取得後かつroot write前にcleanupを完了できない場合は`precommit-cleanup-pending`を返し、control owner/generationをassessment ticketへ結び付けて保持する。同じticketの再送だけがcleanupを先に冪等再開し、cleanup中はroot writeを行わない。

異常rootからの回復では`BackupRestoreDataPort`の回復capabilityが同じ固定名Web Lock内でraw rootと`RecoveryControl`を読む。事前評価はcurrent anomalyとraw fingerprintをcursorへ保持し、候補のmigration・全体validation・容量評価を独立して行う。利用者確認後の`commit`はrecovery maintenance取得、再評価、candidate digest、raw fingerprint、control generation・owner・leaseの再照合を内部で完結する。一致した場合だけroot keyを一回writeする。root write前の失敗でcontrol releaseを完了できない場合、同じassessment ticketによる再commitは一致するowner/generationのcleanupをroot write 0件で先に再開し、cleanup後に最新raw fingerprintとcandidateを再評価する。別ticket、stale owner、期限切れleaseは暗黙再利用しない。成功直後もcontrolがactiveなら通常writeを停止したまま`committed-finalization-required`を返し、`finalize`が通常query確認とcontrol releaseだけを再試行する。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|---|---|---|---|---|
| 1.1 | Chrome 116でMV3起動 | ManifestContract、BuildPipeline、RuntimeContributionFactory | manifest、production contribution | build smoke |
| 1.2 | remote・動的・inline code禁止 | BuildPipeline | validate script | artifact scan |
| 1.3 | worker memory非依存 | RootTransactionRunner、MaintenancePolicy、RuntimeContributionFactory | Web Lock、durable cursor、再初期化 | 両flow |
| 1.4 | 最小権限 | ManifestContract | storage permission | manifest test |
| 2.1 | version付き共有契約 | DomainModel | domain public | root validation |
| 2.2 | 全category | NormalizedAttributeModel | category union | validation |
| 2.3 | 元表記と確認値の分離 | DomainModel | SourcedValue | validation |
| 2.4 | 欠損とcategory属性 | DomainModel、SchemaValidator | optional fields、attribute union | validation |
| 2.5 | IDと日時規約 | IdentifierPolicy | branded ID、UtcTimestamp | validation |
| 2.6 | 参照関係 | DomainModel、ReferenceRepairPolicy | root invariants | mutation flow |
| 2.7 | 取得元欠損と元表記snapshotの分離 | DomainModel、SchemaValidator | optional SourceInfo、SourceSnapshot | validation |
| 2.8 | ドメイン外の利用者インターフェース設定を保存ルート・交換形式へ含めない | DomainModel、SchemaValidator | root object shapeの固定keyと`unexpected-field`拒否 | validation |
| 3.1 | CRUD結果と永続化 | MutationPipeline、RootTransactionRunner、WriteAuthority、RuntimeContributionFactory | FoundationDataPort、worker registration | mutation flow |
| 3.2 | 保存前検証 | MutationPipeline、SchemaValidator | mutateRoot | mutation flow |
| 3.3 | 読取時検証 | LocalDataRepository、MigrationRegistry | readRoot | read flow |
| 3.4 | 破損をtyped failure化 | SchemaValidator | RepositoryError | read flow |
| 3.5 | 保存失敗時に既存値保持 | RootTransactionRunner、ChromeStorageAdapter | commit result | mutation flow |
| 3.6 | 安全な再試行 | WriteAuthority | requestId | mutation flow |
| 3.7 | 同一commitで参照修復 | ReferenceRepairPolicy、MutationPipeline | root mutation | mutation flow |
| 3.8 | 競合検出 | RootTransactionRunner、WriteAuthority | RootWriteLock、expectedRevision | mutation flow |
| 3.9 | project削除カスケード | ReferenceRepairPolicy、MutationPipeline | root mutation | mutation flow |
| 3.10 | UI向け参照・原子的変更だけのport | RuntimeContributionFactory、WriteAuthority | FoundationScopedDataPort | runtime contribution |
| 3.11 | ID・日時なし候補内容のcanonical検証 | SchemaValidator | validateCandidatePartContent、validateCandidatePartDraft | validation |
| 4.1 | root schema version | DomainModel | schemaVersion | read flow |
| 4.2 | 旧版の順序移行 | MigrationRegistry | toCurrent | read flow |
| 4.3 | 将来版を上書きしない | MigrationRegistry | unsupported-version | read flow |
| 4.4 | 移行失敗時source保持 | MigrationRegistry、StorageAdapter | migration-failed | read flow |
| 4.5 | from/to明示 | MigrationStep | migration contract | migration tests |
| 4.6 | 現行schema版の単一公開値 | SchemaContract | CURRENT_SCHEMA_VERSION | public contract |
| 4.7 | 保存・置換・交換形式の版一致 | SchemaContract、MigrationRegistry、ReplacementCoordinator | CURRENT_SCHEMA_VERSION | validation and replacement |
| 5.1 | 保存前後bytes状態 | CapacityPolicy、ChromeStorageAdapter | CapacityStatus | mutation flow |
| 5.2 | 警告閾値 | CapacityPolicy | capacity-warning metadata | mutation flow |
| 5.3 | quota超過拒否 | CapacityPolicy、StorageAdapter | quota-exceeded | mutation flow |
| 5.4 | HTML・画像拒否 | SchemaValidator | validation issue | validation |
| 5.5 | unlimitedStorage非依存 | ManifestContract | manifest | manifest test |
| 6.1 | trusted context限定 | StorageAdapter、RuntimeContributionFactory | restrictAccess | production initialization |
| 6.2 | 未信頼入力検証 | WorkerRegistration、SchemaValidator | unknown command decoder | mutation flow |
| 6.3 | content scriptへ直接APIなし | WorkerRegistration、import boundary | public ports | contract test |
| 6.4 | 不許可caller拒否 | WorkerRegistration | authorization result | contract test |
| 7.1 | 副作用なし置換評価 | ReplacementEvaluator | assessReplacement | replacement flow |
| 7.2 | root全体置換 | ReplacementCoordinator | commit outcome | replacement flow |
| 7.3 | 置換失敗時の既存root保持 | ReplacementCoordinator | replacement error | replacement flow |
| 7.4 | maintenance owner外write拒否 | MaintenancePolicy、RootTransactionRunner | fence、RootWriteLock | 両flow |
| 7.5 | stale owner・generation拒否 | MaintenancePolicy、RootTransactionRunner | MaintenanceCursor | replacement flow |
| 7.6 | worker再生成耐性 | MaintenancePolicy、RootTransactionRunner | persisted state、new lock request | restart test |
| 7.7 | 終了・中止後の再開 | MaintenancePolicy、RootTransactionRunner | finalize-only transition | replacement flow |
| 7.8 | 検証済み保守状態のread-only通知 | MaintenanceSnapshotSource、LocalDataRepository、RuntimeContributionFactory | getSnapshot、subscribe、production contribution | maintenance observation |
| 7.9 | 異常rootを正常値として公開しない | LocalDataRepository、RecoveryCoordinator | CurrentRootAnomaly | read and recovery flow |
| 7.10 | 異常rootを変更しない回復候補評価 | RecoveryCoordinator、ReplacementCoordinator | assessRecovery | recovery flow |
| 7.11 | current異常と候補拒否理由の分離 | RecoveryCoordinator | RecoveryAssessmentError | recovery flow |
| 7.12 | owner・generation再確認後の原子的回復 | RecoveryControlPolicy、RootTransactionRunner | commit / finalize | recovery flow |
| 7.13 | 候補・保存状態・owner・generation変化の拒否 | RecoveryCoordinator、RootTransactionRunner | RecoveryCursor、RecoveryFence | recovery flow |
| 7.14 | 回復後の通常操作復帰 | LocalDataRepository、WriteAuthority | query、mutate | recovery regression |
| 7.15 | backup向け正常置換・異常回復の単一用途契約 | BackupRestoreDataPort | assess / commit / finalize | both replacement flows |
| 7.16 | backup portから通常CRUD・内部primitiveを非公開 | BackupRestoreDataPort、RuntimeContributionFactory | capability facade | negative contract |
| 7.17 | production handleの用途別capability分離 | RuntimeContributionFactory | dataPort、backupRestoreDataPort | production initialization |
| 8.1 | 架空dataのみ | FoundationFixtures | fixture builders | all tests |
| 8.2 | 主要失敗・成功の自動検証 | FoundationFixtures | in-memory ports | all tests |
| 8.3 | 実サイトasset不要 | FoundationFixtures | synthetic values | artifact scan |
| 9.1 | PC policy設定 | ProductLocalDataAdapter | LocalDataPolicy | product adapter composition |
| 9.2 | package公開入口限定 | ProductLocalDataAdapter、BoundaryGate | package root / chrome export | public contract |
| 9.3 | 既存保存意味の保持 | ProductLocalDataAdapter、RuntimeContributionFactory | scoped data / replacement capability | characterization flow |
| 9.4 | 共有AppDataError | AppDataErrorMapper | domain public export | consumer contract |
| 9.5 | FoundationError一対一mapping | AppDataErrorMapper | mapFoundationError | error mapping |
| 9.6 | 未知errorのfail closed | AppDataErrorMapper | boundary validation failure | error mapping |
| 9.7 | 下流consumerの共有error利用 | AppDataErrorMapper、DomainPublicApi | AppDataError | consumer migration contract |
| 9.8 | backup用途限定capability | RuntimeContributionFactory、BackupRestoreDataPort | backupRestoreDataPort | replacement flow |
| 9.9 | 製品変更の局所検証 | ProductCharacterizationSuite | product contract | validation flow |
| 9.10 | package変更時の下流再検証 | BoundaryGate、ProductConsumerContract | validation scripts | validation flow |
| 9.11 | 現行product-local runtime invariant検証 | ProductRuntimeCharacterization | canonical runtime composition | characterization flow |
| 9.12 | foundation所有の再現可能な実行入口 | ProductRuntimeCharacterization、WorkspaceValidation | `validate:local-data-product-contract` | foundation validation route |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|---|---|---|---|---|---|
| BuildPipeline | Tooling | MV3 artifact生成と禁止コード検査 | 1.1–1.2 | Node.js P0 | Batch |
| IdentifierPolicy | Domain | branded IDとUTC日時を統一 | 2.5 | Web Crypto P1 | Service |
| NormalizedAttributeModel | Domain | category別確認済み属性を表現 | 2.2–2.4 | なし | State |
| DomainModel | Domain | 保存可能な共有modelと不変条件 | 2.1–2.8, 4.1 | なし | State |
| AppDataErrorMapper | Domain | FoundationErrorを意味・粒度不変の共有AppDataErrorへ写像 | 3.4, 9.4–9.7 | canonical Result P0 | Service |
| SchemaContract | Persistence contract | 現行schema版とstorage keyの正規値を公開 | 4.1, 4.6, 4.7 | DomainModel P0 | State |
| SchemaValidator | Domain | unknown root・command・候補draftをcanonical契約へ絞る | 2.1–2.8, 3.2–3.4, 3.11, 5.4, 6.2 | DomainModel P0 | Service |
| MigrationRegistry | Persistence | 旧schemaを純粋に連続移行 | 4.1–4.7 | SchemaValidator P0、SchemaContract P0 | Service |
| ReferenceRepairPolicy | Persistence | candidate変更によるbuild参照修復とproject削除カスケード | 3.7, 3.9 | DomainModel P0 | Service |
| CapacityPolicy | Persistence | bytesとquotaからwarning・拒否を純粋判定 | 5.1–5.3 | 直列化済みcapacity input P0 | Service |
| MutationPipeline | Persistence | 検証済みsnapshotからcommit候補を構築 | 3.1, 3.2, 3.7, 3.9, 5.1–5.3 | Validator P0、Repair P0、CapacityPolicy P0 | Service |
| MaintenancePolicy | Persistence | generation/owner/leaseの純粋状態遷移と認可 | 7.4–7.7 | SchemaValidator P0 | Service、State |
| MaintenanceSnapshotSource | Persistence adapter | 検証済みmaintenance cursorをread-onlyで公開 | 7.8 | LocalDataRepository P0、Storage change P1 | Service、State |
| RuntimeContributionFactory | Composition adapter | 現行product-local componentsから用途別foundation handleを一度だけ生成 | 1.1, 1.3, 3.1, 3.10, 6.1, 7.8, 7.10–7.17, 9.3, 9.8 | LocalDataRepository P0、RootTransactionRunner P0、WriteAuthority P0 | Service |
| ProductLocalDataAdapter | 非production adapter contract | package公開型へのPC policy適合を完了済み履歴として維持 | 9.1–9.3 | `@pc-build-planner/local-data` P2 | Service |
| ProductRuntimeCharacterization | Tooling / Integration | 現行product-local production graphのruntime invariantを一つのroot commandで固定 | 6.1, 7.4–7.17, 9.3, 9.5–9.6, 9.8–9.12 | RuntimeContributionFactory P0 | Batch |
| PackageTransactionPort | Upstream package | 抽出済みgeneric primitive（product runtime非接続） | 9.2 | package root export P2 | Service |
| PackageReplacementPort | Upstream package | 抽出済みgeneric replacement primitive（product runtime非接続） | 9.2 | package root export P2 | Service |
| BackupRestoreDataPort | Public capability | commit point付き正常置換・異常root回復とfinalize-only retryをbackupへ公開 | 7.1–7.17 | WriteAuthority P0、RecoveryCoordinator P0 | Service |
| WriteAuthority | Application adapter | 全writeをlock付きrunnerへdispatch | 1.3, 3.6, 3.8, 6.2–6.4 | RootTransactionRunner P0 | Service |
| PackageChromeAdapter | Upstream package | 抽出済みChrome adapter（product runtime非接続） | 9.2 | package chrome export P2 | Service |
| WorkerRegistration | Runtime adapter | shellへtyped handlerを提供 | 6.2–6.4 | WriteAuthority P0 | Service |
| ManifestContract | Runtime config | 最小MV3起動条件を宣言 | 1.1–1.4, 5.5 | Chrome 116 P0 | State |
| FoundationFixtures | Test | 架空dataだけで全契約を検証 | 8.1–8.3 | public ports P0 | Batch |

### Domain Layer

#### AppDataErrorMapper

`src/domain/app-data-error.ts`は候補管理featureから独立した共有`AppDataError`を所有する。各variantは既存`FoundationError`のcode、payload、利用側が判定するcontextを一対一で保持し、複数codeの統合、message文字列への縮退、粒度変更を行わない。`mapFoundationError`はtyped `FoundationError`に対するexhaustive mappingとする。境界で未知・不完全な値を受けた場合はmapping前の検証失敗としてfail closedにし、既知の`AppDataError`へ推測しない。`src/domain/public.ts`だけが型とmapperを公開する。

candidate-management、current-build、compatibility、candidate-source、source-price-refreshはこの公開入口をconsumer migration contractとして利用し、`ManagementError`または同等unionをdata operation errorのownerとして残さない。各feature固有のvalidationやworkflow errorは各ownerに残り、`AppDataError`へ吸収しない。

```typescript
type AppDataError = FoundationError extends infer E
  ? E extends FoundationError
    ? Readonly<E>
    : never
  : never;

function mapFoundationError(error: FoundationError): AppDataError;
```

#### SchemaContract

`src/persistence/schema.ts`は`CURRENT_SCHEMA_VERSION`を唯一の正規値として公開する。`createInitialRoot`、MigrationRegistry、ReplacementCoordinator、backup-restoreの交換形式はこの値をimportし、同じ数値を再定義しない。schema version値や保存構造自体は本変更で変えない。

#### DomainModel

`LocalDataRoot`は`schemaVersion`、`revision`、`projects`、`candidateParts`、`currentBuilds`、request dedupe記録、maintenance stateを持つJSON直列化可能なaggregateである。ProjectはcandidateとCurrentBuildの整合性境界であり、build itemは同じprojectのcandidateだけを参照する。

`CandidatePart`は`category`、欠損可能な共通商品値、任意の`sourceInfo`、任意の`sourceSnapshot`、category別`normalizedAttributes`を持つ。`sourceInfo`の取得URL・取得日時も個別に任意とし、存在しない取得情報を既定値で補わない。`sourceSnapshot`はfield名から元表記または明示的な欠損（`null`）へのread-only mapとし、`SourcedValue`の確認値や`sourceInfo`の代用にしない。HTML、画像binary、data URLを型契約へ含めない。

#### SchemaValidator

```typescript
interface SchemaValidator {
  validateRoot(input: unknown): Result<LocalDataRoot, ValidationError>;
  validateCommand(input: unknown): Result<DataCommand, ValidationError>;
  validateReplacement(input: unknown): Result<ReplaceableRoot, ValidationError>;
}

/** 識別子と日時を除いた候補パーツ内容のcanonical validator。 */
type CandidatePartContent = Omit<CandidatePart, "id" | "createdAt" | "updatedAt">;

function validateCandidatePartContent(
  input: unknown,
  path?: string,
): Result<CandidatePartContent, ValidationError>;

function validateCandidatePartDraft(
  input: unknown,
  path?: string,
): Result<CandidatePartDraft, ValidationError>;
```

- Preconditions: inputは常に`unknown`として渡す。
- Postconditions: success値は参照整合性を満たす現行schemaである。
- Invariants: validatorはinputを変更せず、errorはpathと機械判別可能codeを持つ。
- `validateCandidatePartValue`は識別子・日時を検証したうえで`validateCandidatePartContent`へ委譲し、内容規則の実装を二重化しない。`validateCandidatePartContent`は保存前の候補入力（識別子と日時が未確定なdraft）を検証する唯一のcanonical入口であり、利用側がroot全体や無関係なaggregate（CurrentBuild、maintenance、requestDedupe）を偽造して検証することを不要にする。返す`ValidationError.path`は`$.product.name`のようにfield位置を示し、表示層が問題項目へ対応付けられる。
- root検証は固定key集合（`schemaVersion`、`revision`、`projects`、`candidateParts`、`currentBuilds`、`requestDedupe`、`maintenance`）以外のkeyを`unexpected-field`として拒否する。これにより表示言語のようなドメイン外の利用者インターフェース設定が`localDataRoot`へ紛れ込んでも検証段階で拒否され、交換形式（backup-restoreが写像するのはこのroot形状のみ）にも伝播しない（2.8）。

### Persistence Layer

#### ProductLocalDataAdapter

`src/persistence/product-local-data-adapter.ts`は`@pc-build-planner/local-data`のroot公開entryと`./chrome`だけをimportし、packageの独立genericへ次の製品型を設定する。従来のroot/errorだけを取る2 generic形状は使用しない。

このadapterは先行revisionで完了した公開contract適合の履歴として維持するが、MVPの`RuntimeContributionFactory`はこれをpackage factory全面compositionへ接続しない。以下の型契約はadapter単体の境界であり、consumer固有recovery protocolを新しいpackage完成条件へ昇格させない。

```typescript
type ProductLocalDataPolicy = LocalDataPolicy<
  LocalDataRoot,
  RootMutationOperation,
  MaintenanceState,
  FoundationError
>;

type ProductErrorAdapter = ErrorAdapter<FoundationError, FoundationError>;

type ProductRecoveryProtocol = PersistentRecoveryProtocol<
  RecoveryControl,
  FoundationError,
  RecoveryFence,
  PendingRecoveryCommit,
  CurrentRootAnomaly
>;

interface ProductLocalDataAdapterContract {
  readonly policy: ProductLocalDataPolicy;
  readonly errors: ProductErrorAdapter;
  readonly recovery: ProductRecoveryProtocol;
  readonly workerPolicy: DataWorkerAuthorizationPolicy;
}
```

`RootMutationOperation`はPC mutation command、`MaintenanceState`はroot内maintenance projection、`RecoveryControl`はroot外persistent controlであり、互いに代入可能とは扱わない。`RecoveryFence`、`PendingRecoveryCommit`、`CurrentRootAnomaly`はfoundation所有のopaque capabilityとして具体型を保持し、package既定の`unknown`へ縮退させない。`ProductErrorAdapter.fromPolicy`はdecode/migration/mutation/repair/validation stageと元の`FoundationError` payload/contextを保持し、`fromCore`はpackage mechanism errorを既存`FoundationError`へ決定的に適合する。欠落mappingまたはadapter例外ではroot write前にfail closedとする。

`ProductRecoveryProtocol`は`RecoveryControlPolicy`の既存規則をpackage owner protocolへ適合し、mutation認可、current anomaly観測、owner/generation/leaseを含むfence取得、candidate/raw identityを束縛するpending commit、pre/post-commit分類、release、finalizationを所有する。packageへcontrol field解釈を渡さず、packageから渡される`ReplacementBinding`と`RecoveryCommitState`だけでcommit pointを共有する。`MaintenanceState`と`RecoveryControl`は保存場所、状態遷移、認可意味を分離したまま同じ固定名Web Lock内で検証する。

adapter単体はPC初期root、現行schema validator、MigrationRegistry、ReferenceRepairPolicy、operation、error adapter、recovery protocolとworker policyの型適合を検証する。runtime compositionは現行product-local transaction、capacity、replacement、fencing、Chrome storage、Web Locksを継続利用し、adapterからpackage factoryへ全面移行しない。`AppDataErrorMapper`は既存`FoundationError`へ適用し、raw root、StoragePort、RootWriteLock、transaction runnerを公開handleへ載せない。

#### MigrationRegistry

```typescript
interface MigrationStep<From extends number, To extends number> {
  readonly from: From;
  readonly to: To;
  migrate(input: unknown): Result<unknown, MigrationError>;
}

interface MigrationRegistry {
  toCurrent(input: unknown): Result<LocalDataRoot, MigrationError>;
}
```

各stepは`N -> N+1`のみ許可し、step出力と最終rootを検証する。未知の将来版、経路欠落、検証失敗ではsourceを保存しない。

#### ReferenceRepairPolicy

```typescript
interface ReferenceRepairPolicy {
  repair(before: LocalDataRoot, proposed: LocalDataRoot, change: RootChange): Result<LocalDataRoot, RepairError>;
}
```

candidate削除では該当build itemを除去し、category変更で現在の構成へ保持できない参照を除去する。project削除では同じprojectIdを持つcandidateとCurrentBuildを除去し、別projectのentityと参照は保持する。選択数や互換性などfeature固有判断は行わない。repair済みrootは同じpipelineで全体検証される。

#### LocalDataRepository, FoundationDataPort and MutationPipeline

```typescript
interface LocalDataRepository {
  readRoot(): Promise<Result<ReadSnapshot, RepositoryError>>;
  query<T>(query: RootQuery<T>): Promise<Result<T, RepositoryError>>;
}

interface FoundationDataPort {
  query<T>(query: RootQuery<T>): Promise<Result<T, FoundationError>>;
  mutate(command: RootMutationCommand): Promise<Result<MutationReceipt, FoundationError>>;
  assessReplacement(input: unknown): Promise<Result<ReplacementAssessment, FoundationError>>;
  replaceRoot(command: ReplaceRootCommand): Promise<Result<MutationReceipt, FoundationError>>;
  runMaintenance(command: MaintenanceCommand): Promise<Result<MaintenanceReceipt, FoundationError>>;
}

interface RootMutationCommand {
  requestId: RequestId;
  expectedRevision: number;
  operation: RootOperation;
  maintenance?: MaintenanceFence;
}
```

`LocalDataRepository`は検証済みread/queryだけを所有し、Repository境界の実装で完成する。`FoundationDataPort`は下流向け公開facadeであり、WriteAuthority統合でquery、mutation、maintenance、replacement dispatchを完成させる。

pipelineは`RootTransactionRunner`から渡された現行schemaの検証済みsnapshotとcapacity inputへcommand適用、reference repair、候補root検証、純粋capacity評価を行い、commit候補とreceipt metadataを返す。runnerはlock内でStoragePortから現在bytesとruntime quotaを取得し、pipelineへ値として渡す。pipelineとCapacityPolicyはStoragePortへ依存しない。migration、storage read/write、lock、revision増分、request dedupe永続化は所有しない。warningは成功receiptへ付加し、validationまたはquota failureでは候補を返さない。

#### RootWriteLock and RootTransactionRunner

```typescript
interface RootWriteLock {
  runExclusive<T>(operation: () => Promise<T>): Promise<Result<T, LockError>>;
}

interface RootTransactionRunner {
  run<T>(operation: RootTransactionOperation<T>): Promise<Result<T, FoundationError>>;
}
```

Chrome adapterは固定名`pc-build-planner:local-data-root-write`を`navigator.locks.request`へ渡す。runnerはlock取得後にrootを一度読み、migrationと全体validationを通したsnapshotをoperationへ渡し、operationが返した候補へmaintenance authorization、expected revision、request dedupe、全体validationを適用してrevisionを一度だけ進め、一回だけ保存する。operationはStoragePortを受け取らず再読込できない。lock callbackの完了、失敗、worker終了でlockは解放されるが、maintenance ownershipは永続rootから消えない。

Web Lockを取得できない、またはcallback完了前に実行contextが失われた要求は成功として扱わない。複数の協調writerは同じlock名を必須とし、`StoragePort`とChrome adapterはpublic portへ公開しない。複数authority、lockを迂回するtrusted extension code、Chrome crash時のdurable transactionは非対応architectureとする。

#### MaintenancePolicy

```typescript
interface MaintenancePolicy {
  acquire(root: LocalDataRoot, ownerId: MaintenanceOwnerId, leaseMs: number, now: UtcTimestamp): Result<MaintenanceTransition, MaintenanceError>;
  renew(root: LocalDataRoot, fence: MaintenanceFence, leaseMs: number, now: UtcTimestamp): Result<MaintenanceTransition, MaintenanceError>;
  release(root: LocalDataRoot, fence: MaintenanceFence): Result<MaintenanceTransition, MaintenanceError>;
  abort(root: LocalDataRoot, fence: MaintenanceFence): Result<MaintenanceTransition, MaintenanceError>;
  authorizeWrite(root: LocalDataRoot, fence?: MaintenanceFence): Result<void, MaintenanceError>;
}

interface MaintenanceFence {
  generation: number;
  ownerId: MaintenanceOwnerId;
  revision: number;
}
```

policyはI/Oとlockを持たない純粋関数である。maintenance commandと全writeは`RootTransactionRunner`のexclusive callback内で最新rootへpolicyを適用する。maintenance中はowner fenceを持たない全writeを`maintenance-active`で拒否する。期限切れownerの暗黙再利用は禁止し、新generationのacquireを要求する。renew、replace、releaseはlock取得後の最新generation、owner、revisionへ照合する。

`MaintenanceSnapshotSource`はRepositoryの検証済みrootから初期snapshotを返し、信頼済みStorage変更通知を同じ検証境界へ通してから配信する。通知値は`generation`、root `revision`、`active`だけを含み、owner、lease操作、write capability、Storage primitiveを公開しない。購読解除は冪等で、破損値は通知せずtyped diagnosticとして扱う。

```typescript
interface MaintenanceSnapshot {
  readonly generation: MaintenanceGeneration;
  readonly revision: Revision;
  readonly active: boolean;
}

interface MaintenanceSnapshotSource {
  getSnapshot(): Promise<Result<MaintenanceSnapshot, FoundationError>>;
  subscribe(listener: (snapshot: MaintenanceSnapshot) => void): () => void;
}
```

#### ReplacementCoordinator

```typescript
interface ReplacementEvaluator {
  assessReplacement(input: unknown): Promise<Result<ReplacementAssessment, ReplacementError>>;
}

interface ReplacementAssessment {
  token: ReplacementToken;
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  requiredBytes: number;
  warnings: readonly CapacityWarning[];
}
```

評価対象はmigration後・全体validation後の候補rootである。canonical serializationはJSON object keyをUnicode code point順に再帰整列し、array順序とJSON primitiveを保持し、余分な空白を含めずUTF-8へ符号化する。digestはWeb Crypto SHA-256で算出する。tokenはdigest、source schema version、target schema version、required bytes、評価時revisionを結びつけ、同じ候補と評価cursorからは同じtoken payload、候補値・schema・bytes・revisionのいずれかが変われば異なるtoken payloadを生成する。

`ReplacementCoordinator`は評価時に副作用を持たず、canonical digestを含むassessmentとcommit候補構築だけを所有する。`FoundationDataPort.assessReplacement`はReplacementCoordinator境界で完成し、`replaceRoot`の公開dispatchはWriteAuthority統合で完成する。置換時は`RootTransactionRunner`がlock内でtokenと候補、maintenance fence、current revisionを再検証し、一回のroot writeを行う。

#### RecoveryCoordinator and RecoveryControlPolicy

```typescript
type CurrentRootAnomaly =
  | { readonly code: "corrupt-data"; readonly fingerprint: RootFingerprint }
  | { readonly code: "unsupported-version"; readonly version: number; readonly fingerprint: RootFingerprint };

interface RecoveryCursor {
  readonly current: CurrentRootAnomaly;
  readonly candidateDigest: string;
  readonly targetSchemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly requiredBytes: number;
  readonly controlGeneration: MaintenanceGeneration;
}

type RecoveryAssessmentError = {
  readonly code: "recovery-candidate-rejected";
  readonly current: CurrentRootAnomaly;
  readonly candidate: ValidationError | MigrationError | CapacityError;
};

interface RecoveryOperations {
  assessRecovery(candidate: unknown): Promise<Result<RecoveryAssessment, RecoveryAssessmentError | FoundationError>>;
  runRecoveryMaintenance(command: RecoveryMaintenanceCommand): Promise<Result<RecoveryFence, FoundationError>>;
  replaceFromRecovery(command: RecoveryReplacementCommand): Promise<Result<ReplacementReceipt, FoundationError>>;
}
```

`RootFingerprint`はStorageから読んだraw rootをcanonical JSON UTF-8化してSHA-256で求めるが、raw値自体をconsumerへ返さない。unsupported版はversion fieldだけを安全に抽出し、それ以外は`corrupt-data`へ分類する。候補評価失敗はcurrent anomalyとcandidate rejectionを同じerror envelopeの別fieldで返す。

`RecoveryControlPolicy`は`foundationRecoveryControl` keyのgeneration、owner、lease、active、candidate digest、期待commit revisionを管理する。このkeyはdomain rootや交換形式へ含めず、通常rootがdecode不能でも取得・更新できる。通常mutation、通常置換、保守操作、回復置換は同じ固定Web Lock内でactive recovery controlを確認する。回復commitはraw fingerprint、candidate digest、target schema、required bytes、control generation・owner・leaseを再照合し、期待commit identityをcontrolへ永続化してからroot keyだけを一回writeする。失敗時はraw rootを変更しない。成功後は通常Repositoryで新rootを検証できるまでcontrolをreleaseしない。worker再生成後は現在rootのdigestとrevisionがcontrolの期待値へ両方一致した場合だけpost-commit finalization pendingと分類し、一致しないactive controlをpre-commit cleanup pendingとして扱う。

#### BackupRestoreDataPort

```typescript
type BackupRestoreCommitMode = "normal" | "recovery";

interface BackupRestoreCommitCommand {
  readonly candidate: unknown;
  readonly expectedMode: BackupRestoreCommitMode;
  readonly assessment: BackupRestoreAssessmentTicket;
}

declare const backupRestoreAssessmentTicketBrand: unique symbol;
type BackupRestoreAssessmentTicket = string & {
  readonly [backupRestoreAssessmentTicketBrand]: "assessment";
};

interface BackupRestoreAssessment {
  readonly mode: BackupRestoreCommitMode;
  readonly requiredBytes: number;
  readonly currentAnomaly?: CurrentRootAnomaly;
  readonly ticket: BackupRestoreAssessmentTicket;
}

interface BackupRestoreCommitReceipt {
  readonly mode: BackupRestoreCommitMode;
  readonly revision: Revision;
}

declare const backupRestoreFinalizationTicketBrand: unique symbol;
type BackupRestoreFinalizationTicket = string & {
  readonly [backupRestoreFinalizationTicketBrand]: "finalization";
};

type BackupRestoreCommitOutcome =
  | { readonly kind: "committed"; readonly receipt: BackupRestoreCommitReceipt }
  | {
      readonly kind: "committed-finalization-required";
      readonly receipt: BackupRestoreCommitReceipt;
      readonly finalization: BackupRestoreFinalizationTicket;
    };

interface BackupRestoreDataPort {
  assessReplacement(input: unknown): Promise<Result<BackupRestoreAssessment, FoundationError>>;
  assessRecovery(candidate: unknown): Promise<Result<BackupRestoreAssessment, RecoveryAssessmentError | FoundationError>>;
  commit(command: BackupRestoreCommitCommand): Promise<Result<BackupRestoreCommitOutcome, FoundationError>>;
  findPendingFinalization(): Promise<Result<BackupRestoreFinalizationTicket | null, FoundationError>>;
  finalize(ticket: BackupRestoreFinalizationTicket): Promise<Result<BackupRestoreCommitReceipt, FoundationError>>;
}
```

このportは同じ`WriteAuthority`、`ReplacementCoordinator`、`RecoveryCoordinator`へ委譲するfrozen facadeであり、正常/回復protocolの内部primitiveを公開しない。assessmentはroot revisionまたはraw fingerprint、candidate digest、modeへ結び付くopaque ticketだけをconsumerへ返す。`commit`は固定名Web Lock内でticket、`expectedMode`、最新root分類を再照合し、preflight後に確定した先行mutationがあればwrite前の`stale-assessment`として拒否する。照合成功と同じ排他区間でpersistent maintenance/recovery controlをactiveにし、後続の通常mutationをcleanup完了まで拒否する。root write前の全失敗はerrorであり、control cleanup未完了時だけ`precommit-cleanup-pending`を返す。同じassessment ticketによる次の`commit`は一致するcontrolのcleanupをroot write 0件で再開し、完了後の最新rootで再assessmentしてから通常commitへ進む。root write後は`committed`または`committed-finalization-required`であり、後者を通常失敗へ変換しない。

`BackupRestoreAssessmentTicket`と`BackupRestoreFinalizationTicket`はいずれもopaque値である。前者はpreflight世代、candidate、pre-commit control owner/generationをcommitへ結び付け、後者はcommit mode、owner/generation、置換後revisionまたはrecovery control cursorへ結び付く。raw fingerprint、候補値、digest、fenceをconsumerへ公開しない。前者の再送は`precommit-cleanup-pending`となった一致controlのcleanupとcleanup後の再assessmentだけを再開でき、再assessmentがstaleになった場合は終了して新規assessmentを要求する。別ticketや通常mutationへowner能力を移譲しない。正常maintenance controlとRecoveryControlはcandidate digestと期待commit revisionをroot write前に永続化し、現在rootが両方へ一致した場合だけpost-commitと分類する。`findPendingFinalization`はこの判定を満たすactive controlからだけ同じopaque ticketを再構築し、pre-commit controlや内部cursorを返さない。`finalize`は対応するmaintenance/control cleanupと通常query確認だけを実行し、candidate assessmentまたはroot writeへ到達できない。既に完了したticketの再送は同じreceiptを返すか型付きstale resultとなり、rootを変更しない。`query`、`mutate`、raw root、fingerprint生成、StoragePort、RootWriteLock、runner、authority factory、maintenance sourceは公開しない。

**Preconditions**: production runtime contributionのaccess restrictionが成功し、composition ownerがbackup-restore section factoryへ直接注入していること。

**Postconditions**: 正常置換と異常回復のcommitは既存の同一Web Lock、owner/generation、opaque assessment ticket再検証を通る。先行mutationはticketをstale化して保持され、commit線形化後の後続mutationはpersistent maintenance/recovery controlで拒否される。facade生成やmethod取得だけでは永続状態を変更しない。

### Runtime and Adapter Layer

#### RuntimeContributionFactory

```typescript
interface FoundationRuntimePlatform {
  readonly storageLocal: ChromeStorageLocalApi;
  readonly storageChanges: StorageChangeEvent;
  readonly locks: WebLocksApi;
  readonly authorize: DataWorkerRegistrationDependencies["authorize"];
  readonly now: () => UtcTimestamp;
  readonly reportError: (error: FoundationError) => void;
}

interface FoundationScopedDataPort {
  query<T>(query: RootQuery<T>): Promise<Result<T, FoundationError>>;
  mutate(command: RootMutationCommand): Promise<Result<MutationReceipt, FoundationError>>;
}

interface FoundationRuntimeContribution {
  readonly maintenanceSource: MaintenanceSnapshotSource;
  readonly workerRegistration: DataWorkerRegistration;
  readonly dataPort: FoundationScopedDataPort;
  readonly backupRestoreDataPort: BackupRestoreDataPort;
  dispose(): void | Promise<void>;
}

function initializeProductionFoundationRuntimeContribution(): Promise<
  Result<FoundationRuntimeContribution, FoundationRuntimeInitializationError>
>;
```

public production factoryは引数を取らず、現行product-local Chrome adapterからChrome Storage・Storage change event・Web Locksを解決する。UTC clock、PC schema/policy、error mapping、分類済みcallerが`trusted-extension`の場合だけ許可するworker policyはfoundationが所有する。sender、tab、URLからcaller classificationへの変換は引き続きapplication-shell所有である。

factoryは現行Repository、RootTransactionRunner、WriteAuthority、maintenance source、worker registration、用途別public facadeを同じproduct-local依存graphへ一度だけ組み立てる。既存platform DI seamは互換seamとして維持し、application-shellのsource/artifact boundaryはplatform primitive注入と内部module importを拒否する。schema、migration step、validator、reference repair、command decoder、worker認可、error mappingはfoundation所有のcanonical実装を使用し、application-shellから差し替えさせない。`ProductLocalDataAdapter`とpackage factoryはこのproduction graphへ接続しない。

初期化時にStorage accessを`TRUSTED_CONTEXTS`へ制限し、失敗時はtyped failureを返してcontributionを公開しない。worker registrationへは同じ成功結果を再利用するfail-closedなrestrict callbackを渡し、side panel起動とworker登録の順序へ安全性を依存させない。

公開handleはread-only maintenance source、未登録のworker registration、通常UI用`FoundationScopedDataPort`、backup-restore専用`BackupRestoreDataPort`を用途別に返す。Repository、StoragePort、RootWriteLock、runner、pipeline、raw rootは返さない。完全な内部authorityを単一の汎用portとしてUIへ注入しない。`dispose`は冪等でinitializerが所有するresourceだけを解放する。maintenance購読のunsubscribeとworker registration成功後のdisposerは、それぞれを開始したapplication-shell側consumerが所有する。

`FoundationScopedDataPort`は同一handle内のwrite authorityへ委譲するfrozen viewであり、置換・保守・回復操作を公開しない。`BackupRestoreDataPort`はbackup-restore contributionだけへ注入し、正常置換・異常root回復・finalize-only retry以外の通常CRUDを公開しない。複数contextが同時にwriteしても、固定名Web Lockが線形化点、永続rootのrevision・maintenance fence・RecoveryControlが認可根拠であるため、単一write authorityの不変条件とworker再生成耐性を維持する。Storage access restriction失敗時は両portを含むcontributionを一切公開しない。

factoryは`chrome.runtime`、DOM、React、application-shell型へ依存しない。runtime message target、sender metadataからのcaller classification、listener start/stopはapplication-shellが提供する。global property参照を含むplatform解決・shape検証を先に完了し、不足時は`invalid-platform`を返す。Storage access restriction、購読登録、handler生成、Repository生成はその後にだけ行う。解決中のglobal getter例外も`invalid-platform`へ正規化し、foundation側の観測可能な副作用を開始しない。同じ永続Storageを使用して再初期化した場合、revisionとactive maintenance fenceはRepositoryから再読込され、process memoryを正しさの根拠にしない。

#### ProductRuntimeCharacterization

root `package.json`の`validate:local-data-product-contract`は`scripts/validate-local-data-product-contract.mjs`だけを起動し、現行product-local production graphを実行するfoundation所有commandである。Chrome APIは決定的adapter fixtureへ置換するが、production factoryと同じkey scope、固定Web Lock identity、access restriction順序、用途別handle compositionを通る。package factoryや新しいgeneric control protocolへの移行は前提にしない。

contractは少なくとも次をruntimeで検証する。

- `FoundationError`のvariant、payload、判定contextが現行runtimeから意味不変に到達し、未知・不完全値がroot write前にfail closedとなる。
- root内`MaintenanceState`とroot外`RecoveryControl`が別保存意味として維持され、相互に代用されない。
- 通常mutation、正常置換、異常root回復が同じ固定Web Lock identityと単一write authorityを使い、各commitでroot writeが最大一回、stale fenceでは0回となる。
- recoveryのpre-commit cleanup、post-commit finalization discovery、finalize-only retryを既存product-local protocolで駆動し、finalize中のroot writeが0回、通常/backup handleのcapability分離が維持される。
- `restrictToTrustedContexts`失敗時はdata port、backup port、maintenance source、worker registrationのいずれも公開せず、後続のread/write/registration side effectを開始しない。

commandは成功時0、contract failureまたは初期化例外時non-zeroを返し、安定したtest diagnosticをそのまま伝播する。package単独validationやpackage completionはこのcommandに依存しない。

#### WriteAuthority and WorkerRegistration

```typescript
interface DataWorkerRegistration {
  register(target: WorkerMessageTarget): RegistrationDisposer;
}

function createDataWorkerRegistration(deps: DataAuthorityDependencies): DataWorkerRegistration;
```

registrationは受信値、request ID、caller classificationを検証し、許可済みcommandだけをauthorityへ渡す。WriteAuthorityはqueryを検証済みRepositoryへ、すべてのmutation、maintenance、replacementを`RootTransactionRunner`へdispatchする。同一worker内queueは待ち順と負荷制御に使用できるが、正しさの排他根拠はWeb Lock、再生成後の認可根拠は永続rootである。sender/tab/URLからcaller classificationへの変換とlistener compositionはapplication shellが提供し、分類済みcallerに対するcommand許可policyはfoundationが提供する。content scriptへRepository、StoragePort、RootWriteLockを返さない。

#### Package Chrome Adapter Integration

```typescript
interface ProductChromePorts {
  readonly storage: PackageStoragePort;
  readonly lock: PackageExclusiveLockPort;
  readonly changes: PackageStorageChangePort;
}
```

package `./chrome`は抽出済みadapter contractとしてStorage例外、quota、access restriction、change event、Web Lockを汎用error/portへ正規化するが、MVPのproduction runtimeには接続しない。現行product-local Chrome adapterが`localDataRoot`と内部control keyを扱い、access restriction失敗時は用途別capabilityを含むruntime contributionを公開しない。package内部adapterは公開しない。

## Data Models

```mermaid
erDiagram
    LOCAL_DATA_ROOT ||--o{ PROJECT : contains
    LOCAL_DATA_ROOT ||--o| MAINTENANCE_STATE : fences
    PROJECT ||--o{ CANDIDATE_PART : owns
    PROJECT ||--o| CURRENT_BUILD : has
    CURRENT_BUILD ||--o{ BUILD_ITEM : contains
    CANDIDATE_PART ||--o{ BUILD_ITEM : referenced_by
```

### Domain Model
- Aggregate root: `LocalDataRoot`。全mutation、migration、置換のtransaction boundary。
- Entity: `Project`、`CandidatePart`、`CurrentBuild`。IDはbranded UUID、日時はUTC ISO 8601。
- Value object: `SourceInfo`、`SourceSnapshot`、`SourcedValue<T>`、category別`NormalizedAttributes`、`MaintenanceFence`。
- Invariants: project内参照、正整数quantity、unique ID、current schema、単調増加revision、maintenance owner一意性。

### Logical and Physical Data Model
- storage key `localDataRoot`へroot objectを一件保存する。
- array内IDの一意性と参照はvalidatorが全体検証する。10MB上限のMVPでは二次indexを永続化せず、query時に一時Mapを構築する。
- request dedupe記録は有界で、最新requestだけを保持する。上限とevictionはschema定数として固定し、同じrequest IDが保持期間外に再送された場合はexpected revisionで競合検出する。
- maintenance stateはrootと同じcommit単位に置き、worker memoryや`storage.session`を正としない。
- Web Lockは保存modelへ含めない。lock消失後もactive maintenanceとgenerationはrootに残り、新workerの最初のwriteがlock内で再読込してfail-closedに判定する。

## Error Handling

`FoundationError`は`validation`、`corrupt-data`、`unsupported-version`、`migration-failed`、`repair-failed`、`revision-conflict`、`request-conflict`、`maintenance-active`、`recovery-active`、`stale-fence`、`stale-assessment`、`stale-recovery-state`、`precommit-cleanup-pending`、`quota-exceeded`、`access-denied`、`lock-unavailable`、`storage-unavailable`を判別子に持つ。`precommit-cleanup-pending`はroot未変更かつ同じassessment ticketによるcleanup再開が可能な場合だけ返す。quota warningは失敗ではなく成功receiptのmetadataとする。回復候補の拒否は`RecoveryAssessmentError`でcurrent anomalyとcandidate reasonを分離し、raw rootや候補値を含めない。

`AppDataError`はこの全variantとpayloadを一対一で保持する共有consumer契約であり、新しい分類、統合、粒度変更を導入しない。現行product-local runtimeが返す`FoundationError`へ`mapFoundationError`を適用する。完了済み`ProductLocalDataAdapter`のpackage error適合は非production contractとして維持する。下流feature固有の入力・workflow errorは`AppDataError`へ混ぜない。

Chrome例外、未信頼payload、完全URL、商品値、保存rootをログへ出さない。予期しないadapter例外は`storage-unavailable`へ正規化し、commit成功を確認できない場合は成功を返さない。

## Testing Strategy

### Unit Tests
- `SchemaValidator`で全12category、取得元とsnapshotを含む欠損値、元表記と確認値、UUID/UTC、cross-project参照、生HTML・画像/data URL拒否を検証する（2.1–2.7, 5.4）。
- `SchemaValidator`のroot検証が、固定key集合以外のkey（表示言語のようなドメイン外設定を模した任意のkeyを含む）を`unexpected-field`として拒否することを検証する（2.8。既存の`tests/domain/validation.test.ts`のroot extra-field caseが充足済み）。
- `validateCandidatePartContent`と`validateCandidatePartDraft`がID・日時・rootを偽造せず、full-root validatorと同じfield path/codeで候補内容を検証する（3.11）。
- `CURRENT_SCHEMA_VERSION`がpublic entryから一つだけ公開され、initial root、migration、replacement、交換形式で同じ値になることを検証する（4.6, 4.7）。
- `MigrationRegistry`で連続migration、経路欠落、将来版、step失敗、source非変更を検証する（4.1–4.5）。
- `ReferenceRepairPolicy`でcandidate削除・category変更時のbuild item除去、project削除時の所属candidate・CurrentBuild除去、無関係なproject dataの保持を検証する（3.7, 3.9）。
- `MaintenancePolicy`でinactiveからのgeneration増分、owner外拒否、期限切れ、renew/release/abort、stale generation・owner・revision、破損state非変更を検証する（7.4–7.7）。
- `MaintenanceSnapshotSource`で検証済み初期snapshot、開始・終了通知、購読解除、破損変更値の拒否を検証する（7.8）。
- `RuntimeContributionFactory`が一つのcanonical graphからmaintenance sourceとworker registrationを生成し、両者が同じroot revisionとmaintenance stateを観測することを検証する（1.3, 3.1, 7.8）。
- 不正platform portを副作用前に拒否し、初期access restriction失敗時にcontributionとworker handlerを公開せず、handleがRepository、Storage、lock、authorityを露出しないことを検証する（6.1–6.4）。
- 公開no-arg production factoryがChrome Storage・change event・Web Locksをfoundation内で解決し、`trusted-extension`固定policyとcanonical clock/reporterでDI seamへ委譲することを検証する。global欠落・getter例外では`invalid-platform`となり、access restriction・購読・handler・graph生成が0件であることを検証する（1.1, 1.3, 6.1, 6.3）。
- 同じStorageへfactory graphを再生成し、active maintenance fenceとrevisionを再読込してowner外writeを拒否することを検証する（1.3, 7.4–7.8）。

### Contract and Integration Tests
- 完了済み`ProductLocalDataAdapter`の型適合はpackage root/Chrome公開entryだけで非production contractとして維持し、現行product-local runtime characterizationがschema 1、revision、repair、atomicity、fencing、worker認可を固定する（9.1–9.3, 9.9, 9.11）。
- `AppDataErrorMapper`で全`FoundationError` variantのcode/payload/contextが一対一で保持され、欠落variantでexhaustivenessまたはboundary validationが失敗することを確認する（9.4–9.7）。
- public consumer contractでcandidate/current-build/compatibility/candidate-source/source-price-refreshが`src/domain/public.ts`の`AppDataError`を利用でき、`ManagementError`再定義やproduct adapter/deep importを必要としないことを確認する（9.7, 9.10）。
- `MutationPipeline`でCRUD候補、reference repair、project削除カスケード、候補root検証、capacity warning・拒否をI/Oなしで検証する（3.1, 3.2, 3.7, 3.9, 5.1–5.3）。
- `RootTransactionRunner`でexpected revision競合、storage失敗時の既存root保持、lock内の最新root読取、revision増分、単一writeを検証する（1.3, 3.3–3.5, 3.8）。
- `WriteAuthority`で同一request再試行、異payload request ID拒否、query・mutation・maintenance・replacement dispatchを検証する（3.1, 3.6, 3.8, 6.2–6.4）。
- 10MB未満、warning閾値、超過見込み、実write quota rejectについてbefore/after capacity metadataとroot保持を検証する（5.1–5.5）。
- `RootWriteLock` contractで別clientの同時acquireを直列化し、callback throw後の解放、同一固定lock名、lock failureのtyped化を検証する（1.3, 3.8, 7.4–7.7）。
- `RootTransactionRunner`で同時maintenance acquireの成功が一件だけであること、通常mutationとのlost updateがないこと、lock取得後に最新rootを読むことを検証する（3.8, 7.4–7.6）。
- worker再生成testではメモリqueueを共有しない新authorityと新lock adapterを作り、永続active fenceによるowner外write拒否、期限切れ後の新generation、release/abort後の再開を検証する（1.3, 7.5–7.7）。
- `ReplacementCoordinator`で副作用なし評価、schema migration、容量不足、stale token、単一成功/失敗置換を検証する（7.1–7.3）。
- `RecoveryCoordinator`でcorrupt/future rootの分類とfingerprint安定性、候補不正・未対応・容量超過時の二重診断、raw root非変更を検証する（7.9–7.11）。
- recovery transactionでowner・generation・lease・raw fingerprint・candidate digestの各stale拒否、単一root write、成功後の通常query/mutate復帰を検証する（7.12–7.14）。
- `BackupRestoreDataPort` contractで正常/異常rootのassessmentとcommitを同じcanonical graphから実行し、各経路が既存fence・cursorを迂回しないことを検証する。control取得後かつroot write前のcleanup失敗は`precommit-cleanup-pending`となり、同じassessment ticketだけがworker再生成後もowner/generationを照合してcleanupをroot write 0件で再開し、別ticketを拒否することを固定する。cleanup後の再assessmentがstaleなら古いticketを終了し、新規assessmentだけを許可する。root write後のcleanup失敗は`committed-finalization-required`となり、新しいconsumer instanceが`findPendingFinalization`でticketを再発見でき、finalize retry中のroot writeが0件であることも固定する（7.15, 7.17）。
- `WorkerRegistration`でunknown payload、unauthorized caller、content-script直接accessなし、access restriction失敗時のfail-closedを検証する（6.1–6.4）。
- 公開maintenance sourceがread-onlyであり、Storage primitiveやlease/write操作をconsumerへ公開しないことをcontract testで検証する（7.8）。
- `ProductRuntimeCharacterization`は現行product-local production graphでerror payload/context、`MaintenanceState`/`RecoveryControl`分離、single write、固定Web Lock、pre/post-commit recovery/finalization、capability分離、access restriction fail-closedを一度に検証する（7.4–7.17, 9.3, 9.5–9.6, 9.8, 9.11–9.12）。

### Fixture and Public Port Regression
- fixture builderは全12category、欠損値、元表記・確認値、参照整合root、破損rootを架空値だけで生成し、実サイトHTML、画像、商品dataを含まないことを独立検査する（8.1, 8.3）。
- `FoundationDataPort`だけを使う回帰suiteでCRUD、project削除カスケード、破損読取、容量不足、移行成功・失敗、access拒否、参照修復、request conflict、maintenance fence、replacementを検証する（3.1–3.9, 4.2–4.4, 5.1–5.3, 6.1–6.4, 7.1–7.7, 8.2）。
- runtime contributionのnegative contractで`FoundationScopedDataPort`から置換・保守・回復・Storage・lockへ到達できず、`BackupRestoreDataPort`からquery、mutate、raw root、Storage、lock、fence、Repository、authority factoryへ到達できないこと、およびfinalization ticketからroot writeを開始できないことを型検査とruntime key検査で検証する（3.10, 6.3, 7.16, 8.2）。
- 架空のcorrupt/future rootだけを使い、候補評価拒否、worker再生成、回復成功、通常操作復帰を公開port経由で検証する（7.9–7.14, 8.2）。

### Performance and Concurrency Validation
- 10MB近傍の架空rootでread、migration、validation、repair、canonical serialization、single writeの時間とbytesを個別計測する（5.1, 5.3）。
- 複数clientのlock待機時間、同時mutationのrevision単調増加、worker再生成後のactive fence拒否を独立したintegration suiteで計測・検証する（1.3, 3.8, 7.4–7.6）。

### Runtime and Build Tests
- 生成manifestがMV3、minimum Chrome 116、`storage`のみ、host permission/`unlimitedStorage`なしで読み込めることを検証する（1.1, 1.4, 5.5）。
- bundleをscanし、remote import、`eval`、`new Function`、inline JavaScriptがないことを検証する（1.2）。
- 公開import境界、固定lock名の迂回、直接`chrome.storage`利用、fixture assetをartifact gateで検査し、typecheck、Biome、全test、build、artifact scanを一つの最終commandで実行する（5.4, 6.3, 8.1–8.3）。
- package内部deep import、package側の`ProductLocalDataAdapter`所有、candidate-owned共有data error、通常consumerへのbackup capability、backup consumerへの通常CRUD/raw root/internal adapter露出をnegative gateで拒否する（9.2, 9.7, 9.8, 9.10）。
- 製品adapter/PC policyだけの変更はfoundation characterization・consumer contract、package公開契約変更はpackage gateに加えて全下流consumer contractを実行する変更種別別scriptを検証する（9.9, 9.10）。
- root `validate:local-data-product-contract`が対象contractだけを再現可能に実行し、成功0・任意のcontract failure非0を返すこと、上流routeがcommandを一回だけ呼び終了statusを変更せず伝播することをtooling testで固定する（9.10–9.12）。

## Security Considerations

- 初期化時に`storage.local`を`TRUSTED_CONTEXTS`へ制限し、成功前にwrite authorityを公開しない。
- runtime inputは`unknown`からdecodeし、shell提供のcaller authorizationとfoundation command validationの両方を通す。
- public portはstorage primitiveを公開せず、featureからの`chrome.storage`直接importをboundary testで拒否する。
- Web Locksは協調排他であるため、固定lock名を迂回する`chrome.storage.local.set`、StoragePort、RootWriteLockの直接利用をboundary testで拒否する。
- `foundationRecoveryControl`はownerとleaseを公開せず、raw異常rootとcandidate payloadをlog・通知へ載せない。全通常writerはactive recovery controlをlock内でfail-closedに確認する。
- CSPを弱めず、remote hosted code、動的評価、inline JavaScriptを生成物検査で拒否する。

## Performance & Scalability

- capacity上限はruntime `chrome.storage.local.QUOTA_BYTES`を使用し、warning比率は既定80%として設定可能にする。
- synthetic rootを用いて10MB近傍のread、migration、validation、repair、serialization、write時間を個別計測する。MVP受入では操作をタイムアウトさせず、計測値をtest reportへ残す。
- root分割、永続index、別storage採用は現時点で行わない。全体書換が実測上問題になった場合は参照整合性・置換・migrationを含む全dependent specのrevalidationを行う。
- lock待機時間とcallback実行時間をtest reportへ残す。Web Lock callback内にnetwork I/Oや利用者待機を持ち込まず、root readから単一setまでに限定する。

## Migration Strategy

初期rootは`schemaVersion: 1`、`revision: 0`で生成する。migrationは純粋な`N -> N+1`stepとして順序適用し、各stepと最終rootを検証する。通常readは移行済みsnapshotを返すが、永続化は明示mutation pipeline内だけで行う。失敗、未知の将来版、容量不足ではsource rootを上書きしない。

application shell導入時は、foundationの`initializeProductionFoundationRuntimeContribution()`をshell-owned production compositionから引数なしで呼び、返されたworker registrationを`src/runtime/service-worker.ts`へ、maintenance sourceをside panel compositionへ接続する。shellはStorage、change event、Web Locks、clock、foundation command policyを注入しない。foundationが一時的な共有runtime入口を作成して移管するmigrationは行わない。

`CURRENT_SCHEMA_VERSION`の値と`LocalDataRoot` schemaは変更しない。現行product-local runtimeが同じroot key、control key、schema、migration、repair、error policyを継続利用するため保存data migrationは発生しない。抽出済みgeneric mechanism/Chrome adapterはpackage単独成果として維持し、product runtimeへ移さない。旧consumerの`FoundationScopedDataPort`とbackup用途限定capabilityのshape・挙動を維持する。下流featureはcandidate-owned data error importを共有`AppDataError`公開入口へ変更するが、error種類・意味・粒度と利用者挙動は変えない。
