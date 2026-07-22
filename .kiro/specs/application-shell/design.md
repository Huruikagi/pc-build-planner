# 設計書

## 概要

application shellは、Chrome extensionのside panelをfeature-neutralなhostとして構成し、登録済みfeatureのナビゲーションとlifecycleを管理する。単一のcomposition rootがfoundationのmaintenance projectionとfeature registrationを合成し、共有runtime入口とroot公開APIの所有権を一元化する。

設計はRegistry + Composition Rootパターンを採用する。feature固有のview、状態、業務処理、永続化はshellへ持ち込まず、型付きportを介して参加させる。

### 目標
- featureが共有ファイルを変更せず独立して登録・検証できる。
- 利用可能性、失敗、maintenanceをside panel全体で一貫して表示する。
- maintenance通知の世代順序を守りmutation操作を共通抑止する。

### 非目標
- feature固有のview/state/業務規則の実装。
- Repository、write authority、maintenance lease、復元処理の実装。
- Chrome Web Store公開、他ブラウザ対応、旧major互換。

## 境界コミットメント

### このspecが所有するもの
- `ApplicationFeatureRegistration`とshell lifecycle契約。
- `ShellNavigator`、feature-neutralな`FeatureActivationIntent`、activation配送順序と失敗分離。
- side panel host、ナビゲーション、共通loading/error/maintenance React viewとroot adapter。
- `ApplicationCompositionRoot`とroot公開APIの合成。
- 世代付きmaintenance状態のread-only projectionとUI mutation gate。
- 共有runtime入口、HTML host、shell統合test kit。
- shell containerとfeature mount containerを分離するpresentation lifecycle契約。
- foundationと下流registrationを一度だけ合成するproduction application composition module。
- MV3 service worker contextでfoundation worker registrationとfeature catalogのworker contributionを一度だけ合成するproduction worker composition。

### 境界外
- feature固有のDOM、state、domain error、保存可否判断。
- maintenance leaseの取得・更新・owner fencing・commit直前検証。
- Storage API、Repository、復元、商品抽出、互換性判定。
- feature公開契約の内容そのもの。
- feature固有のactivation payload、targetの意味、payloadからfeature stateへの変換。
- Repository、Chrome Storage adapter、canonical maintenance sourceを生成するfoundation runtime factoryの実装。foundationは公開runtime contributionとして提供し、shellはそのhandleだけを利用する。

### 許可する依存
- local data foundationの公開型、canonical `Result<T, E>`、query契約、および完了済み`local-data-foundation` task 5.5が公開するread-only `MaintenanceSnapshotSource`。
- local data foundationが公開済みの`initializeProductionFoundationRuntimeContribution()`。このfactoryは`MaintenanceSnapshotSource`、foundation worker registration、disposeを一つのhandleとして返し、shellへRepositoryやStorage adapterを露出しない。
- 下流featureのregistration moduleと`public.ts`（composition rootからのみ参照）。
- Chrome 116以降のManifest V3 Side Panel API、React 19系、React DOM、CSS。
- dependency direction: `contracts → registry/state → host → React view/root adapter → composition → runtime/root entry`。逆向きimportは禁止する。
- `src/runtime/side-panel.ts`はapplication-shellのproduction composition factoryだけをimportし、foundation factory、具体feature registration、worker registrationを直接importしない。
- `src/runtime/service-worker.ts`はproduction worker compositionとChrome message target adapterだけを所有し、Storage、Repository、foundation内部、DOM、Reactをimportしない。
- production composition modulesだけがfoundationの公開factoryと下流featureの`public.ts`またはregistration公開入口を具体依存として知る。下流feature内部へのdeep importは禁止する。

### 再検証トリガー
- registration、mount context、availability、activation、public API registryの型変更。
- foundationのmaintenance世代・購読契約の変更。
- root entry、side panel起動順序、`sidePanel.open()` gesture入口の変更。
- shellとfeature間のファイル所有権または依存方向の変更。
- foundationの`MaintenanceSnapshot`または`MaintenanceSnapshotSource`公開契約、`local-data-foundation` task 5.5の完了状態が変更された場合。
- shell presentation handle、feature slot生成時点、navigation command、production contribution一覧の変更。

## アーキテクチャ

### 既存アーキテクチャ分析

- `src/domain/`と`src/persistence/`にはstrict TypeScriptのlocal data foundation、canonical `Result<T, E>`、永続maintenance state、query/mutation portが実装済みである。
- `manifest.json`、esbuildによるChrome 116 target、Node test、Playwright、artifact/boundary検査は既存基盤として維持する。
- application shell task 3.4までにcontracts、registry、maintenance projection、mutation gate、ShellView、ReactShellRoot、SidePanelHost、composition root、runtime bootstrapと対応testが実装済みである。
- `src/runtime/side-panel.ts`はproduction side panel compositionとbootstrapへ接続済みであり、仮maintenance sourceやnoop observerを持たない。残るproduction gapはfoundation worker registrationのservice worker接続である。
- 現行composition rootとSidePanelHostは一つのcontainerをfeature mountへ渡す。shell React rootも同じcontainerを所有するため、task 4.1ではshell専用rootとfeature専用outletを分離する必要がある。
- foundationは`src/persistence/public.ts`から引数なしproduction factoryを公開済みであり、検証済みread-only `MaintenanceSnapshotSource`、単数の`DataWorkerRegistration`、冪等`dispose`を返す。application-shellはStorage実装へdeep importせず、各MV3 contextからこの公開factoryを利用する。

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    Gesture[User gesture entry] --> Runtime[Side panel runtime]
    Runtime --> Root[Application composition root]
    Root --> Registry[Feature registry]
    Root --> Maintenance[Maintenance projection]
    Root --> Presentation[Shell presentation]
    Presentation --> FeatureSlot[Feature mount slot]
    Root --> Host[Side panel host]
    Navigator[Shell navigator] --> Host
    Host --> FeatureSlot
    Registry --> Host
    Maintenance --> Host
    Foundation[Local data foundation] --> Maintenance
    Foundation --> WorkerRuntime[Service worker composition]
    Features --> WorkerRuntime
    Features[Feature registrations] --> Registry
    FeatureSlot --> FeatureViews[Feature views]
    PublicContracts[Feature public contracts] --> RootApi[Root public API]
    Root --> RootApi
```

- **選択パターン**: Registry + Composition Root。登録・状態・表示を分離し、compositionだけが具体featureを知る。
- **境界**: shellはfeatureの契約を呼ぶが業務データを解釈しない。foundation状態を表示へ写像するがleaseを操作しない。
- **新規component**: Registry、MaintenanceProjection、Host、CompositionRoot、PublicApiRegistryはそれぞれ一つの共有責務を持つ。

### Technology Stack

| Layer | 選択 / Version | 役割 | 注記 |
|---|---|---|---|
| 言語 | TypeScript 7.0.2 | 型付き契約とruntime実装 | 既存固定version、`any`禁止、strict mode |
| UI | React 19系 / React DOM / CSS | side panel host、共通表示、feature viewの宣言的描画 | production bundleへ同梱、JSXを使用 |
| Runtime | Chrome 116+ Manifest V3 | Side Panel APIとgesture entry | 実行コードを同梱 |
| Build/Test | esbuild 0.28.1、Node 26.5.0 test、Playwright 1.61.1 | bundle、unit/integration、MV3 E2E | DOM test環境はReact導入時に互換性確認して固定 |

## ファイル構造計画

```text
side-panel.html                         # shellが所有するside panel document
src/
├── application-shell/
│   ├── contracts.ts                   # registration、mount、availability、maintenance型
│   ├── feature-registry.ts            # 登録検証、一意性、snapshotと購読
│   ├── maintenance-projection.ts      # 世代付き状態の単調projection
│   ├── mutation-gate.ts               # UI操作種別とmaintenance抑止判定
│   ├── activation-router.ts            # feature-neutral intentの対象解決と一回配送
│   ├── side-panel-host.ts             # navigationとfeature lifecycle調停
│   ├── worker-composition.ts          # feature提供worker registrationの一回限り合成
│   ├── shell-view.tsx                  # loading/error/maintenance/navigationのReact表示
│   ├── react-shell-root.tsx            # shell用React rootとcleanup adapter
│   ├── error-boundary.tsx              # component描画失敗のfeature単位隔離
│   ├── composition-root.ts            # foundation、feature、hostの一回限り合成
│   ├── shell-presentation.tsx          # shell root、navigation command、feature専用slotの接続
│   ├── application-composition.ts      # canonical foundationと公開registrationのproduction合成
│   ├── production-worker-composition.ts # foundation message registrationとcatalog workerのcontext別合成
│   ├── feature-contribution-catalog.ts # contribution契約とworker安全なcatalog（DOM/React非依存）
│   ├── side-panel-contributions.ts     # side panel専用contribution factoryの唯一の集約点
│   └── public-api-registry.ts          # feature public contractの型付き合成
├── runtime/
│   ├── side-panel.ts                  # side panel bootstrap入口
│   ├── service-worker.ts              # Chrome message targetとproduction worker bootstrap入口
│   └── open-side-panel.ts             # user gesture内のSide Panel API adapter
└── index.ts                           # root公開APIの唯一のbarrel
tests/
├── application-shell/                 # component unit tests
├── contracts/                         # downstream registration contract test kit
└── integration/application-shell.test.ts # bootstrap、遷移、障害、maintenance統合
```

既存の`react-shell-root.tsx`、`shell-view.tsx`、`composition-root.ts`、`runtime/side-panel.ts`、`runtime/service-worker.ts`はproduction接続のため変更し、`shell-presentation.tsx`、`application-composition.ts`、`feature-contribution-catalog.ts`、`side-panel-contributions.ts`を追加する。`src/domain/`と`src/persistence/`の実装は変更対象外であり、完了済み`local-data-foundation` task 5.5の公開portと task 6.11の絞り込みdata portを利用する。各下流featureの登録ファイルと`public.ts`は各feature specが所有し、このspecは変更しない。仮のmaintenance sourceへのfallbackは許可しない。

#### Feature contribution composition

下流feature未実装時の空catalogはfeature実装前の暫定production状態であり、実装済みfeatureが存在する時点でproduction compositionへ接続されていなければならない。空catalogのままstartedになるだけのshellはfeature完成の証拠として扱わない。

feature contributionは値ではなくfactoryとして登録し、production compositionが解決した合成contextを受け取る。

```typescript
interface FeatureCompositionContext {
  readonly data: FoundationScopedDataPort;   // local-data-foundation所有
  readonly navigator: ShellNavigator;        // application-shell所有（遅延bind）
}

type FeatureContributionFactory<TKey extends string, TPublic extends object> =
  (context: FeatureCompositionContext) => FeatureContribution<TKey, TPublic>;
```

- `feature-contribution-catalog.ts`はcontribution型、決定順序helper、およびworker contributionだけを持つworker安全なcatalogを所有する。この moduleはDOM、React、feature UI moduleへ到達してはならない。`src/runtime/service-worker.ts`はこのcatalogだけを参照する。
- `side-panel-contributions.ts`はside panel専用のcontribution factory列を所有する唯一のfileであり、featureの`feature-contribution.ts`公開入口だけをimportする。React依存はこのmodule graphへ閉じ込め、worker bundleへ混入させない。
- `navigator`はcomposition rootのactivate経路へ遅延委譲するobjectとして構築し、feature公開APIとcomposition rootの循環依存を作らない。
- `src/index.ts`はcatalogから導出した`ApplicationApi`型と、合成contextを受け取る`composeApplicationApi(context)`を公開する。data portなしに実featureを実体化できないため、root barrelは即時値を公開しない。
- feature側CSSは、side panel entryのmodule graphからimportして`dist/side-panel.css`へbundleし、shellが所有する`side-panel.html`から参照する。どのentryからも到達しないCSSはproduction artifactに含まれないため、設計上の記載と実体を一致させる。

## システムフロー

```mermaid
sequenceDiagram
    participant F as Foundation
    participant R as CompositionRoot
    participant G as FeatureRegistry
    participant P as ShellPresentation
    participant H as SidePanelHost
    participant V as FeatureView
    F->>R: maintenance subscription
    R->>G: register features
    R->>P: mount shell and obtain feature slot
    R->>H: start with feature slot
    H->>V: mount selected feature
    F-->>R: generation state
    R-->>H: maintenance projection
    H-->>P: state and navigation update
    H-->>V: mutation availability update
```

起動は冪等であり、二回目の`start`は既存instanceを返すか明示的な`already_started`結果を返す。feature切替では前viewのunmount完了後に次viewをmountする。mount失敗はhost全体を停止させない。

## 要件トレーサビリティ

| 要件 | 概要 | Components | Interfaces / Flows |
|---|---|---|---|
| 1.1, 1.2, 1.3, 1.4, 1.5 | hostとnavigation | SidePanelHost, ShellView, ReactShellRoot | RegistrySnapshot, FeatureMount |
| 2.1, 2.2, 2.3, 2.4, 2.5 | feature登録 | FeatureRegistry | ApplicationFeatureRegistration |
| 3.1, 3.2, 3.3, 3.4 | compositionと公開API | CompositionRoot, PublicApiRegistry | start, composePublicApi |
| 4.1, 4.2, 4.3, 4.4 | 共通状態と障害分離 | ShellView, ReactShellRoot, ShellErrorBoundary, SidePanelHost | ShellViewState |
| 5.1, 5.2, 5.3, 5.4, 5.5, 5.6 | maintenance抑止 | MaintenanceProjection, MutationGate | MaintenanceSnapshotSource |
| 6.1, 6.2, 6.3, 6.4 | runtimeと検証 | RuntimeAdapters, ContractTestKit | Chrome adapter, integration flow |
| 7.1, 7.2, 7.3, 7.4, 7.5 | feature間activation | ActivationRouter, SidePanelHost | FeatureActivationIntent, ShellNavigator, FeatureActivationAdapter |

## Components and Interfaces

| Component | Layer | Intent | 要件 | 主な依存 | 契約 |
|---|---|---|---|---|---|
| FeatureRegistry | Core | 登録の検証・一意性・変更通知 | 2.1–2.5 | contracts P0 | Service, State |
| MaintenanceProjection | Core | 世代付き状態を単調に投影 | 5.1, 5.4–5.6 | foundation P0 | Service, State |
| MutationGate | Core | 操作分類から可否を判定 | 5.2–5.3 | projection P0 | Service |
| SidePanelHost | UI orchestration | navigationとmount lifecycle | 1.1–1.5, 2.4, 4.2–4.3 | registry P0, ReactShellRoot P0 | Service, State |
| WorkerComposition | Runtime composition | feature worker registrationを共有service workerへ合成 | 3.1, 3.3, 3.4, 6.1–6.4 | worker registrations P0 | Service |
| ShellView | UI | 共通状態をReactで安全に描画 | 4.1–4.4, 5.1–5.3 | React P0 | State |
| ReactShellRoot | UI adapter | shell stateをReact rootへ接続しcleanupする | 1.1–1.5, 4.1–4.4 | React DOM P0, Host P0 | Service |
| ShellErrorBoundary | UI | component描画失敗をfeature単位で隔離する | 4.2–4.4 | React P0 | State |
| CompositionRoot | Composition | 一度だけ全依存を合成 | 3.1, 3.3–3.4 | 全component P0 | Service |
| PublicApiRegistry | Composition | feature公開契約をrootへ合成 | 3.2, 3.4 | feature public P0 | Service |
| RuntimeAdapters | Runtime | bootstrapとgesture APIを分離 | 6.1–6.3 | Chrome P0 | Service |
| ShellPresentation | UI adapter | shell stateとnavigationを描画しfeature専用slotを公開 | 1.1–1.5, 4.1–4.4, 5.1 | ReactShellRoot P0 | Service, State |
| ApplicationComposition | Composition | canonical foundationと公開registrationをproduction runtimeへ一度だけ接続 | 2.1, 3.1–3.4, 5.6, 6.1 | Foundation/feature public P0 | Service |
| ProductionWorkerComposition | Runtime composition | worker contextでfoundation command handlerとcatalog worker contributionを一度だけ接続 | 3.1, 3.3, 3.4, 6.1–6.4 | Foundation public P0, catalog P0, Chrome message target P0 | Service |
| ActivationRouter | UI orchestration | feature-neutral intentを対象registrationへ検証付きで一度配送 | 7.1–7.5 | FeatureRegistry P0, SidePanelHost P0 | Service |

### Core contracts

```typescript
type FeatureId = string & { readonly __brand: "FeatureId" };
type OperationKind = "read" | "mutation";
type Availability =
  | { readonly status: "available" }
  | { readonly status: "unavailable"; readonly reason: string };

interface FeatureMountContext {
  readonly container: HTMLElement;
  readonly operationPolicy: { isAllowed(kind: OperationKind): boolean };
  readonly reportError: (message: string) => void;
}

interface FeatureActivationIntent {
  readonly featureId: FeatureId;
  readonly target: string;
  readonly payload: unknown;
}

type FeatureActivationError =
  | { readonly kind: "feature_not_found"; readonly featureId: FeatureId }
  | { readonly kind: "feature_unavailable"; readonly featureId: FeatureId }
  | { readonly kind: "invalid_activation"; readonly detail: string }
  | { readonly kind: "mount_failed"; readonly featureId: FeatureId }
  | { readonly kind: "activation_failed"; readonly detail: string };

interface FeatureActivationAdapter<TActivation> {
  validate(intent: FeatureActivationIntent): Result<TActivation, FeatureActivationError>;
  activate(input: TActivation): Promise<Result<void, FeatureActivationError>>;
}

interface ShellNavigator {
  activate(intent: FeatureActivationIntent): Promise<Result<void, FeatureActivationError>>;
}

interface ApplicationFeatureRegistration<
  TPublic extends object = object,
  TActivation = never,
> {
  readonly id: FeatureId;
  readonly navigation: { readonly label: string; readonly order: number };
  readonly publicApi: TPublic;
  getAvailability(): Availability;
  subscribeAvailability(listener: (value: Availability) => void): () => void;
  mount(context: FeatureMountContext): Promise<{ unmount(): Promise<void> }>;
  readonly activation?: FeatureActivationAdapter<TActivation>;
}

interface ApplicationWorkerRegistration {
  readonly id: FeatureId;
  register(context: WorkerRegistrationContext): Result<() => void, RegistrationError>;
}

interface WorkerRegistrationContext {
  readonly addActionHandler: (id: FeatureId, handler: () => Promise<void>) => () => void;
  readonly reportError: (message: string) => void;
}

type RegistrationError =
  | { readonly kind: "invalid_registration"; readonly detail: string }
  | { readonly kind: "duplicate_feature_id"; readonly id: FeatureId };

interface FeatureRegistry {
  register<TPublic extends object>(feature: ApplicationFeatureRegistration<TPublic>): Result<void, RegistrationError>;
  snapshot(): readonly ApplicationFeatureRegistration[];
  subscribe(listener: () => void): () => void;
}
```

`Result<T, E>`はlocal data foundationが所有するcanonical型を利用し、shell内で再定義しない。登録順序は`navigation.order`、同値時は`id`で決定的に並べる。listener解除とview unmountは複数回呼んでも安全である。

worker registrationは同じfeature idで一意にし、共有`src/runtime/service-worker.ts`をfeatureから編集させずcomposition rootだけが登録する。登録解除は冪等で、途中失敗時は登録済みhandlerを逆順に解除する。

`FeatureActivationIntent.payload`はshell境界では常に`unknown`である。対象registrationのadapterだけがtargetとpayloadを検証し、検証済みfeature固有型へ変換する。feature固有の型安全なintent builderは各featureの`public.ts`が所有する。

別featureへのactivationでは、shellは入力元のmounted handleからopaqueなstate snapshotを取得してからunmountする。snapshotを提供できない、または取得に失敗した入力元からのactivationは表示変更前に拒否する。targetのmountまたはactivation失敗時はtargetを完全にunmountしてから、snapshotを入力元へ渡して再mountする。shellはsnapshotの形状を解釈しない。target cleanupが失敗した場合はtarget handleの所有権を保持し、入力元を再mountせずcleanup failureを返す。mount待機中はlifecycle epoch、stopped状態、availabilityを再検証し、stale handleをcleanupしてからrollbackする。同一featureへのactivationはsnapshot・unmountを行わず一回だけ配送する。

### MaintenanceProjection and MutationGate

```typescript
import type {
  MaintenanceSnapshot as FoundationMaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../persistence/public.js";

type MaintenanceCursor = {
  readonly generation: number;
  readonly revision: number;
};
type ShellMaintenanceState =
  | { readonly status: "inactive"; readonly cursor: MaintenanceCursor }
  | { readonly status: "active"; readonly cursor: MaintenanceCursor; readonly message: string };

interface MaintenancePresentationPort {
  getSnapshot(): ShellMaintenanceState;
  subscribe(listener: (state: ShellMaintenanceState) => void): () => void;
}

interface MaintenanceProjection {
  accept(next: FoundationMaintenanceSnapshot): "applied" | "stale_ignored";
  getSnapshot(): ShellMaintenanceState;
  subscribe(listener: (state: ShellMaintenanceState) => void): () => void;
}

interface MutationGate {
  isAllowed(kind: OperationKind): boolean;
}
```

- `(generation, revision)`を辞書順の単調cursorとして比較し、現在cursor以下の通知を無視する。foundationはmaintenance開始・更新・終了ごとにrevisionを増加させるため、同一generationの正当な終了と遅延した開始通知を決定的に区別できる。generationまたはrevisionが負、あるいは有限整数でない通知は契約違反として拒否する。
- gateは`read`を常に許可し、`mutation`をactive中だけ拒否する。shellはdomain側の最終的なwrite拒否を代替しない。
- `FoundationMaintenanceSnapshot`はfoundationのcanonical `MaintenanceSnapshot`をalias importした型であり、`MaintenanceSnapshotSource`とともにshell内で再定義しない。sourceは`generation`、root `revision`、`active`だけを通知する。
- shellはsourceの初期snapshot取得失敗をstartup failureへ変換し、成功snapshotを単調projectionへ渡す。active表示文言はshell所有の固定安全文字列から生成し、foundationへmessage責務を追加しない。

### SidePanelHost and Presentation

```typescript
type ShellViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly selected: FeatureId | null }
  | { readonly kind: "maintenance"; readonly selected: FeatureId | null; readonly message: string }
  | { readonly kind: "error"; readonly message: string; readonly recoverable: boolean };

interface SidePanelHost {
  start(): Promise<Result<void, { readonly kind: "startup_failed"; readonly message: string }>>;
  select(id: FeatureId): Promise<Result<void, { readonly kind: "unavailable" | "mount_failed"; readonly message: string }>>;
  activate(intent: FeatureActivationIntent): Promise<Result<void, FeatureActivationError>>;
  stop(): Promise<void>;
}
```

ShellViewと各feature viewは外部由来文字列を通常のJSX childとして描画し、`dangerouslySetInnerHTML`、`innerHTML`、inline event handlerを使用しない。ReactShellRootはside panel host containerへ`createRoot`し、停止時に`root.unmount()`を一度だけ呼ぶ。`FeatureMountContext`と`ApplicationFeatureRegistration.mount/unmount`の公開契約は変更せず、各feature registrationのUI adapterが受け取ったcontainerへReact rootを作成・破棄する。選択中featureが不可になった場合はunmountし、次の利用可能featureを決定順で選ぶ。該当がなければ理由付きempty stateを表示する。

### CompositionRoot and PublicApiRegistry

```typescript
interface ApplicationCompositionRoot<TRootApi extends object> {
  start(): Promise<Result<{ readonly api: TRootApi }, { readonly kind: "missing_dependency" | "startup_failed"; readonly message: string }>>;
}

interface PublicApiRegistry<TEntries extends Record<string, object>> {
  compose(entries: TEntries): Readonly<TEntries>;
}
```

CompositionRootだけが具体的なfoundation adapterとfeature registrationをimportする。起動途中に失敗した場合、購読解除とmount済みviewのunmountを逆順に行う。root `src/index.ts`は合成済み型付き契約だけをexportする。

### ShellPresentation and production runtime composition

```typescript
interface ShellPresentationHandle {
  readonly featureContainer: HTMLElement;
  publish(state: ShellViewState, navigation: readonly ShellNavigationItem[]): void;
  stop(): void;
}

interface ShellPresentationAdapter {
  mount(input: {
    readonly shellContainer: HTMLElement;
    readonly onNavigate: (id: FeatureId) => void;
    readonly onRetry: () => void;
  }): Result<ShellPresentationHandle, { readonly kind: "presentation_failed" }>;
}

interface ApplicationRuntimeContributions<
  TFeatures extends readonly CompositionFeature[],
> {
  readonly features: TFeatures;
  readonly workerRegistrations: readonly ApplicationWorkerRegistration[];
}

interface ProductionApplicationCompositionOptions<
  TFeatures extends readonly CompositionFeature[],
> {
  readonly shellContainer: HTMLElement;
  readonly initializeFoundation: () => Promise<Result<FoundationCompositionHandle, FoundationStartupError>>;
  readonly contributions: ApplicationRuntimeContributions<TFeatures>;
  readonly presentation: ShellPresentationAdapter;
}

interface FoundationRuntimeContribution {
  readonly maintenanceSource: MaintenanceSnapshotSource;
  readonly workerRegistration: DataWorkerRegistration;
  dispose(): void | Promise<void>;
}

interface FoundationWorkerMessageTarget {
  addHandler(handler: FoundationWorkerMessageHandler): () => void;
}

interface DataWorkerRegistration {
  register(target: FoundationWorkerMessageTarget): Promise<
    Result<() => void, FoundationWorkerRegistrationError>
  >;
}

function initializeProductionFoundationRuntimeContribution(): Promise<
  Result<FoundationRuntimeContribution, FoundationStartupError>
>;

interface ChromeFoundationMessageTargetAdapter {
  readonly target: FoundationWorkerMessageTarget;
}

interface ProductionWorkerComposition {
  start(): Promise<Result<void, ProductionWorkerStartupError>>;
  stop(): Promise<void>;
}
```

`DataWorkerRegistration`はfoundation command用の非同期契約であり、feature catalogの同期`ApplicationWorkerRegistration`とは別々に合成する。`ChromeFoundationMessageTargetAdapter` は`chrome.runtime.onMessage`のlistenerを追加し、`query-root`、`mutate-root`、`assess-replacement`、`replace-root`、`run-maintenance`の既知foundation command kindだけをroutingする。対象messageはmessageと分類済みcallerをfoundation handlerへ渡し、handlerのPromise完了Resultを`sendResponse`へ一度だけ渡してlistenerから`true`を返す。非foundation messageはhandlerも`sendResponse`も呼ばず`undefined`を返し、catalog action listenerへ委ねる。handler rejectionは未信頼値を露出しない安定したfailure responseへ正規化し、disposerは対応listenerだけを一度解除する。

- `ShellPresentationAdapter.mount`はshell React rootを先にmountし、そのrootが所有する専用slotだけを`featureContainer`として返す。`featureContainer !== shellContainer`を起動時に検証する。
- `SidePanelHost`へ渡すcontainerは常に`featureContainer`であり、feature registrationはshell navigationやstatus DOMを変更しない。公開`FeatureMountContext`は変更しない。
- navigation commandはpresentationからcomposition/integrationの`select`へ型付きで渡す。stateとregistry snapshotは逆方向に`publish`され、React componentがhost serviceを直接importしない。
- production composition modulesだけがfoundationの公開factoryと、存在する下流featureの公開registration・worker registrationを合成する。`src/runtime/side-panel.ts`はDOM hostを解決してproduction factoryとbootstrapを開始するだけであり、仮maintenance sourceや下流feature deep importを持たない。
- MV3のside panelとservice workerはobject lifecycleを共有できないため、各contextがfoundationのno-arg production factoryから独立handleを初期化する。side panel compositionはmaintenance sourceとdisposeを所有し、production worker compositionはfoundation worker registration、catalog worker contribution、disposeを所有する。
- `feature-contribution-catalog.ts`はside panel registration、worker registration、public API keyをreadonly tupleとして公開する唯一のcatalogである。catalogは下流feature実装前には空でよく、登録済みfeatureだけを決定的に合成する。side panel compositionはUI/public API項目だけを、service worker compositionはworker項目だけを選択し、worker側へHTMLElementまたはReact依存を持ち込まない。
- 空catalogでの起動は成功し、navigationを表示せず安全なempty stateを提示する。後続feature specは自身の公開registrationをcatalogへ追加する統合だけを要求され、application-shellのhost、runtime entry、root公開機構を変更しない。
- 起動順序はfoundation初期化、registry登録、shell presentation mount、feature host start、worker registrationの順とする。停止とrollbackはworker解除、feature unmount、maintenance購読解除、shell presentation stop、foundation disposeの逆依存順で全件best-effortに実行する。
- worker contextの起動順はfoundation初期化、非同期foundation message registration、同期catalog registrationsとし、それぞれのtyped failureを`ProductionWorkerStartupError`へ正規化する。失敗時と停止はcatalog解除、foundation handler解除、foundation disposeの逆順・全件best-effort・冪等とする。start中のstopはepochを無効化し、遅延したfoundation registrationの完了後にcatalog登録せず即座cleanupする。concurrent startは単一Promiseを共有する。
- Chrome message senderのclassificationはservice worker runtime adapterが所有する。`sender.id === chrome.runtime.id`、`sender.tab` なし、`sender.url`が`chrome.runtime.getURL("")`以下の場合だけ`trusted-extension`、同一extensionでtabありは`content-script`、それ以外は`web-page`とし、分類済みcallerをfoundation handlerへ渡す。runtime API欠落、URL欠落・getter例外・parse失敗は`trusted-extension`にせず、adapter初期化失敗または`web-page`へfail closedに分類する。
- canonical `MaintenanceSnapshotSource`は`initializeFoundation`の成功handleからだけ取得する。shellはinactive stubへのfallbackやStorage API直接購読を行わず、取得不能時はfeatureをmountせず共通startup errorを表示する。
- `initializeProductionFoundationRuntimeContribution()`の実装と公開はlocal-data-foundation所有であり、task 5.8・6.8で公開・統合検証済みである。application-shellは公開consumer型だけを利用し、persistence内部へdeep importして回避しない。

## エラー処理

- 不正・重複登録: 該当featureを隔離し型付きdiagnosticを返す。
- 必須foundation初期化失敗: hostをerror stateにしてfeatureをmountしない。
- feature mount/unmount失敗: 安全なテキストmessageを表示し、他featureのnavigationを維持する。
- stale maintenance通知: stateを変更せず診断hookへ記録する。
- runtime終了: unsubscribe/unmountをbest-effortで全件実行し、複数失敗を一つの失敗で隠さない。

## テスト戦略

### Unit Tests
- FeatureRegistryの不正値、重複、決定的順序、購読解除（2.1–2.4）。
- MaintenanceProjectionの世代前進・stale拒否・終了反映（5.1, 5.4–5.5）。
- MutationGateのread維持とmutation抑止（5.2–5.3）。
- ShellViewが外部文字列を通常のJSX textとして描画し、危険なHTML APIを使用しないこと（4.4）。
- ReactShellRootとfeature adapterが再mount、切替、停止時にReact rootと購読を確実にcleanupすること（1.2–1.5, 6.4）。

### Integration Tests
- compositionが一回だけ実行され、root APIがfeature単位で合成される（3.1–3.4）。
- feature切替でunmount→mount順序となり同時表示が発生しない（1.2–1.5）。
- mount失敗後も別featureへ遷移できる（4.2–4.3）。
- maintenance通知が全navigationへ反映され、readは維持されmutationが無効になる（5.1–5.5）。
- foundation通知portの初期snapshot、順序逆転、購読解除を模擬し、shellがStorage APIを直接参照しないことをcontract/boundary testで確認する（5.1, 5.4, 5.5, 5.6）。
- production-shaped fixtureでshell React rootとfeature outletが別DOM要素であること、2つの模擬featureが独立rootを切替時にunmountすること、navigation clickがhost selectionへ届くことを確認する（1.1–1.5, 3.1, 6.1, 6.4）。
- side panelとservice workerが同じcontribution catalogを利用しつつ、worker bundleへDOM/React依存を含めないことを確認する（2.1, 3.1, 3.4, 6.3）。
- 実service worker入口がno-arg foundation factoryをworker contextで初期化し、foundation command handlerとcatalog workerを順序どおり登録すること、sender classification、途中rollback、停止の逆順cleanupをproduction-shaped testで確認する（3.1, 3.3, 3.4, 6.1, 6.3, 6.4）。

### E2E / Runtime
- Chrome 116+相当のMV3 fixtureでside panel bootstrapとnavigationを検証する（6.1）。
- user gesture handler内でSide Panel APIが同期呼出しされることをadapter spyで検証する（6.2）。
- package outputにremote script、inline script、dynamic evaluationがないことを検査する（6.3）。
- production bundleへReact/React DOMが同梱され、MV3の`script-src 'self'`でside panelが起動することを検査する（6.1, 6.3）。
- contract test kitで模擬featureの登録、availability変更、失敗、cleanupを決定的に観測する（6.4）。
- artifact/boundary検査でdummy inactive maintenance source、noop shell state observer、下流featureから共有runtime/root entryへのimportを拒否する。空production catalogは許可し、empty stateと型付き空root APIが成立することを検証する（1.1, 3.1, 3.2, 3.4, 5.6, 6.3）。

## セキュリティ考慮事項

- shellはStorage APIやページDOMを直接読まない。
- 表示文字列は通常のJSX childとして扱い、`dangerouslySetInnerHTML`、`innerHTML`、inline handlerを使用しない。
- React、React DOMと全UI codeはproduction bundleへ同梱し、CDN、remote module、runtime JSX変換、動的評価を使用しない。
- feature registrationは信頼済み同梱moduleのみからcomposition rootが受け付け、runtime messageから任意登録しない。
