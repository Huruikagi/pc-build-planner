# Design Document

## Overview

本機能は、application shell や既存 feature の内部へ選択 authority を置かず、横断的な `project-context` 境界として現在 project を一元管理する。既存 owner から注入された project catalog を最小 projection へ変換し、専用 UI preference を現行 catalog に照合してから、`ready | empty | unavailable` の判別可能な snapshot として公開する。

選択、refresh、catalog置換guardは一つの直列 transaction authorityで順序付け、preference の永続化成功後にだけ snapshot を更新する。feature-owned draft は change guard の判定だけを受け取り、内容を解釈しない。共通 selector と composition 専用 presentation contribution はこの spec が提供するが、application shell の slot、singleton composition、各 feature adapter、CRUD・restore hook、handoff、legacy selector 撤去は downstream owner に残す。

### Goals

- すべての consumer が同じ検証済み現在 project と generation を参照できる。
- side panel 再オープン、project lifecycle、backup 復元後に選択を決定的に復元・修復する。
- 競合、stale completion、guard 確認、preference 失敗を原子的な transaction で扱う。
- 共通 selector を日本語・英語、keyboard、screen reader に対応させる。
- 専用 preference key と公開 import を source gate と negative test で固定する。

### Non-Goals

- project CRUD、backup replacement、handoff の保存先解決を実装しない。
- candidate、current-build、compatibility などの state、snapshot、draft、view を変更しない。
- application shell の slot・singleton・能力注入・production wiring を変更しない。
- canonical root、backup format、既存 snapshot version/shape を変更しない。
- project 検索、並べ替え、archive、複数同時選択、独立管理画面を導入しない。

## Boundary Commitments

### This Spec Owns

- `ProjectContextSnapshot`、catalog projection、generation、不変条件。
- preference version 1 の schema、専用 key、Chrome local storage adapter と in-memory adapter。
- initialize、select、confirm、cancel、refresh の直列 transaction。
- project 選択と catalog 全体置換を判別する change guard の登録、評価、確認 request、確定後の forced 通知。
- read・command・guard registration・replacement guard の能力別公開 port。
- 共通 selector、日英 message、React root の mount/unmount を行う presentation contribution。
- project-context の public import と preference storage を守る source boundary gate。

### Out of Boundary

- local data foundation の project aggregate、query 実装、write authority。
- application shell の selector slot、singleton composition、root API、feature port injection。
- feature-owned consumer adapter、snapshot、draft、CRUD/restore lifecycle hook、handoff、E2E model。
- backup file の検証、root 置換、復元後 refresh の実行、復元結果 UI。
- legacy `selectedProjectId` の削除、version bump、fallback 利用。
- context unavailable 時の settings / backup recovery 画面そのもの。

### Allowed Dependencies

- `src/domain/public.ts` の `ProjectId`、`UtcTimestamp`、canonical `Result<T, E>`。
- 上流 `runtime-schema-validation` が提供する設定済み `src/domain/runtime-schema/public.ts` と共通 UUID・strict object・issue mapping。
- owner から注入される絞り込み済み `ProjectCatalogSource`。project-context は candidate-management 内部を import しない。
- backup-restore などの downstream lifecycle owner。project-context は置換候補、Foundation port、backup ticket を受け取らない。
- `src/ui-messages/public.ts` と `src/ui-language/public.ts` の message resolver / provider。
- React 19.2.7、React DOM 19.2.7、TypeScript 7.0.2 strict、Node 26、Chrome 116、既存 Node test runner と Playwright。

### Revalidation Triggers

- snapshot union、generation、selection result、change intent、guard protocol、replacement guard port の shape 変更。
- preference key、version、保存 field、runtime schema primitive、storage area の変更。
- catalog entry shape・順序契約、fallback 規則、project ownership の変更。
- transaction の保存順、stale 判定、forced notification の時点変更。
- selector presentation contribution、shell slot、LanguageProvider lifecycle の変更。
- upstream validation 公開入口、公開 import 規約、Chrome storage access policy の変更。
- legacy snapshot `selectedProjectId` の version/shape または扱いの変更。

## Architecture

### Existing Architecture Analysis

Light discovery を実施した。既存の `CandidateQuery.listProjects()` は local data foundation の root 順を保った `ProjectSummary` を返す。candidate-management と current-build はそれぞれ state 内で選択を保持し、存在しない場合に一覧先頭へ fallback する。compatibility の production composition も一覧先頭を one-shot で解決しており、共通 selection authority はない。

`ui-language` は canonical root 外の専用 preference port、Chrome adapter、in-memory adapter、React 外 store を持つ。`validate-boundaries.mjs` の StorageAccessGuard は現在 source path と storage area だけを許可し、key scope は検証しない。project-context はこの既存 pattern を採用しつつ、専用 key を静的に検証する規則を追加する。

上流 `runtime-schema-validation` は configured Zod Mini、strict object、UUID、JSON safety、canonical error mapping を公開する計画である。project-context は preference schema だけを owner-local に置き、Zod package、schema instance、vendor issue を公開しない。新しい外部依存は追加しない。

### Architecture Pattern & Boundary Map

採用パターンは「外部 store を持つ横断 context + capability ports」である。application shell は具体 instance を一度だけ composition し、各 downstream owner は必要な port だけを adapter へ受け取る。

```mermaid
graph LR
    Domain[Domain contracts]
    Validation[Runtime validation public]
    Catalog[Catalog projection]
    Preference[Preference store]
    Guards[Change guards]
    Service[Project context service]
    PublicPorts[Capability ports]
    Selector[Project selector]
    Presentation[Presentation contribution]
    Shell[Application shell downstream]
    Features[Feature adapters downstream]

    Domain --> Catalog
    Domain --> Preference
    Validation --> Preference
    Catalog --> Service
    Preference --> Service
    Guards --> Service
    Service --> PublicPorts
    PublicPorts --> Selector
    Selector --> Presentation
    Presentation --> Shell
    PublicPorts --> Features
```

Dependency directionは `domain/runtime validation → contracts/catalog/preference/guards → service → public ports/selector → presentation contribution → downstream composition` とする。project-context から application-shell、candidate-management、current-build、compatibility、backup、product-capture の具体 module へ逆向きに import しない。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|---|---|---|---|
| Domain / validation | TypeScript 7.0.2 strict、upstream runtime-schema public | branded ID、Result、preference decode | `any`、vendor error 公開、direct Zod import を禁止 |
| UI | React / React DOM 19.2.7 | selector と確認・状態表示 | state authority は React 外 |
| Persistence | `chrome.storage.local` | 専用 UI preference 一件 | canonical root と別 key、既定 10MB への影響は定数 |
| Runtime | Manifest V3、Chrome 116 | side panel composition | 新しい permission と worker state を追加しない |
| Validation | node:test、testing-library、Playwright 1.61.1 | unit、contract、DOM、downstream E2E | 架空 fixture のみ |

## File Structure Plan

### Directory Structure

```text
src/project-context/
├── contracts.ts                    # snapshot、error、catalog、change intent、guard、capability port
├── catalog.ts                      # owner source から最小 catalog projection と不変条件
├── preference-store.ts             # version 1 schema、専用 key、Chrome/in-memory port
├── guard-coordinator.ts            # change guard registry、評価、確認 request、replacement permit、forced 通知
├── service.ts                      # initialize/select/confirm/cancel/refresh/replacement guard transaction
├── public.ts                       # read/command/guard/replacement port と factory の通常公開入口
├── selector.tsx                    # selector、確認、retry、ARIA live state
├── presentation-contribution.tsx   # LanguageProvider と React root を含む shell composition 専用 mount contract
└── runtime.ts                      # production preference adapter の composition seam
tests/project-context/
├── catalog.test.ts
├── preference-store.test.ts
├── guard-coordinator.test.ts
├── service.test.ts
├── public.test.ts
├── contract.integration.test.ts
├── selector.test.tsx
└── presentation-contribution.test.tsx
tests/contracts/
└── project-context-contract-kit.ts # downstream adapter と E2E が再利用する契約 kit
e2e/
├── project-context-core.spec.ts     # core service と selector の browser 横断 flow
└── support/project-context-harness.tsx # 架空 catalog と preference の test-only harness
```

### Modified Files

- `src/ui-messages/catalog/ja/project-context.ts`、`src/ui-messages/catalog/en/project-context.ts` — selector、確認、empty、unavailable、retry の feature-specific message。
- `src/ui-messages/catalog/ja/index.ts`、`src/ui-messages/catalog/en/index.ts` — 両言語で同じ project-context namespace を catalog へ登録する。
- `scripts/validate-boundaries.mjs` — project-context の通常・composition 入口、Chrome local storage source path と専用 key の allowlist。
- `tests/tooling/public-boundaries.test.ts` — deep import、別 storage area、別 key、dynamic key、alias access の negative fixture。
- `tests/tooling/public-api-consumer.ts` — read/command/guard/replacement port の正しい consumer と禁止 import の型検査。
- `package.json` — `src/project-context` を boundary / UI text gate の scan root に追加する。

downstream spec だけが `src/application-shell/*`、`src/features/*`、`src/runtime/side-panel.ts`、既存 feature E2E を変更する。本 spec の実装 task はそれらへ触れない。

## System Flows

### Initialization and Refresh

```mermaid
sequenceDiagram
    participant Owner as Catalog owner
    participant Context as Project context
    participant Preference as Preference store
    participant Consumer as Consumer

    Context->>Owner: Read catalog
    Owner-->>Context: Ordered projection result
    Context->>Preference: Read unknown preference
    Preference-->>Context: Missing valid invalid or failure
    Context->>Context: Resolve valid selection
    Context->>Preference: Repair or clear if needed
    Preference-->>Context: Write result
    Context-->>Consumer: Publish one coherent snapshot
```

catalog failure、preference I/O failure、修復 write failureでは `unavailable` を確定する。invalid preference はデータ破損として外へ出さず、catalog 先頭へ fallback して正常に修復できた場合だけ `ready` を公開する。catalog が空なら preference を clear して `empty` を公開する。

### Guarded Selection

```mermaid
sequenceDiagram
    participant Selector
    participant Context
    participant Guard
    participant Preference
    participant Consumer

    Selector->>Context: Select target
    Context->>Guard: Evaluate registered guards
    Guard-->>Context: Allow or confirmation
    Context-->>Selector: Confirmation required
    Selector->>Context: Confirm request
    Context->>Preference: Persist target
    Preference-->>Context: Success
    Context-->>Consumer: Publish snapshot
    Context-->>Guard: Notify forced selection
```

confirmation request は target、base generation、guard registry revision に結び付く opaque ID である。いずれかが変化した request は stale として拒否する。preference 保存が失敗した場合は snapshot を commit しない。確定後の forced notification は best effort で隔離し、既に確定した選択を rollback しない。

### Guarded Catalog Replacement

```mermaid
sequenceDiagram
    participant Backup as Replacement owner
    participant Context as Project context
    participant Guard as Change guards

    Backup->>Context: Prepare catalog replacement
    Context->>Guard: Evaluate replacement intent
    Guard-->>Context: Allow or confirmation
    Context-->>Backup: Permit or confirmation request
    Backup->>Context: Confirm request
    Context-->>Backup: Confirmed permit
    Backup->>Backup: Commit atomic replacement
    Backup->>Context: Complete permit with success
    Context-->>Guard: Notify forced replacement
    Backup->>Context: Refresh latest catalog
```

`ReplacementGuardPermit` は opaque ID、base generation、guard registry revision に結び付き、一回だけ `complete` または `cancel` できる。prepare と confirm は root を変更せず、downstream owner は permit 取得後にだけ置換を開始する。`complete`はoutcomeにかかわらずpermitをterminal closedへ先に遷移させ、その後に`succeeded`だけがforced notificationを送る。通知失敗を返す場合もpermitは閉鎖済みであり、置換失敗時の`failed`は通知せず閉じる。成功通知と refresh は分離し、refresh 失敗で既に成功した置換を rollback しない。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces / Flows |
|---|---|---|---|
| 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 | coherent context snapshot | ProjectCatalogProjection, ProjectContextService, ProjectContextPublicApi | `ProjectContextSnapshot`、initialization flow |
| 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7 | preference restore and fallback | ProjectPreferenceStore, ProjectCatalogProjection, ProjectContextService | `ProjectPreferenceRead`、initialization flow |
| 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7 | atomic selection and concurrency | ProjectContextService, ProjectChangeGuardCoordinator | `ProjectContextCommandPort`、guarded selection flow |
| 4.1, 4.2, 4.3, 4.4, 4.5, 4.6 | lifecycle refresh | ProjectCatalogProjection, ProjectContextService | `refresh`、initialization flow |
| 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8 | project selection guard | ProjectChangeGuardCoordinator, ProjectContextService, ProjectSelector | guard registry、guarded selection flow |
| 5.9, 5.10, 5.11, 5.12, 5.13 | catalog replacement guard | ProjectChangeGuardCoordinator, ProjectContextService | `ProjectContextReplacementGuardPort`、guarded catalog replacement flow |
| 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7 | capability ports and subscription | ProjectContextPublicApi, ProjectContextService, ProjectChangeGuardCoordinator | read/command/guard/replacement ports |
| 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8 | selector presentation | ProjectSelector, ProjectContextPresentationContribution | React state、presentation mount |
| 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8 | storage/public boundaries and validation | ProjectPreferenceStore, ProjectContextBoundaryGate, ProjectContextPublicApi | runtime seam、boundary gate、contract kit |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|---|---|---|---|---|---|
| ProjectCatalogProjection | Domain | ordered project source を最小・一意 catalog へ射影 | 1.1–1.6, 2.3–2.5, 4.1–4.6 | domain types P0、catalog source P0 | Service |
| ProjectPreferenceStore | Adapter | 専用 key の strict preference を read/write/clear | 2.1–2.7, 3.1, 3.6, 8.1–8.4 | runtime validation P0、Chrome storage P1 | Service, State |
| ProjectChangeGuardCoordinator | Application | 選択・catalog置換のguard registryと確認 lifecycleを調停 | 3.1–3.5, 5.1–5.13, 6.3, 6.5, 6.7 | domain Result P0 | Service, State |
| ProjectContextService | Application | coherent snapshot と transaction authority | 1.1–6.7 | catalog P0、preference P0、guards P0 | Service, State |
| ProjectContextPublicApi | Public boundary | consumer 能力を read/command/guard/replacement に分離 | 1.6, 6.1–6.7, 8.5–8.7 | context service P0 | API |
| ProjectSelector | UI | project 選択、確認、empty/unavailable、retry 表示 | 5.4–5.6, 7.1–7.8 | public ports P0、messages P0 | State |
| ProjectContextPresentationContribution | UI adapter | selector root の mount/unmount を composition owner へ提供 | 6.6, 7.1–7.8, 8.5 | ProjectSelector P0、LanguageProvider P0 | Service |
| ProjectContextBoundaryGate | Tooling | public import と storage source/area/key scope を機械検証 | 8.1–8.5, 8.8 | TypeScript AST scanner P0 | Batch |

### Domain and Adapter Layer

#### ProjectCatalogProjection

**Responsibilities & Constraints**

- 注入された source の成功値から `id`、`name`、`updatedAt` だけを immutable catalog item へコピーする。
- source 順序を保持し、fallback は index 0 だけを使用する。名前や日時で再整列しない。
- duplicate ID、空でないことを保証できない name、無効 entry を catalog failure に閉じ、部分 catalog を公開しない。
- project CRUD、query、並び順の意味は owner に残す。

**Dependencies**

- Inbound: ProjectContextService — refresh / initialize 時の catalog 要求 P0
- Outbound: ProjectCatalogSource — owner が注入する typed query P0
- External: なし

**Contracts**: Service [x]

```typescript
interface ProjectCatalogItem {
  readonly id: ProjectId;
  readonly name: string;
  readonly updatedAt: UtcTimestamp;
}

type ProjectCatalogError =
  | { readonly kind: "source-unavailable" }
  | { readonly kind: "invalid-catalog" };

interface ProjectCatalogSource {
  list(): Promise<Result<readonly ProjectCatalogItem[], ProjectCatalogError>>;
}

interface ProjectCatalogProjection {
  load(): Promise<Result<readonly ProjectCatalogItem[], ProjectCatalogError>>;
}
```

#### ProjectPreferenceStore

**Responsibilities & Constraints**

- `projectContextPreference` 一 key だけを操作し、document は `{ version: 1, selectedProjectId }` に限定する。
- `unknown` を upstream configured schema と strict object helper で decode する。invalid document は `invalid` として修復可能にし、storage rejection は I/O error にする。
- write と clear は例外を stable error code へ閉じ、値や vendor issue を log へ出さない。
- Chrome adapter と in-memory adapter は同じ port を実装する。Chrome API の存在確認は `runtime.ts` の composition seam 内に限定する。

**Dependencies**

- Inbound: ProjectContextService — restore、selection commit、repair P0
- Outbound: runtime-schema public — strict version / UUID decode P0
- External: `chrome.storage.local` — exact key only P1

**Contracts**: Service [x] / State [x]

```typescript
type ProjectPreferenceRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "valid"; readonly selectedProjectId: ProjectId };

type ProjectPreferenceError =
  | { readonly kind: "storage-unavailable" }
  | { readonly kind: "storage-write-failed" };

interface ProjectPreferencePort {
  read(): Promise<Result<ProjectPreferenceRead, ProjectPreferenceError>>;
  write(projectId: ProjectId): Promise<Result<void, ProjectPreferenceError>>;
  clear(): Promise<Result<void, ProjectPreferenceError>>;
}
```

### Application Layer

#### ProjectChangeGuardCoordinator

**Responsibilities & Constraints**

- stable guard ID ごとに一件を登録し、登録順の snapshot を change transaction 開始時に固定する。
- guard decision は `allow` または `confirmation-required` だけとし、draft data を受け取らない。
- `ProjectContextChangeIntent` は `select-project` と `replace-catalog` の判別共用体とし、置換候補や backup data を含めない。
- confirmation と replacement permit は opaque ID、intent、base generation、registry revision を保持する。cancel、generation 変更、target 消失、registry 変更、別 transaction で無効化する。
- confirmed selection commit、catalog invalidation、確認済み replacement success 後に forced change を通知する。listener failure は隔離する。
- replacement completionはoutcomeにかかわらずpermitを通知前に閉じる。failure/cancel は forced notification を送らず、success通知の失敗でもpermitを再開しない。通知自体は snapshot を変更せず、refresh は downstream owner が別途要求する。

**Dependencies**

- Inbound: ProjectContextService — user selection / forced refresh P0
- Outbound: registered owner guard — decision と notification P1
- External: なし

**Contracts**: Service [x] / State [x]

```typescript
type ProjectContextChangeIntent =
  | {
      readonly kind: "select-project";
      readonly from: ProjectId;
      readonly to: ProjectId;
      readonly cause: "user" | "catalog-invalidated";
    }
  | {
      readonly kind: "replace-catalog";
      readonly from: ProjectId | null;
      readonly cause: "backup-restore";
    };

type ProjectContextChangeGuardDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "confirmation-required" };

interface ProjectContextChangeGuard {
  readonly id: string;
  evaluate(
    intent: ProjectContextChangeIntent,
  ): Promise<Result<ProjectContextChangeGuardDecision, { readonly kind: "guard-failed" }>>;
  notifyForced?(intent: ProjectContextChangeIntent): void | Promise<void>;
}
```

#### ProjectContextService

**Responsibilities & Constraints**

- transaction queue を一つだけ持ち、catalog load、preference I/O、guard evaluation、commit を順序付ける。MV3 worker の寿命には依存しない。
- immutable snapshot を保持し、commit 時だけ generation を一増加して listener へ同期通知する。
- initialize / refresh の選択優先順位は「現 snapshot の有効選択 → 有効 preference → catalog 先頭 → empty」である。initialize には現 snapshot がない。
- user select は「target validation → guard evaluation → optional confirmation → preference write → snapshot commit → forced notification」の順とする。
- catalog replacement は「prepare intent → optional confirmation → begin時stale検証 → downstream commit → outcome completion」の順とし、prepare/confirm/beginでは snapshot と preference を変更しない。
- replacement success completion は forced notification だけを行い、catalog refresh を暗黙実行しない。downstream owner が置換成功確定後に command port の `refresh` を呼ぶ。
- stale async completion は transaction sequence、base generation、confirmation registry revision で拒否する。
- unavailable への遷移でも generation を増加するが、preference write failure による user select 失敗では snapshot を変更しない。

**Dependencies**

- Inbound: Public API / selector / downstream lifecycle owner P0
- Outbound: catalog projection、preference port、guard coordinator P0
- External: なし

**Contracts**: Service [x] / State [x]

```typescript
type ProjectContextSnapshot =
  | {
      readonly status: "ready";
      readonly generation: number;
      readonly catalog: readonly [ProjectCatalogItem, ...ProjectCatalogItem[]];
      readonly selectedProjectId: ProjectId;
    }
  | {
      readonly status: "empty";
      readonly generation: number;
      readonly catalog: readonly [];
      readonly selectedProjectId: null;
    }
  | {
      readonly status: "unavailable";
      readonly generation: number;
      readonly selectedProjectId: null;
      readonly reason:
        | "not-initialized"
        | "catalog-unavailable"
        | "preference-unavailable"
        | "preference-write-failed";
    };

interface ProjectSwitchConfirmation {
  readonly id: string;
  readonly from: ProjectId;
  readonly to: ProjectId;
  readonly baseGeneration: number;
}

type ProjectSelectionOutcome =
  | { readonly kind: "selected"; readonly snapshot: ProjectContextSnapshot }
  | {
      readonly kind: "confirmation-required";
      readonly confirmation: ProjectSwitchConfirmation;
    };

type ProjectContextCommandError =
  | { readonly kind: "context-unavailable" }
  | { readonly kind: "project-not-found" }
  | { readonly kind: "guard-failed" }
  | { readonly kind: "confirmation-stale" }
  | { readonly kind: "preference-write-failed" };
```

#### ProjectContextPublicApi

**Responsibilities & Constraints**

- 通常 consumer へ read-only port、lifecycle owner へ command port、draft owner へ guard registration port、catalog置換ownerへ replacement guard port を別 object として提供する。
- port は frozen facade であり、service instance、preference port、catalog source、guard collection を公開しない。
- `public.ts` は domain contract と factory だけを export し、React、Chrome、runtime schema instance を module graph に含めない。

**Contracts**: API [x]

```typescript
interface ProjectContextReadPort {
  getSnapshot(): ProjectContextSnapshot;
  subscribe(listener: (snapshot: ProjectContextSnapshot) => void): () => void;
}

interface ProjectContextCommandPort {
  select(projectId: ProjectId): Promise<Result<ProjectSelectionOutcome, ProjectContextCommandError>>;
  confirm(confirmationId: string): Promise<Result<ProjectContextSnapshot, ProjectContextCommandError>>;
  cancel(confirmationId: string): Result<void, ProjectContextCommandError>;
  refresh(): Promise<Result<ProjectContextSnapshot, ProjectContextCommandError>>;
}

interface ProjectContextChangeGuardRegistrationPort {
  register(guard: ProjectContextChangeGuard): Result<() => void, { readonly kind: "duplicate-guard" }>;
}

interface ProjectContextReplacementConfirmation {
  readonly id: string;
  readonly baseGeneration: number;
}

interface ProjectContextReplacementPermit {
  readonly id: string;
  readonly baseGeneration: number;
}

type ProjectContextReplacementPreparation =
  | { readonly kind: "permitted"; readonly permit: ProjectContextReplacementPermit }
  | {
      readonly kind: "confirmation-required";
      readonly confirmation: ProjectContextReplacementConfirmation;
    };

type ProjectContextReplacementGuardError =
  | { readonly kind: "guard-failed" }
  | { readonly kind: "confirmation-stale" }
  | { readonly kind: "permit-stale" }
  | { readonly kind: "permit-not-started" }
  | { readonly kind: "permit-already-completed" };

interface ProjectContextReplacementGuardPort {
  prepare(): Promise<Result<ProjectContextReplacementPreparation, ProjectContextReplacementGuardError>>;
  confirm(confirmationId: string): Promise<Result<ProjectContextReplacementPermit, ProjectContextReplacementGuardError>>;
  cancel(confirmationId: string): Result<void, ProjectContextReplacementGuardError>;
  begin(permitId: string): Result<void, ProjectContextReplacementGuardError>;
  complete(
    permitId: string,
    outcome: "succeeded" | "failed" | "cancelled",
  ): Promise<Result<void, ProjectContextReplacementGuardError>>;
}

interface ProjectContextPublicApi {
  readonly read: ProjectContextReadPort;
  readonly commands: ProjectContextCommandPort;
  readonly guards: ProjectContextChangeGuardRegistrationPort;
  readonly replacementGuard: ProjectContextReplacementGuardPort;
}
```

`prepare` は `unavailable` snapshot でも実行可能であり、intent の `from` を `null` とする。`begin` は permit の generation と guard registry revision を現在値へ再照合して一回だけ開始済みにし、stale permit では downstream commit を開始させない。`complete`はpermit閉鎖をforced notificationより先に確定し、`complete("succeeded")` だけが登録 guard へ通知する。通知callbackが失敗して`guard-failed`を返してもpermitは閉鎖済みで再利用できない。`failed` と `cancelled` は通知せず lifecycle を閉じ、同じ backup ticketから新しい`prepare`を行える。

### Presentation Layer

#### ProjectSelector

**Responsibilities & Constraints**

- `useSyncExternalStore` で read port を購読し、local UI state は pending command と confirmation dialog だけに限定する。
- ready は native select、empty は disabled state、unavailable は status と retry button を表示する。
- select の label、status は message catalog key を使用する。project name は option child text として描画する。
- confirmation は modal semantics、initial focus、Escape cancel、confirm/cancel button を持つ。処理中は重複操作を無効化する。
- command rejection は stable kind から利用者向け message へ写像し、ID、storage value、exception を表示しない。

**Contracts**: State [x]

```typescript
interface ProjectSelectorProps {
  readonly read: ProjectContextReadPort;
  readonly commands: ProjectContextCommandPort;
}
```

#### ProjectContextPresentationContribution

**Responsibilities & Constraints**

- shell が提供した exact slot container に一つの React root を生成し、`LanguageProvider` と `ProjectSelector` を mount する。
- handle の `unmount` は subscription、pending UI、React root を一度だけ解放し、container を空にする。
- slot の作成、配置、context singleton の生成、feature への port injection は shell owner に残す。

**Contracts**: Service [x]

```typescript
interface ProjectContextPresentationHandle {
  unmount(): void;
}

interface ProjectContextPresentationContribution {
  mount(container: HTMLElement): Result<
    ProjectContextPresentationHandle,
    { readonly kind: "presentation-failed" }
  >;
}
```

### Tooling

#### ProjectContextBoundaryGate

**Responsibilities & Constraints**

- normal consumer の project-context import は `public.ts`、shell composition は `presentation-contribution.ts` と `runtime.ts` だけを許可する。
- direct `chrome.storage.local` は `preference-store.ts` のみ許可し、`get/set/remove` の key argument が静的に `projectContextPreference` へ解決できる場合だけ通す。
- dynamic key、storage area alias、別 key、session/sync access、別 source path、内部 deep import の negative fixture を拒否する。
- 要件 8.6 として legacy 選択 authority の逆流を拒否する。`src/project-context/` からの import は Allowed Dependencies（owner-local sibling、`domain/public`、`domain/runtime-schema/public`、`ui-language/public`、`ui-messages/public`、React）だけを許し、features / application-shell / runtime / persistence への static・dynamic・import type 経路を閉じる。加えて初期化・fallback の入力契約（`*Dependencies` / `*Source` / `*Port` / `*Options` / `*Input`）が `selectedProjectId` を member に持つことを拒否する。context 自身の出力である snapshot の同名 field は対象外とする。
- source scan root に `src/project-context` を必須化し、存在しない root を fail closed にする。

**Contracts**: Batch [x]

## Data Models

### Domain Model

- `ProjectCatalogItem`: context が公開する最小 project projection。project 内容の authoritative record ではない。
- `ProjectContextSnapshot`: catalog と選択の一貫性境界。`ready` だけが non-null selection を持つ。
- `ProjectPreferenceDocumentV1`: root 外の UI preference。version と ID だけを持つ。
- `ProjectSwitchConfirmation`: memory-only の一時 request。永続化、snapshot、backup へ含めない。
- `ProjectContextChangeIntent`: project 選択または catalog 全体置換の種類と、guard 判断に必要な最小 context。draft や置換候補を含めない。
- `ProjectContextReplacementConfirmation` / `ProjectContextReplacementPermit`: memory-only の一時 lifecycle。generation と guard registry revision に結び付き、永続化、snapshot、backup へ含めない。

不変条件:

1. ready の selected ID は catalog に一度だけ存在する。
2. empty の catalog は空で selected ID は null。
3. unavailable は catalog と利用可能な selected ID を公開しない。
4. generation は commit ごとに単調増加し、process 内で後退しない。
5. preference は snapshot commit より先に永続化される。
6. legacy snapshot ID は入力に含まれない。
7. replacement permit は一回だけ begin でき、begin 済み permit は一回だけ complete できる。complete後の通知成否にかかわらずterminal closedである。
8. replacement success completion だけが forced replacement notification を発生させ、snapshot の変更は後続 refresh でのみ確定する。

### Logical Data Model

```typescript
interface ProjectPreferenceDocumentV1 {
  readonly version: 1;
  readonly selectedProjectId: ProjectId;
}
```

- storage key: `projectContextPreference`
- missing: 初回または empty 後。
- invalid: strict schema failure。catalog があれば fallback write で修復する。
- version unknown: invalid として同じ repair path に閉じ、推測 migration は行わない。
- clear: catalog が empty に確定する transaction の commit 前に実行する。

## Error Handling

| Failure | Snapshot / command result | Recovery |
|---|---|---|
| Catalog source failure | `unavailable: catalog-unavailable` | owner または selector の refresh |
| Preference read rejection | `unavailable: preference-unavailable` | selector refresh、settings/backup は継続 |
| Invalid preference value | publish 前に fallback repair | repair 成功時 ready/empty、失敗時 unavailable |
| User selection unknown ID | `project-not-found`、state 不変 | catalog refresh 後に再選択 |
| Guard failure | `guard-failed`、state 不変 | draft owner の回復後に再選択 |
| Stale confirmation | `confirmation-stale`、state 不変 | select をやり直して再評価 |
| Stale replacement permit | `permit-stale`、state 不変 | backup ticketを保持してprepareから再評価 |
| Replacement failed or cancelled | permitを通知なしでclose、state不変 | 同じ候補または別候補でprepareを再実行 |
| Replacement succeeded but refresh failed | forced通知後にsnapshotがunavailable | 置換を再実行せずrefreshだけを再試行 |
| Preference write rejection | `preference-write-failed`、state 不変 | retry |
| Subscriber / forced notifier throw | listener のみ隔離 | stable error code の best-effort diagnostic |

error と log には project name、project ID、storage value、draft、exception object を含めない。selector は message catalog から action-oriented text を解決する。

## Testing Strategy

### Unit Tests

- ProjectCatalogProjection: source 順保持、duplicate ID、invalid entry、empty、failure の全-or-nothing。
- ProjectPreferenceStore: missing/valid/invalid/unknown version、別 key 非接触、read/write/clear rejection、in-memory parity。
- ProjectChangeGuardCoordinator: 登録順、duplicate、両intentのallow/confirmation、cancel、stale generation、registry revision、permit begin/complete、terminal close後の成功通知とlistener failure isolation。
- ProjectContextService: ready/empty/unavailable、restore priority、fallback repair、generation、same-selection no-op、write-before-commit、serialized select/refresh/replacement guard、stale result。

### Contract and Integration Tests

- read/command/guard/replacement facade が内部 capability を漏らさず、unsubscribe 後に通知しない。
- create/delete/restore を表す synthetic catalog replacement で、選択維持、fallback、empty、unavailable recovery を検証する。
- guard confirmation 中に refresh、guard unregister、target deletion が起きた場合に confirmation を stale とする。
- replacement prepare/confirmation後にgenerationまたはregistry revisionが変わった場合はbeginを拒否し、失敗・取消ではforced通知なし、成功では一回だけ通知する。
- backup owner相当のsynthetic consumerで `prepare → confirm → begin → complete succeeded → refresh` の順序と、refresh失敗後にreplacementを再実行しないことを検証する。
- catalog invalidation の forced notification と listener failure isolationを検証し、通知失敗後もpermitが閉鎖済みで通常操作と次のprepareを阻害しないことを確認する。
- reusable contract kit で downstream adapter が legacy snapshot ID を authority にしないこと、null/unavailable を扱うことを検証可能にする。

### DOM Tests

- ready/empty/unavailable/pending の表示、native select、retry、確認・取消。
- keyboard focus、Escape、accessible label、live status、disabled state。
- LanguageProvider の ja/en 切替で選択を維持し、全 message key parity を確認する。
- markup-like project name を text として描画し、`img` や script element が生成されないことを確認する。
- unmount が root、subscription、container を cleanup する。

### Boundary, Build, and E2E

- AST negative fixture で別 source、別 area、別/dynamic key、alias access、deep import を拒否する。
- public consumer typecheck で capability separation と canonical `Result` を固定する。
- `pnpm validate:boundaries`、`validate:ui-text`、`validate:final-build`、`pnpm test` を通す。
- 本 spec は test-only browser harness で core service、preference、guard、selector を composition し、選択、確認・取消、再初期化による preference 復元、empty/unavailable recovery を Playwright で検証する。harness は production bundle や manifest へ含めない。
- 要件 8.7 は contract kit の `collectUnavailableRecoveryContractViolations` で固定する。unavailable snapshot を観測しながら downstream owner が注入した settings / backup recovery 起動経路が拒否されないことと、公開 command から retry へ到達できることだけを検査し、shell 具体実装は取り込まない。
- downstream Playwright test が利用する contract kit と selector locator contract も提供する。production shell への slot 配置、feature adapter 追従、実 extension 再オープン、settings/backup recovery の Playwright シナリオ実装は各 downstream owner が行い、Revalidation Triggers により統合時に本 contract suite も実行する。
- fixture は架空 ID・project 名のみを使い、実サイト由来 URL、商品値、HTML、画像を含めない。

## Security Considerations

- preference は `unknown` から strict decode し、unknown key、unsafe object、禁止 payload、unknown version を受理しない。
- direct Chrome storage access は exact source/area/key gate で限定し、content script や feature へ preference API を公開しない。
- project name は React text child としてのみ描画し、`dangerouslySetInnerHTML` / `innerHTML` を使用しない。
- canonical root と backup format に preference を混在させず、local data foundation の single write authority を迂回して domain data を書かない。
- new permission、host permission、remote code、runtime download、CSP 緩和を追加しない。

## Performance & Scalability

- catalog projection、selection lookup、guard traversal は project / guard 数に対して線形とする。MVP では多数 project の検索・index は導入しない。
- snapshot と catalog は immutable reference とし、同値 selection は通知しない。React selector は `useSyncExternalStore` で確定済み snapshot だけを再描画する。
- preference document は定数サイズで、`chrome.storage.local` の容量監視対象へ実質的な負荷を加えない。
- transaction queue は失敗後も解放し、後続 refresh を starvation させない。

## Migration and Downstream Integration

実装順は upstream runtime validation 完了後、project-context core、owner-local adapter、application-shell production wiring、legacy selector/fallback 撤去の順とする。

1. 本 spec は新しい public ports と presentation contribution を追加するだけで、既存 feature behavior を切り替えない。
2. candidate/current-build/compatibility/backup/product-capture migration が owner-local adapter と lifecycle hook を追加する。
3. application-shell が singleton、selector slot、能力別 injection を composition する。
4. downstream contract / Playwright が同一 selection、reopen、guard、restore、unavailable recovery を証明した後に legacy selector と list-first fallback を撤去する。
5. rollout 中も既存 snapshot version/shape と `selectedProjectId` field は維持し、context authority への逆流を boundary test で拒否する。
