# Research & Design Decisions

## Summary
- **Feature**: `project-candidate-management`
- **Discovery Scope**: Extension / light discovery
- **Key Findings**:
  - 上流は`LocalDataRoot`、`CandidatePart`、カテゴリ判別共用体、検証済みRepositoryを公開する。
  - 候補は単一プロジェクトへ所属し、プロジェクト削除は上流Repositoryが所属データを同一更新内で除去する。
  - 新規外部依存は不要で、業務サービスとサイドパネルUIを上流ポートへ接続する最小構成が適切である。
  - 最新Foundationは候補変更とCurrentBuild参照修復を同一root mutationで完了し、application shellはfeature-neutralなtyped activationを配送する。
  - `product-capture-transient-migration` は保存portや直接navigationを廃止し、candidate-management所有のtyped intent factoryと解決前pre-edit契約へ移行する。
  - project 0件はactivation失敗ではなく候補管理の`project-required`状態であり、空名は編集開始検証では許可し既存保存時検証で拒否する。
  - 候補管理公開APIは`query`、`createCandidateEditorIntent`、`sources: { catalog, mutations }`を共存させ、`duplicate-product-merge`の公開consumer境界を維持する。

## Research Log

### 上流契約と拡張点
- **Sources Consulted**: `local-data-foundation/requirements.md`、`design.md`、`research.md`
- **Findings**: 下流は公開ドメイン契約とRepositoryだけへ依存する。保存失敗は判別可能な`Result`で返り、候補の元表記と確認値は別フィールドである。
- **Implications**: 本機能はChrome Storageを直接操作せず、管理固有の入力検証、カテゴリ変更、表示状態を所有する。

### UIホストと境界
- **Sources Consulted**: `roadmap.md`、feature brief、上流File Structure Plan
- **Findings**: ロードマップはChrome 116以降のMV3サイドパネルを想定する。ページ抽出と構成選択は別specである。
- **Implications**: サイドパネル入口と管理画面を追加し、取り込み・構成UIは含めない。

## Architecture Pattern Evaluation

| Option | Strengths | Risks | Decision |
|---|---|---|---|
| Feature service + UI | 業務規則と表示を分離し後続契約を共有可能 | 小規模な層追加 | 採用 |
| UIからRepository直接操作 | 実装が短い | 規則とエラー変換が分散 | 不採用 |

## Design Decisions

### Decision: 単一の管理サービス
- プロジェクトと候補は同じ集約ルートで更新されるため、一つのサービスがコマンド検証とRepository連携を担う。
- 将来用途向けの汎用CRUDフレームワークは導入しない。

### Decision: カテゴリ変更時の属性を明示変換
- 共通項目と元表記を保持し、カテゴリ固有の確認属性は新カテゴリの形へ初期化する。
- 旧カテゴリ属性を新カテゴリ属性へ推測変換しない。

## Risks & Mitigations
- 上流型の変更 — 公開エントリポイントだけに依存し、形状変更を再検証トリガーにする。
- 編集途中の保存失敗 — フォーム状態を永続状態と分離し、成功時のみ一覧を更新する。
- 未分類の下流利用 — 参照契約で分類済み候補だけを返す。

### 2026-07-19 React UI方針更新
- **背景**: 一覧、カテゴリ切替、複数フォーム、削除確認、失敗時ドラフト保持を標準DOMで管理すると描画とcleanupの見通しが悪化する。
- **判断**: `view.tsx`をReact function componentとし、feature固有の`react-root.tsx`で既存`FeatureMountContext`へ接続する。
- **境界**: ManagementState、service、port、CSS所有権は維持し、React固有型をdomain契約へ漏らさない。外部文字列は通常のJSX childとし、`dangerouslySetInnerHTML`と`innerHTML`を禁止する。
- **統合**: featureは`public.ts`とregistration moduleを所有し、共有side panel runtime、HTML host、root barrelを編集しない。
- **検証**: 利用者視点のReact DOM testとmount/unmount cleanup testを追加する。
- **参照**: [React createRoot](https://react.dev/reference/react-dom/client/createRoot)、[React TypeScript](https://react.dev/learn/typescript)

### 2026-07-20 上流契約追従
- **Sources Consulted**: `local-data-foundation/design.md`、`application-shell/design.md`、`roadmap.md`、`cross-spec-review.md`
- **Findings**: Foundationは`FoundationDataPort.mutate`内で参照修復、root検証、revision更新、単一保存を行う。shellはfeature ID、target、`unknown` payloadを配送し、対象featureがpayloadを検証する。
- **Implications**: 候補管理はRepository直接writeと成功後のbuild reconcileを要求せず、`RootMutationCommand`の利用側になる。候補編集prefillは`public.ts`の型付きAPIとregistrationのruntime validatorを対にする。
- **Decision（2026-07-27に置換）**: 当時の`openCandidateEditor`直接navigation判断はtyped handoff移行で廃止し、現在は副作用のない`createCandidateEditorIntent`を公開する。`CandidateDraft`の保存規則は引き続き候補管理が所有する。
- **Risk Mitigation**: activation payload、project存在、targetを適用前に検証し、失敗時は入力元と候補管理双方の既存stateを保持する。

### 2026-07-20 Shell rollback snapshot契約への追従
- **Sources Consulted**: `application-shell/requirements.md`、`application-shell/design.md`、activation lifecycle review findings
- **Findings**: shellはfeature固有stateを復元できないため、cross-feature activationの入力元はopaque state snapshotを提供する必要がある。cleanup失敗時はshellがtarget handleを保持し、sourceを同時にmountしない。
- **Decision**: 候補管理は選択、未保存draft、確認ダイアログ、表示エラーをfeature-local snapshotとしてcapture／restoreする。永続root、request、購読、React objectはsnapshot対象外とする。
- **Implications**: state snapshotのruntime validationはcandidate managementが所有し、shellへ候補値やフォーム構造を漏らさない。restore不能時は保存済みデータを変えず初期表示へ退避する。

### 2026-07-27 transient product capture移行への追従
- **Sources Consulted**: `product-capture-transient-migration/{requirements.md,design.md}`、`transient-feature-surface/design.md`、`application-shell/design.md`、候補管理の既存コード。
- **Findings**: captureは`CandidateManagementPublicApi.createCandidateEditorIntent`でpayloadを作り、現行`activationId`とともに`TransientSurfaceLifecyclePort.conclude`へ渡す。候補管理は世代を所有せず、`FeatureActivationAdapter`のvalidate/activate結果だけを返す。project解決方法は2026-08-03の判断で置換し、現在は`project-context`だけをauthorityとする。
- **Implications**: 旧`CaptureCandidatePort`、`openCandidateEditor`、capture側project queryを公開契約から除去する。`pendingPreEdit`は長寿命ManagementStateへsession限定で保持し、永続root・backup・opaque snapshotへ含めない。

### 2026-07-27 下流source・duplicate契約の保全
- **Sources Consulted**: `candidate-source-bookmarks/design.md`、`duplicate-product-merge/design.md`。
- **Findings**: source specは候補管理公開APIへ`sources: { catalog, mutations }`を追加し、duplicate consumerは`CandidateQuery.listCandidates`とsource mutation portを利用する。一部文書に旧`capture`表記が残るが、transient migrationのcanonical契約とは両立しない。
- **Implications**: 本specの最終公開APIは`query`、`createCandidateEditorIntent`、`sources` facetとする。source/duplicate能力をpre-edit内部へ統合せず、公開portの共存だけを保証する。旧`capture`参照は横断spec修復対象として報告する。

## 2026-07-27 Design Synthesis

### Generalization
- project解決済み編集とproject未解決pre-editを一つの保存draftへ無理に統合せず、`UnresolvedCandidateDraft`からcanonical `CandidateDraft`へ一方向に解決する。

### Build vs. Adopt
- 世代管理と原子的handoffは`transient-feature-surface`、typed activation envelopeはapplication shell、保存validationはFoundationの既存契約を採用する。候補管理独自のgeneration、navigator、validatorを作らない。

### Simplification
- 公開操作をintent factoryへ縮小し、capture向けwrite portと直接navigation methodを削除する。`pendingPreEdit`は既存ManagementStateへの一field追加とし、別storeや永続schemaを導入しない。

## 2026-08-03 project-context統合の再設計

### Summary

本specは既存候補管理の拡張であるためlight discoveryを実施した。更新要件は新規ライブラリや外部APIを導入せず、隣接`project-context`の公開portを利用して、旧来のfeature内selector・一覧先頭fallback・snapshot ID authorityを撤去する統合変更である。

### Research Log

- `project-context`は`read`、`commands`、`guards`を能力別に公開し、ready/empty/unavailable snapshot、generation付き確認、forced notification、refreshを所有する。候補管理はこの公開境界だけへ依存できる。
- 現行候補管理設計はproject未指定pre-editを「選択中→一覧先頭」で解決し、snapshot内`selectedProjectId`を復元根拠としていた。これは現在projectを唯一のauthorityとする更新要件に反する。
- project CRUDとcontext preferenceは異なる整合性境界である。mutation成功後のrefresh失敗をmutation失敗と同一視すると同じCRUDを再送する危険があるため、保存済み結果とcontext再検証失敗を別状態にする必要がある。

### Design Decisions

- **Generalization**: candidate draftとpending pre-editを「project切替で失ってはならないdirty work」として一つのguard判定へ集約する。forced切替は確認可能なuser切替と分け、旧project bindingを保持した回復待ちへ移す。
- **Build vs. Adopt**: 独自selector、preference、fallback、確認tokenを実装せず、`project-context`のread/command/guard portを採用する。新規依存は追加しない。
- **Simplification**: pre-editの検証済み公開型はproject-freeとし、legacyまたは未信頼payloadのproject情報は受理後に破棄する。snapshotの`selectedProjectId`だけは既存shape互換の一致検査用metadataとして残すが、保存先やcontext変更には使用しない。snapshot versionを上げず、adapter一つへ購読・guard・refresh調停を閉じる。

### Risks & Mitigations

- CRUD成功後のrefresh失敗による二重mutation: `context-refresh-failed`でrefresh-only recoveryを提供する。
- async確認中のcontext更新によるdraft消失: generationとrequest IDが一致する結果だけを適用する。
- forced切替後の誤保存: draftのproject IDを書き換えず保存不能な回復待ち状態にする。
- legacy snapshotによるauthority逆流: current snapshotとの一致検査だけに使い、不一致時はcontextを変更しないcontract testを置く。

## 2026-08-12 v0.5.0 boundary reconciliation

### Summary

- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **Discovery Scope**: Extension / Light Integration Update
- **Sources Consulted**: 最新Change Brief、roadmap、承認済み`project-context`と`local-data-foundation`のrequirements/design/tasks、現行candidate requirements/design/tasks、`product.md`、`tech.md`、`structure.md`。
- **Findings**:
  - `project-context`は`ProjectLifecyclePort`、single-flight service、state、削除確認、semantic message descriptor、host-neutral presentationをcanonicalに所有し、候補管理には既存host接続とdraft guard連携だけが残る。
  - `local-data-foundation`は`FoundationError`と一対一対応する共有`AppDataError`とmapperを`src/domain/public.ts`から公開し、candidate固有validationは各featureに残す。
  - source editor UXは候補管理の利用者能力だが、source entity・catalog・URL identity・mutationは`candidate-source-bookmarks`へ、product identity normalizerと保存前判断contractは`duplicate-product-merge`へ移る。
  - `duplicate-product-merge`のmatchなし・明示新規保存経路にはcandidate CRUD ownerが提供するcreate-only seamが必要である。既存`query`と`createCandidateEditorIntent`を変更せず、`CandidateCreatePort`だけをcanonical candidate公開入口へ加えるのが最小境界となる。
  - application shellは後続waveでproduction注入と旧proxy撤去を所有するため、本specはfeature-local host/consumer seamまでを定義し、runtime compositionを変更しない。

### Design Decisions

- **Generalization**: 旧`ManagementError`全体を別名へコピーせず、候補固有field validationと共有`AppDataError`を合成する`CandidateOperationError`へ縮小する。data operation semanticsは共有ownerのvariantをそのまま保つ。
- **Build vs. Adopt**: project command/refresh、source catalog/mutation、product identityを再実装せず、承認済み隣接ownerの公開portを採用する。新規外部依存は追加しない。
- **Simplification**: project CRUD service/state/formをcandidate境界から撤去し、host adapter一つで共通lifecycle presentationを既存領域へmountする。source/identityは各一つのowner-local consumer adapterに限定し、再公開barrelやproxyを作らない。
- **Candidate create seam**: `CandidateCreatePort`はduplicate workflowの明示新規保存だけに必要な`createCandidate`を公開し、既存`CandidateManagementService`へ委譲する。update/delete、project lifecycle、source mutation、error定義を公開面へ広げず、戻り値は候補固有validationと共有`AppDataError`からなる既存`CandidateOperationError`を維持する。

### Migration Seams and Risks

- project lifecycle移管は共通presentationを先にhostへ接続し、candidate側の旧project service/state/view/messageを同じ変更で撤去する。二重command authorityまたは二重表示をboundary/DOM testで拒否する。
- `ManagementError`移行は共有`AppDataError` public importへ全candidate data pathを切り替えてから旧definition/mapper/exportを除去する。variant/payload/display regressionはexhaustive contractとDOM testで固定する。
- `CandidateCreatePort`はTask 13.1でpublic shapeを固定し、Task 14.2で共有`AppDataError`対応済みのcandidate service実装へ接続する。query/editor intentの既存consumer fixtureを同じgateで保持する。
- source core移管は隣接spec実装前に内部codeを先行削除しない。本specは公開portを受けるadapter seamと旧owner negative gateを定義し、downstream実装完了後に移管元を撤去できるtask順序にする。
- product identityも同様に`duplicate-product-merge`公開contractが利用可能になってからimportを差し替え、product captureへの依存が残らないことをtype/boundary gateで確認する。
- snapshot version 3/shape、candidate CRUD、pre-edit寿命、current project binding、draft guard、source editor layout/操作順を変更しない。migration中にcontractが未注入ならfail closedに初期化し、旧ownerへ暗黙fallbackしない。
