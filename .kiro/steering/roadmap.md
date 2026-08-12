# Roadmap

## Overview

v0.5.0では、PC Build Plannerで実証済みのうちドメイン非依存で安定した責務をworkspace packageへ抽出し、公開API、allowed dependencies、独立テスト、変更種別ごとの検証範囲を確立する。package数や外部公開そのものを成果にせず、PCドメイン内だけの変更で安定領域を再確認するコストを減らす。

最初に依存の小さいtyped messages coreでworkspace運用を確立し、その知見をlocal data core、Chrome adapter、backup orchestrationの境界へ適用する。同時に、v1.0.0のUI刷新前に、project lifecycle、共有データ操作error、candidate source、product identityのcanonical ownerを整理する。spec生成順は公開契約の確定を基準にし、実装順は各specのtasksで明示する。

## Approach Decision

- **Chosen**: 責務境界で分ける混合構成。generic package境界は既存の2新規specへ限定し、製品adapter、共有データ操作error、catalog、composition、consumer移行は既存canonical ownerのChange Briefで扱う。配布notice修正だけをDirect Candidateとする。
- **Why**: package specが製品adapterまで所有する重複を解消し、`ui-message-catalog`、`local-data-foundation`、`backup-restore`、`application-shell`など既存ownerの履歴と受け入れ契約を保てる。共有errorは新規core specを増やさず、canonical `Result`と`FoundationError`を持つlocal data foundationの製品domain境界へ置く。
- **Rejected alternatives**: app共有errorだけの新規specは既存`src/domain`と責務が重なるため不採用。横断移行をapplication shellへ集約する案はshellへ業務error・catalog・data policyを漏らすため不採用。core、Chrome adapter、backupを最初から別package specへ分割する案もpackage構成を早期固定しすぎるため不採用。

## Scope

- **In**: typed messages coreのworkspace package化、local data core・Chrome adapter・backup orchestrationと製品policyの境界確立、project lifecycle・共有データ操作error・candidate source・product identityのowner是正、製品adapterとcatalogの単一owner化、application shellの循環回避proxy撤去、全consumerの公開import移行、export mapとdeep import gate、package単独検証、変更種別別の下流検証、runtime依存のライセンスnotice整備。
- **Out**: npmへの外部公開、安定版API宣言、2番目のconsumerの本実装、UIの見た目・layout刷新、保存形式やbackup交換形式の意味変更、商品同一性アルゴリズム変更、価格取得ロジック変更、エラー種類・粒度の再設計。

## Constraints

- v0.4.0のschema、composition、project-context境界を前提にする。
- `pc-build-planner`を最初のconsumerとし、外部公開と安定版APIは2番目のconsumerで再評価する。
- `pnpm-workspace.yaml`へworkspace package pathを登録し、内部依存は`workspace:*`で表現する。
- 各packageを単独でtypecheck・test可能にし、topological buildとapp consumer contractを再現可能なscriptへ置く。
- package内部へのdeep importをexport mapと機械的gateで禁止する。
- Chrome API、React、PCドメイン型、製品カタログをgeneric coreへ漏らさない。
- Manifest V3、CSP、単一write authority、原子的replacement、maintenance fencing、架空fixtureのみという既存契約を維持する。

## Boundary Strategy

- **Why this split**: `typed-messages-core`と`local-data-library-boundaries`はgeneric mechanismと公開portだけを所有する。configured message adapter、product local-data adapter、product backup adapter、physical catalog、production compositionは既存製品ownerへ一本化し、移管元と全consumerをChange Briefで明示する。
- **Shared seams to watch**: package公開型と製品adapter、`FoundationError`と共有`AppDataError`、project lifecycleの意味contractと物理catalog、project-contextとcandidate-management、candidate source ownerとsource-price-refresh、product identityとproduct-capture、application shellのcomposition-only wiring、package testと下流contract/E2E。

## Existing Spec Updates

- [x] typed-messages-core -- generic package APIとread-only consumer fixtureへ責務を限定し、configured app adapterと製品検証のownershipを手放す。 Dependencies: none
- [x] project-context -- project lifecycleの意味・command・stateを引き受け、文言の物理catalog ownershipはui-message-catalogへ委譲する。 Dependencies: none
- [x] local-data-library-boundaries -- generic local-data core、Chrome adapter、backup orchestrationの公開portへ責務を限定し、製品adapter実装を手放す。 Dependencies: spec:typed-messages-core
- [x] ui-message-catalog -- configured app message adapterと全ja/en物理catalogを単独所有し、project lifecycle messageを統合する。 Dependencies: spec:typed-messages-core, spec:project-context
- [x] local-data-foundation -- generic永続化primitiveをpackageへ委譲し、PC固有root・product adapter・共有AppDataErrorをcanonical ownerとして保持する。 Dependencies: spec:local-data-library-boundaries
- [x] project-candidate-management -- project lifecycle、共有error、candidate source、product identityの所有を手放し、candidate管理へ責務を限定する。 Dependencies: spec:project-context, spec:local-data-foundation
- [x] current-build-management -- candidate-owned ManagementError importを共有AppDataErrorへ移し、既存のcurrent project追従と構成管理を維持する。 Dependencies: spec:local-data-foundation
- [x] compatibility-checking -- candidate-owned ManagementError importを共有AppDataErrorへ移し、read-only評価境界を維持する。 Dependencies: spec:local-data-foundation, spec:current-build-management
- [x] candidate-source-bookmarks -- source catalog・URL identity・照合・変異を独立共有coreへ集約し、循環依存を解消する。 Dependencies: spec:project-candidate-management, spec:local-data-foundation
- [x] source-price-refresh -- source照合とcandidate-owned errorの所有を手放し、明示操作による価格取得と更新workflowへ責務を限定する。 Dependencies: spec:candidate-source-bookmarks, spec:local-data-foundation
- [x] duplicate-product-merge -- 商品同一性normalizerを共有coreとして所有し、source ownerを利用してproduct-captureへの不要な依存を解消する。 Dependencies: spec:candidate-source-bookmarks
- [x] product-page-capture -- 商品同一性normalizerの公開ownershipを手放し、取得・manufacturer補完・candidate handoffへ責務を限定する。 Dependencies: spec:duplicate-product-merge
- [x] backup-restore -- product backup adapterを単独所有し、generic orchestrationをcoreの公開port上へ委譲する。 Dependencies: spec:local-data-library-boundaries, spec:local-data-foundation, spec:project-context
- [x] application-shell -- owner確定後の公開portだけをcompositionし、project・source・identityの遅延proxyと旧wiringを撤去する。 Dependencies: spec:ui-message-catalog, spec:project-context, spec:project-candidate-management, spec:current-build-management, spec:compatibility-checking, spec:candidate-source-bookmarks, spec:source-price-refresh, spec:duplicate-product-merge, spec:product-page-capture, spec:backup-restore

## Direct Implementation Candidates

- [ ] runtime-license-notices -- runtime bundleへ含まれる既存依存のMIT notice補完は公開契約や利用者挙動を変えないためdirect implementationとする
  - Source: v0.5.0 Approach A viability check（2026-08-12）
  - Scope: `THIRD_PARTY_NOTICES.txt`へReact、React DOM、schedulerのlicense noticeを追加し、runtime依存一覧に対するnotice検証gateを更新する
  - Preserves: runtime bundle、依存version、MV3/CSP、アプリの挙動、Zod notice
  - Dependencies: none
  - Validation: `pnpm build`, `pnpm validate:artifacts`, `pnpm validate:final-build`, notice検証のpositive/negative test

## Specs (dependency order)

- [x] typed-messages-core -- React・Chrome・製品カタログ非依存の型安全なmessage coreとworkspace運用を確立する。 Dependencies: none
- [x] local-data-library-boundaries -- local data core、Chrome adapter、backup orchestration、製品policyの依存方向と抽出waveを確立する。 Dependencies: implementation:typed-messages-core

## Implementation Validation History

| Work Item | Type | Result | Validated at | Commit | Evidence |
|---|---|---|---|---|---|
