# Design Document

## Overview

本機能はPC構成を検討する利用者へ、共通の現在プロジェクトに所属する候補パーツをサイドパネル内で整理・補正する管理体験を提供する。`project-context` の検証済みsnapshotを唯一の作業対象とし、`local-data-foundation` の型、query、原子的root mutationを利用して、管理固有のコマンド規則、カテゴリ別参照契約、typed activation、draft保護、フォーム状態、画面を提供する。

### Goals
- 欠損と未分類を許容するプロジェクト・候補CRUDを提供する
- 共通項目、確認済み属性、元表記を区別し安全に再編集する
- 商品取り込みと構成管理が利用できる安定した候補契約を公開する
- project切替、CRUD後のcatalog再検証、画面復元を通じて現在プロジェクトとの整合を維持する

### Non-Goals
- ページ抽出、候補の採用、互換性判定、バックアップ
- project contextの選択・preference・fallback・共通selector
- 共通パーツライブラリ、画像、複製、ステータス

## Boundary Commitments

### This Spec Owns
- プロジェクト名と候補編集の業務規則、カテゴリ変更規則
- プロジェクト別・カテゴリ別の候補照会と分類済み候補参照契約
- サイドパネルのproject CRUD、候補管理UI、削除確認、エラー表示。現在project selectorは所有しない
- `CandidateDraft`、候補編集prefill、候補管理activationの検証とstate適用
- `UnresolvedCandidateDraft`、pre-edit構造検証、現在projectへのbinding、`pendingPreEdit`と`project-required`状態
- 候補draftのdirty判定、project-context guard、強制切替通知後のdraft保護
- CRUD成功後のproject-context refresh調停と、既存snapshot内project metadataの一致検査
- 候補管理公開APIの`query`とtyped intent factory。`candidate-source-bookmarks`が追加する`sources` facetと共存する公開境界
- feature切替rollback向けの管理画面state snapshotとrestore

### Out of Boundary
- 永続化、スキーマ移行、容量判定の実装
- DOM抽出、現在構成の選択・数量、互換性評価
- 元表記から確認値を推測する処理
- navigation lifecycle、候補変更時のCurrentBuild参照修復、root全体のcommit
- snapshotの永続化、snapshot内容のshell側解釈、他featureのstate復元
- 一過性面の起動世代・固定tab・`conclude`・失敗時intent保持
- source entity・catalog・mutationの実装、および重複候補の照合・統合判断
- 現在projectの選択、preference、fallback、共通selector、project-context singletonとproduction composition
- 現行snapshot version 3/shapeの追加変更、snapshotからproject-contextを更新する処理

### Allowed Dependencies
- `local-data-foundation` のDomainModel、Result、`FoundationDataPort`、原子的root mutation契約
- Chrome 116以降のsidePanel実行ホストと既存ビルド基盤
- application shellが提供するReact 19系/React DOM基盤を利用し、このfeature独自のUI runtime依存は追加しない
- application shellの`ApplicationFeatureRegistration`、`FeatureMountContext`、operation policy、contract test kit
- application shellの`ShellNavigator`、`FeatureActivationIntent`、activation adapter契約
- application shellのopaque state snapshot／restore lifecycle契約
- `project-context` のread、command、guard registration port。候補管理はpreference storeやservice内部へ依存しない
- `product-capture-transient-migration` が利用する現行世代確認済み`FeatureActivationIntent`と`TransientSurfaceLifecyclePort.conclude`のtyped result
- `candidate-source-bookmarks` が同じ公開APIへ合成する`CandidateSourceCatalogPort`と`CandidateSourceMutationPort`
- `product-page-capture` が公開する純粋な`ProductIdentityNormalizer`とmanufacturer domain照合能力
- `source-price-refresh` の公開port。`duplicate-product-merge`のfeature-local coordinatorへcomposition時に注入し、内部moduleへdeep importしない
- `duplicate-product-merge` が候補管理owner内へ追加するmatcher、判断state/view、snapshot substate。既存CRUD・project binding・保存validatorの所有は移さない

### Revalidation Triggers
- `Project`、`CandidatePart`、`SourceInfo`、カテゴリ、正規化属性、Foundation query/mutation errorの形状変更
- 未分類候補の公開規則または候補の所属規則変更
- サイドパネル入口、保存責任、依存方向の変更
- shell activation envelope、候補変更時の参照修復policy、revision競合規則の変更
- FeatureMountContextの復元state、capture／restore失敗、activation rollback規則の変更
- `CandidateEditorPrefill`、`UnresolvedCandidateDraft`、pre-edit error、project解決順序、`pendingPreEdit`寿命の変更
- `ProjectContextSnapshot`、generation、guard/confirmation、refresh、forced notification契約の変更
- candidate-management snapshot version/shape、またはproject metadataの意味の変更
- 候補管理公開APIの`query`、`createCandidateEditorIntent`、`sources` facetの変更

## Architecture

### Architecture Pattern & Boundary Map

```mermaid
graph LR
    Context[Project context] --> Adapter[Project context adapter]
    Adapter --> VM[Management state]
    UI[Management UI] --> VM[Management state]
    VM --> Service[Candidate management service]
    Capture[Product capture] --> Intent[Candidate editor intent]
    Build[Current build] --> Query[Candidate query]
    Service --> Data[Foundation data port]
    Query --> Data
    Intent --> Transient[Transient conclude]
    Transient --> Activation[Candidate activation]
    Activation --> VM
    VM --> PreEdit[Pending pre edit]
    PreEdit --> Service
    VM --> Guard[Draft switch guard]
    Guard --> Context
    Service --> Refresh[Catalog refresh]
    Refresh --> Context
```

- **Selected pattern**: feature serviceとUI state。入力規則と永続化連携をUIから分離する。
- **Dependency direction**: `Foundation/ProjectContext/Shell contracts → Feature contracts → Service/Query/Activation/ContextAdapter → UI state → UI/Registration`。右側は左側だけへ依存する。
- **Existing patterns preserved**: canonical `Result`、判別共用体、単一write authority、feature registration。
- **Atomicity**: 候補削除・カテゴリ変更はFoundationの一つのroot mutationで参照修復、全体検証、revision更新、保存を完了し、成功後のCurrentBuild別writeを要求しない。

### Technology Stack

| Layer | Choice / Version | Role |
|---|---|---|
| Language | TypeScript 7.x strict | コマンド・状態・属性の型安全性 |
| UI | React 19系 / React DOM / CSS | MV3サイドパネル管理画面 |
| Data | FoundationDataPort | 検証済みqueryと原子的root mutation |
| Test | Node test runner / jsdom / Playwright | サービス、状態、DOM統合、production E2E検証 |

## File Structure Plan

```text
src/features/candidate-management/contracts.ts # コマンド、表示用モデル、公開照会契約
src/features/candidate-management/public.ts    # query、typed intent factory、sources facetの唯一の公開入口
src/features/candidate-management/feature-contribution.ts # shell compositionへ渡すcontribution factoryの唯一の公開入口
src/features/candidate-management/registration.ts # shellへ渡すfeature registrationと依存組立
src/features/candidate-management/activation.ts # unresolved pre-edit検証、project解決、typed activation適用
src/features/candidate-management/pre-edit-validation.ts # unresolved draft/prefillの段階別runtime検証
src/features/candidate-management/project-context-adapter.ts # read購読、dirty guard、forced切替、CRUD後refreshの調停
src/features/candidate-management/state-snapshot.ts # 管理UI stateのopaque snapshot検証・capture・restore
src/features/candidate-management/service.ts   # CRUD、分類変更、下流照会
src/features/candidate-management/state.ts     # 読込、pendingPreEdit、project-required、フォーム、保存、エラー状態
src/features/candidate-management/view.tsx     # 一覧、フォーム、確認のReact component
src/features/candidate-management/react-root.tsx # FeatureMountContextとReact rootの接続・cleanup
src/features/candidate-management/styles.css   # 管理画面レイアウトと状態表現
src/features/candidate-management/source-*.ts # candidate-source-bookmarksが追加したsource facetとowner-local adapter
src/features/candidate-management/duplicate-*.ts(x) # duplicate-product-mergeが追加した保存前判断とUI substate
src/features/candidate-management/category-draft.ts # unresolved draftのproject binding
tests/features/candidate-management/service.test.ts
tests/features/candidate-management/state.test.ts
tests/features/candidate-management/view.test.ts
tests/features/candidate-management/registration.test.ts
tests/features/candidate-management/activation.test.ts
tests/features/candidate-management/state-snapshot.test.ts
tests/features/candidate-management/pre-edit-validation.test.ts
tests/features/candidate-management/project-context-adapter.test.ts
tests/features/candidate-management/pre-edit-handoff.integration.test.ts
tests/features/candidate-management/project-switch-protection.integration.test.ts
tests/features/candidate-management/source-*.test.ts
tests/features/candidate-management/duplicate-*.test.ts(x)
```

### Modified Files
- 共有runtime入口、`side-panel.html`、root `src/index.ts`は変更しない。application shellは`feature-contribution.ts`と`public.ts`だけをcompositionし、内部moduleへdeep importしない。
- `styles.css`はfeatureが所有し、application shellのside panel stylesheet入口`src/application-shell/side-panel.css`が`@import`で集約して`dist/styles.css`へ出力する。HTML hostとbuild entry pointはshellが所有するため、featureはこれらを変更しない。到達不能なCSSをfeature所有ファイルとして残さない。
- `react-root.tsx`は`FeatureMountContext`とReact rootの接続・cleanupだけを所有し、`registration.ts`はDOM/React生成処理を持たない。registrationは実mountを持たない場合にplaceholderで成功を装わず、mount失敗として扱う。
- `state-snapshot.ts`とregistrationのsnapshot接続は、application shellがcapture／restoreを含むmount contractを確定してから実装する。このspecの既存`tasks.md`はその前提を持たないため、設計承認後に再生成する。

## System Flows

```mermaid
sequenceDiagram
    participant User
    participant View
    participant State
    participant Service
    participant Foundation
    User->>View: edit and confirm
    View->>State: submit command
    State->>Service: validated draft
    Service->>Foundation: root mutation with expected revision
    Foundation->>Foundation: repair references and validate root
    Foundation-->>Service: mutation receipt or typed error
    Service-->>State: saved model or error
    State-->>View: render stable state
```

保存成功時だけ永続モデルを置換する。失敗時は編集ドラフトと直前の一覧を保持する。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|---|---|---|---|---|
| 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8 | project CRUDとcontext再検証 | Service、State、ProjectContextAdapter、View | ProjectCommand、ProjectContextCommandPort | 編集・削除・refresh |
| 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 | 現在projectへの欠損許容候補作成 | Service、State、ProjectContextAdapter | CandidateDraft、ProjectContextReadPort | 保存 |
| 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7 | 現在project追従とカテゴリ別表示 | CandidateQuery、ProjectContextAdapter、View | CandidateListQuery、ProjectContextReadPort | context購読・読込 |
| 4.1, 4.2, 4.3, 4.4, 4.5, 4.6 | 安全な編集 | Service、State、View | UpdateCandidateCommand | 保存 |
| 5.1, 5.2, 5.3, 5.4 | 候補削除 | State、View、Service | DeleteCandidateCommand | 削除 |
| 6.1, 6.2, 6.3, 6.4, 6.5, 6.6 | 復元と下流契約 | Service、CandidateQuery、CandidateActivation、State | CandidateQuery、createCandidateEditorIntent、sources facet | 読込・保存・activation |
| 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10 | 解決前pre-editと現在project binding | CandidateActivation、PreEditValidation、ProjectContextAdapter、ManagementState、ManagementView | CandidateEditorPrefill、ProjectContextReadPort、FeatureActivationAdapter | pre-edit handoff・binding |
| 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 | project切替時のdraft保護 | ProjectContextAdapter、ManagementState、ManagementView | ProjectSwitchGuard、forced notification | switch guard・強制切替 |
| 9.1, 9.2, 9.3, 9.4, 9.5 | 非権威的snapshot metadata | StateSnapshotCodec、ProjectContextAdapter、ManagementState | ManagementStateSnapshot、ProjectContextReadPort | restore |

## Components and Interfaces

| Component | Domain | Intent | Req Coverage | Dependencies | Contracts |
|---|---|---|---|---|---|
| CandidateManagementService | Feature | 管理コマンドと規則 | 1.1–1.7, 2.1–2.6, 4.2–4.6, 5.2, 6.2–6.5 | FoundationDataPort P0 | Service |
| CandidateQuery | Feature | 絞込済み候補参照 | 3.1–3.6, 6.3–6.5 | FoundationDataPort P0 | Service |
| PreEditValidation | Feature contract | project未解決draftの構造検証 | 7.1, 7.5–7.8 | Foundation domain validators P0 | Service |
| CandidateActivation | Feature adapter | 候補編集prefillの検証、現在project binding、state適用 | 4.1–4.6, 6.6, 7.1–7.9 | Application shell activation P0、ProjectContextReadPort P0、ManagementState P0 | Service |
| ProjectContextAdapter | Feature adapter | context購読、dirty guard、強制切替、CRUD後refresh | 1.5–1.8, 2.1, 2.6, 3.1, 3.6–3.7, 7.1–7.5, 8.1–8.6, 9.2–9.4 | ProjectContextPublicApi P0、ManagementState P0 | Service, State |
| ManagementState | UI state | 編集、dirty、pending pre-edit、project-required、失敗回復、snapshot復元 | 1.3–1.8, 2.3–2.6, 4.5, 5.1–5.4, 6.1–6.2, 7.1–7.10, 8.1–8.6, 9.1–9.5 | Service P0、ProjectContextAdapter P0、FeatureMountContext P1 | State |
| ManagementView | UI | 一覧、フォーム、project-required、確認 | 1.1–5.4, 7.2–7.7, 7.9, 8.2–8.5, 9.4–9.5 | State P0 | State |
| CandidateFeatureRegistration | UI adapter | state/view/public API、context adapter、snapshot codecをshell登録契約へ接続 | 1.1–9.5 | ApplicationFeatureRegistration P0、ProjectContextPublicApi P0、ManagementView P0 | Service, State |

### Feature Layer

#### CandidateManagementService

```typescript
interface CandidateManagementService {
  createProject(input: CreateProjectInput, context: MutationContext): Promise<Result<Project, ManagementError>>;
  renameProject(input: RenameProjectInput, context: MutationContext): Promise<Result<Project, ManagementError>>;
  deleteProject(id: ProjectId, context: MutationContext): Promise<Result<void, ManagementError>>;
  createCandidate(input: CandidateDraft, context: MutationContext): Promise<Result<CandidatePart, ManagementError>>;
  updateCandidate(input: UpdateCandidateInput, context: MutationContext): Promise<Result<CandidatePart, ManagementError>>;
  deleteCandidate(id: CandidatePartId, context: MutationContext): Promise<Result<void, ManagementError>>;
}

interface MutationContext {
  readonly requestId: RequestId;
  readonly expectedRevision: number;
}
```

- 名前はtrim後に非空を要求する。任意項目は欠損を値へ推測変換しない。
- カテゴリ変更時は共通項目、`sourceInfo`、`sourceSnapshot`を維持し、新カテゴリ属性を明示入力から構築する。
- serviceは管理入力をFoundation公開の`RootMutationCommand`へ変換するだけで、StorageやCurrentBuildを直接更新しない。
- Foundationエラーを`validation`、`not-found`、`conflict`、`maintenance`、`storage`、`quota`、`unsupported-data`へ正規化する。

#### CandidateQuery

```typescript
interface CandidateQuery {
  listProjects(): Promise<Result<readonly ProjectSummary[], ManagementError>>;
  listCandidates(input: CandidateListQuery): Promise<Result<readonly CandidateSummary[], ManagementError>>;
  listBuildEligible(projectId: ProjectId): Promise<Result<readonly CandidatePart[], ManagementError>>;
  /** 一覧要約からは復元できない編集用draftを、保存済み候補から取得する。 */
  getCandidateDraft(id: CandidatePartId): Promise<Result<CandidateDraft, ManagementError>>;
}

```

`listCandidates`は必ずprojectIdで限定し、任意のcategoryで絞る。`listBuildEligible`は`unclassified`を除外する。`CandidateSummary`は比較用の要約であり、カテゴリ属性・取得元・元表記を持たないため編集draftを復元できない。既存候補の編集はUIから`getCandidateDraft`を呼び、保存済み値から完全なdraftを取得してから開始する。

#### PreEditValidation and CandidateActivation

```typescript
type UnresolvedCandidateDraft = {
  readonly [Attributes in NormalizedAttributes as Attributes["category"]]: Omit<
    CandidateDraftBase,
    "projectId"
  > & {
    readonly category: Attributes["category"];
    readonly normalizedAttributes: Attributes;
  };
}[PartCategory];

interface CandidateEditorPrefill {
  readonly draft: UnresolvedCandidateDraft;
  readonly projectId?: ProjectId;
  readonly categoryHint?: PartCategory;
}

interface CandidateManagementPublicApi {
  readonly query: CandidateQuery;
  readonly sources: {
    readonly catalog: CandidateSourceCatalogPort;
    readonly mutations: CandidateSourceMutationPort;
  };
  createCandidateEditorIntent(prefill: CandidateEditorPrefill): FeatureActivationIntent;
}

type PreEditDraftError =
  | { readonly kind: "invalid-draft-shape" }
  | { readonly kind: "invalid-category" }
  | { readonly kind: "category-mismatch" };

type CandidateEditorPrefillError =
  | PreEditDraftError
  | { readonly kind: "invalid-project-id" }
  | { readonly kind: "invalid-category-hint" };

function validatePreEditDraft(
  draft: unknown,
): Result<UnresolvedCandidateDraft, PreEditDraftError>;

function validateCandidateEditorPrefill(
  value: unknown,
): Result<CandidateEditorPrefill, CandidateEditorPrefillError>;
```

`createCandidateEditorIntent`は型付きprefillからshellの`FeatureActivationIntent`を構築するだけで、navigation、query、state mutationを開始しない。product captureはこの戻り値を現行`activationId`とともに`TransientSurfaceLifecyclePort.conclude`へ渡す。候補管理は起動世代を受け取らず、世代の現行性、stale結果破棄、handoff失敗時のintent保持を再実装しない。`conclude`が返す`Promise<Result<void, TransientSurfaceError>>`では、候補管理adapterの`activate`が成功した場合だけhandoff成功となる。

registrationのactivation adapterは受信payloadを`unknown`から再検証し、`featureId`とtargetが候補管理の固定値である場合だけManagementStateへ適用する。adapterの型付き境界は既存どおり`validate(intent): Result<CandidateEditorPrefill, FeatureActivationError>`と`activate(prefill): Promise<Result<void, FeatureActivationError>>`である。payload構造不正は`invalid_activation`へ写像し、未信頼値をerror detailへ含めない。形式が正しい任意`projectId`は互換性のため検証するが、保存先、fallback、context変更には使用しない。

activation時は`ProjectContextReadPort.getSnapshot()`を読み、`ready`ならその`selectedProjectId`だけを付与してcanonical `CandidateDraft`を構築しeditorへ遷移する。`empty`または`unavailable`ならactivation成功として`pendingPreEdit`へprefillを保持し、`project-required`を表示する。候補管理は一覧先頭やpayload内IDへfallbackせず、context snapshotを上書きしない。

`invalid-draft-shape`は必須field/value shape、`invalid-category`は未知category、`category-mismatch`はdraft categoryと`normalizedAttributes.category`の不一致を表す。任意`projectId`の型・空文字は`invalid-project-id`、未知`categoryHint`は`invalid-category-hint`とする。project 0件はerror unionへ追加しない。編集開始検証はcategory・normalized attributes・payload shapeだけを対象にして空名を許可し、保存時は既存`validateCandidatePartContent`を適用して空名を拒否する。仮project ID、unsafe cast、root全体の偽造、保存validatorの重複定義を使用しない。

`sources` facetは`candidate-source-bookmarks`が同じ公開APIへ加える既承認の拡張であり、この移行で削除・平坦化しない。`duplicate-product-merge`は`query.listCandidates`と`sources.mutations`だけを公開入口から利用し、pre-edit内部stateやvalidatorへ依存しない。

### UI Layer

#### ManagementState

永続スナップショット、選択project/category、編集ドラフト、`pendingPreEdit`、`project-required`、確認ダイアログ、操作状態、表示エラーを保持する。同一操作の二重送信を抑止し、失敗時はドラフトを保持する。

```typescript
interface CandidatePreEditState {
  readonly pendingPreEdit: CandidateEditorPrefill | null;
}
```

`ManagementStateValue`へ`pendingPreEdit`を追加するが、既存`editor`はproject解決済みcanonical `CandidateDraft`だけを保持する。project作成成功だけではpendingを解決せず、続く`ProjectContextCommandPort.refresh()`が`ready`を返した時点で、その選択IDを保持中draftへ付与してeditorへ遷移する。作成失敗またはrefresh失敗ではpendingを保持する。pendingは候補保存成功、利用者の明示取消、新しい検証済みpre-edit activationでのみ置換・破棄し、capture面の終了、通常のfeature切替では破棄しない。

pendingの寿命は同一side panel document sessionに限定し、長寿命の`ManagementState` instanceが保持する。opaque rollback snapshot、永続root、session storage、Chrome Storage、backupへ含めない。side panel閉鎖、extension reload、browser終了後の再openでは復元も自動再抽出もしない。`candidate-source-bookmarks`の複数source stateと`duplicate-product-merge`の判断substateを含む現行snapshot version 3契約を維持し、pendingをその永続化対象へ混入させない。

feature registrationのmounted handleは、未保存の管理画面stateをopaque snapshotとしてcaptureできる。現行version 3とshapeを維持し、`selectedProjectId`は復元時の一致検査にだけ使う非権威的metadataとする。snapshotは選択category、編集対象、検証済みdraft、削除確認、表示エラー、複製判断substateを含み、永続rootや保存中request、購読handle、React objectを含まない。rollbackによる再mount時は`FeatureMountContext`から受け取った`unknown`をfeature内で検証してから復元する。shellはsnapshotの構造・候補値を解釈しない。

```typescript
interface ManagementStateSnapshot {
  readonly version: 3;
  readonly selectedProjectId: ProjectId | null;
  readonly selectedCategory: PartCategory | null;
  readonly editor: CandidateEditorSnapshot | null;
  readonly deletion: DeletionConfirmationSnapshot | null;
  readonly displayError: ManagementDisplayError | null;
  readonly duplicateDecision: DuplicateMergeStateSnapshot | null;
}

type CandidateEditorSnapshot =
  | { readonly mode: "create"; readonly projectId: ProjectId; readonly draft: CandidateDraft }
  | { readonly mode: "edit"; readonly projectId: ProjectId; readonly candidateId: CandidatePartId; readonly draft: CandidateDraft };

type DeletionConfirmationSnapshot =
  | { readonly kind: "project"; readonly projectId: ProjectId }
  | { readonly kind: "candidate"; readonly candidateId: CandidatePartId };

interface ManagementDisplayError {
  readonly code: "validation" | "not-found" | "conflict" | "maintenance" | "snapshot-restore-failed";
}

type ManagementSnapshotError =
  | { readonly kind: "invalid-shape" }
  | { readonly kind: "unsupported-version" }
  | { readonly kind: "invalid-reference" }
  | { readonly kind: "invalid-draft" };

interface ManagementStateSnapshotCodec {
  capture(state: ManagementState): ManagementStateSnapshot;
  restore(input: unknown): Result<ManagementStateSnapshot, ManagementSnapshotError>;
}
```

`CandidateFeatureRegistration`はmount時にshellが提供する復元候補をcodecへ渡し、version/shape/content検証後、`ProjectContextReadPort`が`ready`かつsnapshotの`selectedProjectId`と一致する場合だけ編集状態を適用する。不一致、ID不存在、`empty`、`unavailable`ではcontextを変更せず、安全な初期状態へ退避する。session内の`pendingPreEdit`が既に存在する場合はそれを保持して`project-required`または再binding待ちを表示する。保存操作・subscription・React rootは新規mountで作成し直す。

`ManagementState`は単一mountより長く生存するため、mount開始時に通常の編集draft、削除確認、表示エラーを破棄してから永続データを読み込む。ただし受理済み`pendingPreEdit`は同一document sessionで維持する。shellはrollback時だけ`restoredState`を渡すので、通常の編集draftが検証済みsnapshotを経ずに再表示されることはない。

shellがmount contextで渡す`OperationPolicy`は`ManagementState`の依存として保持し、`isAllowed("mutation")`が偽の間はプロジェクト作成・改名・削除、候補作成・更新・削除をUI上で開始不能にし、serviceを呼ばない。Foundation側のfail-closedな拒否は最終防壁として維持し、UI抑止をその代替にしない。読取とナビゲーションはmaintenance中も維持する。

shellはmaintenance遷移でfeatureを再mountしないため、policyを一度読んだ値として扱わない。mount時に`operationPolicy.subscribe`で購読し、通知を受けたら`mutationsDisabled`を再評価して購読者へ伝播させ、unmountで解除する。これによりmount中にmaintenanceが開始した場合も操作要素が即座に無効表示へ切り替わる。stateのsnapshotは通知を伴わずに書き換えない。

#### ManagementView

project CRUD、カテゴリタブ、候補一覧、編集フォーム、`project-required`の選択・作成・回復案内、削除確認を描画する。共通の現在project selectorは描画しない。欠損は「未入力」、元表記は読み取り専用の別領域として表示する。`project-required`では保持中draftの内容を失わず、projectを自動作成・暗黙命名しない。

#### ProjectContextAdapter

`ProjectContextReadPort`を購読し、`ready`の選択IDだけを一覧query、候補保存、pre-edit bindingへ渡す。`empty`/`unavailable`では独自fallbackを行わず、stateを`project-required`へ移す。候補管理はstable guard IDで`ProjectSwitchGuard`を登録し、未保存のcandidate draftまたはpending pre-editがある場合だけ`confirmation-required`を返す。確認取消ではstateを変更せず、確認済み切替では旧draftを破棄して新snapshotを表示する。

```typescript
interface CandidateProjectContextAdapter {
  start(): Result<() => void, { readonly kind: "guard-registration-failed" }>;
  getCurrentProject(): Result<ProjectId, { readonly kind: "project-required" }>;
  refreshAfterProjectMutation(): Promise<
    Result<ProjectId | null, { readonly kind: "context-refresh-failed" }>
  >;
}
```

catalog置換やproject削除によるforced notificationではdirty draftを破棄せず、旧projectへ固定した回復待ち状態へ移す。新projectへdraftの`projectId`を書き換えず、利用者へ取消または明示的な再開始を案内する。guard評価と確認結果はcontext generationおよび要求IDに紐づけ、stale completionを適用しない。

project CRUDの永続mutation成功後だけ`ProjectContextCommandPort.refresh()`を一度呼ぶ。refresh成功後に一覧とcurrent selectionを確定する。mutation失敗時はrefreshせず既存表示と入力を保持する。mutation成功・refresh失敗は`context-refresh-failed`として区別し、mutationを再送せずrefreshだけを再試行できる状態にする。

候補一覧には、選択中プロジェクトへ新規候補を作成する導線と、各候補の編集を開始する導線をアクセシブルな名前付きで置く。編集導線は`getCandidateDraft`で保存済みdraftを取得してから編集画面を開く。テストはこれらのDOM操作を通して要件を検証し、`beginCreate()`／`beginEdit()`を直接呼んでUI導線を迂回しない。

## Data Models

- `CandidateDraft`: 必須の商品名、projectId、categoryと、欠損可能な共通項目・カテゴリ属性・`sourceInfo`・`sourceSnapshot`・確認値。`sourceInfo`は取得URL・取得日時、`sourceSnapshot`は元表記を表し、相互に代用しない。
- `UnresolvedCandidateDraft`: `CandidateDraft`からprojectIdだけを除いたcategory判別共用体。空名を含むpre-editの構造的整合を表し、保存可能性を意味しない。
- `CandidateEditorPrefill`: unresolved draftと任意のprojectId/categoryHintを持つactivation payload。永続entityではない。
- `CandidateSummary`: id、商品名、カテゴリ、価格、メーカー、型番、欠損状態。
- `ManagementError`: UIが次の行動を選べる判別共用体。
- 保存上の`Project`と`CandidatePart`はFoundation契約をそのまま利用し、重複モデルを作らない。

## Error Handling

検証エラーは項目単位に表示し、保存系エラーはドラフトと一覧を保持する。破損・非対応版は更新操作を無効化し、maintenance・revision競合は再読込可能な案内にする。容量警告は保存成功と併記、容量超過は失敗として表示する。ログへ商品値やURLを出さない。

`ManagementDisplayError`は`ManagementError["kind"]`と`snapshot-restore-failed`を保持し、表示層は少なくとも次を利用者が識別できる別文言へ写像する。

| code | 利用者が識別する状態 |
|---|---|
| `unsupported-data` | 保存データの破損または非対応schema版（更新操作を無効化） |
| `quota` | 保存容量不足 |
| `storage` | 保存領域を利用できない |
| `maintenance` | 保守操作中 |
| `conflict` | 他の変更と競合（再読込が必要） |
| `not-found` | 対象が見つからない |
| `validation` | 入力内容の問題（項目単位に表示） |
| `snapshot-restore-failed` | 直前の画面状態を現在projectと安全に復元できなかった |
| `project-required` | 現在projectの選択、作成または回復が必要 |
| `context-refresh-failed` | project変更は保存済みだが現在projectを再検証できない。変更を再送せずrefreshを再試行する |
| `project-changed-with-draft` | 強制切替後も旧draftを保持しており、継続方法の選択が必要 |

pre-editのpayload不正はshellの`invalid_activation`へ写像する。payload内project IDは保存先判断に使わない。contextが`empty`/`unavailable`であることはactivation失敗ではなく`project-required`状態であり、handoff失敗時のintent保持と再試行表示はproduct captureが所有する。

`ManagementError`の`validation`は`fields`にfield pathをキーとする理由を持つ。serviceは`validateCandidatePartContent`が返す`ValidationError.path`を`product.name`、`sourceInfo.pageUrl`、`sourceInfo.capturedAt`、`normalizedAttributes.<属性名>`のようなdraft相対キーへ正規化し、Viewは対応する入力欄へ`aria-invalid`と`aria-describedby`で結び付けたメッセージを表示する（Requirement 4.5）。項目エラー時も入力内容と既存一覧は保持する。

## Testing Strategy

- Service unit: 空名拒否、欠損許容、単一所属、カテゴリ変更の共通値保持、元表記分離、未分類除外を検証する。
- State unit: context ready/empty/unavailable追従、二重送信抑止、保存失敗時のドラフト・一覧保持、削除取消、dirty判定を検証する。
- React DOM integration: 共通selectorを重複表示しないこと、カテゴリ切替、project-required、欠損表示、編集、削除確認、切替確認、forced切替案内、項目エラー、unmount cleanupを架空データで検証する。
- Runtime integration: manifestとside panel起動、公開契約がFoundationDataPortを経由することを検証する。
- Contract integration: 候補削除・カテゴリ変更が単一mutationとなり、Foundationの参照修復後に一度だけcommitされることを、CurrentBuild参照を含むroot上でrevision増分とcommit回数まで検証する。
- Production E2E: 実artifactを読み込んだChromeで、候補管理navigationの表示、画面到達、プロジェクト作成、候補作成、既存候補編集、再読込後の復元、boot時のconsole/runtime error不在を検証する。空shellがstartedになるだけのsmokeをfeature完成の証拠にしない。
- Activation integration: 正常prefill、未知target、不正payload、payload project IDの非権威性、同一feature再activation、失敗時の入力元状態保持を検証する。
- Pre-edit contract: context readyへのbinding、empty/unavailableの`project-required`成功、project作成とrefresh後のdraft解決、作成/refresh失敗時保持、category不整合、空名の編集開始成功と保存失敗を検証する。
- Handoff/generation integration: 現行世代の`conclude`だけがintentを配送し、candidate-management受理成功で一過性面が終了することを検証する。stale世代とhandoff失敗intent保持は上流fixtureで検証し、候補管理へ世代stateを追加しない。
- Public consumer contract: `query`、`createCandidateEditorIntent`、`sources: { catalog, mutations }`が同じ`public.ts`から利用でき、`CaptureCandidatePort`、`openCandidateEditor`、内部validatorへのdeep importが存在しないことを型検査する。
- Project context integration: clean/dirty切替、確認取消/確定、stale確認、forced切替、CRUD mutation失敗時refreshなし、成功時refresh、refresh失敗後のrefresh-only回復を検証する。
- State snapshot integration: version 3/shapeを維持し、一致するcurrent projectでだけ編集状態と複製判断substateを復元する。不一致・不存在・empty/unavailable・不正snapshotがcontext、保存、候補一覧を変更しないことを検証する。

## Security & Performance

表示文字列は通常のJSX childとして扱い、`dangerouslySetInnerHTML`、`innerHTML`、inline handlerを使用しない。React componentはframework非依存のManagementStateとService portだけを受け、domain stateをhook固有形へ置き換えない。画面は選択プロジェクトの候補だけを描画し、保存操作中の重複更新を抑止する。10MB容量管理と信頼済みコンテキスト限定はFoundationへ委譲する。
