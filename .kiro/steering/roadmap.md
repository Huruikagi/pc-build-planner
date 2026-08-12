# Roadmap

## Overview

v0.5.0では、PC Build Plannerで実証済みのうちドメイン非依存で安定した責務をworkspace packageへ抽出し、公開API、allowed dependencies、独立テスト、変更種別ごとの検証範囲を確立する。package数や外部公開そのものを成果にせず、PCドメイン内だけの変更で安定領域を再確認するコストを減らす。

最初に依存の小さいtyped messages coreでworkspace運用を確立し、その知見をlocal data core、Chrome adapter、backup orchestrationの境界へ適用する。同時に、v1.0.0のUI刷新前に、project lifecycle、共有エラー、candidate source、product identityのcanonical ownerを整理する。

## Approach Decision

- **Chosen**: 責務境界で分ける混合構成。新規package境界は2つの新規specで扱い、既存機能の所有権変更はChange Brief、配布notice修正はDirect Candidateとして扱う。
- **Why**: 新しい再利用境界だけを新規specにし、既存specの履歴と受け入れ契約を保ちながらowner移動を明示できる。#20をpackage数で先に分割せず、設計と実装のdependency waveで段階化できる。
- **Rejected alternatives**: core、Chrome adapter、backupを最初から別specへ分割する案はpackage構成を早期固定しすぎるため不採用。#44〜#47をDirectへ寄せる案は公開契約とcanonical ownerの変更をspec外へ隠すため不採用。

## Scope

- **In**: typed messages coreのworkspace package化、local data core・Chrome adapter・backup orchestrationと製品policyの境界確立、project lifecycle・共有データ操作エラー・candidate source・product identityのowner是正、export mapとdeep import gate、package単独検証、変更種別別の下流検証、runtime依存のライセンスnotice整備。
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

- **Why this split**: `typed-messages-core`は純粋で依存が小さくworkspace運用の先行実証に適する。`local-data-library-boundaries`はデータ保全リスクが高いため、generic mechanismと製品policyを一つの設計で比較しつつcore、app consumer、Chrome adapter、backupの順に実装する。既存ownerの移動は元specのChange Briefとして履歴を保つ。
- **Shared seams to watch**: package公開型とapp adapter、`FoundationError`とapp共有エラー、project-contextとcandidate-management、candidate source ownerとsource-price-refresh、product identityとproduct-capture、package testと下流contract/E2E。

## Existing Spec Updates

- [ ] ui-message-catalog -- 製品カタログとconfigured resolverを残し、typed messageの汎用mechanismをpackageへ委譲する。 Dependencies: spec:typed-messages-core
- [ ] project-context -- projectの作成・改名・削除と関連message namespaceをcanonical ownerとして引き受ける。 Dependencies: none
- [ ] project-candidate-management -- project lifecycleと共有`ManagementError`の所有を手放し、candidate管理へ責務を限定する。 Dependencies: spec:project-context
- [ ] candidate-source-bookmarks -- source catalog・URL identity・照合・変異を独立共有coreへ集約し、循環依存を解消する。 Dependencies: implementation:project-candidate-management
- [ ] source-price-refresh -- source照合の所有を手放し、明示操作による価格取得と更新workflowへ責務を限定する。 Dependencies: spec:candidate-source-bookmarks
- [ ] duplicate-product-merge -- 商品同一性normalizerを共有coreへ移し、product-captureへの不要な依存を解消する。 Dependencies: implementation:candidate-source-bookmarks
- [ ] local-data-foundation -- generic永続化primitiveをpackageへ委譲し、PC固有root・policy・compositionを保持する。 Dependencies: spec:local-data-library-boundaries, implementation:typed-messages-core
- [ ] backup-restore -- generic backup orchestrationをcoreの公開port上へ委譲し、PC固有交換形式・UI・context lifecycleを保持する。 Dependencies: spec:local-data-library-boundaries, spec:local-data-foundation

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
