# Implementation Plan

- [ ] 1. Workspace基盤と現行挙動の安全網を確立する
- [ ] 1.1 private local data package scaffoldと公開entry枠を追加する
  - typed messages coreで確立したworkspace運用へlocal data packageを登録し、root core、Chrome、backupの3つの宣言済みentryをbuildできるstrictなESM設定を用意する。
  - package単独build、typecheck、testをroot orchestrationから呼び出せるscript枠を設け、runtime dependency、npm publish設定、未宣言subpathを持たない状態にする。
  - 完了時、package managerがlocal data packageを一意に認識し、空のbuild済みJavaScriptとdeclarationを各宣言entryから解決できる。
  - _Requirements: 7.1, 7.4, 7.8_
  - _Boundary: PackagePublicEntries_

- [ ] 1.2 現行local dataのcharacterization contractを固定する
  - 既存公開portからrevision、dedupe、競合、修復、容量、正常置換、異常回復、maintenance/recovery fencingを観測する架空fixtureのcontract suiteを用意する。
  - 保存schema、`FoundationError`、用途限定capabilityを抽出前の期待値として固定し、実サイト由来データを含めない。
  - 完了時、generic実装へ委譲する前の現行production graphに対して全local data characterization testが成功し、root write回数とfailure時root保持を検出できる。
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 4.2, 4.3, 4.7, 6.7_
  - _Boundary: ProductLocalDataAdapter_

- [ ] 1.3 現行backup orchestrationのcharacterization contractを固定する
  - 既存backup公開serviceからartifact、交換形式、preview、normal/recovery ticket、pre-commit cleanup、post-commit finalizationを観測する架空fixtureのcontract suiteを用意する。
  - root write前の失敗とroot write後のfinalization待ちを別々の期待値として固定し、file/UI/project-contextの既存owner境界を変更しない。
  - 完了時、抽出前のbackup serviceに対して全characterization testが成功し、pre-commit retryとfinalize-only retryのroot write回数を区別できる。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.7_
  - _Boundary: ProductBackupAdapter_

- [ ] 2. Platform-independentなlocal data coreを実装する
- [ ] 2.1 製品非依存のResult、port、root policy契約を実装する
  - root decode/migrate、revision、request record、mutation、repair、maintenance controlをconsumerが型付きで設定できる契約を定義する。
  - storage、exclusive lock、capacity、transaction、replacementの公開入力・成功結果・安定errorを定義し、Chrome型、PC型、schema vendor、製品errorを含めない。
  - positive/negative consumer型fixtureで任意rootを設定でき、`LocalDataRoot`、`FoundationError`、Chrome、React、Zodへのpackage依存がないことを確認できれば完了とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.5, 3.6, 6.4_
  - _Boundary: CoreContracts_

- [ ] 2.2 (P) generic capacity policyを実装する
  - 現在使用量、candidate直列化後使用量、warning閾値、platform quotaから成功・warning・超過を決定的に評価する。
  - quotaや10MBをcore定数へ固定せず、platform write rejectionを事前評価と区別できるerrorへ保つ。
  - below、warning境界、1 byte超過、platform quota rejectionのsynthetic testが成功し、failure時にcandidate writeが0件であれば完了とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - _Boundary: CapacityPolicy_
  - _Depends: 2.1_

- [ ] 2.3 (P) persistent maintenance・recovery fencing policyを実装する
  - owner、generation、lease、revisionを用いるacquire、renew、release、abort、stale拒否をroot/controlの具体fieldに依存しないpure policyとして実装する。
  - process memoryを共有しない再生成fixtureでもactive fenceを再読込し、owner外mutationとstale owner/generationを拒否する。
  - normal終了・abort後だけ後続mutationが再開し、同時acquireの成功が一件に限定されるcontract testが成功すれば完了とする。
  - _Requirements: 2.7, 4.3, 4.4, 4.5, 4.6, 4.7_
  - _Boundary: FencingPolicy_
  - _Depends: 2.1_

- [ ] 2.4 revision・dedupe付きtransaction engineを実装する
  - exclusive lock取得後にlatest rootをdecode/migrateし、revision、dedupe、fence、mutation、repair、validation、capacityを経てsingle writeするpipelineを構成する。
  - 同一requestの再試行は重複適用せず、異payload request ID、stale revision、active fence、lock/storage failureをroot未変更のtyped failureとして返す。
  - 完了時、並行clientとprocess再生成を含むcontract suiteでrevisionが単調増加し、成功transactionごとのroot writeが最大一回、全pre-commit failureで0回になる。
  - _Requirements: 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: TransactionEngine_
  - _Depends: 2.2, 2.3_

- [ ] 2.5 評価済みnormal・recovery root replacementを実装する
  - candidateを副作用なしでdecode/migrate/repair/validate/capacity評価し、candidate digest、revision、raw fingerprint、owner/generationを公開しないopaque ticketへ束ねる。
  - commit直前にcandidateとpersistent stateを再照合し、normal/recoveryの両modeを同じlock、single write、fence規則で処理する。
  - pre-commit cleanup pending、stale assessment、committed finalization required、finalize-only retryを判別し、finalize時のroot writeが0件になるtestが成功すれば完了とする。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.3, 5.4, 5.5, 5.6, 5.7_
  - 2.3で確立したfencing policyを利用し、replacement側でowner/generation state transitionを再実装しない。
  - _Boundary: ReplacementCoordinator_
  - _Depends: 2.4_

- [ ] 3. PC product policyとChrome platformをpackage境界へ接続する
- [ ] 3.1 PC Build Plannerのlocal data policy adapterを実装する
  - 既存`LocalDataRoot` decode/migration、revision、request dedupe、mutation、reference repair、maintenance/recovery control、capacity serializationをpackage policyへ設定する。
  - generic success/errorを既存Result、`FoundationError`、公開data portへ写像し、schema version、storage key、worker認可、runtime capability shapeを製品側に保持する。
  - characterization suiteが抽出前と同じroot、revision、repair、error、normal/recovery outcomeを返し、保存schema差分が0件であれば完了とする。
  - pending `local-data-foundation` Existing Spec Updateのschema・error・owner契約変更は行わず、pure delegationに意味変更が必要なら当該updateまで停止する。
  - _Requirements: 1.1, 1.5, 1.6, 6.5, 6.7_
  - _Boundary: ProductLocalDataAdapter_
  - _Depends: 1.2, 2.5_

- [ ] 3.2 (P) Chrome storage・quota・change adapterを実装する
  - productから渡されたroot/control keyだけを対象にread/write、bytes、quota、TRUSTED_CONTEXTS、change eventをgeneric portへ適合させる。
  - Promise rejection、不正response、quota rejection、access restriction failureを保存値やChrome例外を含まない安定errorへ正規化する。
  - Chrome stub contractで対象外key非干渉、10MB platform quota、access成功前handle非公開、変更通知の購読解除が観測できれば完了とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.3, 6.4, 7.6_
  - _Boundary: ChromeStorageAdapter_
  - _Depends: 2.1, 2.2_

- [ ] 3.3 (P) Chrome exclusive Web Locks adapterを実装する
  - product compositionが渡す既存固定identityについてexclusive callbackだけを実行し、callback完了・失敗時にlockを解放する。
  - 同名のtab/worker相当clientを直列化し、別名lockやnested lockをtransaction correctnessへ持ち込まない。
  - contract testで同時holderが最大一件、callback throw後に次requestが進行し、platform failureがtyped errorになることを確認できれば完了とする。
  - _Requirements: 2.1, 2.7, 6.2, 6.3, 6.4, 7.6_
  - _Boundary: ChromeLocksAdapter_
  - _Depends: 2.1_

- [ ] 3.4 production local data compositionをpackage adapterへ移行する
  - product policy、Chrome storage、Chrome lockを一つのcanonical graphへ組み立て、既存の通常data port、backup用途限定port、maintenance sourceをproduct-owned runtime compositionが消費できるhandleとして提供する。
  - worker command authorization、registration factory、listener registration、runtime compositionは製品側の既存ownerに残し、新しいhandleから受け取るdata capabilityだけへ接続する。
  - access restriction失敗時はfail closedとし、Repository、raw root、Storage、lock、内部authorityを公開handleへ含めない。
  - production initialization、worker再生成、同時writer、公開capability negative contractが移行前と同じ結果で成功すれば完了とする。
  - _Requirements: 2.1, 2.6, 2.7, 4.4, 4.5, 6.1, 6.2, 6.3, 6.5, 6.7_
  - _Boundary: ProductLocalDataAdapter, ChromeStorageAdapter, ChromeLocksAdapter_
  - _Depends: 3.1, 3.2, 3.3_

- [ ] 4. Generic backup orchestrationと製品backup adapterを統合する
- [ ] 4.1 generic artifact・preflight・commit・finalize orchestrationを実装する
  - snapshot reader、codec、artifact policy、replacement portを設定し、backup createとrestore input decode/map/assessmentを製品metadata非依存で順序付ける。
  - previewとopaque restore ticketだけをconsumerへ返し、confirmed commit、same-ticket cleanup retry、stale reassessment、pending finalization discovery、finalize-only retryを提供する。
  - synthetic codec contractでproduct field、Chrome、File、DOM、React、project-contextを使わず、pre-commit failureのroot write 0件とpost-commit retryの追加root write 0件が観測できれば完了とする。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 7.7_
  - _Boundary: BackupOrchestrator_
  - _Depends: 2.5_

- [ ] 4.2 PC Build Plannerのbackup serviceをgeneric orchestratorへ接続する
  - 既存exchange validator/migration/mapper、16MiB input policy、artifact naming、clock、snapshot read、Foundation replacement capabilityをproduct codecとadapterとして設定する。
  - FileGateway、UI state/view、利用者確認、project-context guard/refreshを既存feature側に残し、公開preview、error、ticket、normal/recovery結果を維持する。
  - backup/restore characterizationと既存normal・corrupt・future root integration testが同じ交換JSON、件数、commit/finalize結果を返せば完了とする。
  - pending `backup-restore` Existing Spec Updateの交換形式・UI・context lifecycle変更は行わず、pure delegationに意味変更が必要なら当該updateまで停止する。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.6, 6.7_
  - _Boundary: ProductBackupAdapter_
  - _Depends: 1.3, 3.4, 4.1_

- [ ] 5. 公開境界、変更種別別validation、完全回帰を確定する
- [ ] 5.1 package export、consumer、dependency boundary gateを実装する
  - root core、Chrome、backupの各declared entryだけを使うstrict consumer fixtureとruntime smoke testを追加する。
  - 未宣言subpath、source/dist deep import、coreからChrome/backup/productへの逆依存、Chromeからproductへの依存、backupからChrome/DOM/React/productへの依存を機械的に拒否する。
  - 完了時、3つのpublic consumerはclean build成果物から成功し、各negative fixtureは対応する違反を一件ずつ検出してgateを失敗させる。
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.8, 7.11_
  - _Boundary: PackagePublicEntries, WorkspaceValidation_
  - _Depends: 3.4, 4.2_

- [ ] 5.2 core・Chrome・backup・product変更のvalidation経路を分離する
  - core変更用にpackage build/typecheck/test、consumer、boundary、product contractを、Chrome変更用にadapter contractを、backup変更用にorchestratorとproduct adapter contractを構成する。
  - product schema/migration/repair/exchange/UIだけの変更はowner-local contractへ限定でき、完全検証は全経路を包含するscript構成にする。
  - tooling testが各変更種別のgate集合と失敗伝播を検証し、無関係なapp-wide suiteを最小経路へ混入させず必要gateを取りこぼさなければ完了とする。
  - _Requirements: 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11_
  - _Boundary: WorkspaceValidation_
  - _Depends: 5.1_

- [ ] 5.3 packageとPC Build Plannerの完全回帰を実行する
  - package 3 entryのbuild・typecheck・test、root typecheck/public consumer、lint、boundary、runtime schema、fixture、build、persistence/backup integration、既存backup E2Eを実行する。
  - app bundleにpackage内部source、Chrome型のcore漏出、product schemaのpackage漏出、dynamic/remote code、重複generic implementationがないことをartifact gateで確認する。
  - 完了時、`pnpm validate`が成功し、10MB、TRUSTED_CONTEXTS、single write authority、atomic replacement、persistent fencing、backup export/restore/recoveryのfresh evidenceが揃う。
  - `runtime-license-notices` Direct Candidateや他Existing Spec Updatesは変更・検証対象へ追加しない。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11_
  - _Boundary: WorkspaceValidation, ProductLocalDataAdapter, ProductBackupAdapter_
  - _Depends: 5.2_
