# 技術設計書

## Overview

本specはapplication shellへ一過性featureの汎用契約を導入する。一過性featureは常設ナビゲーションへ並ばず、権限付与ジェスチャー由来の起動要求でだけ表示され、固定対象タブの文書世代が失効すると終了する。

業務feature固有の状態やUIは所有しない。下流featureは本specが公開する`ActivationId`、固定`TargetTabId`、`TransientSurfaceLifecyclePort`を利用し、feature固有の権限付与gestureを持つ場合は`TransientGestureRegistrationPort`へ登録する。controller、scheduler、store writerはshell/runtime内部に留める。

### Goals

- 常設と一過性の登録区分を既存feature非回帰で追加する
- 起動要求をMV3 workerのメモリ寿命へ依存せずpanelへ届ける
- 起動世代と対象タブを固定し、遷移・更新・閉鎖で確実に終了する
- 戻り先と型付き引き渡しを単一主表示領域の契約として提供する
- Chrome APIをruntime adapterへ閉じ、shellを決定的に検証する
- feature固有gestureを既存のsequence・store・panel open経路へ同期登録できる最小portを提供する

### Non-Goals

- product-captureの状態・UI・抽出処理
- 候補管理のdraftと保存検証
- コンテキストメニュー項目の実登録
- gesture source固有のChrome API、item ID、表示条件、文言
- 商品データの永続化

## Boundary Commitments

### This Spec Owns

- `ApplicationFeatureRegistration`を構成する常設／一過性registration判別共用体と`isPersistent`型述語
- `ActivationId`、`TargetTabId`、未信頼なChrome tab IDをbrandへ変換する`parseTargetTabId`、`TransientActivationRequest`
- `TransientSurfaceController`の起動、撤収、引き渡し、世代照合
- 下流featureへ世代照合と引き渡しだけを公開する`TransientSurfaceLifecyclePort`
- feature-owned gesture sourceをcanonical gesture ingressへ接続する`TransientGestureRegistrationPort`
- 起動要求storeとタブ寿命adapter
- 常設ナビ、初期選択、availability fallbackの一過性除外
- shell/runtimeの診断、失敗通知、検証fixture

### Out of Boundary

- 一過性面の業務payloadの意味
- 抽出結果の確認・補正・保存
- capture/candidateの文言とE2Eロケータ
- context menuなど各gesture sourceの登録内容とChrome API adapter
- 永続データschema

### Allowed Dependencies

- application shellの既存registration、host transition、typed activation契約
- canonical `Result<T, E>`と既存message catalog公開契約
- shell/runtime専用adapter内に限定した`chrome.action`、`chrome.sidePanel`、`chrome.tabs`、`chrome.storage.session`、`chrome.runtime` message
- 下流specは`application-shell/public.ts`の`TransientSurfaceLifecyclePort`または`TransientGestureRegistrationPort`と関連型だけを参照する

### Revalidation Triggers

- `ActivationId`、`TargetTabId`、`parseTargetTabId`、`TransientActivationRequest`、`TransientSurfaceLifecyclePort`のshapeまたは意味の変更
- `TransientGestureSource`、`TransientGestureRegistrationPort`、`TransientGestureRegistrationError`のshape、同期emit、cleanup保証の変更
- `seq`割り当て、墓標優先、watch-ready最終許可の順序保証の変更
- session媒体、worker単一write owner、タブ寿命イベントの変更
- production E2Eの委譲先または実feature登録順の変更
- 常設navigation command、`closing` / `dismiss-failed`の意味、retry target保持、monitoring cleanup ownerの変更
- gesture ingressの同期性またはworker composition ownerを変更した場合は`source-price-refresh`を再検証する

### Existing Spec Revision Touchpoints

- `application-shell` 1.1 / 1.5 / 2.1を、常設featureだけをナビゲーション・初期選択・availability fallback・通常`select()`の対象にし、一過性featureを同じ単一主表示領域へ型付き登録できる契約へ改訂する
- `application-shell` 4.3 / 4.4を、常設featureを維持したまま一過性起動障害を安全なテキストの`transientNotice`で提示できる共通状態表示へ改訂する
- `application-shell` 7のtyped activationは`conclude`の引き渡し先として再利用し、既存rollback保証を変更しない

### Dependency Direction

```text
application-shell contracts
    ↓
transient controller ports
    ↓
runtime adapters (chrome.storage.session / chrome.tabs / chrome.action / chrome.runtime)

downstream feature
    → application-shell/public.ts

feature gesture source
    → TransientGestureRegistrationPort
    → canonical gesture ingress
    → transient scheduler
```

下流featureはshellの内部moduleやChrome APIへ到達しない。shellは下流featureのpayloadを`unknown`として扱い、対象featureのactivation validatorへ委ねる。

下流featureへcontroller実装そのものは公開しない。`ApplicationComposition`がcontrollerから最小の`TransientSurfaceLifecyclePort`を作り、feature contribution factoryへ依存注入する。これによりmigration側はshell実装やglobal singletonを参照しない。

## Architecture

```mermaid
graph TB
    Action["chrome.action source"] --> Registration["TransientGestureRegistrationPort"]
    FeatureGesture["feature gesture source"] --> Registration
    Registration --> Ingress["Canonical gesture ingress"]
    Ingress --> Store["TransientActivationStore"]
    Ingress --> FailureSignal["ActivationFailureSignal"]
    Ingress --> PanelOpen["Side panel open"]
    Tabs["chrome.tabs lifecycle"] --> Store
    Store --> Port["Typed runtime activation port"]
    Tabs --> TabPort["TabLifecyclePort"]
    Port --> Controller["TransientSurfaceController"]
    TabPort --> Monitoring["ProductionMonitoringIntegration"]
    Monitoring --> Controller
    Controller --> Host["SidePanelHost"]
    Host --> Registry["FeatureRegistry"]
```

### Responsibilities

- **FeatureRegistry**: `presentation`を検証し、不正登録を隔離する
- **SidePanelHost**: 同時に一つのfeatureだけをmountし、既存transition/rollbackを維持する
- **TransientSurfaceController**: 起動世代、対象タブ、戻り先、常設選択target、終了epochを所有する
- **ProductionMonitoringIntegration**: panel監視callbackをcontrollerへ引き渡し、取得したwatch cleanupを停止時に所有・解除する
- **TransientActivationStore**: worker再生成を跨ぐ起動要求、単調増加順序、失効墓標を保持する
- **TransientGestureRegistrationPort**: feature-owned sourceを同期開始し、emitを唯一のgesture ingressへ接続して対称cleanupする
- **Canonical gesture ingress**: activation IDとsequenceを割り当て、store commandをenqueueし、同じgesture callback内でpanel openを開始する
- **TransientActivationPort**: panelのwatch-readyを型付きruntime messageでworkerの最終許可へ接続する
- **ActivationFailureSignal**: 起動record書き込み失敗をsession媒体と独立したChrome action表示で通知する
- **TabLifecycleAdapter**: ChromeイベントをURL非依存の寿命イベントへ変換する

## File Structure Plan

```text
src/application-shell/
  contracts.ts                            # explicit presentationとnavigation有無を相関させる判別共用体
  feature-registry.ts                     # branch相関のruntime検証とsnapshot複製
  side-panel-host.ts
  application-composition.ts
  late-bound-lifecycle.ts                 # new: feature factoryへ安定参照を渡すfail-closed proxy
  shell-presentation.tsx                  # navigation / retry commandをproduction viewへ結線
  shell-view.tsx
  transient-surface-notice.ts            # new
  transient-surface-controller.ts       # new
  transient-surface-ports.ts            # new
  public.ts
src/runtime/
  service-worker.ts
  transient-gesture-registration.ts     # new
  transient-action-gesture-source.ts    # new
  canonical-gesture-ingress.ts           # new: 全gesture sourceの単一入口
  transient-activation-transport.ts      # new: versioned worker/panel transport
  panel-activation-adapter.ts            # new: watch-ready後のauthorization
  activation-failure-signal.ts           # new: storage非依存のaction通知
  transient-activation-store.ts          # new: session到達、store、scheduler
  tab-lifecycle-adapter.ts               # new: URL非依存rulesとChrome listener
  production-monitoring-integration.ts   # new: watch→authorize→controller handoff
  production-transient-panel.ts          # new: production panel composition
scripts/
  validate-boundaries.mjs
tests/application-shell/
tests/runtime/
```

`StorageAccessGuard`には`src/runtime/transient-activation-store.ts`だけを限定追加する。featureから`chrome.storage`への直接到達は引き続き禁止する。

## Core Contracts

### Feature Registration

```typescript
export interface FeatureRegistrationBase<
  TPublic extends object = object,
  TActivation = never,
> {
  readonly id: FeatureId;
  readonly publicApi: TPublic;
  getAvailability(): Availability;
  subscribeAvailability(listener: (value: Availability) => void): () => void;
  mount(context: FeatureMountContext): Promise<FeatureMountHandle>;
  readonly activation?: FeatureActivationAdapter<TActivation>;
}

export interface ShellNavigationMetadata {
  readonly labelKey: MessageKey;
  readonly order: number;
  readonly icon?: string;
}

export interface PersistentApplicationFeatureRegistration<
  TPublic extends object = object,
  TActivation = never,
> extends FeatureRegistrationBase<TPublic, TActivation> {
  readonly presentation: "persistent";
  readonly navigation: ShellNavigationMetadata;
}

export interface TransientApplicationFeatureRegistration<
  TPublic extends object = object,
  TActivation = never,
> extends FeatureRegistrationBase<TPublic, TActivation> {
  readonly presentation: "transient";
  readonly navigation?: never;
}

export type ApplicationFeatureRegistration<
  TPublic extends object = object,
  TActivation = never,
> =
  | PersistentApplicationFeatureRegistration<TPublic, TActivation>
  | TransientApplicationFeatureRegistration<TPublic, TActivation>;

export const isPersistent = <TPublic extends object, TActivation>(
  registration: ApplicationFeatureRegistration<TPublic, TActivation>,
): registration is PersistentApplicationFeatureRegistration<TPublic, TActivation> =>
  registration.presentation === "persistent";
```

共通baseは既存のmount、availability、public API、任意のtyped activationを保持するため、transient lifecycle／activation配送をnavigation契約から分離できる。全producerは`presentation`を明示する。常設branchだけが`MessageKey`で型付けされたnavigation metadataを持ち、一過性branchではproperty自体を渡さない。runtime境界は未知／欠損presentation、常設navigation欠損、一過性navigation混入を拒否し、snapshot複製でもbranchを維持する。`isPersistent`をnavigation catalog構築、通常選択、初期選択、fallback、controller検証の単一型述語とする。

### Transient Controller

```typescript
export type TargetTabId = number & { readonly __brand: "TargetTabId" };
export type ActivationId = string & { readonly __brand: "ActivationId" };

export type TargetTabIdValidationError = {
  readonly kind: "invalid-target-tab";
};

export function parseTargetTabId(
  value: unknown,
): Result<TargetTabId, TargetTabIdValidationError>;

export interface TransientActivationRequest {
  readonly activationId: ActivationId;
  readonly surfaceId: FeatureId;
  readonly tabId: TargetTabId;
}

export type TransientDismissReason =
  | "navigated"
  | "tab-closed"
  | "persistent-selected";

export type TransientSurfaceState =
  | { readonly kind: "inactive" }
  | {
      readonly kind: "active";
      readonly activationId: ActivationId;
      readonly surfaceId: FeatureId;
      readonly tabId: TargetTabId;
      readonly returnTo: FeatureId | null;
    }
  | {
      readonly kind: "closing";
      readonly activationId: ActivationId;
      readonly surfaceId: FeatureId;
      readonly returnTo: FeatureId | null;
      readonly target: FeatureId | null;
      readonly reason: TransientDismissReason;
    }
  | {
      readonly kind: "dismiss-failed";
      readonly activationId: ActivationId;
      readonly surfaceId: FeatureId;
      readonly returnTo: FeatureId | null;
      readonly target: FeatureId | null;
      readonly reason: TransientDismissReason;
    };

export interface TransientSurfaceController {
  start(): Promise<Result<void, TransientSurfaceError>>;
  request(value: TransientActivationRequest): Promise<Result<void, TransientSurfaceError>>;
  dismiss(
    activationId: ActivationId,
    reason: TransientDismissReason,
  ): Promise<Result<void, TransientSurfaceError>>;
  selectPersistent(target: FeatureId): Promise<Result<void, TransientSurfaceError>>;
  retryDismiss(): Promise<Result<void, TransientSurfaceError>>;
  conclude(
    activationId: ActivationId,
    handoff: FeatureActivationIntent,
  ): Promise<Result<void, TransientSurfaceError>>;
  isCurrent(activationId: ActivationId): boolean;
  getSnapshot(): TransientSurfaceState;
  subscribe(listener: (state: TransientSurfaceState) => void): () => void;
  stop(): Promise<void>;
}

/** 下流の一過性featureへ注入する最小公開port。 */
export interface TransientSurfaceLifecyclePort {
  isCurrent(activationId: ActivationId): boolean;
  conclude(
    activationId: ActivationId,
    handoff: FeatureActivationIntent,
  ): Promise<Result<void, TransientSurfaceError>>;
}
```

controllerは自身のcommandをpromise chainで直列化する。各intentの受付時に単調なcommand epochを割り当て、await後のstate確定は最新epochだけに許可する。これにより先行`request` / `conclude`の遅延完了より後発navigationが勝ち、navigation後に受理した新世代`request`だけがnavigationを置換できる。`conclude`は受付時にactivation単位のsingle-owner claimを同期取得し、host副作用前にclaimと最新epochを照合する。同じactivationでhost handoffを開始できるownerは最大1件とし、最新intentのhandoff失敗時だけclaimを解放してrollback済みtransientを再試行可能に戻す。終了開始時に同期的に`closing`へ進め、`isCurrent()`をfalseにして同世代の`conclude`をno-opにする。全command入口で`activationId`を照合し、旧世代由来の終了、抽出完了、監視callbackをno-opにする。

`TransientSurfaceController`は`TransientSurfaceLifecyclePort`を実装する。`application-shell/public.ts`が型だけを公開し、composition rootが具体instanceを次の形で注入する。

```typescript
export interface TransientFeatureRuntimeDependencies {
  readonly transientSurface: TransientSurfaceLifecyclePort;
}

createProductCaptureFeatureContribution({
  transientSurface: lateBoundLifecycle.port,
});
```

具体feature名を知るのはcomposition rootだけであり、shell controllerはproduct-captureを知らない。

### Gesture Registration

```typescript
export type TransientGestureRegistrationError =
  | { readonly kind: "invalid-source" }
  | { readonly kind: "duplicate-source" }
  | { readonly kind: "source-start-failed" }
  | { readonly kind: "not-started" };

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

`register`と`source.start`は同期契約である。登録成功時の戻り値はsource listenerを一度だけ解除するcleanupであり、同じ`id`の二重登録、空ID、不正surface、runtime開始前・停止後、source開始失敗を閉じたerror unionで返す。失敗したsourceをregistryへ残さない。

sourceはChrome eventの未信頼tab IDを`parseTargetTabId`で検証し、正の安全な整数だけを`TargetTabId`へ昇格する。これにより下流adapterはbrandをunsafe castせず、不正・欠損tabをemit前に無視できる。

`emit(tabId)`はsourceのChrome event callback内で同期実行される。concrete registrarはこの呼出しをcanonical gesture ingressへ直結し、その場でactivation IDとsequenceを割り当ててschedulerへenqueueすると同時に`sidePanel.open()`を開始する。`emit`はstore完了を待たず、sourceへstore writer、sequence allocator、panel openerを公開しない。durable put失敗とopen失敗の通知は既存`ActivationFailureSignal`と診断規則へ委譲する。

組み込み`chrome.action`も`TransientGestureSource`として同じregistrarへ登録する。`source-price-refresh`など下流featureが所有するcontext menu adapterは、自身のitem登録・click検証だけを所有し、production worker compositionが公開portへsourceを登録する。cleanupでは全sourceを解除してからregistrarとschedulerを停止し、解除後に到着したcallbackはno-opにする。

### Late-Bound Composition

現行compositionはfeature contributionをregistry/hostより先に生成するため、controller実体をfeature factoryへ直接渡さない。composition rootは既存`ShellNavigator`と同じlate-bound proxyを先に作り、次の順序で循環を解く。

1. 未bind時に`not_started`を返す内部`TransientSurfaceLifecyclePort` proxyを生成する
2. proxyだけを`FeatureCompositionContext`経由で一過性feature contribution factoryへ渡す
3. registryとhost/integrationを構築してから`TransientSurfaceController`を生成する
4. host start前にproxyをcontrollerへbindし、host start成功後にcontrollerをstartする
5. cleanupではcontrollerをstopしてからproxyをunbindし、stale feature callbackを`not_started`へ閉じる

proxyとbind操作はapplication composition内部契約であり、`application-shell/public.ts`へ公開しない。下流featureが利用する値は常に同じ`TransientSurfaceLifecyclePort`参照で、bind前に一過性featureがmountされる経路は作らない。

### Dismiss and Conclude

- `dismiss`: 一過性面をunmountし、記録した常設featureへ戻る
- `selectPersistent`: production navigationの単一commandとして、一過性active / dismiss-failedなら選択targetを保持して終了し、inactiveなら同じtargetを通常選択する
- `retryDismiss`: `dismiss-failed`に保持したtargetとreasonで同じ終了commandを再実行する。production shellのretry操作はこのstateを優先する
- `conclude`: 引き渡し先へのtyped activationをhostの一回のtransitionで実行し、戻り先へは戻らない
- activation失敗時はhostの既存rollbackで一過性面を維持する
- 戻り先が利用不可なら利用可能な常設featureと理由を提示する

## Activation Delivery

### Generic Gesture Ingress

全gesture sourceはregistrarが所有する単一の内部callbackへ収束する。callbackは`surfaceId`と`TargetTabId`だけを受け、source固有payloadをactivation storeへ持ち込まない。組み込みactionと下流context menuは同じ順序で、activation ID生成、受信時sequence割当、`pending` recordのenqueue、同期的なpanel open開始を行う。

registrarはsource IDごとのcleanupを保持するが、activation状態や永続順序を持たない。worker再生成時はsourceを冪等に再登録し、順序の復元は従来どおりsession envelopeとschedulerが担う。別sourceが同じtab・surfaceを起動した場合も新しいsequenceとactivation IDを割り当て、現行世代置換と墓標規則を変えない。

### Store Model

```typescript
export type ActivationStage =
  | "pending"
  | "received"
  | "activated"
  | "invalidated";

export type ActivationSequence = number & {
  readonly __brand: "ActivationSequence";
};

export interface TransientActivationRecord {
  readonly activationId: ActivationId;
  readonly surfaceId: FeatureId;
  readonly tabId: TargetTabId;
  readonly seq: ActivationSequence;
  readonly stage: ActivationStage;
}

export interface TransientInvalidationTombstone {
  readonly tabId: TargetTabId;
  readonly seq: ActivationSequence;
}

export interface TransientActivationEnvelope {
  readonly lastSequence: ActivationSequence;
  readonly record?: TransientActivationRecord;
  readonly tombstones: readonly TransientInvalidationTombstone[];
}

export const MAX_TRANSIENT_TOMBSTONES = 128;

export type ActivationAuthorization =
  | { readonly kind: "authorized"; readonly record: TransientActivationRecord }
  | { readonly kind: "invalidated"; readonly record: TransientActivationRecord };

export interface TransientActivationStore {
  put(record: TransientActivationRecord): Promise<Result<void, ActivationStoreError>>;
  read(): Promise<Result<TransientActivationRecord | undefined, ActivationStoreError>>;
  requestAdvance(
    activationId: ActivationId,
    stage: "received" | "activated",
  ): Promise<Result<void, ActivationStoreError>>;
  invalidate(
    tombstone: TransientInvalidationTombstone,
  ): Promise<Result<void, ActivationStoreError>>;
  authorizeAfterWatchReady(
    activationId: ActivationId,
  ): Promise<Result<ActivationAuthorization, ActivationStoreError>>;
  subscribe(listener: (record: TransientActivationRecord | undefined) => void): () => void;
}
```

媒体は`chrome.storage.session`とし、商品値、URL、生HTMLを保持しない。panelは読み出しと購読だけを行い、変更要求はworkerへ送り、store変更のownerをruntimeへ集約する。

service workerは起動要求とタブ寿命イベントを単一スケジューラへ同期的にenqueueし、受信時点を論理順序の線形化点として単調増加`seq`を割り当てる。スケジューラは永続化mutationを`seq`順に直列適用する。worker再生成時はsession envelope内の最大`seq`から次値を復元してからcommandを適用し、workerメモリだけを順序の根拠にしない。`sidePanel.open()`自体はaction callback内で同期開始し、store完了は待たない。

スケジューラはworker compositionの停止時に`close()`される。`close()`は新しいcommandを拒否したうえで既に受理済みのtailをdrainし、完了後は旧compositionからsessionへ書き込みが残らないことを保証する。cleanupはwatch-ready、gesture source、tab listenerをbest-effortで全解除してからscheduler closeを待ち、個別cleanup例外が後続resourceの解除を妨げない。

`invalidate`は対象recordの有無を問わず、tabごとの最新墓標を保存する。`put`適用時に`墓標.seq > record.seq`ならrecordを`invalidated`として着地させ、後から同条件の墓標が適用された場合も既存recordを`invalidated`へ進める。`invalidated`は終端であり、`requestAdvance`とactivation許可はこれを上書きできない。新しいジェスチャーは既存墓標より大きい`seq`を持つため、同じtabでも新世代として開始できる。

墓標はtabごとに最新1件、envelope全体で最大128件に制限する。剪定はscheduler checkpointで、それ以前の`seq`を持つ全commandがcommit済みであることを確認してからだけ行う。現在recordより新しく、そのrecordがまだ`invalidated`へ着地していない間は支配中の墓標を保持し、それ以外を古い`seq`から除去する。checkpoint後に到着する`put`は必ず剪定対象より大きい`seq`を持つため、古い失効を復活させない。破損envelopeなどで支配墓標を保持したまま上限内へ剪定できなければ、古い墓標を強制evictせず`capacity-exceeded`として新規起動をfail closedにする。この上限と安全条件をstore unit testで固定する。

### Typed Runtime Transport

watch-readyは既存`WorkerRegistrationContext.addActionHandler`を流用しない。これはpayloadを持たず応答を`{ ok: boolean }`へ縮退させるためである。shell/runtime専用adapterが次のversioned messageを所有する。

```typescript
export interface TransientWatchReadyRequest {
  readonly version: 1;
  readonly kind: "transient-watch-ready";
  readonly activationId: ActivationId;
}

export type TransientWatchReadyResponse =
  | {
      readonly version: 1;
      readonly ok: true;
      readonly decision: ActivationAuthorization;
    }
  | {
      readonly version: 1;
      readonly ok: false;
      readonly code:
        | "invalid-message"
        | "store-unavailable"
        | "capacity-exceeded"
        | "not-started";
    };

export interface TransientActivationPort {
  authorizeAfterWatchReady(
    activationId: ActivationId,
  ): Promise<Result<ActivationAuthorization, ActivationTransportError>>;
}
```

panel adapterはrequestを送信し、`unknown` responseを上記unionへ検証してからcontrollerへ返す。worker adapterは既存`classifyCaller`規則で自拡張のpanel文脈だけを受理し、request shapeを検証して同じscheduler上の`authorizeAfterWatchReady`へ渡す。応答は`authorized | invalidated | typed error`を保持し、booleanへ縮退させない。listenerはservice workerのtop-level bootstrapで同期登録し、feature固有worker registrationへ委ねない。

### Monitoring Handoff

監視責務は次の順で移管する。

1. 登録済みgesture sourceがeventを受け、同期`emit`を通じて受信順`seq`を割り当て、起動要求をenqueueし、同じcallback内でpanel openを同期開始する
2. workerのトップレベル`tabs.onUpdated` / `onRemoved` listenerが、recordの有無を問わず後続`seq`の失効墓標をenqueueする
3. panelはrecordを受け取るが、この時点では業務featureをmountしない
4. panelが`TabLifecyclePort.watch`を設置し、watch-readyをworkerへ通知する
5. workerがwatch-readyを同じスケジューラへenqueueし、それ以前に受信した全mutationを適用してからrecordと墓標を最終照合し、activation許可または`invalidated`を返す
6. controllerがfeatureをmountし、成功後にrecordを`activated`へ進める
7. 以後は`ProductionMonitoringIntegration`がpanel監視callbackをcontrollerへ渡し、停止時にwatch cleanupを解除する。controllerはmonitoring resourceを所有しない

worker監視とpanel監視には重複期間を設け、監視の空白を作らない。workerがwatch-readyより前に受信した失効は墓標と最終照合で拒否し、watch設置後の失効はpanel監視でも捕捉する。recordが一時的に`pending`または`received`として観測されても実行可能ではなく、最終許可前にfeatureをmountしない。`invalidated`は終端であり、activation許可後であってもmount成功前の失効通知はcontrollerを撤収させる。

### Store Failure Decision

`sidePanel.open()`はジェスチャー内で同期開始する必要があり、起動recordの非同期書き込み完了を待てない。panelの`read()`が`err`を返した場合は、ジェスチャー起因openかChrome UIからの直接openかを識別せず、「セッション領域が利用不能なため一過性面を開始できない」という再操作可能な理由を共通表示する。

2.7が要求するのは安全に成立しない理由の提示であり、起動契機の識別ではない。媒体障害では起動候補自体を安全に保持できないため、feature固有の失敗ではなくshellの保存領域障害として扱う。

受容する残余リスクは、利用者がChrome UIから直接panelを開いた時点でsession媒体も障害中だった場合、本来は常設表示だけでよい場面にも保存領域障害が表示されることである。誤って一過性面を立てるより安全側であり、復旧案内も同一なので許容する。この判断はshell契約で閉じ、capture移行specへ起動契機判定を要求しない。

起動recordの`put()`が`err`を返した場合は、同じsession媒体へ`write-failed` recordを書こうとしない。workerは`chrome.action`のbadgeを`!`へ、titleを安定した「起動情報を保存できません。拡張アイコンを再操作してください」案内へ設定する`ActivationFailureSignal`を使用する。これはstorageと独立し、追加permissionを要求せず、worker再生成後もChrome管理のaction表示として残る。

signalはglobalなChrome action状態とし、publishとclearを起動mutationと同じschedulerへ載せる。次の起動recordがdurable `put()`に成功した後だけ、badgeを空文字へ戻し、titleを`chrome.runtime.getManifest().action.default_title`または拡張名から解決した通常値へ復元する。panelの`read()`成功、notice表示、side panel open成功、worker再生成はclear条件にしない。clear失敗は起動成功を巻き戻さず安定コードで診断し、次のdurable `put()`成功時に再試行する。

panelの`read()`失敗はglobalな`ShellViewState.error`へ遷移させない。`ready` / `maintenance`に選択中の常設featureと併存できる`transientNotice`を追加し、一過性面だけを開始せずsession媒体障害と再操作案内をbanner表示する。これによりChrome UIからの直接openで障害表示が出る受容リスクは維持しつつ、無関係な常設featureを失わない。

```typescript
export interface TransientNotice {
  readonly message: MessageDescriptor;
  readonly recoverable: true;
}

// application-shell改訂後の差分。loading/errorの意味は変更しない。
type NoticeCapableShellState =
  | { readonly kind: "ready"; readonly selected: FeatureId | null; readonly transientNotice?: TransientNotice }
  | { readonly kind: "maintenance"; readonly selected: FeatureId | null; readonly message: MessageDescriptor; readonly transientNotice?: TransientNotice };
```

`ShellPresentation.publish`はnoticeをnavigation・feature slotと独立したbannerへ渡し、`ShellView`は通常のJSX textとして描画する。session `read()`由来noticeは後続read成功または新しい有効activationの受理でclearするが、Chrome action signalのclear lifecycleとは結合しない。

## Tab Lifecycle

```typescript
export interface TabLifecyclePort {
  watch(
    activationId: ActivationId,
    tabId: TargetTabId,
    onEnded: (
      activationId: ActivationId,
      reason: Extract<TransientDismissReason, "navigated" | "tab-closed">,
    ) => void,
  ): () => void;
}
```

`chrome.tabs.onUpdated`の読み込み開始と`onRemoved`を使用する。URLは参照せず、追加の`tabs` / `webNavigation`権限を要求しない。同一origin遷移でも終了する過剰終了は、失敗操作を残さない安全側の挙動として受け入れる。

## Error Handling

- **記録なし**: Chrome UIから直接開かれた場合は常設表示に留まり通知しない
- **失効済み**: 一過性面を立てず再操作を案内する
- **起動拒否**: 常設表示に留まり安定コードで診断する
- **終了中**: `closing`へ進めて`isCurrent` / `conclude`を無効化し、対象tabへの実行操作を許可しない
- **終了失敗**: 実行操作を隠した`dismiss-failed`として選択targetとreasonを保持する。hostのrecoverable error投影はfeature slotを非表示にしてretry操作を提示し、production compositionはその操作を同じcontroller commandへ戻す
- **引き渡し失敗**: 一過性面を維持し、呼び出しfeatureへ判別可能な失敗を返す
- **store障害**: 商品値やURLをログせず、安定した媒体障害として提示する
- **起動record書き込み失敗**: sessionへ再書き込みせずaction badge/titleで理由と再操作を提示する
- **起動record読み出し失敗**: 常設面を維持した`transientNotice`として提示する
- **墓標容量を安全に剪定不能**: `capacity-exceeded`で起動を拒否し、再操作可能なstore障害として提示する
- **gesture source登録失敗**: `invalid-source | duplicate-source | source-start-failed | not-started`を返し、listenerと登録entryを残さない
- **解除後のgesture callback**: 新しいactivationを生成せずno-opにし、停止済みschedulerへcommandを渡さない

## Requirements Traceability

| Requirement | Components | Verification |
|---|---|---|
| 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 | Registry, composition, host | contract/integration |
| 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7 | Gesture registration/ingress, Store, sequence/tombstone protocol, typed runtime port, failure signal, controller, service worker | contract/runtime integration |
| 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8 | Controller, host, tab adapter | unit/integration |
| 3.9, 3.10 | Controller, activation router | integration |
| 4.1, 4.2, 4.3, 4.4 | ports, in-memory adapters, existing shell fixtures | unit/integration |
| 4.5 | downstream production feature registration | `product-capture-transient-migration`のdurable activation以降のPlaywright E2E + toolbar icon/`activeTab` manual smoke |
| 4.6 | synthetic fixtures | fixture validation |

## Testing Strategy

### Unit

- 判別共用体の常設navigation必須・一過性navigation禁止、`isPersistent`の型絞り込み、未知／欠損presentationとbranch矛盾の不正登録隔離
- controllerの起動、世代更新、3種のdismiss、conclude、stale callback
- tab lifecycle ruleのtabIdフィルタと最大1回通知
- 単調増加`seq`、record不在時の墓標、`invalidated`終端と不正stage遷移拒否
- 墓標がtabごとに最新1件・全体128件以内で、安全checkpoint前の支配墓標を剪定しないこと
- 安全に128件以内へ剪定できない破損状態を`capacity-exceeded`でfail closedにすること
- `parseTargetTabId`の正の安全な整数受理と、欠損・0・負数・小数・非数値拒否
- gesture sourceの正常登録、invalid/duplicate/start failure、cleanup一回性、解除後emitのno-op

### Integration

- panel閉状態・開状態の起動配送
- `put()`保留中の失効が墓標に残り、watch-ready後の最終許可で拒否されること
- runtime messageのsender/request/response検証と`authorized | invalidated | error`保持
- watch-ready前後の遷移・閉鎖で一過性面が立たないこと
- worker再生成後も未完了recordを回収すること
- `put()`失敗がglobal action signalを残し、次のdurable `put()`成功後だけclearされること
- 古いpanelのread/notice完了やworker再生成が後発signalをclearしないこと
- `read()`失敗noticeと常設featureが同時に維持されること
- persistent featureのナビ・選択・availability障害分離の非回帰
- conclude成功で引き渡し先が保持され、失敗で一過性面がrollbackされること
- action sourceとfeature-owned sourceのemitが同じscheduler/store/open経路へ一度だけ入り、別writerや別sequence allocatorを作らないこと
- public consumerが`TransientGestureRegistrationPort`だけでsourceを登録でき、runtime concreteをdeep importしないこと

### Cross-Spec E2E

- 本specはproduction bundleへテスト専用の一過性featureを登録しない
- shell単体ではin-memory registration fixtureによるcontract/runtime integrationまでを所有する
- Chrome 116以降のproduction buildにおけるdurable activation受信以降、対象タブ失効、常設復帰は、最初の実featureを登録する下流`product-capture-transient-migration`の5.5 Playwright E2Eで自動検証する
- browser toolbar iconの実user gestureと`activeTab`付与は同じproduction buildの必須manual smokeで検証し、未実施または失敗時は`MANUAL_VERIFY_REQUIRED`として本spec 4.5を閉じない

## Security Considerations

- 権限は`storage` / `activeTab` / `scripting` / `sidePanel`の4つを維持する
- session storeは`TRUSTED_CONTEXTS`に限定する
- runtime/storage入力は`unknown`として境界検証する
- URL、抽出値、ページ由来文字列を記録・ログしない
- worker bundleをDOM/React非依存に保つ

## Migration Strategy

1. navigation相関を持つ`presentation`判別共用体と`isPersistent`型述語を追加し、既存常設featureへ`presentation: "persistent"`を明示して非回帰を通す
2. ナビと初期選択を常設限定へ変更する
3. controllerとin-memory portsを実装する
4. runtime storeとtab lifecycle adapterを実装する
5. production compositionから隔離したin-memory registration fixtureでshell契約を検証する
6. `TransientSurfaceLifecyclePort`と`TransientGestureRegistrationPort`を`application-shell/public.ts`から提供する
7. 組み込みaction sourceをgeneric registrarへ移し、feature-owned sourceを同じworker ingressへ登録できるcontract fixtureを追加する
8. composition rootから下流feature factoryへ`TransientSurfaceLifecyclePort`を注入できるcontract fixtureを追加する

一過性surfaceへの最初の業務feature適用とicon起動E2Eは`product-capture-transient-migration`、feature-owned context menu sourceの実登録とE2Eは`source-price-refresh`で行う。shell tasksはテスト専用featureをproduction catalogへ追加しない。
