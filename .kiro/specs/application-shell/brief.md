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

主要featureがそれぞれproject選択UIを持つため、利用者は画面を移動するたびに現在の作業対象を確認・選択し直す必要がある。現在選択中projectを常に識別できる共通面と、各featureへ安全に配布するcompositionがない。

### Current State

application shellはside panel host、常設navigation、feature registration、typed activation、共通状態表示を所有するが、現在projectの表示・切替面やproject-contextのcompositionは提供していない。projectの意味とCRUDは候補管理が所有している。

### Desired Outcome

side panelの主要画面から現在projectを常に識別でき、共通selectorから切り替えられる。shellはproject-contextを一度だけcompositionし、公開portとして各consumerへ注入するが、project CRUD、選択fallback、未保存draftの意味は所有しない。

### Scope

- **In**: 常設の現在project表示・selector host、project-contextのproduction composition、consumer port注入、初期loading・0件・無効選択・切替中の共通表示、日英messageとキーボード・読み上げ対応、feature障害分離とmount lifecycle検証。
- **Out**: project CRUD、選択状態のcanonical owner、候補・構成・互換性データの解釈、独立project管理画面、検索・並べ替え、feature-owned draftの保存・破棄判断。

### Boundary Impact

- **Extends**: `application-shell`の常設共通面、composition root、feature context注入、共通error/loading表示。
- **Preserves**: shellはfeature固有業務データを解釈せず、共有runtime入口とmount/unmountだけを所有する原則。
- **Adjacent**: `project-context`が現在選択とfallbackを所有し、`project-candidate-management`がCRUDとdraft guardを所有する。

### Dependencies

- **Upstream**: `project-context`。
- **Downstream**: `project-candidate-management`、`current-build-management`、`compatibility-checking`の共通選択追従。

### Source

- Milestone v0.4.0 roadmap `application-shell` update、GitHub Issue #29。
