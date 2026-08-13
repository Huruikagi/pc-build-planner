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

## Change Brief: v0.5.0-boundary-reconciliation

### Problem

生成済みspecが`ProductLocalDataAdapter`と`ProductBackupAdapter`の実装まで所有し、`local-data-foundation`と`backup-restore`の最新Change Briefと二重ownerになっている。

### Current State

generic core、Chrome adapter、backup orchestrationの境界に加え、PC固有root/error/交換形式を設定する製品adapterも本specのdesign/tasksへ含まれる。

### Desired Outcome

本specはgeneric local-data core、Chrome/Web Locks adapter、generic backup orchestration、公開port、package検証だけを所有し、製品adapter実装は既存canonical ownerへ委譲する。

### Scope

- **In**: generic storage/lock/transaction/replacement contract、Chrome adapter、generic backup orchestration、公開export、package test、read-only app contract、deep import gate。
- **Out**: PC root/schema/migration/repair/error mapping、`ProductLocalDataAdapter`、製品backup codec/mapping/policy、`ProductBackupAdapter`、製品composition/E2E。

### Boundary Impact

- **Extends**: generic packageとplatform adapterの公開portを製品実装なしで確定する。
- **Preserves**: atomicity、fencing、容量保全、MV3/CSP、package独立検証。
- **Adjacent**: `local-data-foundation`がproduct local-data adapterを、`backup-restore`がproduct backup adapterを単独所有する。

### Dependencies

- **Upstream**: `spec:typed-messages-core`で確定するworkspace運用。
- **Downstream**: `spec:local-data-foundation`、`spec:backup-restore`。

### Source

- v0.5.0 `$kiro-spec-update-batch` final review（2026-08-12）。

## Change Brief: product-runtime-contract-repair

### Problem

`local-data-foundation`の実装者は、製品固有errorと回復controlの意味を保ったままpackage公開factoryへ`ProductLocalDataAdapter`を接続できない。現行factoryはpolicy errorを`CoreError`へ固定し、root内maintenance controlとroot外recovery controlを一つの型とfield解釈へ結合しているため、下流task 11.2が安全に開始できない。

### Current State

generic transaction・replacement・Chrome adapter・backup orchestrationと3つの公開entryは実装済みである。一方、transaction/replacement factoryはconsumer-owned policy errorを保持できず、replacement coreがpersistent controlの`kind`、`owner`、数値lease、pending fieldを直接解釈する。read-only app contractは製品型aliasの接続だけを確認し、実`ProductLocalDataAdapter`を使うruntime composition不整合を検出しなかった。

### Desired Outcome

package公開factoryがconsumer-owned policy errorを明示adapterで出力errorへ意味不変に変換でき、root内maintenance controlとroot外persistent recovery controlを別契約として扱える。replacementはowner-provided protocolを通してfence、pending commit、release、finalization、current anomalyを扱い、製品fieldを解釈しない。下流ownerが実`ProductLocalDataAdapter`を接続するexecutable contractを所有し、上流validationがそのcontractを再現可能に実行する。

### Scope

- **In**: transaction/replacement factoryのconsumer error adapter、root maintenance controlとpersistent recovery controlの型分離、owner-provided recovery protocol、opaque ticketとsingle-write/finalization semanticsの維持、synthetic package contract、公開consumer/declaration更新、下流所有executable product contractを呼ぶvalidation routing。
- **Out**: `FoundationError`やPC control型のpackage所有、`ProductLocalDataAdapter`実装、製品schema・migration・repair、backup交換形式・UI、task 11.2以降の下流runtime composition実装、保存形式や利用者向け挙動の変更。

### Boundary Impact

- **Extends**: generic factoryをconsumer-owned errorとcontrol policyで実構成可能にし、公開契約の接続可能性を実行時contractまで検証する。
- **Preserves**: 3つの公開entry、packageの製品非依存、単一write authority、固定Web Lock、revision・dedupe、atomic replacement、pre/post-commit cleanup、opaque ticket、既存root保持、MV3/CSP、架空package fixture。
- **Adjacent**: `local-data-foundation`が`ProductLocalDataAdapter`と製品executable contractを所有し、`backup-restore`が製品backup adapterとrestore lifecycleを所有する。上流validationはそれらを再実装せず、下流contractを呼び出す。

### Dependencies

- **Upstream**: none。
- **Downstream**: `spec:local-data-foundation` task 11.2以降、`spec:backup-restore`のreplacement/recovery/finalization seam、application-shellのproduction composition。

### Source

- `local-data-foundation` task 11.2の`kiro-debug`結果（2026-08-13）。
