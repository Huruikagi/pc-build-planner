# Design Document

## Overview

本機能は、ローカルファーストのChrome拡張利用者へ、全プロジェクト、候補パーツ、現在構成を一つのバージョン付きJSONへ退避し、安全に一括復元する機能を提供する。操作面は`settings-screen`が所有する設定画面の区画へ、`BackupRestoreSectionMount`を介して埋め込む。ブラウザ標準のファイルAPIでユーザー操作による入出力を行う。

設計は交換形式、検証・変換、復元調整、UI状態を分離する。`ProductBackupAdapter`がpackageのbackup public portへPC固有codec・mapping・policyとFoundationの限定置換能力を設定し、汎用オーケストレーション手順はpackage実装へ委ねる。永続化モデルを直接公開せず、入力を`unknown`として検証した後に現行`LocalDataRoot`へ変換する。root write前の失敗では復元前データを維持し、write後のcleanup失敗は復元成功を取り消さずfinalize-only retryへ分離する。

### Goals
- 保存実装から独立した版付き交換形式で全データを往復可能にする
- 正常に生成したバックアップが同じ交換形式版の復元ファイル事前検証を必ず通過する
- 不正形式、非対応版、参照不整合、容量超過を永続状態変更前に拒否する
- 確認済みデータだけを一回のroot writeで置換し、commit前失敗時は既存データを保持する
- バックアップの限界、置換影響、処理結果を設定画面内の区画で明示する
- バックアップ内部を公開せず、任意containerへ安全にmount・cleanupできるsection契約を提供する
- `ProductBackupAdapter`をPC固有バックアップ構成の単一所有境界とし、package public portだけから汎用オーケストレーターを利用する

### Non-Goals
- 自動、定期、差分、クラウド、同期、圧縮バックアップ
- 複数バックアップのマージ、CSV入出力、商品カタログ配布
- 候補や現在構成の業務規則、互換性判定、ブラウザ外の保管
- 設定画面、常設ナビゲーション、言語区画、shell compositionの所有
- 汎用バックアップオーケストレーター、そのpublic port、PC root・置換能力のcanonical定義

## Change Integration

- **Change Brief**: `v0.5.0-boundary-reconciliation`
- **In scope**: `ProductBackupAdapter`、PC交換形式codec・mapping・policy、file UI、確認、project-context guard・refresh、consumer contract、UI、E2E。
- **Out of scope**: packageの汎用オーケストレーター/public port、FoundationのPC root・置換能力、application shell composition、交換形式や保存schemaの意味変更、自動バックアップ、UI layout。
- **Preserved behavior**: 明示確認、atomic replacement、競合fencing、commit前cleanup、失敗時の既存データ保持、破損・未対応rootからの回復、finalization/refresh再試行を変更しない。

## Boundary Commitments

### This Spec Owns
- packageのbackup public portをPC固有codec・mapping・policyおよびFoundation capabilityへ接続する`ProductBackupAdapter`
- `BackupEnvelope`交換形式、形式版、旧交換形式から現行形式への移行
- 全保存データと交換データ間の変換、交換形式検証、復元プレビュー
- バックアップ生成と検証済みルートの復元調整
- 正常root置換と破損・未対応root回復の経路選択、およびcommit pointまでの調整
- catalog全体置換前のproject-context guard lifecycleと、置換成功後のcontext refresh・refresh-only retry
- 設定画面内へ埋め込む区画のファイル選択、確認、処理状態、警告、結果表示
- `BackupRestoreSectionMount`とfactory、およびmountされたReact rootのcleanup
- Foundationのcommit point付きbackup portを用いた復元commit、同一assessment ticketによるpre-commit cleanup再開、finalize-only retryの調整
- Foundationのbackup専用portを用いた正常置換・異常回復の調整
- Foundationが返すcommit pointを保持し、置換済みcleanupだけを再試行するfinalization lifecycle

### Out of Boundary
- `@pc-build-planner/local-data/backup`の汎用`BackupOrchestrator`、`BackupCodec`、factoryおよびpublic port定義
- FoundationのPC root/schema/migration/repair、`BackupRestoreDataPort`のcanonical定義と実装
- application shellのproduction compositionと最終port wiring（本specは公開adapter/section契約だけを提供する）
- `Project`、`CandidatePart`、`CurrentBuild`の所有権と業務規則
- Foundationの保存スキーマ、通常CRUD、Chrome Storage APIアダプター
- ファイルの保存先、保持期間、自動化、暗号化、クラウド転送
- 復元時のマージ、部分選択、互換性結果の再計算
- settings feature registration、設定layout、navigation metadata、shell host lifecycle
- feature-owned draftの内容・保存・破棄判断、project-contextのguard registryとselection fallback
- Foundationのraw root分類、fingerprint、RecoveryControl、置換・回復原子性、commit/finalization token生成
- 破損・未対応rootを検出したside panelのdegraded startupと`recovery`操作分類（application-shell owner）

### Allowed Dependencies
- `@pc-build-planner/local-data/backup`が公開する`BackupOrchestrator`、`BackupCodec`、factory。package内部moduleへdeep importしない
- Foundationの`LocalDataRoot`、`Result`、エラー契約。export用の`BackupSnapshotReadPort`と、commit point、同一assessment ticketによるpre-commit cleanup再開、永続controlからのpending finalization再発見を提供する`BackupRestoreDataPort`
- runtime-schema-validationのconfigured Zod Mini入口、strict plain object・JSON safety primitive、owner error/path変換helper。Zod packageや他feature schemaをdeep importしない
- ui-messagesの公開`MessageKey`・`MessageResolver`・`useMessages()`。利用者向け案内とerror policyは日本語・英語カタログで完全性を保ち、言語別カタログ実装へdeep importしない
- project-contextの`ProjectContextReplacementGuardPort`と`ProjectContextCommandPort.refresh`。guard registry、draft、selection stateへdeep importしない
- Candidate managementとCurrent build managementが定義する保存済みデータ契約
- `settings-screen`が提供する空の区画containerとsection lifecycle
- 信頼済みextension page
- Chrome 116以降のFile、Blob、URL、TextEncoder、React 19系/React DOM
- application shellの`FeatureMountContext`、`FeatureMountHandle`、operation policy
- application shellの`recovery` operation kindと、`corrupt-data | unsupported-version`時にもsettingsをmountするdegraded startup契約

依存方向は`Domain contracts → Configured runtime-schema primitives → Owner-local PC codec / mapper / policy → package backup public port + Foundation backup capability → ProductBackupAdapter → Backup and Restore facades → State → View and File gateway → Section mount adapter`とし、右側は左側だけへ依存する。Product側はpackage内部の汎用protocolを再実装せず、File gatewayはFoundation portへ直接アクセスせず、settingsは公開section adapterより内側へ依存しない。

### Revalidation Triggers
- `LocalDataRoot`、カテゴリ、候補所属、現在構成参照、read-only root queryまたはRepositoryエラーの形状変更
- `BackupRestoreDataPort`、正常/回復assessment、commit outcome、異常root分類の形状変更
- `BackupRestoreCommitOutcome`、opaque finalization ticket、finalize-only retryの形状変更
- pending finalization discovery、復元ファイル安全上限、交換形式の最大直列化サイズ不変条件の変更
- root write前にpersistent controlのcleanupが未完了となった場合のerror code、同一assessment ticketによる再開、lease失効後の新規assessment規則の変更
- `ProjectContextReplacementGuardPort`のpermit lifecycle、`ProjectContextCommandPort.refresh`、snapshotのready/empty/unavailable規則の変更
- 交換形式の追加・削除、形式版の変更、旧版サポート範囲の変更
- 保存が単一キー一括書込でなくなる変更、容量上限または書込原子性の変更
- `BackupRestoreSectionMount`、`FeatureMountContext`、settings-owned host lifecycle、File API前提、信頼済みコンテキスト設定の変更
- application shellのdegraded startup、`recovery`操作可否、正常snapshot復帰通知の変更
- ui-messagesの`MessageKey`、placeholder、日英catalog parity、言語切替時のProvider契約の変更
- package backup public contractまたは`ProductBackupAdapter`のconsumer contract、codec設定点の変更

## Architecture

### Existing Architecture Analysis

Foundationは`LocalDataRoot`を単一キーで保存し、読取・保存時にスキーマと参照を検証する。Candidate managementはプロジェクトと候補、Current build managementは構成参照と数量を所有し、どちらもRepositoryを介して保存する。本仕様はこれらの公開保存値だけを入力とし、業務サービスやStorage APIへ直接依存しない。

Foundationは`BackupRestoreDataPort`から、正常rootと破損/未対応rootのassessment、commit pointを判別する置換、opaque ticketによるfinalize-only retryを用途限定で提供する。packageのbackup subpathはcodec注入型の汎用`BackupOrchestrator`を提供する。`ProductBackupAdapter`は両方のpublic contractとPC codec/policyを構成し、feature facadeへ既存のcreate/preflight/reassess/commit/finalize操作を公開する。内部の`WriteAuthority`、Web Lock、raw root、Storage、fence、通常CRUD、およびpackageの汎用protocolへは到達しない。project-contextはcatalog全体置換用permitとsuccess/failure completion、置換後refreshを能力別portで提供し、feature stateが利用者確認を含むlifecycleを汎用orchestratorの外側で順序付ける。

破損・未対応rootでは通常のmaintenance snapshotを構築できない。application shellはこの二つのtyped failureだけを`recovery-required`へ写像し、通常mutationをfail closedで抑止したままsettingsをmountする。backup-restoreのcommitは`recovery` operationとして許可され、その他のstartup failureでは従来どおりglobal startup errorに留まる。Foundationから最初の正常snapshotを受信した時点でshellは通常projectionへ復帰する。

### Architecture Pattern & Boundary Map

```mermaid
graph LR
    View[Backup restore view] --> State[Backup restore state]
    View --> File[File gateway]
    State --> Facade[Backup and restore facades]
    State --> Guard[Project context replacement guard]
    State --> Context[Project context refresh]
    Facade --> Adapter[ProductBackupAdapter]
    Adapter --> Generic[Package backup orchestrator]
    Adapter --> Codec[PC backup codec mapper policy]
    Adapter --> Snapshot[Backup snapshot read port]
    Adapter --> Foundation[Backup restore data port]
    Generic --> Codec
    Generic --> Foundation
    Foundation --> Runner[Root transaction runner]
    Runner --> Schema[Schema validator]
    Runner --> Storage[Chrome storage adapter]
```

- **Selected pattern**: 機能サービスとポート・アダプター。交換形式の純粋処理とブラウザI/Oを分離する。
- **Existing patterns preserved**: `unknown`入力検証、判別可能な`Result`、Repository経由の保存、UI stateとDOM viewの分離。
- **New components rationale**: Exchange componentsは保存版との分離に、`ProductBackupAdapter`はpackageの汎用orchestratorとPC固有codec/policy/Foundation capabilityの構成点に、FileGatewayはDOM固有処理の隔離に必要である。汎用protocolはpackage、置換・保守・単一writeの原子性はFoundationが所有し新設しない。
- **Steering compliance**: MV3同梱コード、最小権限、10MB上限、架空fixture、service worker寿命への非依存を維持する。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|---|---|---|---|
| Language | TypeScript 7.x strict | 交換形式、結果、状態契約 | `any`禁止、入力は`unknown` |
| Runtime validation | configured Zod Mini 4.4.3 | 交換形式のstrict shape、JSON safety、型推論 | canonical入口だけを利用し、Zod issueを公開しない |
| UI | React 19系 / React DOM / CSS | 管理操作、確認、案内 | 既存mount契約を維持 |
| Messages | ui-messages public resolver / 日英catalog | 案内、操作、分類済みerror、再試行方針 | `useMessages()`だけを利用しcatalog parityを維持 |
| File I/O | File、Blob、URL、TextEncoder | 読取、生成、UTF-8サイズ | Chrome 116標準、新規依存なし |
| Data | `BackupSnapshotReadPort` / `BackupRestoreDataPort` | export参照、commit point付き正常置換・異常root回復 | 通常CRUD・Storage API・fence直接利用なし |
| Generic backup | `@pc-build-planner/local-data/backup` public port | create/preflight/reassess/commit/finalize protocol | product codecとFoundation capabilityを注入し、deep importしない |
| Context | project-context public ports | 置換前guard、成功後refresh | registry・draft・preference非公開 |
| Test | Node test runner / jsdom / Playwright | 純粋契約、統合、UI検証 | 架空データのみ |

## File Structure Plan

```text
src/features/backup-restore/contracts.ts           # Envelope、preview、commit outcome、pre-commit cleanup、finalization、error契約
src/features/backup-restore/public.ts              # BackupRestoreSectionMount、factory、最小dependency inputの唯一の公開入口
src/features/backup-restore/section-mount.ts       # section依存組立、mount handle、冪等cleanup
src/features/backup-restore/backup-schema.ts       # configured schema primitiveで組むowner-local Envelope schema定義
src/features/backup-restore/exchange.ts            # backup-schemaを使う交換形式検証、形式移行、LocalDataRoot変換
src/features/backup-restore/capacity-policy.ts     # 16 MiB入力上限とexport自己復元可能性の単一policy
src/features/backup-restore/product-backup-adapter.ts # package orchestratorへPC codec/policyとFoundation capabilityを設定
src/features/backup-restore/service.ts             # バックアップ生成と復元preflight・commit・pre-commit cleanup再開・finalize
src/features/backup-restore/context-lifecycle.ts   # replacement guardとpost-commit refreshの順序調整
src/features/backup-restore/file-gateway.ts        # File読取とBlobダウンロード
src/features/backup-restore/state.ts               # 選択、検証、確認、commit retry、finalize-only、refresh-only状態
src/features/backup-restore/view.tsx                # 管理UI、警告、preview、確認のReact component
src/features/backup-restore/operation-kind.ts       # shell canonical read/recovery分類のowner-local参照
src/features/backup-restore/react-root.tsx          # read/recovery可否の購読、FeatureMountContextとReact rootの接続・cleanup
src/features/backup-restore/styles.css             # 管理セクションと状態表現
src/ui-messages/catalog/ja/backup.ts               # 既存backup keyに回復・finalization・refresh・再試行案内を追加
src/ui-messages/catalog/en/backup.ts               # 日本語と同一key・placeholderの英語メッセージを追加
tests/fixtures/backup.ts                           # 架空の現行・旧版・不正Envelope
tests/features/backup-restore/exchange.test.ts     # 形式検証、移行、往復、参照検証
tests/features/backup-restore/capacity-policy.test.ts # 保存上限rootのartifact最大サイズと自己復元可能性
tests/features/backup-restore/product-backup-adapter.test.ts # package/foundation public contractのconsumer検証
tests/features/backup-restore/service.test.ts      # export、preflight、commit、pre-commit cleanup再開、失敗不変性
tests/features/backup-restore/file-gateway.test.ts # UTF-8読取、ファイル名、Blob生成
tests/features/backup-restore/state.test.ts        # 状態遷移、確認、重複抑止、commit/finalize/refresh再試行
tests/features/backup-restore/view.test.tsx        # 区画の案内、preview、エラー、操作可否
tests/features/backup-restore/section-mount.test.tsx # 公開mount、失敗、cleanup、二重cleanup
tests/features/backup-restore/integration.test.ts  # 全データ往復とRepository回帰
tests/features/backup-restore/backup-restore-flow.integration.test.tsx # sectionからの復元全体flow
tests/features/backup-restore/recovery.integration.test.ts # degraded startupからの明示的回復とfinalize-only retry
tests/features/backup-restore/project-context-lifecycle.test.ts # guard、finalization、refresh-only retry
tests/tooling/backup-restore-consumer.ts           # package backup subpathとFoundation capabilityの公開境界fixture
tests/ui-messages/catalog-parity.test.ts            # backup日英key・placeholder parity
e2e/backup-restore.spec.ts                         # settings経由のexport→改変→復元→再起動
```

既存実装へ`product-backup-adapter.ts`と対応consumer test/fixtureを追加し、`service.ts`を既存UI向けfacadeとしてadapterへ委譲する。`backup-schema.ts`、`capacity-policy.ts`、`context-lifecycle.ts`、exchange/file/UI/stateと既存testは責務を維持する。`ProductBackupAdapter`だけがpackage backup public portとFoundation capabilityの両方を受け取り、PC codec/mapping/policyを設定する。`operation-kind.ts`はshellのcanonical `read | recovery`だけを参照し、shell composition fileは本specの変更対象に含めない。

`project-context`の内部ロジックは変更せず、公開された`ProjectContextReplacementGuardPort`と`ProjectContextCommandPort`だけを消費する。実装順は、(1) package backup public contract、(2) Foundationの用途限定`BackupRestoreDataPort`、(3) project-context public ports、(4) 本specの`ProductBackupAdapter`とfeature/UI、(5) application-shell ownerによるproduction compositionとする。本specは手順4までを所有し、shell fileを編集しない。

過去task 5.1でDEF-011を解消するため行ったproduction wiringは履歴として残るが、`v0.5.0-boundary-reconciliation`以後のcanonical所有者はapplication-shellである。本変更は既存wiringの意味や挙動を変更せず、今後のcomposition実装を本specへ再導入しない。

## System Flows

### バックアップ生成

```mermaid
sequenceDiagram
    participant User
    participant State
    participant Service
    participant Repo
    participant Mapper
    participant File
    User->>State: create backup
    State->>Service: export
    Service->>Repo: read validated root
    Repo-->>Service: local data root
    Service->>Mapper: to envelope
    Mapper-->>Service: versioned JSON value
    Service-->>State: file artifact
    State->>File: download artifact
    File-->>User: JSON file
```

### 復元

```mermaid
sequenceDiagram
    participant User
    participant File
    participant State
    participant Restore
    participant Exchange
    participant Guard
    participant Foundation
    participant Context
    User->>File: select JSON
    File-->>State: text and byte size
    State->>Restore: preflight unknown input
    Restore->>Exchange: parse validate migrate map
    Exchange-->>Restore: storage root candidate and preview
    Restore->>Foundation: assess normal or recovery candidate
    Foundation-->>Restore: opaque assessment ticket or rejection
    Restore-->>State: restore ticket and preview
    State-->>User: replacement confirmation
    User->>State: confirm
    State->>Guard: prepare replacement
    Guard-->>State: permit or draft confirmation
    User->>State: approve draft impact
    State->>Guard: confirm and begin permit
    State->>Restore: commit ticket
    Restore->>Foundation: commit candidate mode and assessment ticket
    Foundation-->>Restore: committed or finalization required
    State->>Guard: complete succeeded
    opt finalization required
        State->>Foundation: finalize only
        Foundation-->>State: finalized
    end
    State->>Context: refresh
    Context-->>State: ready empty or unavailable
    Restore-->>State: restore summary and context status
```

`RestoreTicket`はcandidate、preview、`normal | recovery` mode、Foundation発行のopaque `BackupRestoreAssessmentTicket`だけを非永続stateへ保持する。preflightは正常assessmentを先に試し、current rootが`corrupt-data | unsupported-version`の場合だけ同じcandidateを`assessRecovery`へ渡す。candidate拒否をcurrent anomalyと混同しない。commit前にreplacement guardをprepare/confirmし、`begin`成功後だけFoundation commitを開始する。guard拒否・取消ではticketと現在選択を保持する。`stale-assessment`では古いassessment ticketを再送せず、保持したcandidateを再assessmentして新しいticketとpreviewを作り、現在データが変化した前提で置換確認とguard lifecycleを最初からやり直す。

Foundationはcommit開始時に同じ固定名Web Lock内でassessment ticketのroot revisionまたはraw fingerprint、candidate digest、modeを再照合する。preflight後からこの線形化点までに通常mutationが確定していれば`stale-assessment`としてwrite前に拒否し、その変更を上書きしない。照合成功と同じ排他区間でpersistent maintenance/recovery controlをactiveにし、以後の通常mutationはroot writeとcleanupが完了するまでFoundationで拒否する。shell gateはこの状態のUI projectionであり、排他の認可根拠にはしない。control取得後かつroot write前の失敗でcleanupを完了できない場合、Foundationは`precommit-cleanup-pending`を返し、control ownershipを同じassessment ticketへ結び付けたまま保持する。同じticketによる次の`commit`だけがcleanupを先に冪等再開し、cleanup完了後に最新rootとcandidateを再assessmentしてcommitを再開できる。cleanup再開中はroot writeを行わず、別ticketと通常mutationはfail closedで拒否する。

Foundationはmode別の再assessment、root write、cleanupを一つのcommit protocolとして実行し、root write前の失敗を`Result`のerror、root write後を`committed`または`committed-finalization-required`として返す。`precommit-cleanup-pending`はroot未変更を表すretryable errorであり、stateは元のrestore ticketを保持して新しいguard permitから同じFoundation commitを再実行する。Foundationは同じassessment ticketの未完了controlだけを再開し、cleanup完了後の再assessmentがstaleならwriteせず通常の`stale-assessment`へ移す。`stale-assessment`へ移った時点で同ticketの再送能力は失われ、backupはcandidateの再assessmentへ戻る。ticketを失った場合は永続leaseの失効後に新しいassessmentとcontrol generationを要求し、古いownerを暗黙再利用しない。root write後のopaque finalization ticketはcleanupだけを再開でき、root writeを実行できない。Foundationはactiveなpost-commit controlからpending finalization ticketを再発見できる用途限定queryを同portで提供し、section再mount時にbackup stateがfinalize-only状態を再水和する。両committed outcomeでguardを`complete("succeeded")`し、finalization完了後にだけcontext `refresh()`を呼ぶ。finalizationまたはrefresh失敗は復元成功を取り消さず、それぞれ`restored-finalization-required`、`restored-context-unavailable`へ移す。再試行は対応する`finalize()`または`refresh()`だけを呼び、Foundation commitを再実行しない。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|---|---|---|---|---|
| 1.1, 1.2, 1.4, 1.6, 1.7 | 全データEnvelope生成と自己復元可能性 | BackupService、ExchangeMapper、RestoreFileCapacityPolicy | export | バックアップ生成 |
| 1.3 | ファイル名 | FileGateway | download | バックアップ生成 |
| 1.5 | 読取失敗 | BackupService、BackupRestoreState | BackupError | バックアップ生成 |
| 2.1, 2.2, 2.3 | 交換契約 | ExchangeValidator、ExchangeMapper | BackupEnvelope | 両フロー |
| 2.4, 2.5 | 形式版と移行 | ExchangeMigration | migrate | 復元 |
| 3.1, 3.2, 3.3, 3.5 | 事前検証 | RestoreService、ExchangeValidator | preflight | 復元 |
| 3.4 | ファイル安全上限と保存容量拒否 | RestoreService、RestoreFileCapacityPolicy、BackupRestoreDataPort | preflight / assessReplacement / assessRecovery | 復元 |
| 3.6 | preview | RestoreService、BackupRestoreView | RestorePreview | 復元 |
| 4.1, 4.2 | 置換確認と取消時保持 | BackupRestoreState、BackupRestoreView | RestoreTicket | 復元 |
| 4.3, 4.5, 4.6 | 全体置換と共通操作ロック | ProductBackupAdapter、BackupRestoreDataPort、BackupRestoreState | commit / finalize-only retry | 復元 |
| 4.4 | 成功反映 | BackupRestoreState、BackupRestoreSectionMount | RestoreSummary | 復元 |
| 4.7, 4.8 | 未保存編集保護 | RestoreContextLifecycle、BackupRestoreState | ProjectContextReplacementGuardPort | guarded restore |
| 5.1, 5.2, 5.3, 5.4 | 原子的失敗回復 | RestoreService、BackupRestoreDataPort | not-committed / committed outcome | 復元 |
| 5.5 | ticket保持と再試行 | BackupRestoreState | retryRestore / finalize | 復元 |
| 5.6, 5.7 | 破損・未対応rootからの明示的回復 | ProductBackupAdapter、BackupRestoreDataPort、BackupRestoreView | recovery assessment / commit | recovery restore |
| 6.1, 6.2, 6.3, 6.4 | 設定内の区画と案内 | BackupRestoreView、BackupRestoreState、BackupRestoreSectionMount | ViewState、FeatureMountContext | 両フロー |
| 6.5 | 値を露出しない診断 | 全検証・サービス・View | 分類済みerror code | 両フロー |
| 6.6 | 非永続ドラフト | BackupRestoreState | transient state | 復元 |
| 6.7 | 独立navigationを要求しない埋め込み | BackupRestoreSectionMount | mount | Settings mount |
| 6.8 | context unavailable時の到達性 | BackupRestoreSectionMount、BackupRestoreView | recovery-capable section contract | Settings mount |
| 6.9, 6.10, 6.11 | 置換後refreshと単独再試行 | RestoreContextLifecycle、BackupRestoreState、BackupRestoreView | ProjectContextCommandPort.refresh | post-restore refresh |
| 7.1, 7.3 | package public port利用とdeep import禁止 | ProductBackupAdapter | BackupOrchestrator factory | adapter composition |
| 7.2, 7.4 | PC codec・mapping・policyとFoundation capability接続 | ProductBackupAdapter、ExchangeMapper、RestoreFileCapacityPolicy | BackupCodec / BackupRestoreDataPort | 両フロー |
| 7.5 | 既存安全性の非回帰 | ProductBackupAdapter、RestoreContextLifecycle、BackupRestoreState | commit/finalize/refresh | guarded restore |
| 7.6 | shell compositionの分離 | BackupRestoreSectionMount、ProductBackupAdapter | public factory / section mount | downstream composition |
| 7.7, 7.8 | consumer・contract・UI・E2E検証 | ProductBackupAdapter、BackupRestoreView | public contract fixtures | 全フロー |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|---|---|---|---|---|---|
| ExchangeValidator | Exchange | unknownからEnvelopeを交換形式専用規則で検証 | 2.1–3.3, 6.5 | Exchange contracts P0 | Service |
| ExchangeMigration | Exchange | 対応旧形式を現行へ変換 | 2.4, 2.5, 5.3 | ExchangeValidator P0 | Service |
| ExchangeMapper | Exchange | Envelopeと保存ルートを相互変換 | 1.1–2.3 | DomainModel P0 | Service |
| ProductBackupAdapter | Product adapter | package orchestratorへPC codec/mapping/policyとFoundation backup capabilityを設定 | 1.1–7.8 | package backup public port P0、BackupRestoreDataPort P0、PC codec P0 | Service, Consumer contract |
| BackupService | Feature | 検証済みデータを自己復元可能なfile artifact化 | 1.1–1.7 | BackupSnapshotReadPort P0、Mapper P0、RestoreFileCapacityPolicy P0 | Service |
| RestoreService | Feature facade | UI向け既存操作をProductBackupAdapterへ委譲 | 3.1–5.7 | ProductBackupAdapter P0 | Service |
| RestoreContextLifecycle | Feature | replacement guardとpost-commit refreshを順序付け | 4.7, 4.8, 6.9–6.11 | project-context ports P0 | Service, State |
| BackupRestoreDataPort | Foundation port | commit point付き置換とfinalize-only retryだけを公開 | 3.1–5.7 | Foundation authority P0 | Service |
| BackupSnapshotReadPort | Persistence (read-only) | export用の検証済みsnapshot参照 | 1.1, 1.4, 1.5 | FoundationScopedDataPort P0 | Service |
| FileGateway | UI adapter | extension pageのファイルI/O | 1.3, 3.1 | Web API P0 | Service |
| RestoreFileCapacityPolicy | Exchange | 保存上限と分離した安全な入力上限およびexport自己復元不変条件を所有 | 1.7, 3.4 | TextEncoder P0、ExchangeMapper P0 | Service |
| BackupRestoreState | UI state | ticket、guard、commit、finalize-only・refresh-only retry状態 | 1.5, 3.5–6.11 | Services P0 | State |
| BackupRestoreView | UI | 操作、案内、preview、guard確認、回復・refresh状態 | 3.2, 3.6, 4.1–6.11 | State P0 | State |
| BackupRestoreSectionMount | UI adapter | context状態に依存せずsection lifecycleを提供 | 1.1–6.11 | FeatureMountContext P0、BackupRestoreView P0 | Service, State |

### Exchange Layer

#### ExchangeValidator and Migration

```typescript
interface ExchangeValidator {
  validate(input: unknown): Result<CurrentBackupEnvelope, ExchangeValidationError>;
}

interface ExchangeMigration {
  toCurrent(input: unknown): Result<CurrentBackupEnvelope, ExchangeVersionError | ExchangeValidationError>;
}
```

- `ExchangeValidationError`は`path`と`code`だけを公開し、問題値を含めない。
- JSON object自身のプロパティだけを読み、未知必須版、危険な余剰内容、非JSON値を拒否する。
- 旧版移行は連続する純粋関数とし、各段階を再検証する。将来版は変換しない。

#### ExchangeMapper

```typescript
interface ExchangeMapper {
  fromRoot(root: LocalDataRoot, createdAt: UtcIsoDateTime): CurrentBackupEnvelope;
  toRoot(envelope: CurrentBackupEnvelope): Result<LocalDataRoot, ExchangeMappingError>;
}
```

MapperはID、日時、確認値、出典、正規化属性、候補所属、構成参照を保持する。保存`schemaVersion`は交換データから信頼せず、現行保存スキーマ版を用いて保存root候補を構築する。この候補は`unknown`として`BackupRestoreDataPort`へ渡し、最終的なschema検証・参照整合性・容量判定はFoundationが行う（feature側でSchemaValidatorや容量判定を重複実行しない）。

### Feature Layer

#### ProductBackupAdapter

```typescript
interface ProductBackupAdapterDependencies {
  readonly backupOrchestratorFactory: BackupOrchestratorFactory;
  readonly snapshot: BackupSnapshotReadPort;
  readonly replacement: BackupRestoreDataPort;
  readonly codec: BackupCodec<LocalDataRoot, RestoreInput, unknown, BackupArtifact, RestorePreview, ProductBackupCodecError>;
  readonly capacityPolicy: RestoreFileCapacityPolicy;
  readonly errorPolicy: ProductBackupErrorPolicy;
}

interface ProductBackupAdapter {
  readonly backup: BackupService;
  readonly restore: RestoreService;
}
```

factoryは`@pc-build-planner/local-data/backup`の公開subpathからだけ受け取り、PC codecへ`ExchangeValidator`、`ExchangeMigration`、`ExchangeMapper`、artifact命名、容量policy、製品error mappingを閉じ込める。Foundation capabilityは汎用orchestratorが要求するroot assessment/replacement/finalization portへ狭めて渡す。明示確認とproject-context guard/refreshは製品UI lifecycleに残し、汎用orchestratorへ利用者操作やshell stateを持ち込まない。adapterはpackage protocolを複製せず、既存`BackupService`/`RestoreService`形状をfacadeとして公開する。

#### BackupService

```typescript
interface BackupService {
  create(): Promise<Result<BackupArtifact, BackupError>>;
}

interface BackupArtifact {
  readonly filename: string;
  readonly mimeType: "application/json";
  readonly json: string;
  readonly byteLength: number;
}
```

`BackupSnapshotReadPort`から検証済みルートを読み、現在時刻でEnvelopeを作り、決定的なJSONへ直列化する。読取、変換、直列化の失敗時はartifactを返さない。

#### RestoreService

```typescript
interface RestoreService {
  preflight(input: RestoreInput): Promise<Result<RestoreTicket, RestoreError>>;
  reassess(ticket: RestoreTicket): Promise<Result<RestoreTicket, RestoreError>>;
  commit(ticket: RestoreTicket): Promise<Result<RestoreCommitOutcome, RestoreError>>;
  finalize(ticket: RestoreFinalizationTicket): Promise<Result<RestoreSummary, RestoreFinalizationError>>;
  findPendingFinalization(): Promise<Result<RestoreFinalizationTicket | null, RestoreFinalizationError>>;
}

type RestoreCommitOutcome =
  | { readonly kind: "committed"; readonly summary: RestoreSummary }
  | {
      readonly kind: "committed-finalization-required";
      readonly summary: RestoreSummary;
      readonly finalization: RestoreFinalizationTicket;
    };

interface RestoreFinalizationTicket {
  readonly id: string;
}

interface RestoreTicket {
  readonly candidate: unknown;
  readonly preview: RestorePreview;
  readonly mode: "normal" | "recovery";
  readonly assessment: BackupRestoreAssessmentTicket;
}

interface RestoreInput {
  readonly text: string;
  readonly byteLength: number;
}
```

`preflight`は交換層の検証後、正常assessmentを試す。current anomalyだけを表す`corrupt-data | unsupported-version`ではrecovery assessmentへ切り替え、candidate rejection、quota、storage failureでは切り替えない。assessmentの必要bytesとcurrent anomaly分類だけをpreview/ticketへ写し、fingerprint、cursor、fenceは保持しない。`reassess`は保持済みcandidateを同じ分岐へ戻して新しいassessment ticketとpreviewを発行し、古いticketを破棄する。stateは新しいpreviewを表示して置換確認から再開する。

`commit`はcandidateと期待mode、assessment ticketをFoundationへ渡す。Foundationはmode別protocolを実行し、root write前の失敗だけをerrorとして返す。`precommit-cleanup-pending`では元のrestore ticketを保持し、利用者の再試行時に新しいguard permitを得て同じticketを再送する。Foundationは一致する未完了controlのcleanupを先に再開し、root write 0件のままcleanupを完了してから再assessmentとcommitへ進む。`stale-assessment`では`reassess`以外を許可しない。root write後は必ずcommitted outcomeとなり、cleanup未完了時は値やfenceを含まないopaque `RestoreFinalizationTicket`へ写像する。`findPendingFinalization`はFoundationの用途限定queryからactiveなpost-commit ticketだけを復元し、candidate、raw root、control情報を取得しない。`finalize`はこのticketでcleanupと通常query確認だけを再試行し、root write、guard prepare、利用者の置換確認を繰り返さない。再mount後にsummaryがない場合はfinalize成功後に`BackupSnapshotReadPort`から検証済みrootの件数を再構築する。失敗時は元のrestore ticketまたはfinalization ticketを状態に応じて保持する。

#### RestoreContextLifecycle

```typescript
interface RestoreContextLifecycle {
  prepare(): Promise<Result<RestoreGuardPreparation, RestoreContextError>>;
  confirm(confirmationId: string): Promise<Result<RestoreGuardPermit, RestoreContextError>>;
  cancel(confirmationId: string): Result<void, RestoreContextError>;
  begin(permitId: string): Result<void, RestoreContextError>;
  complete(permitId: string, outcome: "succeeded" | "failed" | "cancelled"): Promise<Result<void, RestoreContextError>>;
  refresh(): Promise<Result<ProjectContextSnapshot, RestoreContextError>>;
}
```

これはproject-context public portsを順序付けるowner-local adapterであり、独自registryを持たない。guard permitの`begin`後だけRestoreServiceを呼ぶ。commit前失敗・取消では対応outcomeでpermitを閉じ、ticketとselectionを保持する。committed outcomeでは`succeeded` completionを一度だけ呼ぶ。上流`complete`は通知前にpermitをterminal closedへ遷移させるため、notification失敗でも排他状態は残らない。finalizationが必要なら先にfinalize-only状態へ移り、完了後にだけrefreshする。completion/notification失敗とrefresh失敗はいずれも成功済みrootをrollbackせず、安全な診断とpost-commit stateへ写像する。retryはpermitまたはFoundation commitを再使用しない。

### Persistence Layer

#### Foundation contracts consumed

exportでは通常feature向けportから切り出したread-only viewを、restoreではFoundationが公開するbackup専用契約を消費する。compositionだけが元のportを保持し、feature内部へ通常mutation能力を渡さない。

```typescript
interface BackupSnapshotReadPort {
  query<T>(query: RootQuery<T>): Promise<Result<T, FoundationError>>;
}

interface BackupRestoreDataPort {
  assessReplacement(input: unknown): Promise<Result<BackupRestoreAssessment, FoundationError>>;
  assessRecovery(candidate: unknown): Promise<Result<BackupRestoreAssessment, RecoveryAssessmentError | FoundationError>>;
  commit(command: BackupRestoreCommitCommand): Promise<Result<BackupRestoreCommitOutcome, FoundationError>>;
  findPendingFinalization(): Promise<Result<BackupRestoreFinalizationTicket | null, FoundationError>>;
  finalize(ticket: BackupRestoreFinalizationTicket): Promise<Result<ReplacementReceipt, FoundationError>>;
}
```

`BackupRestoreAssessment`はpreview用のmode・必要bytes・current anomalyとopaque ticketだけを公開し、root revision、raw fingerprint、candidate digest、cursorを公開しない。`BackupRestoreCommitCommand`はcandidate、expected mode、assessment ticketを必須とする。`BackupRestoreCommitOutcome`は`committed | committed-finalization-required`の判別共用体であり、Foundationだけがroot writeのcommit pointを判定する。root write前にcontrol cleanupが未完了となった場合は値を含まない`precommit-cleanup-pending` errorを返し、同じassessment ticketの再送だけでcleanupを冪等再開する。再開はroot write 0件、同じowner/generationの照合、cleanup後の最新root再assessmentを必須とし、別ticket、stale owner、期限切れleaseを暗黙継続しない。再assessmentがstaleなら同ticketを終了させ、consumerに新規assessmentを要求する。finalization ticketは対応するcommitとcleanup世代へ結び付くopaque値で、`finalize`はrootを再置換できない。Foundationの内部controlはcandidate digestと期待commit revisionをroot write前から永続保持し、現在rootが両方へ一致した場合だけpost-commitと分類する。`findPendingFinalization`はこの永続判定が成立したactive controlからだけ同じopaque ticketを再構築し、pre-commit control、digest、revision、raw root、owner、generationを公開しない。このportは通常query、mutate、raw root、Storage、lock、Repository、fence、authority factoryを公開しない。正常/回復の両経路は同じWeb Lock、validation、capacity、assessment ticket再照合、owner/generation再検証、単一root writeを使用する。

composition ownerは`FoundationScopedDataPort.query`だけをfrozen `BackupSnapshotReadPort`へ狭め、`BackupRestoreDataPort`とproject-contextのreplacement/command capabilityとともに本機能のsection factoryへ供給する。settingsには`BackupRestoreSectionMount`だけを渡し、read/data/context port、finalization ticket、stateを露出しない。

### UI Layer

#### FileGateway

```typescript
interface FileGateway {
  read(file: File): Promise<Result<RestoreInput, FileError>>;
  download(artifact: BackupArtifact): Result<void, FileError>;
}
```

JSONファイルを一つだけ受け、サイズを読取前に確認する。ダウンロード用object URLは操作後に破棄する。内容解釈やRepositoryアクセスはしない。

#### BackupRestoreState and View

stateは`idle`、`exporting`、`validating`、`awaiting-replacement-confirmation`、`awaiting-draft-confirmation`、`restoring`、`restored-finalization-required`、`refreshing-context`、`succeeded`、`restored-context-unavailable`、`failed`の判別共用体とする。取消、guard拒否、commit前失敗ではrestore ticketと有効previewを保持する。`precommit-cleanup-pending`ではroot未変更を表示し、同じticketと新しいguard permitによる`retry-restore`だけを許可する。`stale-assessment`では同ticket commitを無効化し、candidateの`reassess-restore`だけを許可する。容量超過では選択fileと表示可能な検証結果を保持するが、ticketを再送可能な状態として扱わず、同一入力の復元再実行を禁止して別file選択だけを許可する。commit後cleanup失敗ではsummaryとfinalization ticketだけを保持し、復元の再実行操作を公開しない。section mount時は通常idle表示の前にpending finalizationを照会し、存在すればsummary省略可能な`restored-finalization-required`を再水和する。`restored-finalization-required`はfinalize-only、`restored-context-unavailable`はrefresh-onlyへretry actionを固定する。ファイル再選択とsection unmountで未commit ticketを破棄するが、Foundation所有のpending finalization能力は破棄しない。

失敗状態は表示codeだけでなく`retryPolicy`を保持する。`retryable`は同じartifact生成または未commit ticketによる再試行、`action-required`は別file選択または未保存編集の保存/破棄後の再試行、`unsupported`は同一入力の再実行を許可しない。容量超過は空き容量確保によるretryへ分類せず`unsupported`へ固定する。commit後はこの一般policyへ戻さず、finalize-onlyまたはrefresh-onlyの専用actionを維持する。

viewはバックアップと復元をReact componentの別領域として表示し、消失リスク、自動保存・同期なし、置換確認、件数summary、分類済みエラーと再試行方針を`ui-messages` public resolverの`MessageKey`へ写像する。日本語・英語で同一keyとplaceholderを保ち、`useMessages()`で解決した固定安全文言を通常のJSX childとして描画する。内部validation path、商品値、完全URL、fingerprintは表示しない。settingsの`h3`区画見出し配下へ埋め込まれるexport／restore見出しは`h4`とし、owner内部で見出し階層を維持する。

#### BackupRestoreSectionMount

```typescript
export interface BackupRestoreSectionMount {
  mount(context: FeatureMountContext): Promise<FeatureMountHandle>;
}

export interface BackupRestoreSectionDependencies {
  readonly read: BackupSnapshotReadPort;
  readonly restore: BackupRestoreDataPort;
  readonly replacementGuard: ProjectContextReplacementGuardPort;
  readonly projectContext: Pick<ProjectContextCommandPort, "refresh">;
  readonly state?: BackupRestoreState;
}

export function createBackupRestoreSectionMount(
  dependencies: BackupRestoreSectionDependencies,
): BackupRestoreSectionMount;
```

factoryは`BackupService`、`RestoreService`、`RestoreContextLifecycle`、`BackupRestoreState`、`FileGateway`を構成し、`context.container`へReact rootを一つだけmountする。project-context snapshotまたは保存rootがunavailableでもmountを拒否せず、file選択・preflight・recovery commitを利用可能にする。`state?`はcontract test用注入seamであり、productionはmountごとに新しいidle stateを生成する。`context.operationPolicy`ではrestore commitを`recovery`として判定し、通常maintenance中は拒否、`recovery-required`では許可する。section表示、backup export、file選択、preflightはread-onlyとして維持する。公開入口はこのinterface、factory、factory入力型だけとし、read/data/context port、React component、service、state accessorをsettingsへ公開しない。既存のrollback、冪等cleanup、再試行可能なunmount ownershipを維持する。

## Data Models

```typescript
interface CurrentBackupEnvelope {
  readonly product: "pc-build-planner";
  readonly formatVersion: 1;
  readonly createdAt: UtcIsoDateTime;
  readonly data: BackupDataV1;
}

interface BackupDataV1 {
  readonly projects: readonly BackupProject[];
  readonly parts: readonly BackupCandidatePart[];
  readonly currentBuilds: readonly BackupCurrentBuild[];
}

interface RestorePreview {
  readonly createdAt: UtcIsoDateTime;
  readonly formatVersion: number;
  readonly projectCount: number;
  readonly partCount: number;
  readonly currentBuildCount: number;
  readonly estimatedBytes: number;
  readonly mode: "normal" | "recovery";
  readonly currentAnomaly?: "corrupt-data" | "unsupported-version";
}

type RestoreCompletion =
  | { readonly kind: "restored"; readonly summary: RestoreSummary; readonly context: "ready" | "empty" }
  | {
      readonly kind: "restored-finalization-required";
      readonly summary: RestoreSummary;
      readonly finalization: RestoreFinalizationTicket;
    }
  | { readonly kind: "restored-context-unavailable"; readonly summary: RestoreSummary };

type RetryPolicy =
  | { readonly kind: "retryable"; readonly action: "retry-export" | "retry-restore" | "reassess-restore" }
  | {
      readonly kind: "action-required";
      readonly action: "select-another-file" | "resolve-draft";
    }
  | { readonly kind: "unsupported" };

interface RestoreFileCapacityPolicy {
  readonly maxInputBytes: 16777216;
  accepts(byteLength: number): boolean;
  assertExportRestorable(artifactByteLength: number): Result<void, { readonly kind: "backup-capacity-invariant" }>;
}
```

交換エンティティはFoundationの値をJSON互換の読み取り専用フィールドへ写像するが、保存ルートの`schemaVersion`を含めない。配列内IDは一意、候補の`projectId`は存在するProject、構成の`projectId`と各`partId`は同じProject内を参照し、数量は正整数とする。互換性結果、生HTML、画像バイナリ、実行可能値は契約外である。`RestoreFileCapacityPolicy.maxInputBytes`は16 MiB（`16 * 1024 * 1024` bytes）とし、10 MiBの保存上限とは分離する。

16 MiBは単一のworst-case fixtureから推測しない。`capacity-policy.ts`は、Foundationが容量判定に使う`JSON.stringify({ localDataRoot: root })`の10 MiB上限、Envelope固定overhead、Mapperが各scalarを一回だけ写像する規則、各entity variantの保存側と交換側のproperty-name・delimiter差分、UUID・日時・enum・正整数の最小直列化長から、保存上限内で取り得る交換Envelopeの上界を決定的に導出する。`capacity-policy.test.ts`は全entity variantの差分表を列挙し、導出上界が16 MiB以下であること、Mapperのfield追加・重複写像・名称変更時に未分類fieldとして失敗することを検査する。この上界gateが成立しない変更ではbuildを失敗させ、入力上限または交換形式版の明示変更を要求する。BackupServiceも実artifactをdownload前に同policyで検査するため、成功したartifactは同版のfile preflightで拒否されない。将来の交換形式では上界を版ごとに再導出し、暗黙に上限を拡大しない。

## Error Handling

- `FileError`: 未選択、複数選択、読取不能、事前サイズ超過。
- `ExchangeError`: JSON解析、必須構造、非対応版、path付き値・参照問題。入力値は表示しない。
- `RestoreError`: 上記に加え`quota`、`storage`、`candidate-invalid`、`current-corrupt`、`current-unsupported`、`maintenance-active`、`recovery-active`、`stale-assessment`、`stale-recovery-state`、`stale-ticket`、`precommit-cleanup-pending`を判別する。current anomalyとcandidate rejectionを別fieldで保持し、値やfingerprintは表示しない。`precommit-cleanup-pending`はroot未変更かつ同じassessment ticketでcleanup再開可能な場合だけ返す。
- `RestoreContextError`: `guard-failed`、`confirmation-stale`、`permit-stale`、`context-unavailable`、`refresh-failed`を判別する。guard失敗はcommit前、refresh失敗はcommit後としてstate遷移を分ける。
- `RestoreFinalizationError`: root write済みであることを保持したまま`cleanup-unavailable | finalization-stale`を判別し、同じopaque ticketによるfinalize-only retryだけを許可する。
- `BackupError`: `corrupt-current-data`、`unsupported-current-data`、`storage`、`serialization`、`backup-capacity-invariant`を判別する。最後のcodeは生成artifactが同版のfile preflight上限を超えた内部契約違反であり、downloadを開始せず安全な固定文言を表示する。
- commit前失敗ではticketを保持した`failed`へ遷移する。Foundationがcommitted outcomeを返した後は復元失敗へ戻さず、cleanup未完了、guard notification失敗、refresh失敗をsummary付きのpost-commit stateへ分離する。

commit前のerror codeと許可actionは次の単一対応表で固定する。stateとViewは個別判定を重複せず、このpolicyを介して理由と再試行可能性を表示する。

| Error category | Retry policy | Allowed action |
|---|---|---|
| 一時的なread・storage・lock失敗 | `retryable` | `retry-export` または保持中ticketの`retry-restore` |
| stale assessment | `retryable` | 保持中candidateを再assessmentする`reassess-restore`。新ticket・preview・置換確認・guard permitを取得し、古いticketを再送しない |
| root write前のcontrol cleanup未完了 | `retryable` | 新しいguard permitと保持中ticketで`retry-restore`。Foundationはcleanupを先に再開し、cleanup中のroot writeは0件 |
| 復元後rootまたは書込時の容量超過 | `unsupported` | 同一入力の復元再実行を無効化し、選択状態を保持したまま別file選択だけを許可 |
| guard拒否・未保存draft | `action-required` | 保存または破棄後に新しいpermitで再試行 |
| file読取・JSON・構造・参照・入力ファイルサイズ問題 | `action-required` | `select-another-file`。現在の永続rootと選択は不変 |
| 将来の交換版・移行経路のない旧版・serialization契約違反 | `unsupported` | 同一入力の再実行を無効化し、対応版または別fileを案内 |
| export自己復元容量不変条件違反 | `unsupported` | artifactを生成せず、製品更新が必要な内部契約違反として案内 |

root write後の`committed-finalization-required`とcontext refresh失敗は上表のcommit前policyに写像せず、それぞれfinalize-only、refresh-onlyだけを許可する。

利用者向け診断とログは分類済みエラーcodeを基準とし、検証用pathは内部結果に留めて表示・記録しない。商品名、URL、価格、ファイル本文を含めない。

## Testing Strategy

- **Consumer contract**: packageのbackup public subpathとFoundationのbackup専用capabilityだけで`ProductBackupAdapter`を構成でき、deep import、通常CRUD、raw storage/lock、shell compositionへの依存がないことをcompile fixtureとnegative ownership scanで固定する（7.1–7.7）。
- **Adapter contract**: PC codec/mapping/policyを注入したgeneric orchestratorでcreate/preflight/reassess/commit/finalizeが既存facadeと同じ結果へ写像され、明示確認・guard前にcommitしないこと、失敗時root保持、commit後finalize/refresh-onlyを検証する（7.2–7.8）。
- **Unit**: Envelope全フィールド、未知・旧・将来版、非JSON値、禁止内容、ID重複、孤立候補、別プロジェクト構成参照、Mapper往復同値性を検証する。
- **Foundation port integration**: 正常/異常rootでassessment→commit point→finalizationを検証する。preflight後に先行mutationが確定した場合はassessment ticketをstale拒否して先行変更を保持し、古いticketの再送を拒否したまま新assessmentだけを許可する。commit線形化後の後続mutationはmaintenance/recovery controlで拒否する。候補不正、容量超過、stale cursor、write前失敗では元rootが不変である。control取得後のwrite前cleanup失敗は`precommit-cleanup-pending`となり、同じassessment ticketでcleanupを再開する間のroot writeが0件、別ticketが拒否、worker再生成後もowner/generationが一致し、cleanup後だけ再assessmentしてcommit可能であることを確認する。write後cleanup失敗では`committed-finalization-required`だけを返し、section unmount・新stateでのremount後にpending ticketを再発見し、finalize retry中のroot writeが0件であることを確認する（3.1–5.7）。
- **Guard/context integration**: guard拒否・取消・staleでticket/selection/rootを保持し、begin前commitを禁止する。committed outcomeではfinalization状態にかかわらずcomplete succeededを一度だけ呼び、finalization完了後だけrefreshする。finalize/refresh retryがFoundation commitを再呼出ししないことを検証する（4.7, 4.8, 6.9–6.11）。
- **Service integration**: 空・全データexport、決定的ファイル名、保存容量上限のrootから生成したartifactがfile preflightを通る自己復元可能性、normal/recovery preflight分岐、stale時の新ticket発行、preview件数、ticket保持、容量超過時の同一ticket再送0回、両commit成功と全失敗点の不変性を検証する。
- **State/React UI**: 二段階確認、処理中抑止、取消時ticket保持、容量超過時の選択保持・同一入力再実行禁止・別file選択、異常root回復案内、restore summaryを保持したfinalization/context unavailable、finalize-only/refresh-only retry、settings配下の`h4`、再表示時の未選択状態、cleanup再試行を検証する。operation policyは`read`と`recovery`を別々に購読し、`recovery-required`でexport・file選択・preflightが利用可能、通常restore commitが`recovery`として許可され、active maintenanceではcommitが拒否されることをcontract/DOM testで固定する。
- **E2E**: settingsから通常export/restoreを完了し、別シナリオで架空のcorrupt/future rootからdegraded shellを起動して正常backupを復元する。finalization/refresh失敗後は置換せず対応retryだけを行い、候補管理を再開する（5.6, 5.7, 6.8–6.11）。
- **Regression**: 復元後にCandidateQueryとCurrentBuildQueryが同じ所属・候補ID・数量を返し、通常CRUDを継続できることを検証する。

## Security Considerations

選択ファイルは未信頼入力として`unknown`から検証し、UIへは値、path、raw fingerprintを渡さず分類済みcodeに対応する固定文言だけを出す。`BackupRestoreDataPort`から通常CRUD・raw root・Storageへ到達せず、project-contextからguard registry・draft・preferenceへ到達しない。表示値は通常のJSX childとして扱い、`dangerouslySetInnerHTML`、`innerHTML`、inline handlerを使用しない。ファイル本文、ticket、permitをcontent scriptやページへ公開せず、Blob URLは直ちに破棄する。

## Performance & Capacity

入力ファイルは16 MiB（`16 * 1024 * 1024` bytes）を1 byteでも超えた時点で本文読取前に拒否する。この安全上限は保存容量の10 MiBと分離し、現行交換形式が有効な上限内rootから生成する最大Envelope UTF-8サイズ以上であることを、全entity variantの保存側／交換側直列化差分から導出する上界gateで固定する。変換後rootはFoundation容量契約で独立に10 MiB上限を判定し、commit時にも再判定する。BackupServiceはartifact生成後に同policyを適用し、成功artifactの自己復元可能性を保証する。容量超過は同一入力の再実行を許可しない。MVPでは圧縮・streamingを導入せず、同一区画の重複操作はstate、全featureの競合mutationはassessment ticketとFoundationのpersistent maintenance/recovery controlで抑止する。
