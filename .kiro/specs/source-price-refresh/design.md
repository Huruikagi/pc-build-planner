# 設計文書

## 概要

本機能は、保存済み販売ページのコンテキストメニューから一回の操作で価格を再取得し、正規化URLで一意に特定した `CandidateSource` の `price` と `capturedAt` だけを更新する。一過性面は進行・成功・失敗を表示し、権限付与gestureと実行を分離しない。

URL同一性と原子的価格更新は公開use caseとしてまとめ、context menu経路と `duplicate-product-merge` の同一URL再取り込み経路から共用する。抽出規則、ソースaggregate、一過性起動storeはそれぞれの上流ownerが提供する狭いportへ委譲する。

### 目標

- context menu clickから現行の固定tab・起動世代だけを自動更新する。
- 保守的なURL正規化で一意の販売sourceを特定し、曖昧さをfail closedにする。
- 商品取り込みと同じ価格抽出・正規化・provenanceを再利用する。
- source価格と取得日時を一回の候補aggregate mutationで更新する。
- primary projection、旧価格保全、権限・fixture・worker境界を自動検証する。

### 非目標

- 定期巡回、価格履歴、在庫監視、通貨換算。
- source追加・削除・primary決定、同一商品検知、merge UX。
- 抽出priority・price parser、一過性store/schedulerの再定義。
- manufacturer sourceやURL不一致ページからの価格更新。

## 境界コミットメント

### 本specが所有するもの

- `source-price-refresh` featureの一過性登録、状態、表示、公開API。
- context menu項目のID、表示範囲、click sourceとproduction登録。
- URL正規化、catalog/candidate scopeでの一意照合、ambiguity規則。
- price observationを既存sourceへ適用するuse caseとtyped error mapping。
- `contextMenus` permissionの限定追加とartifact permission gate更新。
- feature固有のunit、integration、runtime、DOM、E2E検証。

### 境界外

- `CandidateSource`、`CandidateSourceId`、`primarySourceId`、priceの形状と保存invariantは `candidate-source-bookmarks` が所有する。
- price抽出、rank、normalization、pageUrl provenanceは `product-page-capture` が所有する。
- gesture sequence、activation store、side panel open、tab失効、戻り先は `transient-feature-surface` が所有する。
- same-product判定とmerge提示は `duplicate-product-merge` が所有する。
- context menu以外の新しい起動gesture、履歴・通知・定期処理は所有しない。

### 許可する依存

- `application-shell/public.ts` 公開の `ActivationId`、`TargetTabId`、`parseTargetTabId`、`TransientSurfaceLifecyclePort`、`TransientGestureRegistrationPort`。
- `candidate-management/public.ts` 公開の source facet `sources.catalog: CandidateSourceCatalogPort` と `sources.mutations: CandidateSourceMutationPort`。
- `candidate-management/public.ts` 公開の `query: CandidateQuery` のうち `getCandidateDraft(id)`。保持すべきsource全フィールドの読み出しに限って利用する。
- `product-capture/public.ts` 公開の `ProductCapturePublicApi.pagePriceExtraction: PagePriceExtractionPort`。
- canonical `Result<T, E>`、`CandidatePartId`、`CandidateSourceId`、`SourcedValue<MoneyValue>`、`UtcTimestamp`。
- Chrome 116 MV3の `chrome.contextMenus`、既存 `activeTab` / `scripting` / `sidePanel`、標準 `URL`。
- React 19、TypeScript 7 strict、既存message catalog、Node test runner、Playwright。

### 確定済み上流契約

下流consumer向けの3つのseamは各producer specで定義・承認済みであり、いずれのspecも `ready_for_implementation: true` である。本specはこれらを解決済み依存として扱う。純粋なURL照合・use case・stateは確定済み契約のtest doubleで着手でき、production統合だけをproducer側実装タスクの完了後に行う。

1. `candidate-source-bookmarks`: `CandidateSourceCatalogPort.listSourceReferences({ candidateId? })` と `getSourceReference({ candidateId, sourceId })` が `CandidateSourceReference` を返す。candidate-management公開APIの `sources.catalog` から取得し、writeは同じsource facetの `sources.mutations: CandidateSourceMutationPort` を利用する。
2. `transient-feature-surface`: `TransientGestureRegistrationPort.register(source)` と `TransientGestureSource.start(emit)` は同期 `Result<() => void, TransientGestureRegistrationError>` 契約であり、`parseTargetTabId` で検証した固定tabだけをemitする。store writer、sequence割当、panel openerは非公開である。
3. `product-page-capture`: `ProductCapturePublicApi.pagePriceExtraction` が `PagePriceExtractionPort.extractPrice(TargetTabId)` を公開し、page-derived URL、canonical取得時点、任意のprice provenanceを `PagePriceObservation` として返す。既存extractor/ranker/normalizerはproducer内部に留まる。

foundation root read、shell store、product-capture内部moduleへの迂回依存は禁止する。契約実装の受け取り順はtasksの明示的なcross-spec依存に従う。

### 再検証トリガー

- 確定済み3portのshape、error union、ownerまたは公開入口が変わる場合。
- `CandidateSource` のURL、kind、price、capturedAt、ID、primary導出が変わる場合。
- URL identityのtracking key集合、query保持、scopeまたはambiguity規則が変わる場合。
- transient gestureの同期性、`activeTab` 付与、activation payload、tab失効規則が変わる場合。
- manifest permission allowlist、Chrome contextMenus permission要件、worker composition ownerが変わる場合。
- `side-panel-contributions.ts` のUI contribution factory境界、または `feature-contribution-catalog.ts` のworker-safe制約が変わる場合。

### 依存方向

```text
canonical domain + upstream public contracts
    ↓
URL identity + source locator
    ↓
price refresh service + public API
    ↓
transient state + view + side panel registration

worker-safe menu adapter + worker composition
    ↓
transient gesture port
```

featureは `candidate-management/public.ts`、`product-capture/public.ts`、`application-shell/public.ts` だけをimportする。UI contributionはapplication shell所有の `side-panel-contributions.ts` からfeatureの `feature-contribution.ts` を参照して登録する。context menu adapterはsource-price-refresh内に留まり、worker-safeなcatalog / production worker compositionから上流schedulerへgesture eventを渡すだけとする。`feature-contribution-catalog.ts` からUI、DOM、React moduleへ到達してはならない。

## アーキテクチャ

### 既存アーキテクチャ分析

- product-captureの注入adapterは固定tabとpage-derived URLを照合し、extractor、normalizer、rankerを分離済みである。
- candidate-managementはsource aggregateを単一write authorityへ渡し、public mutation portがrevision contextをconsumerから隠す。
- transient surfaceはfeature registrationとactivation世代をapplication shellへ統合し、別gesture経路にも同じ起動規則を要求する。
- application shellはUI contributionの唯一の集約点を `side-panel-contributions.ts`、worker-safeなcontribution型・worker registrationの集約点を `feature-contribution-catalog.ts` として分離している。
- 現行manifestとartifact validatorは `storage / activeTab / scripting / sidePanel` だけを許可しており、`contextMenus` を同じexact allowlistへ加える必要がある。

### アーキテクチャパターンと境界マップ

```mermaid
graph TB
    Menu[Price refresh context menu] --> Gesture[Transient gesture registration]
    WorkerCatalog[Worker safe catalog] --> Menu
    Gesture --> Surface[Transient surface controller]
    SidePanel[Side panel contributions] --> Registration[Source price registration]
    Surface --> Registration[Source price registration]
    Registration --> State[Source price state]
    State --> Service[Source price refresh service]
    Service --> Extract[Page price extraction port]
    Service --> Locator[Stored source locator]
    Locator --> Identity[Source URL identity]
    Locator --> Catalog[Candidate source catalog port]
    Service --> Mutation[Candidate source mutation port]
    Mutation --> Storage[Local data write authority]
```

**統合判断**:

- 選択パターンはfeature use case + ports and adaptersである。
- source-price-refreshはURL同一性と更新workflowだけを所有し、抽出・永続domain・gesture lifecycleを上流へ戻す。
- source-price-refreshのUI registration factoryはside panel専用graphへ登録し、worker-safe catalogにはmenu worker registrationだけを載せる。
- context menu adapterはworker内でDOM/Reactをimportせず、click callback中にupstream gesture sourceへtabIdを同期emitする。
- 新規library、network、alarm、host permissionを追加しない。

### 技術スタック

| 層 | 選択・版 | 本機能での役割 | 備考 |
|---|---|---|---|
| UI | React 19 / CSS | 一過性の進行・成功・失敗表示 | stateはReact外 |
| 言語 | TypeScript 7 strict / ESM NodeNext | URL brand、port、error union | `any`禁止 |
| Domain/Data | candidate source schema 2 / write authority | source priceとcapturedAtの原子的更新 | schema変更なし |
| Runtime | Chrome 116 MV3 contextMenus / activeTab / scripting / sidePanel | gesture、固定tab抽出、panel表示 | `contextMenus` permission追加 |
| 検証 | node:test / testing-library / Playwright | unit、contract、DOM、E2E | 架空 `.invalid` dataのみ |

## ファイル構成計画

### ディレクトリ構成

```text
src/
├── features/source-price-refresh/
│   ├── contracts.ts                    # URL、match、receipt、error、state契約
│   ├── url-identity.ts                 # 保守的URL正規化と同一性
│   ├── source-locator.ts               # catalog/candidate scopeの一意照合
│   ├── service.ts                      # extraction、stale gate、atomic update use case
│   ├── state.ts                        # activationごとのrunning/succeeded/failed
│   ├── view.tsx                        # 進行・結果・回復案内
│   ├── react-root.tsx                  # feature-owned mount/unmount
│   ├── context-menu-source.ts          # Chrome menu itemとgesture source adapter
│   ├── registration.ts                 # transient activation validatorとmount
│   ├── feature-contribution.ts         # portsを組み立てるfeature contribution
│   ├── public.ts                       # URL identityとrefresh portの唯一の公開入口
│   └── styles.css                      # feature-scoped style
├── application-shell/
│   ├── side-panel-contributions.ts      # source-price-refresh UI contribution factoryの唯一の登録先
│   ├── feature-contribution-catalog.ts  # worker-safeなmenu worker registrationだけを登録しUI moduleを参照しない
│   └── production-worker-composition.ts # worker catalogのmenu registrationとgesture portをcomposition
└── ui-messages/catalog/
    ├── ja/source-price-refresh.ts       # 日本語の進行・成功・失敗・menu label
    ├── en/source-price-refresh.ts       # 同一keyの英語文言
    ├── ja/index.ts
    └── en/index.ts

tests/
├── features/source-price-refresh/      # identity、locator、service、state、DOM、public contract
├── application-shell/                  # contribution/gesture composition
├── runtime/                            # context menu registration/click/worker非DOM
└── fixtures/                           # 架空sourceとpage price observation

e2e/
├── source-price-refresh.spec.ts        # context menuからsuccess/failureまで
└── locators.ts                         # transient status locator
```

### 変更対象ファイル

- `manifest.json` — `contextMenus`を既存permission集合へ追加し、host/optional permissionは追加しない。
- `scripts/validate-artifacts.mjs` — exact permission allowlistと診断文言を5権限へ更新する。
- `scripts/build.mjs` または既存entry catalog — 新featureのCSS/UIをproduction bundleへ含める。具体entry方式は現行build patternへ合わせる。
- `src/application-shell/side-panel-contributions.ts` — application shell所有のside panel composition pointでsource-price-refreshのUI contribution factoryを登録する。
- `src/application-shell/feature-contribution-catalog.ts` — worker-safe制約を維持したままsource-price-refreshのmenu worker registrationだけを登録し、UI contribution、DOM、Reactへ到達させない。
- `src/application-shell/production-worker-composition.ts` — worker catalogのmenu registrationを上流gesture registration portへ接続し、side panel専用module graphをimportしない。
- `src/ui-messages/catalog/{ja,en}/index.ts` — source-price-refresh catalogをschemaへ登録しparityを維持する。
- 既存のboundary、artifact、fixture、worker bundleテスト — 新しい公開入口、permission、非DOM規約を反映する。

## システムフロー

### context menuからの価格更新

```mermaid
sequenceDiagram
    participant User
    participant WorkerCatalog
    participant Menu
    participant Gesture
    participant Surface
    participant SidePanel
    participant Refresh
    participant Extractor
    participant Catalog
    participant Mutation

    WorkerCatalog->>Menu: worker-safe menu registration
    SidePanel->>Surface: UI contribution registration
    User->>Menu: 価格を更新
    Menu->>Gesture: surfaceIdとfixed tabIdを同期emit
    Gesture->>Surface: 既存schedulerでactivation要求
    Surface->>Refresh: activationIdとfixed tabId
    Refresh->>Extractor: extractPrice fixed tab
    Extractor-->>Refresh: pageUrl capturedAt price
    Refresh->>Catalog: normalized URLでsource参照
    Catalog-->>Refresh: candidateId sourceId retail
    Refresh->>Mutation: source priceとcapturedAt更新
    Mutation-->>Refresh: atomic Result
    Refresh-->>Surface: 成功またはtyped failure表示
```

menu click callbackからgesture emitまでは同期し、上流が同じcallback内でpanel openを開始できるようにする。source-price-refreshはactivation recordの書込み完了を待ってから `sidePanel.open` する経路を作らない。

### 公開portによる同一URL再取り込み

```mermaid
sequenceDiagram
    participant Merge as Duplicate merge
    participant Public as Source price public port
    participant Locator
    participant Mutation

    Merge->>Public: matchSource candidate scopeとpageUrl
    Public->>Locator: conservative URL identity
    Locator-->>Public: unique targetまたはtyped error
    Merge->>Public: refreshCapturedPrice targetとobservation
    Public->>Locator: target URLとkindを再検証
    Public->>Mutation: priceとcapturedAtだけ更新
    Mutation-->>Public: receiptまたはconflict
    Public-->>Merge: Result
```

## 要件トレーサビリティ

| 要件 | 要約 | コンポーネント | インターフェース | フロー |
|---|---|---|---|---|
| 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 | 一回完結のgesture起動 | PriceRefreshContextMenuSource、SourcePriceRefreshRegistration、SourcePriceRefreshState、SourcePriceRefreshView | `TransientGestureRegistrationPort`、activation payload | context menu更新 |
| 2.1, 2.2, 2.3, 2.4 | URL受理と同一性 | SourceUrlIdentity | `normalizeSourcePageUrl`、`sameSourcePageUrl` | 両フロー |
| 2.5, 2.6, 2.7, 2.8 | 一意source・retail制約 | StoredSourceLocator | `CandidateSourceCatalogPort`、`matchSource` | 両フロー |
| 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 | priceだけの抽出 | SourcePriceRefreshService | `PagePriceExtractionPort` | context menu更新 |
| 4.1, 4.2, 4.3, 4.4, 4.5 | 原子的反映とprojection | SourcePriceRefreshService | `CandidateSourceMutationPort.updateSource`、`refreshCapturedPrice` | 両フロー |
| 5.1, 5.2, 5.3, 5.4, 5.5, 5.6 | 保全と回復 | SourcePriceRefreshService、SourcePriceRefreshState、SourcePriceRefreshView | `SourcePriceRefreshError` | 両フロー |
| 6.1, 6.2, 6.5, 6.6 | permission/runtime境界 | PriceRefreshContextMenuSource、SourcePriceRefreshRegistration | manifest、artifact gate、gesture port | context menu更新 |
| 6.3 | adjacent再利用 | SourcePriceRefreshPublicApi | `SourcePriceRefreshPort` | 同一URL再取り込み |
| 6.4, 6.7 | 決定的・架空fixture検証 | 全コンポーネント | in-memory ports | test flows |

## コンポーネントとインターフェース

| コンポーネント | 層 | 意図 | 要件 | 主要依存 | 契約 |
|---|---|---|---|---|---|
| SourceUrlIdentity | Feature domain | URLを誤統合しない正規形へ変換 | 2.1–2.4, 6.3 | 標準URL | Service |
| StoredSourceLocator | Feature service | scope内のunique retail sourceを特定 | 2.5–2.8, 4.5, 6.3 | Catalog P0、Identity P0 | Service |
| SourcePriceRefreshService | Feature use case | price observationを検証してatomic update | 3.1–3.6, 4.1–4.5, 5.1–5.6 | Extraction P0、Locator P0、Mutation P0、Lifecycle P0 | Service |
| SourcePriceRefreshState | Feature state | activation世代ごとの進行・結果を保持 | 1.2–1.5, 5.5 | Service P0、Lifecycle P0 | State |
| SourcePriceRefreshView | UI | 進行、成功、回復案内を安全なtextで表示 | 1.2–1.4, 3.5, 5.1–5.4 | State P0、Messages P1 | State |
| SourcePriceRefreshRegistration | Side panel UI adapter | transient registrationとactivation validation | 1.1, 1.5, 1.6, 6.5 | Shell public P0、SidePanelContributions P0、ReactRoot P1 | Service |
| PriceRefreshContextMenuSource | Worker runtime adapter | menu itemを提供しtab gestureを同期emit | 1.1, 1.4, 6.1, 6.2, 6.6 | Chrome contextMenus P0、WorkerCatalog P0、Gesture P0 | Event |

### Feature Domain

#### SourceUrlIdentity

| 項目 | 詳細 |
|---|---|
| 意図 | HTTP/HTTPS source URLを、tracking差を許容しつつ商品識別queryを保つ比較keyへ変換する |
| 要件 | 2.1, 2.2, 2.3, 2.4, 6.3 |

**契約**: Service [x]

```typescript
export type NormalizedSourcePageUrl = string & {
  readonly normalizedSourcePageUrlBrand: "NormalizedSourcePageUrl";
};

export type SourceUrlIdentityError = { readonly kind: "invalid-url" };

export function normalizeSourcePageUrl(
  value: string,
): Result<NormalizedSourcePageUrl, SourceUrlIdentityError>;

export function sameSourcePageUrl(left: string, right: string): boolean;
```

**正規化規則**:

- protocolは `http:` / `https:` だけを受理し、schemeは同一性へ含める。
- hostnameをASCII lower-caseへ正規化し、既定port、fragment、root以外の末尾slashを除く。
- `utm_*`、`gclid`、`dclid`、`fbclid`、`msclkid` のcase-insensitive keyだけを除く。
- 残るquery pairはvalueを変更せず、key、value、元indexの順で安定sortする。同じkeyの複数valueを保持する。
- decode/re-encodeは標準 `URL` / `URLSearchParams` のserializationだけを使用し、独自percent decodeを行わない。

#### StoredSourceLocator

| 項目 | 詳細 |
|---|---|
| 意図 | catalog全体または一候補からunique source IDを解決し、retail制約を適用する |
| 要件 | 2.5, 2.6, 2.7, 2.8, 4.5, 6.3 |

**契約**: Service [x]

```typescript
export type SourceMatchScope =
  | { readonly kind: "catalog" }
  | { readonly kind: "candidate"; readonly candidateId: CandidatePartId };

export interface MatchStoredSourceInput {
  readonly scope: SourceMatchScope;
  readonly pageUrl: string;
}

export interface MatchedCandidateSource {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly normalizedPageUrl: NormalizedSourcePageUrl;
  readonly isPrimary: boolean;
}

export interface CandidateSourceReference {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly pageUrl?: string;
  readonly kind?: CandidateSourceKind;
  readonly isPrimary: boolean;
}

export interface CandidateSourceCatalogPort {
  listSourceReferences(input: {
    readonly candidateId?: CandidatePartId;
  }): Promise<Result<readonly CandidateSourceReference[], ManagementError>>;
  getSourceReference(input: {
    readonly candidateId: CandidatePartId;
    readonly sourceId: CandidateSourceId;
  }): Promise<Result<CandidateSourceReference, ManagementError>>;
}
```

この型は `candidate-source-bookmarks/design.md` の確定済み公開契約をそのまま参照したものであり、本featureでは再定義せず `candidate-management/public.ts` からimportする。catalog errorは既存 `ManagementError` を保持する。pageUrl欠損はmatch対象外、kindが `retail` 以外または欠損なら `ineligible-source` とする。0件、2件以上、1件を明確に分岐し、候補・source配列順で暗黙選択しない。

### Feature Use Case

#### SourcePriceRefreshService

| 項目 | 詳細 |
|---|---|
| 意図 | price observation、source再検証、atomic mutationを一つの公開use caseへまとめる |
| 要件 | 3.1–3.6, 4.1–4.5, 5.1–5.6, 6.3, 6.4 |

**依存**:

- Inbound: transient state、duplicate-product-merge public consumer（P0）
- Outbound: `PagePriceExtractionPort`、StoredSourceLocator、`CandidateSourceCatalogPort`、`CandidateSourceMutationPort`、`CandidateQuery`（`getCandidateDraft` のみ／保持field読み出し用）、`TransientSurfaceLifecyclePort`（P0）

**契約**: Service [x]

```typescript
export interface PagePriceObservation {
  readonly pageUrl: string;
  readonly capturedAt: UtcTimestamp;
  readonly price?: SourcedValue<MoneyValue>;
}

export type PagePriceExtractionError =
  | { readonly kind: "tab-unavailable" }
  | { readonly kind: "permission-lost" }
  | { readonly kind: "restricted-page" }
  | { readonly kind: "tab-changed" }
  | { readonly kind: "injection-failed" }
  | { readonly kind: "invalid-payload" };

export interface PagePriceExtractionPort {
  extractPrice(
    tabId: TargetTabId,
  ): Promise<Result<PagePriceObservation, PagePriceExtractionError>>;
}

export interface RefreshCapturedPriceInput {
  readonly target: Pick<MatchedCandidateSource, "candidateId" | "sourceId">;
  readonly observedPageUrl: string;
  readonly capturedAt: UtcTimestamp;
  readonly price?: SourcedValue<MoneyValue>;
}

export interface SourcePriceRefreshReceipt {
  readonly candidateId: CandidatePartId;
  readonly sourceId: CandidateSourceId;
  readonly price: SourcedValue<MoneyValue>;
  readonly capturedAt: UtcTimestamp;
  readonly isPrimary: boolean;
}

export type SourcePriceRefreshError =
  | SourceUrlIdentityError
  | { readonly kind: "no-match" }
  | { readonly kind: "ambiguous-match" }
  | { readonly kind: "ineligible-source" }
  | { readonly kind: "price-unavailable" }
  | { readonly kind: "stale-activation" }
  | { readonly kind: "stale-target" }
  | PagePriceExtractionError
  | Extract<
      ManagementError,
      { readonly kind: "validation" | "conflict" | "maintenance" | "storage" | "quota" | "unsupported-data" }
    >;

export interface SourcePriceRefreshPort {
  matchSource(
    input: MatchStoredSourceInput,
  ): Promise<Result<MatchedCandidateSource, SourcePriceRefreshError>>;
  refreshCapturedPrice(
    input: RefreshCapturedPriceInput,
  ): Promise<Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>>;
}
```

`PagePriceObservation`、`PagePriceExtractionError`、`PagePriceExtractionPort` は `product-page-capture/design.md` の確定済み契約を参照し、`ProductCapturePublicApi.pagePriceExtraction` から受け取る。本featureの所有契約は `RefreshCapturedPriceInput` 以降であり、価格抽出型やerror unionを再定義しない。

`refreshCapturedPrice` は `getSourceReference` で対象を再読込し、現行pageUrlの正規形が `observedPageUrl` と一致し、kindが `retail` である場合だけ既存 `CandidateSourceMutationPort.updateSource` を呼ぶ。inputの `price` が欠損またはconfirmed amount/currencyを持たない場合は `price-unavailable` とし、mutationを呼ばない。update inputは既存sourceのprice/capturedAtだけを置換し、URL、siteName、kind、ID、他source、product、normalized attributesを保持する。`CandidateSourceReference` は `siteName` を射影しないため、保持すべきこれらのフィールドは `query.getCandidateDraft(candidateId)` が返す `CandidateDraft.sources` の該当entryから読み出し、`getSourceReference` による直前の再検証はそのまま維持する。revision conflictは後発状態を上書きせず `conflict` または `stale-target` として返す。

context menu内部commandは次の順序を守る。

1. `isCurrent(activationId)` を確認する。
2. `extractPrice(tabId)` を実行する。
3. 完了後に再度 `isCurrent` を確認し、staleなら結果を破棄する。
4. catalog scopeで `matchSource` を実行する。
5. `refreshCapturedPrice` で現行sourceを再検証して更新する。
6. mutation完了後に再度世代を確認し、旧世代なら表示だけを変更しない。commit済みの有効な更新は巻き戻さない。

### State / UI

#### SourcePriceRefreshState

**契約**: State [x]

```typescript
export type SourcePriceRefreshStateValue =
  | {
      readonly status: "running";
      readonly activationId: ActivationId;
      readonly tabId: TargetTabId;
    }
  | {
      readonly status: "succeeded";
      readonly activationId: ActivationId;
      readonly receipt: SourcePriceRefreshReceipt;
    }
  | {
      readonly status: "failed";
      readonly activationId: ActivationId;
      readonly error: SourcePriceRefreshError;
      readonly recoverable: boolean;
    };
```

activation受理時に即座に `running` として自動実行する。新世代は旧stateを置換し、旧世代callbackはstateを変更しない。unmountはlistenerを解除し、view上に再実行buttonを残さない。

#### SourcePriceRefreshView

summary-only component。runningでは進行、succeededでは価格・通貨・取得時点・primary反映有無、failedでは安定した原因とcontext menu再実行またはsource整理の案内を表示する。URL、商品名、raw HTMLは表示しない。外部由来のprice originalをHTMLとして描画せず、confirmed moneyだけを既存formatterで表示する。

### Shell / Runtime

#### SourcePriceRefreshRegistration

**契約**: Service [x]

```typescript
export interface SourcePriceRefreshTransientActivation {
  readonly activationId: ActivationId;
  readonly tabId: TargetTabId;
}

export type SourcePriceRefreshFeatureRegistration =
  TransientApplicationFeatureRegistration<
    SourcePriceRefreshPublicApi,
    SourcePriceRefreshTransientActivation
  >;
```

registrationはcanonical `TransientApplicationFeatureRegistration`を消費し、`presentation: "transient"`、feature ID `source-price-refresh`を明示する。navigation propertyは渡さず、常設navigation metadata/keyを持たない。activation payloadを境界検証し、mount時にstateへ渡す。menu gesture以外から同じsurfaceIdを起動できても、正しいactivationId/tabIdがなければfail closedにする。

production UIへの登録は `side-panel-contributions.ts` だけが行い、source-price-refreshの `feature-contribution.ts` からregistration factory、public API、CSSをside panel module graphへ取り込む。`feature-contribution-catalog.ts` はこのUI factoryをimportせず、service workerから `side-panel-contributions.ts` へ到達する経路を作らない。

#### PriceRefreshContextMenuSource

| 項目 | 詳細 |
|---|---|
| 意図 | feature固有menu itemを提供し、clickを上流のgeneric gesture lifecycleへ渡す |
| 要件 | 1.1, 1.4, 6.1, 6.2, 6.5, 6.6 |

**契約**: Event [x]

```typescript
export interface TransientGestureSource {
  readonly id: string;
  readonly surfaceId: FeatureId;
  start(
    emit: (tabId: TargetTabId) => void,
  ): Result<() => void, TransientGestureRegistrationError>;
}

export interface TransientGestureRegistrationPort {
  register(
    source: TransientGestureSource,
  ): Result<() => void, TransientGestureRegistrationError>;
}
```

`TransientGestureSource`、`TransientGestureRegistrationPort`、`TransientGestureRegistrationError` は `transient-feature-surface/design.md` の確定済み同期契約を参照し、`application-shell/public.ts` からimportする。context menu sourceはstable ID `source-price-refresh`、`contexts: ["page"]`、`documentUrlPatterns: ["http://*/*", "https://*/*"]` でitemを冪等登録する。click listenerはmenu IDと `parseTargetTabId` で検証したtab IDだけを受け、callback内で `emit` を同期実行する。`pageUrl`、link text、selection、frame dataをstoreやログへ渡さない。上流registration portがemitを既存scheduler、store、side panel openへ接続する。

menu sourceのproduction登録はworker-safeなcatalog項目として `production-worker-composition.ts` が合成する。この経路が参照できるのはDOM/React非依存のcontext menu adapterとworker registrationだけであり、UI registration、view、React root、CSSは参照しない。

## データモデル

### ドメインモデル

新しい永続entity、schema version、history collectionは追加しない。

- 更新aggregate: 既存 `CandidatePart`。
- 更新entity: 既存 `CandidateSource`。
- 更新field: `price?: SourcedValue<MoneyValue>` と `capturedAt?: UtcTimestamp`。
- 識別子: `CandidatePartId + CandidateSourceId`。
- 不変条件: source配列、ID、primary参照、kind、URL、money validationはcandidate-source ownerが検証する。

### 一時データ

- `NormalizedSourcePageUrl` はprocess内の比較値で永続化しない。
- activation stateとprice observationはside panel sessionにだけ保持する。
- URL、price observation、activation payloadを `chrome.storage.session` へ追加保存しない。上流storeは既存どおりIDとtabだけを持つ。

## エラー処理

### エラー方針

- invalid URL、0件一致、複数一致、manufacturer source、price欠損はmutation前にfail closedにする。
- extraction・permission・tab changeは旧価格とcapturedAtを維持する。
- validation、conflict、maintenance、quota、storageは既存management errorを保持し、UI messageへ安定mappingする。
- source、URL、価格、例外objectはログせず、必要な場合は `error.kind` だけを報告する。

| エラー | mutation | 表示・回復 |
|---|---|---|
| `no-match` | 呼ばない | 保存済みsourceを確認する |
| `ambiguous-match` | 呼ばない | 重複sourceを整理する |
| `ineligible-source` | 呼ばない | retail sourceで再実行する |
| `price-unavailable` | 呼ばない | ページ価格を確認し再実行する |
| `permission-lost` / `tab-changed` | 呼ばない | context menuを再実行する |
| `stale-target` / `conflict` | commitしない | 最新候補を再読込して再実行する |
| `maintenance` | commitしない | 保守終了後に再実行する |
| `storage` / `quota` | commitしない | 保存領域を確認して再実行する |

## テスト戦略

### Unit tests

- SourceUrlIdentityでHTTP/HTTPS限定、host case、既定port、fragment、末尾slash、known tracking除去、unknown query保持、duplicate query安定sortを検証する（2.1–2.4）。
- StoredSourceLocatorで0/1/複数一致、catalog/candidate scope、欠損URL、manufacturer、primary flagを検証する（2.5–2.8）。
- SourcePriceRefreshServiceでprice欠損、URL再検証、kind再検証、price/capturedAt限定patch、management error mappingを検証する（3.3–3.5、4.1–4.5、5.1–5.4）。
- Stateでactivationごとの自動開始、新世代置換、旧抽出・旧mutation完了無視、unmountを検証する（1.1–1.5、5.5）。

### Contract / integration tests

- `PagePriceExtractionPort` contract kitで固定tab、page-derived URL、既存rank/normalize provenance、invalid payloadを検証する（3.1–3.3、3.6）。
- catalog → match → updateSourceをin-memory portsで接続し、一回のmutationで対象sourceだけが変わることを検証する（4.1–4.4）。
- duplicate-product-merge consumer fixtureがcandidate scopeでmatchし、同一URLをsource追加せず `refreshCapturedPrice` へ渡すことを検証する（6.3）。
- `TransientGestureRegistrationPort` contract kitでmenu emitが既存activation schedulerへ一度だけ届き、別store writerを作らないことを検証する（1.1、6.6）。
- side panel contribution contractでUI registrationがcanonical transient branchとして`presentation: "transient"`を持ちnavigation不在のまま `side-panel-contributions.ts` から取得でき、worker catalogにはmenu registrationだけが存在することを検証する（1.1、1.2、6.6）。
- public consumer型検査でfeature内部deep importとfoundation root readが不要なことを検証する。

### Runtime / DOM / E2E tests

- context menu itemがHTTP/HTTPSのpage contextだけでstable IDにより冪等登録され、別item click、tabId欠損、restricted URLを無視する（1.1、1.4、6.1、6.2）。
- worker bundleが `side-panel-contributions.ts`、feature UI、DOM、Reactを含まず、manifest permissionがexact 5件でhost/optional permissionがないことをartifact gateで検証する（6.1、6.6）。
- viewがrunning/succeeded/errorを表示し、raw URLやHTMLを描画せず再実行buttonを残さない（1.2–1.5、5.6）。
- production extensionで架空HTTPSページのcontext menuから更新し、primary成功、price欠損、URL不一致、tab遷移のcritical pathを検証する（1.1–1.5、2.5–2.8、3.5、3.6、6.5）。

### 非回帰

- source price/capturedAtだけの変更でnormalized attributesとcompatibility結果が不変である（4.4）。
- primary updateでsummary priceが追従し、non-primary updateでは不変である（4.2、4.3）。
- fixture validatorが実サイトURL、HTML、画像、商品値を拒否する（6.7）。

## セキュリティ考慮事項

- `contextMenus` permissionはmenu item提供だけに使用し、host permissionを追加しない。
- activeTab accessはcontext menu user gestureの固定tab・現行activationだけに使用する。
- page payload、catalog output、runtime inputを `unknown` 境界で検証する。
- source IDを更新識別子とし、URL一致だけで配列indexや最初の候補を選ばない。
- workerではDOM、React、page value、完全URL、例外dumpを扱わない。
- 新しいstorage key、network送信、alarm、background pollingを導入しない。

## 移行戦略

1. 承認済み上流3portのowner、公開入口、exact signatureをpublic consumer contract testへ固定する。
2. URL identity、locator、public refresh use caseを確定済み契約のin-memory portで実装する。
3. `product-page-capture` 6.3完了後に公開price extraction portへ接続する。
4. transient registration、state、viewを実装し、UI contributionを `side-panel-contributions.ts` へ登録する。
5. `transient-feature-surface` 6.3完了後に、context menu sourceのworker registrationだけをworker-safe catalogから上流gesture registration portへ接続する。
6. `manifest.json` とartifact permission gateを同時に更新する。
7. `candidate-source-bookmarks` 3.4完了後に、candidate source catalog/mutation、side panel composition、production worker compositionへ責務別に統合する。
8. contract、runtime、DOM、E2E、full validationでrolloutする。

永続schema migrationと既存価格のbackfillは不要である。rollout失敗時はside panel UI registration、worker menu registration、`contextMenus` permissionを同一変更単位で戻し、保存済みsource dataは変更しない。
