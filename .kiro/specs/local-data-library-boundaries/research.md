# Research & Design Decisions

## Summary

- **Feature**: `local-data-library-boundaries`
- **Discovery Scope**: Extension / Integration-focused discovery
- **Key Findings**:
  - 現行実装は必要な安全性をすでに持つが、`StoragePort`、transaction、replacement、recovery、backup protocolが`LocalDataRoot`と`FoundationError`へ結合している。抽出は挙動追加ではなく、既存characterizationを保った依存反転として行う必要がある。
  - package数を3つへ先に増やさず、単一private package内のroot core export、明示的なChrome subpath、明示的なbackup subpathで依存方向を分ける構成が最小である。宣言済みsubpathは公開API、その他の内部pathはdeep importとして拒否する。
  - Chrome Storageは10MB quota、`getBytesInUse`、`setAccessLevel`、`onChanged`を提供し、Web Locksはtab・worker間で同名exclusive lockを直列化する。platform-native能力を薄いadapterへ閉じ込め、coreにChrome型を入れない設計を維持できる。
  - `v0.5.0-boundary-reconciliation`により製品adapter実装は`local-data-foundation`と`backup-restore`へ委譲された。最新Change Briefでは、従来のread-only contractをsynthetic package contractとして残しつつ、実製品接続はFoundation所有executable contractを上流routeから呼んで補完する。
  - `product-runtime-contract-repair`のintegration-focused discoveryでは、package factoryがpolicy errorを`CoreError`へ固定し、同一`Control` genericをroot maintenanceとpersistent recoveryに共有し、replacementがcontrol fieldと独自pending markerを解釈しているため、実product adapterを意味不変に構成できないことを確認した。
  - 修復はconsumer error adapter、分離control generic、owner-provided recovery protocolへ限定し、実`ProductLocalDataAdapter` executable contractは下流ownerに残したままroot validation routeから呼ぶ。

## Research Log

### 現行local data責務と公開契約

- **Context**: generic mechanismと製品policyの切断点を特定する必要がある。
- **Sources Consulted**: `src/persistence/**`、`src/domain/**`、`local-data-foundation` requirements/design/tasks、`runtime-schema-validation` requirements/design。
- **Findings**:
  - `RootTransactionRunner`がlatest-read、revision、dedupe、maintenance/recovery fencing、single writeを統合する。
  - `StoragePort`はroot、RecoveryControl、bytes、quota、access restrictionを一つに持ち、Chrome adapterとin-memory adapterが実装する。
  - `LocalDataRoot`、具体migration、reference repair、`FoundationError`、worker authorizationは製品policyでありgeneric coreへ移せない。
  - `BackupRestoreDataPort`は通常CRUDやraw rootを隠す用途限定capabilityとして確立済みである。
- **Implications**: coreはrootをgeneric型として扱い、revision・dedupe・validation・migration・repair・fenceをconsumer-supplied policyにする。製品adapterによる既存公開portの維持は下流`local-data-foundation`が所有し、本specはその型接続可能性だけをread-only fixtureで検証する。

### Backup orchestrationの切断点

- **Context**: `backup-restore`の交換形式・UIを汎用protocolへ混入させない必要がある。
- **Sources Consulted**: `backup-restore` requirements/design/tasks、`local-data-foundation`の`BackupRestoreDataPort`契約。
- **Findings**:
  - 汎用化可能なのはsnapshot→artifact、untrusted input→decode/map→assessment、confirm済みticket→commit、post-commit finalizeの順序である。
  - PC固有の`CurrentBackupEnvelope`、entity mapping、16MiB file policy、filename、File API、UI、project-context guard/refreshは既存featureのcanonical ownerである。
  - `precommit-cleanup-pending`と`committed-finalization-required`を混同すると、root writeの再実行または成功取消が起きる。
- **Implications**: backup subpathはcodec/artifact policyとlocal data replacement portを注入されるorchestratorだけを提供し、交換schemaやUI stateを持たない。

### Workspace運用

- **Context**: `typed-messages-core`で確立する最初のworkspace patternへ整合させる必要がある。
- **Sources Consulted**: `typed-messages-core` spec.json、requirements、design、tasks。
- **Findings**:
  - private package、`workspace:*`、build済みexport、package単独build/typecheck/test、public consumer fixture、deep import negative gate、topological buildが先行契約である。
  - package sourceをroot appのTypeScript projectへ直接混在させず、consumerはbuild済みdeclarationとJavaScriptを解決する。
- **Implications**: local data packageも同じworkspace lifecycleを使い、core・Chrome・backupの変更種別別scriptを追加する。

### Chrome StorageとWeb Locks

- **Context**: platform-native adapterで既存のquota、access、change、排他契約を維持できるか確認した。
- **Sources Consulted**: Chrome Extensions Storage API、Chrome StorageArea API、MDN Web Locks API、MDN LockManager.request。
- **Findings**:
  - `chrome.storage.local`は10MBの`QUOTA_BYTES`、`getBytesInUse`、Promise rejection、`setAccessLevel`、`onChanged`を提供する。
  - local storageは既定でcontent scriptから到達可能なため、`TRUSTED_CONTEXTS`への明示制限が必要である。
  - Web Locksの同名exclusive requestはtab・workerをまたいで単一holderに直列化され、callback完了時にreleaseされる。
- **Implications**: Chrome adapterはquota値を注入せずplatformから読み、access restriction成功前にproduction contributionを公開しない。lockは一つのresource identityだけを使い、nested lockを導入しない。

### Change Brief product-runtime-contract-repair のintegration-focused discovery

- **Context**: `local-data-foundation` task 11.2が、製品error/controlをpackage factoryへ意味不変に接続できず停止したため、公開契約の不足を切り分けた。
- **Sources Consulted**: `packages/local-data/src/contracts.ts`、`transaction.ts`、`replacement.ts`、public exports、synthetic fixtures、workspace validation routing、`local-data-foundation` design/tasks、`backup-restore` replacement契約、`application-shell` production composition契約。
- **Findings**:
  - transaction/replacement dependenciesの`LocalDataPolicy`が`PolicyError = CoreError`に固定され、policy payloadと判定contextを保持するadapter seamがない。
  - root policyのmaintenance projectionとstorage側persistent recovery controlが同じ`Control` genericを共有する。
  - replacementがpersistent valueからactive state、mode、owner、generation、pending commitを直接読み書きし、数値表現と独自markerをpackage semanticsにしている。
  - read-only app contractは型aliasの接続だけで、実`ProductLocalDataAdapter`を用いるruntime compositionを実行しないため不整合を検出できなかった。
  - historical Task 2.3はowner、generation、leaseを扱うpackage `FencingPolicy`を完了済みとして記録しているが、これは修復前のpersistent recovery state machineである。planned end stateではTasks 6.3–6.4がこの部分をsupersedeし、package `FencingPolicy`はroot内maintenance transitionだけを保持する。
- **Implications**:
  - factoryは`PolicyError`と`OutputError`を分離し、明示`ErrorAdapter`へ全policy errorを元payloadのまま渡す。
  - root maintenanceとpersistent recoveryを別genericにし、persistent lifecycleはowner protocolがfence、pending、release、finalization、current anomalyを判定する。
  - package testsは非互換なsynthetic型だけを使い、製品adapter/controlを所有しない。実製品contractは下流ownerに置き、上流routeはcommandを呼ぶだけとする。

### Integration risks and revalidation

- **Context**: 公開factory修復は既存consumerとrestore lifecycleへ波及するため、implementation順と再検証範囲を固定した。
- **Sources Consulted**: `local-data-foundation` tasks 10.1、10.2、11.2以降、`backup-restore` design、`application-shell` design、workspace scripts。
- **Findings**:
  - 上流factory/public declarationを先に修復しないと下流executable contractをcastなしで書けない。
  - Foundation task 11.2のexecutable product contract成立後に、`backup-restore` tasks 7.1–7.4のreplacement/recovery/finalizationと`application-shell` tasks 12.1–12.3のproduction compositionを各owner gateで再検証する必要がある。
  - 既存3 entry、固定Web Lock、single write、revision/dedupe、atomic replacement、opaque ticket、pre/post cleanup、既存root保持は変更対象ではない。
- **Implications**: 実装順をpackage core → public/synthetic contracts → Foundation task 11.2のdownstream-owned `validate:local-data-product-contract` → 上流routing/final validationとし、backup/application-shellの実装は吸収せず、各ownerの後続gateが修復milestoneを待つことを検査する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 3 private packages | core、Chrome、backupを別package化 | package managerが依存を強制 | package数とbuild graphを早期固定し、同時変更のoverheadが大きい | 現時点では不採用 |
| 1 package root only | 全能力を単一root exportから公開 | 最小構成 | Chrome型やbackup型がcore consumerへ混在しやすい | 不採用 |
| 1 package with declared subpaths | root core、`./chrome`、`./backup`を別entryにする | package増加を抑えつつ依存とconsumer surfaceを分離 | source boundary gateが必要 | 採用 |
| 現行srcを維持しinterfaceだけ追加 | app内部のまま抽象化 | 移行量が小さい | package単独検証と2番目consumerへの再利用を実証できない | 不採用 |

## Design Decisions

### Decision: 単一private packageと3つの公開entry

- **Context**: package数を成果にせずcore、Chrome adapter、backup orchestrationの依存証拠を得る。
- **Alternatives Considered**:
  1. 3 packageへ即時分割する。
  2. root export一つへ全能力を混在させる。
- **Selected Approach**: `@pc-build-planner/local-data`の`.`、`./chrome`、`./backup`だけを公開する。
- **Rationale**: root coreはplatform-free、Chrome subpathはcoreだけ、backup subpathはcoreだけへ依存する関係を明示でき、package増加を避けられる。
- **Trade-offs**: package内依存はexport mapだけでは防げないためsource graph gateが必要になる。
- **Follow-up**: 2番目consumer追加時に利用頻度と変更独立性を計測し、package分割とstable APIを再評価する。

### Decision: product policyはhookで注入し、保存schemaを変えない

- **Context**: revision、dedupe、maintenanceが現行`LocalDataRoot`内にあり、generic envelopeへの置換は保存形式変更になる。
- **Alternatives Considered**:
  1. generic envelopeへdataとcontrolを移す。
  2. coreへPC root shapeを取り込む。
- **Selected Approach**: root decode/migrate、revision、dedupe、mutation/repair、maintenance projectionをtyped policyとして注入する。
- **Rationale**: generic mechanismを再利用可能にしながらschemaVersion、field、exchange semanticsを変更しない。
- **Trade-offs**: policy interfaceは広くなるが、first consumerの既存不変条件を明示的にcharacterizeできる。
- **Follow-up**: hook同士の矛盾をsynthetic contract kitとapp characterizationで検出する。

### Decision: backup protocolをcodecとreplacement portの合成にする

- **Context**: preflight/commit/finalizeは汎用だが交換形式・file/UIは製品固有である。
- **Alternatives Considered**:
  1. exchange envelopeをpackageへ移す。
  2. replacement portだけを公開しorchestrationを製品側に残す。
- **Selected Approach**: product codec/artifact policyとcore replacement portを受けるgeneric orchestratorを`./backup`から公開する。
- **Rationale**: root commit pointとretry semanticsを再利用し、製品metadataとUIをownerに残せる。
- **Trade-offs**: generic typesが多い。公開型fixtureで推論可能性を固定する。
- **Follow-up**: existing backup public behaviorへの接続はpending `backup-restore` Change Briefが単独所有し、本specは製品codec/adapterを実装しない。

### Decision: 製品adapterを下流canonical ownerへ委譲する

- **Context**: `v0.5.0-boundary-reconciliation`で`ProductLocalDataAdapter`と`ProductBackupAdapter`の二重ownerが判明した。
- **Alternatives Considered**:
  1. 本specでpure delegation adapterまで実装し、下流specでは意味変更だけを扱う。
  2. 本specはgeneric package、Chrome adapter、backup orchestration、公開port、package検証だけを所有する。
- **Selected Approach**: 2を採用し、app接点は製品型を入力にするread-only compile contractへ限定する。
- **Rationale**: generic mechanismの独立性を証明しながら、PC root/error/compositionは`local-data-foundation`、製品backup codec/policy/UIは`backup-restore`というcanonical ownershipを守れる。
- **Trade-offs**: package spec単独ではproduction wiringを完了しない。接続の実行可能性は公開型contractで固定し、実装・integration/E2Eは下流waveで検証する。
- **Follow-up**: public port変更時は両下流specを再検証し、製品adapter実装を本specへ戻さない。

### Decision: policy errorとmechanism errorを明示adapterで合流する

- **Context**: stage codeだけでは`FoundationError`のpayload/contextを復元できない。
- **Alternatives Considered**:
  1. policy errorを既存`CoreError`へ縮退する。
  2. consumer側でunsafe castしてfactoryへ渡す。
  3. `PolicyError`と`OutputError`を別genericにし、consumer-owned adapterで写像する。
- **Selected Approach**: 3を採用し、policy failureはstageと元errorをadapterへ渡し、mechanism failureだけをcore error adapterへ渡す。
- **Rationale**: packageの製品非依存を維持しながら、下流canonical errorの意味とpayloadを保持できる。
- **Trade-offs**: factory genericは増えるが、synthetic declaration contractで推論可能性とexhaustivenessを固定する。
- **Follow-up**: 下流executable contractで全policy stageとcore failureの意味不変mappingを実行検証する。

### Decision: persistent recovery lifecycleをowner protocolへ委譲する

- **Context**: packageがcontrol fieldを解釈すると、root内maintenanceとroot外recoveryの保存意味が結合する。
- **Alternatives Considered**:
  1. package共通control schemaへ製品を移行する。
  2. field accessor群だけを注入しpackageがstate machineを所有する。
  3. owner protocolがcontrol decode、fence、pending、release、finalization、current anomaly transitionを所有する。
- **Selected Approach**: 3を採用し、packageはopaque capabilityとprotocol resultだけでreplacement commit pointを制御する。
- **Rationale**: 保存形式を変えず、数値lease、owner field、独自pending marker、製品anomaly ruleをpackageから排除できる。
- **Trade-offs**: protocol contractはlifecycleを明示する必要があるが、packageは製品state machineを再実装しない。
- **Follow-up**: normal/recovery、precommit cleanup、postcommit finalization、worker再生成をsynthetic package testと下流executable contractの両方で検証する。

historical Task 2.3の完了記録は変更しない。ただし、そのowner/generation/lease state machineはTasks 6.3–6.4でsupersedeされる移行元であり、planned end stateのpackage `FencingPolicy`はroot内maintenanceだけを所有する。persistent recoveryの保存表現とtransitionはowner protocolが単独所有する。

### Synthesis: 最小修復境界

- **Generalization**: transactionとreplacementに共通するpolicy failure合流を一つの`ErrorAdapter<PolicyError, OutputError>`へ一般化する。controlは一般化せず、root maintenanceとpersistent recoveryを別責務として分離する。
- **Build vs Adopt**: 新規依存は導入しない。既存Result、factory、opaque ticket、workspace command routingを拡張する。
- **Simplification**: package内の製品field parserとpending marker ownershipを削除し、owner protocol一つへ置換する。製品contract複製やpackage側product fixtureは追加しない。

### Decision: finalization capabilityをprepare時にownerが発行する

- **Context**: Task 6.4実装レビューで、root write後のreleaseまたはcontrol保存が失敗した場合にowner-issued `FinalizationTicket`が必要だが、従来の`prepareCommit`は`PendingCommit`しか返さず、ticket取得のためのpost-commit `observeCurrent` / `classifyCurrent`自体が失敗するとcommitted successとowner errorを既存unionで同時に表現できない矛盾が判明した。
- **Alternatives Considered**:
  1. root write前のcandidateをcurrent rootとして分類し、postcommit ticketを予測する。
  2. packageがticketを生成する、または`PendingCommit`をticketへcastする。
  3. committed resultへticketなしvariantまたはreceipt付きerrorを追加する。
  4. owner protocolが`prepareCommit`時にpendingとfinalization capabilityを同じpersistent controlへ束縛して返す。
- **Selected Approach**: 4を採用する。owner-defined `FinalizationCapability`をprotocol、commit state、replacement public portまで独立genericとして通し、package-owned brandやwrapperへ変換しない。packageはcapabilityをroot write成功後のcleanup failure時だけ公開し、root write失敗時はprecommit cleanup/reassessmentへ戻す。
- **Rationale**: actual current rootの意味とcommit pointを保ち、post-commitのfallible classificationをcommit経路から除去しながら、owner-only ticket生成、worker再生成、finalize-only retryを両立できる。
- **Trade-offs**: owner protocol実装はprepare時に将来のfinalization capabilityを永続controlへ束縛し、そのopaque型をpublic replacement portまで提供する必要がある。ただしpackageはcapabilityのfieldや保存表現を解釈せず、unsafe cast、package wrapper、公開result unionのvariant追加も不要になる。
- **Follow-up**: synthetic storage fixtureはcontrol read/writeごとにcloneして参照同一性依存を排除する。`findPendingFinalization`はactual persisted rootを分類し、`finalize`は入力ticketをowner protocolへそのまま渡す。下流`local-data-foundation` Task 11.2で製品controlの対応を実行検証する。

## Risks & Mitigations

- policy hookの組合せが矛盾する — package contract kitでrevision、dedupe、repair、fenceを一つのsynthetic policyとして検証し、app characterizationで現行結果と比較する。
- package内subpath間の逆依存 — TypeScript AST boundary gateで`core <- chrome`、`core <- backup`の一方向だけを許可する。
- root write後の失敗をpre-commit失敗として扱う — commit outcomeを判別共用体にし、finalize-only testでroot write 0件を固定する。
- Chrome adapterがcontent scriptへstorageを露出する — `TRUSTED_CONTEXTS`成功前はproduction handleを返さずnegative contractを維持する。
- pending Existing Spec Updatesとの重複 — 本specのapp作業をsynthetic contractとFoundation所有commandのroutingへ限定し、製品adapter、schema・error、exchange、composition、UI、lifecycle、E2Eを各canonical ownerのChange Briefへ残す。

## References

- [Chrome Extensions Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) — quota、access level、bytes、change event。
- [Chrome StorageArea API](https://developer.chrome.com/docs/extensions/reference/api/storage/StorageArea) — Promise、`setAccessLevel`、area change contract。
- [MDN Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) — tab・worker間のnamed lock coordination。
- [MDN LockManager.request](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request) — exclusive requestとcallback lifecycle。
- `.kiro/specs/typed-messages-core/` — private workspace packageとvalidation pattern。
- `.kiro/specs/local-data-foundation/`、`.kiro/specs/backup-restore/`、`.kiro/specs/runtime-schema-validation/` — 現行ownerと非回帰契約。
