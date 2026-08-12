# Brief: local-data-library-boundaries

## Problem

複数のローカルファーストChrome拡張で安全な永続化とbackupを再利用したい開発者にとって、現在の`src/persistence`はstorage・lock・transaction等の汎用mechanismと、`LocalDataRoot`、`FoundationError`、具体migration、reference repair、maintenance policy、worker command等の製品責務が同じcompositionにある。単純なファイル移動ではPCドメインやChrome APIを漏らした不安定なpackageになる。

## Current State

単一write authority、revision競合、request dedupe、migration、validation、capacity、atomic replacement、maintenance fencing、Chrome storage adapter、in-memory adapter、backup preflight・confirm・commitは実装済みである。しかし`StoragePort`とtransaction runnerは具体root・製品error・repair policyへ結合し、backupの交換形式はPCドメインへ写像される。workspace packageと変更種別別の検証範囲は未確立である。

## Desired Outcome

platform-independentなlocal data core、core portを実装するChrome adapter、coreの公開port上で動くbackup orchestration、PC Build Planner固有policyとcompositionの責務境界とallowed dependenciesが明確になる。安定したmechanismはworkspace境界から単独検証でき、製品変更は必要なapp contractだけを再確認できる。

## Approach

最初にgeneric coreと製品policyの境界を設計し、characterization・contract testで現行挙動を固定する。実装はcore、PC Build Planner consumer、Chrome adapter、backup orchestrationの順に進める。adapterとbackupを別packageにするかsubpathにするかは依存分離の証拠で決め、最初からpackage数を固定しない。

## Scope

- **In**: generic storage・lock port、revision・dedupe・transaction contract、migration・validation hook、capacity/error normalization、atomic root replacement primitive、Chrome storage・Web Locks・quota adapter境界、generic backup envelope・artifact・preflight/confirm/commit・ticket/fence、app adapter、workspace export、単独検証、deep import gate、変更種別別の下流検証。
- **Out**: `LocalDataRoot`の具体schema、PCドメイン操作、具体migration、reference repair policy、製品固有`FoundationError`、worker認可、backup metadata・交換形式の具体内容、backup UI、保存schemaや交換形式の意味変更、npm公開。

## Boundary Candidates

- platform-independentなlocal data core
- Chrome APIとplatform errorを閉じ込めるadapter
- coreの公開portだけを使うbackup orchestration
- PC固有root・policy・error mapping・runtime composition
- package testとapp contract・integration・E2Eの検証境界

## Out of Boundary

- package数を増やすこと自体
- product/candidate/current-buildの業務規則
- Chrome以外のproduction adapter実装
- 2番目のconsumerでのstable API宣言

## Upstream / Downstream

- **Upstream**: v0.4.0の`runtime-schema-validation`、`project-context`、`local-data-foundation`、`backup-restore`境界と、`typed-messages-core`で確立するworkspace運用。
- **Downstream**: `local-data-foundation`の製品composition、Chrome runtime adapter、`backup-restore`、将来の2番目のChrome拡張consumer。

## Existing Spec Touchpoints

- **Extends**: `local-data-foundation`はPC固有root、validator、migration、repair、runtime capabilityを保持し、generic mechanismを本境界へ委譲する。`backup-restore`はPC固有交換形式・UI・project-context lifecycleを保持し、generic orchestrationを委譲する。
- **Adjacent**: `runtime-schema-validation`のcanonical Result/error変換、jitless、owner-local schema規約を維持し、schema vendorをpackage公開契約へ漏らさない。

## Constraints

Manifest V3、Chrome 116+、CSP、10MB容量前提、単一write authority、同一root transaction、atomic replacement、maintenance generation/owner fencing、失敗時の既存データ保持を維持する。packageはPCドメイン型、React、Chrome APIへ意図せず依存しない。`pnpm-workspace.yaml`、`workspace:*`、package単独typecheck/test、topological build、export map、consumer fixtureを再現可能なscriptで検証する。外部公開は行わず、2番目のconsumerでAPIを再評価する。
