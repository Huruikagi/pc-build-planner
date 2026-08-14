# Implementation Plan

## Change Integration

- **Integrated Change Brief**: `mvp-local-data-simplification`
- **In-scope trace**: 完了済みTasks 1–5.5が抽出済みtransaction・capacity・replacement、Chrome adapter、backup orchestration、3公開entry、synthetic consumer、package単独validationを提供する。Tasks 6–7の完了記録は先行revisionで実施済みのpackage contract修復として保持するが、実product compositionや下流product contract gateを追加の完了条件にしない。
- **Out-of-scope preservation**: 実`ProductLocalDataAdapter` composition、consumer-owned maintenance fenceのpackage command化、generic recovery cleanup/finalization resumption、下流product contractの上流gate化、新規package APIを未完了taskとして追加しない。`FoundationError`、PC schema/migration/repair、製品backup capability、UI、production compositionは各canonical ownerに残す。

- [x] 1. Workspace package基盤を確立する
- [x] 1.1 private local data package scaffoldと公開entry枠を追加する
  - typed messages coreで確立したworkspace運用へlocal data packageを登録し、root core、Chrome、backupの3つの宣言済みentryを持つstrictなESM設定を用意する。
  - package単独build、typecheck、testをroot orchestrationから呼び出せるscript枠を設け、runtime dependency、npm publish設定、未宣言subpathを持たない状態にする。
  - clean build後、3 entryのJavaScriptとdeclarationが生成され、package managerとmodule resolverが宣言済みentryだけを解決できれば完了とする。
  - _Requirements: 7.1, 7.4, 7.8_
  - _Boundary: PackagePublicEntries_

- [x] 2. Platform-independentなlocal data coreを実装する
- [x] 2.1 製品非依存のResult、port、root policy契約を実装する
  - root decode/migrate、revision、request record、mutation、repair、maintenance controlをconsumerが型付きで設定できる契約を定義する。
  - storage、exclusive lock、capacity、transaction、replacementの公開入力・成功結果・安定errorを定義し、Chrome型、PC型、schema vendor、製品errorを含めない。
  - positive/negative consumer型fixtureで任意rootを設定でき、package declarationに`LocalDataRoot`、`FoundationError`、Chrome、React、Zodが現れなければ完了とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.5, 3.6, 6.4_
  - _Boundary: CoreContracts_

- [x] 2.2 (P) generic capacity policyを実装する
  - 現在使用量、candidate直列化後使用量、warning閾値、platform quotaからbelow・warning・exceededを決定的に評価するpure policyを実装する。
  - quotaや10MBをcore定数へ固定せず、実platform writeとその例外正規化はこのboundaryへ持ち込まない。
  - warning境界と1 byte超過を含むsynthetic testが成功し、exceededではtransactionへcommit不可の評価を返せれば完了とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.6_
  - _Boundary: CapacityPolicy_
  - _Depends: 2.1_

- [x] 2.3 (P) persistent maintenance・recovery fencing policyを実装する
  - owner、generation、lease、revisionを用いるacquire、renew、release、abort、stale拒否をroot/controlの具体fieldに依存しないpure policyとして実装する。
  - process memoryを共有しない再生成fixtureでもactive fenceを再読込し、owner外mutationとstale owner/generationを拒否する。
  - normal終了・abort後だけ後続mutationが再開し、同時acquireの成功が一件に限定されるcontract testが成功すれば完了とする。
  - historical完了記録として`[x]`を保持する。persistent recoveryのowner/generation/lease state machine部分はTasks 6.3–6.4がsupersedeし、planned end stateの`FencingPolicy`はroot内maintenance transitionだけを保持する。
  - _Requirements: 2.7, 4.3, 4.4, 4.5, 4.6, 4.7_
  - _Boundary: FencingPolicy_
  - _Depends: 2.1_

- [x] 2.4 transactionのlatest-read・validation・single-write pipelineを実装する
  - exclusive lock取得後にlatest rootをdecode/migrateし、mutation、repair、再validation、capacity評価を経て一度だけcommitするpipelineを構成する。
  - decode、migration、repair、validation、capacity、lock、storageの各pre-commit failureをtyped failureとして返し、既存rootとcommit回数を保持する。
  - synthetic contractで成功時のroot writeが一回、全pre-commit failureで0回となり、未知の例外値やroot内容を結果・logへ出さなければ完了とする。
  - _Requirements: 1.6, 2.1, 2.6, 3.1, 3.2, 3.3, 3.5_
  - _Boundary: TransactionEngine_
  - _Depends: 2.2, 2.3_

- [x] 2.5 revision・dedupe・競合・runtime再生成契約をtransactionへ統合する
  - expected revision、request digest、persistent request record、active fenceを変更前とcommit直前に検査し、revisionを成功時だけ単調に進める。
  - 同一requestの再試行は重複適用せず、異payload request ID、stale revision、active fenceをroot未変更のtyped failureとして返す。
  - 並行clientとprocess再生成を含むcontract suiteで重複適用0件、成功ごとのrevision増分1、競合時write 0件を観測できれば完了とする。
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.7_
  - _Boundary: TransactionEngine_
  - _Depends: 2.4_

- [x] 2.6 normal・recovery rootの副作用なしassessmentを実装する
  - candidateをdecode/migrate/repair/validate/capacity評価し、candidate digest、revision、raw fingerprint、owner protocolから受け取るopaque recovery capabilityを公開しないopaque ticketへ束ねる。
  - normalと破損・未対応rootのrecoveryを別modeで評価し、assessment中はroot/controlを一度も書き換えない。
  - stale candidate、revision、root maintenance判定、opaque recovery capabilityを識別できるfixtureと、全assessmentでroot write 0件のtestが成功すれば完了とする。packageはcapability内のowner、generation、lease fieldを解釈しない。
  - _Requirements: 4.1, 4.3, 4.5, 4.7, 5.3_
  - _Boundary: ReplacementCoordinator_
  - _Depends: 2.5_

- [x] 2.7 assessment ticketのatomic commitとfinalization lifecycleを実装する
  - commit直前にcandidateとpersistent stateを再照合し、normal/recovery両modeを同じlock、single write、fence規則で処理する。
  - pre-commit cleanup pendingはroot未変更のfailure、root write後cleanup未完了はcommitted-finalization-requiredとして区別する。
  - same-ticket commit retryとfinalize-only retryのcontract testでcommit成功が最大一回、finalize時のroot writeが0件、正常終了後だけ後続mutationが再開すれば完了とする。
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: ReplacementCoordinator_
  - _Depends: 2.6_

- [x] 3. Chrome platform adapter subpathを実装する
- [x] 3.1 Chrome storage・quota・change adapterを実装する
  - consumerから渡されたroot/control keyだけを対象にread/write、bytes、platform quota、`TRUSTED_CONTEXTS`、change eventをgeneric portへ適合させる。
  - Promise rejection、不正response、実writeのquota rejection、access restriction failureを保存値や例外objectを含まない安定codeへ正規化する。
  - 独立したstorage adapter testで対象外key非干渉、10MB platform quota、quota rejection後のroot保持、access成功前handle非公開、変更購読解除、logが安定codeだけであることを観測できれば完了とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.3, 6.4, 7.6_
  - _Boundary: ChromeStorageAdapter_
  - _Depends: 2.1, 2.2, 2.4_

- [x] 3.2 Chrome exclusive Web Locks adapterを実装する
  - consumerが渡す一つのlock identityについてexclusive callbackだけを実行し、callback完了・失敗時にlockを解放する。
  - 同名のtab/worker相当clientを直列化し、別名lockやnested lockをtransaction correctnessへ持ち込まない。
  - 独立したlock adapter testで同時holderが最大一件、callback throw後に次requestが進行し、platform failureが例外objectを含まないtyped errorになれば完了とする。
  - _Requirements: 2.1, 2.7, 6.2, 6.3, 6.4, 7.6_
  - _Boundary: ChromeLocksAdapter_
  - _Depends: 2.1, 3.1_

- [x] 3.3 Chrome subpathの公開exportとaggregate contractを統合する
  - storageとlockのfactoryを`./chrome`の宣言済みentryへ集約し、共有indexとaggregate contract testをこのintegration taskだけで変更する。
  - root coreやbackup subpathへChrome型が漏れず、Chrome subpathがproduct key、runtime message、application shellを公開しないことを検証する。
  - clean package buildからChrome consumer fixtureが成功し、root/backup consumer fixtureではChrome型を解決できなければ完了とする。
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.3, 7.6_
  - _Boundary: PackagePublicEntries, ChromeStorageAdapter, ChromeLocksAdapter_
  - _Depends: 3.1, 3.2_

- [x] 4. Generic backup orchestration subpathを実装する
- [x] 4.1 artifact作成とrestore preflightを実装する
  - snapshot reader、codec、artifact policy、replacement assessmentを注入し、backup artifact作成とuntrusted restore inputのdecode、version変換、mapping、assessmentを順序付ける。
  - previewとopaque restore ticketだけを返し、candidate、raw root、lock、fence、製品metadataを公開しない。
  - synthetic codec contractでartifactとpreflightが成功し、decode/map/assessment失敗時のroot writeが0件、Chrome、File、DOM、React、project-context依存が0件なら完了とする。
  - _Requirements: 5.1, 5.2, 5.3, 5.8, 7.7_
  - _Boundary: BackupOrchestrator_
  - _Depends: 2.6_

- [x] 4.2 confirmed commit・reassessment・finalization retryを実装する
  - confirmed ticketのcommit、stale ticketのreassessment、same-ticket pre-commit cleanup retry、pending finalization discovery、finalize-only retryを提供する。
  - commit前failureとcommit済みfinalization待ちを判別共用体で区別し、成功を取り消したりrootを再置換したりしない。
  - contract testでpre-commit retryまでのroot write 0件、commit成功最大一回、finalize-only retryの追加root write 0件を観測できれば完了とする。
  - _Requirements: 5.4, 5.5, 7.7_
  - _Boundary: BackupOrchestrator_
  - _Depends: 2.7, 4.1_

- [x] 5. 公開境界と検証経路を確定する
- [x] 5.1 3つの公開entry consumer fixtureを追加する
  - root core、Chrome、backupの各declared entryだけを使うstrict consumer fixtureとruntime smoke testを追加する。
  - 各fixtureはclean build済みJavaScript/declarationだけを解決し、package sourceをroot appのTypeScript projectへ混在させない。
  - 3つのpositive fixtureがclean outputから成功し、未宣言subpathではmodule resolutionが失敗すれば完了とする。
  - _Requirements: 7.1, 7.4, 7.8_
  - _Boundary: PackagePublicEntries_
  - _Depends: 3.3, 4.2_

- [x] 5.2 read-only app contractを追加する
  - 製品root/error/codec型をconsumer側入力として使い、package公開portへ型接続できることだけを検査する非実行fixtureを追加する。
  - fixtureは製品adapter、composition、runtime registration、E2Eを定義せず、package declarationへ製品型を混入させない。
  - backup consumerが通常CRUD、raw root、Storage、lock、fence capabilityを取得できないnegative type fixtureを含め、positive/negative contractが期待どおり成功・失敗すれば完了とする。
  - _Requirements: 6.5, 6.6, 6.7, 7.9, 7.10, 7.11_
  - _Boundary: ReadOnlyAppContract_
  - _Depends: 5.1_

- [x] 5.3 deep import・逆依存・ownership gateを実装する
  - 未宣言subpath、`src`/`dist` deep import、coreからChrome/backup/productへの逆依存、Chromeからproductへの依存、backupからChrome/DOM/React/productへの依存を機械的に拒否する。
  - package source/testが`ProductLocalDataAdapter`、`ProductBackupAdapter`、製品composition、E2Eを所有する変更も境界違反として検出する。
  - positive graphが成功し、各negative fixtureが狙った違反一件だけでgateを失敗させ、他の診断へ依存しなければ完了とする。
  - _Requirements: 6.4, 6.7, 7.2, 7.3, 7.11_
  - _Boundary: WorkspaceValidation_
  - _Depends: 5.2_

- [x] 5.4 core・Chrome・backup・contractのpackage検証経路を分離する
  - core変更用にbuild/typecheck/unit/consumer/boundary、Chrome変更用にadapter contract、backup変更用にorchestrator contract、公開型変更用にread-only app contractを構成する。
  - 10MB近傍のsynthetic rootでcore処理のbaselineを記録し、package testのfixture・diagnostic・logが保存内容、商品値、URL、例外objectを出さず安定codeだけを使うことを検査する。
  - 各変更種別のtooling testが必要gate集合と失敗伝播を再現し、package単独実行でapp source、Chrome実体、DOM、E2Eを起動しなければ完了とする。
  - _Requirements: 7.5, 7.6, 7.7, 7.9, 7.11_
  - _Boundary: WorkspaceValidation_
  - _Depends: 5.3_

- [x] 5.5 root topological buildと変更scope統合を確定する
  - root buildがtyped messages coreとlocal data packageをconsumerより先にbuildし、app側がbuild済みpublic exportだけを解決する順序を固定する。
  - 製品schema、migration、repair、交換形式、adapter、composition、UIだけの変更はpublic contractへ影響しない限り下流ownerの検証へ委譲し、package経路はgeneric contract変更時だけ要求する。
  - fresh package build/typecheck/test、3 consumer、read-only app contract、boundary gate、topological buildが成功し、いずれかのfailureがroot commandへ伝播する一方、製品composition/E2Eを本specのgateへ吸収しなければ完了とする。
  - _Requirements: 5.6, 5.7, 7.8, 7.9, 7.10, 7.11, 7.12_
  - _Boundary: WorkspaceValidation_
  - _Depends: 5.4_

- [x] 6. 公開factoryのerror/control境界を修復する
- [x] 6.1 consumer-owned policy error adapterをtransaction・replacement両factoryへ統合する
  - transactionとreplacementのpolicy error/output errorを別genericとして受け、decode、migration、mutation、repair、validation、assessment、replacement validationの各failureを元payloadと判定contextのまま明示adapterへ渡す。
  - mechanism errorだけをcore error mappingへ渡し、policy failureをstage codeへ縮退したり未知値を既知errorへ推測変換したりしない。
  - synthetic policyの識別可能なerror種類・payload・判定contextがtransaction/replacement両factoryの各stageから同一内容でoutput errorへ到達し、adapterがfail-closed resultを返す場合とthrowする場合のどちらも成功・別の既知errorへ縮退せずroot writeが0件なら完了とする。
  - _Requirements: 1.5, 1.7, 1.8, 2.1, 2.6, 4.1, 4.2, 4.7_
  - _Boundary: ConsumerErrorAdapter, TransactionEngine, ReplacementCoordinator_

- [x] 6.2 root maintenanceとpersistent recovery controlをtransaction factoryで分離する
  - root policyが扱うmaintenance controlとstorage側persistent recovery controlを非互換な別genericとして構成し、mutation前・commit直前の両方でowner protocolのauthorizationを呼ぶ。
  - revision、dedupe、single write、固定exclusive lockの順序を維持し、control間のcastまたは共通field前提を導入しない。
  - 非互換なsynthetic control型でtransaction factoryが型検査・実行され、active recovery拒否と成功時write一回が観測できれば完了とする。
  - _Depends: 6.1_
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.7, 4.4, 4.5, 6.8_
  - _Boundary: CoreContracts, TransactionEngine_

- [x] 6.3 owner-provided persistent recovery protocolをreplacementへ統合する
  - replacement assessment/commitがfence取得・照合、pending準備、current anomaly分類をowner protocolへ委譲し、package側のcontrol field parserと独自pending markerを除去する。
  - normal/recoveryのcandidate、raw fingerprint、revision、capacity、opaque ticket再照合とroot write一回を維持する。
  - fieldを公開しないsynthetic protocolでnormal/recovery assessmentとcommitが成功し、stale protocol capabilityでは既存rootが保持されれば完了とする。
  - _Depends: 6.2_
  - _Requirements: 4.1, 4.2, 4.3, 4.7_
  - _Boundary: PersistentRecoveryProtocol, ReplacementCoordinator_

- [x] 6.4 protocol-owned releaseとfinalization lifecycleをreplacementへ統合する
  - `prepareCommit`がpersistent controlへ束縛したowner-issued finalization capabilityをpendingとともに保持し、pre-commit cleanup、root commit後release、pending finalization discovery、finalize-only retryをowner protocolのopaque capabilityとstate classificationだけで進める。
  - pre-commit failureではroot write 0件、commit済みfailureでは成功を取り消さず、finalizeではroot write capabilityへ到達しない。
  - consumer ownerが定義した`FinalizationCapability`をprotocol、commit state、replacement public portまで独立genericとして保持する。packageはcandidateをactual current rootとして事前分類せず、finalization ticketを生成・cast・wrapper化したりJavaScript参照同一性で検証したりしない。root write失敗ではowner capabilityをcommittedとして公開せず、same-ticket cleanupと全binding再評価を行う。
  - same-ticket retry、worker再生成後のactual current rootによるpending discovery、serializationを跨ぐticket検証、release/control保存/finalize failureを含むcontractで、owner error identity、commit最大一回、finalize追加write 0件が観測できれば完了とする。
  - _Depends: 6.3_
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 5.4, 5.5_
  - _Boundary: PersistentRecoveryProtocol, ReplacementCoordinator_

- [x] 7. 公開declarationとsynthetic consumer contractを更新する
- [x] 7.1 root公開entryへ分離genericとowner protocol contractを公開する
  - transaction/replacement factory、error adapter、root maintenance、persistent recovery、opaque protocol capabilityの型をroot entryからbuild済みdeclarationとして解決可能にする。
  - `.`、`./chrome`、`./backup`の3 entryだけを維持し、Chrome、製品型、schema vendor、内部moduleをroot declarationへ混入させない。
  - clean package build後にpublic declarationがunsafe castなしでconsumerへ解決され、未宣言subpathは引き続き失敗すれば完了とする。
  - _Depends: 6.4_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.4, 6.8, 7.1, 7.2, 7.3, 7.4, 7.8_
  - _Boundary: CoreContracts, PackagePublicEntries_

- [x] 7.2 transaction public consumer fixtureを独立error/control型へ更新する
  - 架空のpolicy error、output error、root maintenance control、persistent recovery controlを互いに代入不能な型としてfactoryへ接続するpositive fixtureを追加する。
  - error adapter欠落とcontrol generic混同が狙った型診断で失敗するnegative fixtureを追加し、runtime contractで各stageのpolicy error identity/payloadがadapter入力まで保持されることを検証する。
  - build済みJavaScript/declarationだけを使うpositive/negative fixtureとruntime contractが期待どおり成功・失敗すれば完了とする。
  - _Depends: 7.1_
  - _Requirements: 1.5, 1.7, 1.8, 6.5, 6.7, 6.8, 7.1, 7.5, 7.9, 7.11_
  - _Boundary: SyntheticPublicContract_

- [x] 7.3 replacement・backup synthetic contractを更新する
  - owner protocolのopaque fence/pending/anomaly型でassessment、commit、pre/post cleanup、find/finalizeを実行するfixtureを追加し、backup orchestrationの既存ticket semanticsを同じ公開port上で再検証する。
  - replacement policy errorの種類・payload・判定contextが明示adapter入力とoutput errorまで保持され、adapterがfail-closed resultを返す場合またはthrowする場合はroot write 0件となるruntime fixtureを追加する。
  - normal/recovery、stale、precommit cleanup、committed finalization、finalize-only retryをprotocol結果だけで駆動する。
  - replacement/backup runtime contractでroot commit最大一回とfinalize root write 0件が観測できれば完了とする。
  - _Depends: 7.2_
  - _Requirements: 1.5, 1.7, 1.8, 2.6, 5.2, 5.3, 5.4, 5.5, 6.6, 6.7, 7.2, 7.3, 7.7, 7.11_
  - _Boundary: SyntheticPublicContract, BackupOrchestrator_

- [x] 7.4 package ownership boundary gateを更新する
  - package source/testによる製品adapter、製品control field、数値lease、generic/protocolを迂回するunsafe cast、独自pending markerの所有をboundary gateで拒否する。
  - error/control/protocolのsynthetic fixtureは許可し、製品識別子や単なる型安全な変換を誤検出しないnegative/positive tooling testを追加する。
  - 各negative fixtureが狙った所有違反一件で失敗し、3 public entryと製品非依存のpositive graphが成功すれば完了とする。
  - _Depends: 7.3_
  - _Requirements: 6.7, 6.8, 7.2, 7.3, 7.11_
  - _Boundary: WorkspaceValidation_

## Implementation Notes

- **Fresh task-graph sanity review (2026-08-14 MVP simplification)**: Tasks 1–7の完了記録を保持し、未完了だった下流product contract routing/final validation tasksを最新Change BriefのOut of scopeとして除外した。package completion graphはpackage core → Chrome/backup → 3 public entries → synthetic consumer/boundary/topological gateで閉じ、product-local runtime、backup capability、application compositionへの循環依存を持たない。全56 acceptance criteriaのtask/design trace、checkbox、observable completion、boundary、hidden prerequisiteを再監査し、PASSと判定した。
- Tasks 6–7は先行Change Briefで既に完了したpackage内部修復とsynthetic contract強化の履歴として保持する。本revisionはそれらをproduct runtime migrationの根拠へ拡張せず、新しいpackage APIまたは下流gateを要求しない。
