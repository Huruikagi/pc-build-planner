# Research & Design Decisions

## Summary

- **Feature**: `local-data-library-boundaries`
- **Discovery Scope**: Complex Integration
- **Key Findings**:
  - 現行実装は必要な安全性をすでに持つが、`StoragePort`、transaction、replacement、recovery、backup protocolが`LocalDataRoot`と`FoundationError`へ結合している。抽出は挙動追加ではなく、既存characterizationを保った依存反転として行う必要がある。
  - package数を3つへ先に増やさず、単一private package内のroot core export、明示的なChrome subpath、明示的なbackup subpathで依存方向を分ける構成が最小である。宣言済みsubpathは公開API、その他の内部pathはdeep importとして拒否する。
  - Chrome Storageは10MB quota、`getBytesInUse`、`setAccessLevel`、`onChanged`を提供し、Web Locksはtab・worker間で同名exclusive lockを直列化する。platform-native能力を薄いadapterへ閉じ込め、coreにChrome型を入れない設計を維持できる。

## Research Log

### 現行local data責務と公開契約

- **Context**: generic mechanismと製品policyの切断点を特定する必要がある。
- **Sources Consulted**: `src/persistence/**`、`src/domain/**`、`local-data-foundation` requirements/design/tasks、`runtime-schema-validation` requirements/design。
- **Findings**:
  - `RootTransactionRunner`がlatest-read、revision、dedupe、maintenance/recovery fencing、single writeを統合する。
  - `StoragePort`はroot、RecoveryControl、bytes、quota、access restrictionを一つに持ち、Chrome adapterとin-memory adapterが実装する。
  - `LocalDataRoot`、具体migration、reference repair、`FoundationError`、worker authorizationは製品policyでありgeneric coreへ移せない。
  - `BackupRestoreDataPort`は通常CRUDやraw rootを隠す用途限定capabilityとして確立済みである。
- **Implications**: coreはrootをgeneric型として扱い、revision・dedupe・validation・migration・repair・fenceをconsumer-supplied policyにする。既存公開portのshapeはproduct adapterが維持する。

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
- **Follow-up**: existing backup public behaviorの移行はpending `backup-restore` Change Briefの境界を越えない。

## Risks & Mitigations

- policy hookの組合せが矛盾する — package contract kitでrevision、dedupe、repair、fenceを一つのsynthetic policyとして検証し、app characterizationで現行結果と比較する。
- package内subpath間の逆依存 — TypeScript AST boundary gateで`core <- chrome`、`core <- backup`の一方向だけを許可する。
- root write後の失敗をpre-commit失敗として扱う — commit outcomeを判別共用体にし、finalize-only testでroot write 0件を固定する。
- Chrome adapterがcontent scriptへstorageを露出する — `TRUSTED_CONTEXTS`成功前はproduction handleを返さずnegative contractを維持する。
- pending Existing Spec Updatesとの重複 — 本specのapp作業をpure delegation adapterと非回帰testへ限定し、製品schema・error・exchange・UI・lifecycle変更を各Change Briefへ残す。

## References

- [Chrome Extensions Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) — quota、access level、bytes、change event。
- [Chrome StorageArea API](https://developer.chrome.com/docs/extensions/reference/api/storage/StorageArea) — Promise、`setAccessLevel`、area change contract。
- [MDN Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) — tab・worker間のnamed lock coordination。
- [MDN LockManager.request](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request) — exclusive requestとcallback lifecycle。
- `.kiro/specs/typed-messages-core/` — private workspace packageとvalidation pattern。
- `.kiro/specs/local-data-foundation/`、`.kiro/specs/backup-restore/`、`.kiro/specs/runtime-schema-validation/` — 現行ownerと非回帰契約。
