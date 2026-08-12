# Brief: application-shell

## Problem

PC build plannerの各feature specが `src/runtime/side-panel.ts`、`src/index.ts`、`side-panel.html` を直接変更対象としており、共有統合面の所有権が分散している。このままではspec単位の独立実装・検証が難しく、機能追加時の競合と依存方向の逆転が発生する。

## Current State

候補管理、商品取り込み、現在構成、互換性確認、バックアップ・復元が、それぞれside panelへの組立とroot公開APIの変更を計画している。feature registration契約、composition rootの所有者、復元中の共通maintenance表示・操作抑止が定義されていない。

## Desired Outcome

application shellだけが共有runtime入口、ナビゲーション、公開API composition、共通maintenance UIを所有する。各featureは安定したregistration portを実装し、自身のfeature配下の登録モジュールと公開契約だけを変更してshellへ参加できる。

## Approach

薄いside panel hostとfeature registryを導入し、各featureから登録記述、view mount、利用可能状態を受け取ってcomposition rootで組み立てる。root public APIはfeature単位の `public.ts` をshellが合成し、各featureによる `src/index.ts` の直接編集を禁止する。復元中のmaintenance状態はfoundationの世代付きlease/write authorityから通知を受け、shell全体でmutation操作を抑止する。

ライブラリは実装開始時点の最新stable majorを採用し、旧major互換やmigrationは行わない。

## Scope

- **In**: side panel host、ナビゲーション、feature registration port、composition root、root public API組立、共有loading/error/maintenance表示、mutation操作の共通抑止、runtime統合テスト。
- **Out**: feature固有の業務ロジック、feature固有state/view、Repository実装、復元処理、ページDOM抽出、互換性判定、候補・構成データの保存。

## Boundary Candidates

- `ApplicationFeatureRegistration`: feature id、明示的な常設／一過性区分、常設だけに必須のnavigation metadata、mount/unmount、利用可能状態、typed activationを受け渡す判別共用体port。
- `ApplicationCompositionRoot`: foundationとfeature公開契約を一度だけ組み立てるruntime入口。
- `MaintenancePresentationPort`: foundationが所有するmaintenance stateをshell表示と操作可否へ写像するread-only port。
- `PublicApiRegistry`: featureごとの `public.ts` をroot exportへ合成し、root barrelの所有を一元化する。

## Out of Boundary

- maintenance leaseの取得、世代管理、owner fencing、commit直前検証はfoundationが所有する。
- 各featureの保存可否判断とdomain error mappingは各featureが所有する。
- service worker内の抽出調停やFile APIによるbackup入出力は該当featureが所有する。

## Upstream / Downstream

- **Upstream**: `local-data-foundation` の公開契約、write authority、maintenance状態通知。
- **Downstream**: `project-candidate-management`、`product-page-capture`、`current-build-management`、`compatibility-checking`、`backup-restore` のregistration module。

## Existing Spec Touchpoints

- **Extends**: 新規境界のため既存specを直接拡張しない。既存6specは共有入口の直接変更をregistration利用へ更新する。
- **Adjacent**: `local-data-foundation` のruntime adapterとwrite authority、`product-page-capture` のservice worker/action入口、`backup-restore` のmaintenance lifecycle。

## Constraints

- Chrome 116以降のManifest V3とproduction bundleへ同梱するReact 19系/React DOM/CSSを対象とする。
- `sidePanel.open()` はユーザージェスチャー要件を維持する。
- shellはStorage APIやRepositoryを直接操作せず、公開portだけを利用する。
- maintenance排他をprocess-local memoryだけに依存させない。
- 共有表示を含め、ページ由来文字列を実行可能なmarkupとして扱わない。
- ライブラリは実装開始時点の最新stable majorを使用し、対象Node/Chromeとの互換性を検証する。

## Change Brief: v0.4.0

### Problem

主要featureがそれぞれproject選択UIを持つため、利用者は画面を移動するたびに現在の作業対象を確認・選択し直す必要がある。現在選択中projectを常に識別できる共通面と、各featureへ安全に配布するcompositionがない。また、canonical dataが破損して通常起動できない状態で、通常mutationを閉じたまま明示的な回復操作だけを許可する共通gate契約がない。

### Current State

application shellはside panel host、常設navigation、feature registration、typed activation、共通状態表示と共有runtime入口を所有するが、現在projectの表示slot、project-context singleton、能力別consumer port注入は提供していない。既存の操作可否契約は通常mutationと回復操作を区別せず、破損時の`recovery-required`状態を安全に投影できない。projectの意味とCRUDは候補管理が所有し、各consumer adapterはそれぞれのfeature ownerへ残す必要がある。

### Desired Outcome

side panelの主要画面から現在projectを常に識別でき、project-contextが提供する共通selector contributionから切り替えられる。shellはproject-contextを一度だけcompositionし、selector用slotへ配置し、各owner-local contributionへ必要最小限のportを注入する。canonical dataが回復を必要とする場合は`recovery-required`状態を表示し、通常mutationを拒否したまま、回復として分類された操作だけを利用可能にする。contextが利用不能でもshell自体とsettings・backup recoveryは起動を継続し、project依存featureだけが識別可能な利用不能状態になる。

### Scope

- **In**: `OperationKind`の`recovery`分類、`recovery-required`状態の共通projection、通常mutationを拒否し回復操作だけを許可するgate契約、常設selector slot、project-context singletonのproduction compositionと停止、project-contextのcomposition専用presentation adapter配置、candidate・current-build・compatibility・backupのowner-local contributionへの能力別port注入、context unavailable時のsettings・backup到達維持、共有shell/runtime integration test。
- **Out**: recovery判定元となるcanonical dataの評価、assessment ticket、復元のpreflight・確認・commit、backup sectionのfeature lifecycle、selector component・文言・選択状態の実装、project CRUD・fallback・guard判断、feature consumer adapter、feature snapshot、候補・構成・互換性データの解釈、feature-owned draftの保存・破棄、各feature内部test・E2E。

### Boundary Impact

- **Extends**: `application-shell`の操作分類・共通gate・`recovery-required` projection、常設selector slot、composition root、feature contribution context、共有runtime wiring、起動時障害分離。
- **Preserves**: shellはcanonical dataの正常性、feature固有業務データ、project selection、guard結果、restore結果を解釈せず、上流の評価済み状態を操作可否と共通表示へ投影し、共有runtime入口・slot・mount/unmountだけを所有する原則。
- **Adjacent**: `local-data-foundation`がcanonical dataの評価と回復用置換契約を、`backup-restore`がassessment ticketを利用したpreflight・確認・commitとsection lifecycleを、`project-context`がselector presentationと選択transactionを、各featureがconsumer adapter・snapshot・guard・lifecycleを所有する。shellはfeature内部をdeep importせず、確定した公開contribution signatureだけを接続する。

### Dependencies

- **Upstream**: recovery contract gateは`local-data-foundation` updateの評価済み状態契約。production wiringは`project-context`、`project-candidate-management` update、`current-build-management` update、`compatibility-checking` update、`backup-restore` update、`product-capture-transient-migration` updateの確定した公開contribution。
- **Downstream**: `backup-restore` updateの回復操作面、共通選択・restore・handoffを含むproduction composition、横断E2E、release validation。

### Source

- Milestone v0.4.0 roadmap `application-shell recovery contract gate`・`application-shell production wiring` updates、GitHub Issues #24・#29。

## Change Brief: v0.5.0-boundary-reconciliation

### Problem

project lifecycle、candidate source、product identityのowner移動後に、現行の遅延proxyと旧公開portを撤去してproduction wiringを完結するownerがroadmapにない。

### Current State

shellはproject catalog source、late-bound project command/guard、manufacturer domain、source refreshを複数のdeferred proxyで接続し、旧owner間の構築循環を吸収している。

### Desired Outcome

shellは確定した各`public.ts`/`feature-contribution.ts`だけをcompositionし、owner移動で不要になったproject/source/identityのproxyと旧wiringを撤去する。業務error、catalog、data policyは解釈しない。

### Scope

- **In**: production composition、obsolete proxy撤去、公開port注入、worker/side-panel wiring、composition/public-boundary test、横断E2E接続。
- **Out**: project/source/identity/error/catalogの意味・実装、feature UI/state、data mutation、package core。

### Boundary Impact

- **Extends**: v0.5.0 owner移管後のcomposition-only migrationを追加する。
- **Preserves**: shellのslot/runtime/registration ownership、feature isolation、deep import禁止、recovery表示。
- **Adjacent**: 各owner specが実装とcontractを持ち、shellは具体ownerの公開contributionだけを接続する。

### Dependencies

- **Upstream**: `spec:ui-message-catalog`、`spec:project-context`、`spec:project-candidate-management`、`spec:current-build-management`、`spec:compatibility-checking`、`spec:candidate-source-bookmarks`、`spec:source-price-refresh`、`spec:duplicate-product-merge`、`spec:product-page-capture`、`spec:backup-restore`。
- **Downstream**: v0.5.0横断E2E、release validation。

### Source

- v0.5.0 `$kiro-spec-update-batch` final review（2026-08-12）。
