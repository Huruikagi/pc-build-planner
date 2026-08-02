# Roadmap

## Overview

Milestone [v0.4.0](https://github.com/Huruikagi/pc-build-planner/milestone/4) は、v0.3.0 の実利用で見えた課題を反映し、現在の構成検討を画面間で一貫させ、取得元情報の識別性と未信頼入力・保存境界の堅牢性を高めるリリースとする。主要な操作要件をこのリリースで実利用により固め、v1.0.0 の UI 全面刷新へ引き渡す。

実装は、共通プロジェクト選択と実行時スキーマ検証だけを新しい責務境界として切り出し、商品取得、永続化、バックアップ、現在構成、互換性、メッセージカタログの意味は既存 owner に残す。これにより、Milestone 全体を一つの巨大な仕様へまとめず、既存の feature-first / vertical slice と公開 API 規約を維持する。

## Approach Decision

- **Chosen**: core-only の新規境界と owner-local integration を組み合わせる境界維持型ロードマップ。新規 spec は `runtime-schema-validation` と `project-context` の2件に限定し、`project-context` は contract、catalog projection、UI preference、選択 transaction、guard protocol、共通 selector と公開境界 gate だけを所有する。各 feature の adapter、snapshot、CRUD・restore hook、handoff、production composition は既存 spec 更新として管理する。
- **Why**: #29 と #30 は複数 feature が共有する新しい責務と移行規約を必要とする一方、application shell、候補管理、現在構成、互換性、backup、handoff の実装 owner は既に確立している。新規 core を feature 内部へ侵入させず、既存 owner が自分の state と統合を変更することで、単一ファイル所有、段階移行、独立レビューを維持できる。
- **Rejected alternatives**: v0.4.0 の8 Issue を一つの統合 spec にする案は責務混在と20件超のタスク化が見込まれるため不採用。feature 間 adapter を所有する横断 integration spec を追加する案は feature-first と共有ファイルの単一所有を崩すため不採用。`selectedProjectId` を runtime schema 同等性検証と同時に全 snapshot から削除する案は既存 shape 契約を壊すため不採用。Zod 移行を既存 spec へ分散する案も、共通 primitive、エラー変換、CSP gate、移行順の重複と追跡漏れを招くため不採用。

## Scope

- **In**: Zod Mini による実行時スキーマ基盤と段階移行（#30）、共通の現在選択プロジェクト（#29）、現在構成の選択パーツ要約表示（#28）、商品取り込み時のサイト名取得（#21）、JSON-LD 型支援（#22）、型付きメタデータ allowlist（#23）、schema version 一元化と破損データ回復 E2E（#24）、利用者向け「候補」表記の「パーツ」への変更（#25）。
- **Out**: v1.0.0 の UI 全面刷新、独立したプロジェクト管理画面、多数プロジェクトの検索・並べ替え・アーカイブ、複数プロジェクトの同時表示、保存 schema や backup format の意味変更、サイト固有抽出、バックグラウンド監視、UI フォームライブラリ導入。

## Constraints

- PC 版 Chrome 116 以降の Manifest V3、extension pages CSP、既存の最小権限を維持する。
- 実行時依存は Zod Mini を前提とし、全 schema 生成前に単一の canonical import 入口で `jitless` を設定する。最初の実装項目として production bundle を生成し、`new Function` を含む既存の静的生成物 gate を通過できることを実証する。通過できない場合は schema 移行を開始せず、実装方針を再審査する。
- `schema-dts` は devDependency かつ type-only import とし、production bundle へ含めない。
- TypeScript 7 strict、ESM、Node.js 26、pnpm 11、esbuild、React 19、Node test runner、Playwright の既存基盤へ載せる。
- ページ、runtime message、JSON、storage の値は `unknown` として受け取り、境界検証後にだけドメイン型へ変換する。Zod の標準エラーを外部契約として公開しない。
- canonical `Result<T, E>`、既存エラーコード、canonical path、未知キー拒否、危険 payload 拒否、参照整合性、原子的置換を維持する。
- runtime schema の snapshot 同等性検証中は既存 version と shape を維持する。既存 `selectedProjectId` は owner-local 更新で現在 context との一致を検査する非権威的 metadata としてのみ扱い、選択 authority や fallback に使用しない。field 削除は別の versioned migration とする。
- `project-context` の UI preference は canonical root と分離した専用 key に限定し、直接 storage 利用を許す場合は公開境界 gate の厳密な key-scoped allowlist と negative test を同じ変更で追加する。
- Zod Mini の導入 gate は文字列上の `new Function` だけに依存せず、alias 経由を含む動的 Function 呼出しを production で検出・阻止する証拠を持つ。配布物には runtime dependency の必要なライセンス notice を含める。
- 日本語・英語 UI、キーボード操作、読み上げ可能なラベル、架空 fixture のみを使う検証規約を維持する。

## Boundary Strategy

- **Why this split**: `runtime-schema-validation` は信頼境界で共通利用する primitive、エラー変換、導入 gate、段階移行規約を所有する。`project-context` は利用者の現在作業対象という横断状態、選択・再検証 transaction、guard protocol、selector presentation を所有する。application shell は singleton composition と slot、各 feature は自分の consumer adapter・snapshot・draft・lifecycle hook、foundation は canonical data の整合性だけを所有する。
- **Shared seams to watch**: 実装順は runtime schema 同等性、project-context core、owner-local adapter、application-shell production wiring、legacy selector/fallback 撤去の順とする。Zod Mini の schema を feature 間で deep import しない。`selectedProjectId` を context authority に戻さない。project 削除・復元後の UI 選択修復を domain root の参照整合性と混同しない。handoff の保存先は candidate owner が検証済み current context だけから解決し、product-capture や一覧先頭が決めない。context が unavailable でも settings と backup recovery の起動を妨げない。商品ページの metadata 採否を candidate source 保存側へ漏らさず、schema version の canonical owner を backup feature へ移さない。

## Existing Spec Updates

- [ ] product-page-capture -- #21 の `siteName` 抽出・検証・handoff と、#23 の型付き metadata allowlist を既存の汎用抽出境界へ追加する。Dependencies: runtime-schema-validation, direct candidate `schema-dts-type-support`
- [ ] local-data-foundation -- #24 の canonical schema version 一元化、未知 version 拒否、破損 canonical root からの明示的回復を可能にする安全な置換契約を追加する。Dependencies: runtime-schema-validation
- [ ] project-candidate-management -- context consumer adapter、CRUD 前後の guard・refresh、候補 draft 保持、handoff の current-project 解決、snapshot の非権威的 legacy ID 扱いを owner 内で実装する。Dependencies: project-context
- [ ] current-build-management -- context consumer adapter、数量 draft guard、snapshot の非権威的 legacy ID 扱いと独自選択撤去を owner 内で実装し、#28 のカテゴリ別選択パーツ・数量・未選択要約を表示する。Dependencies: project-context
- [ ] compatibility-checking -- owner 内の one-shot/list-first project 解決を context 購読へ置換し、null・unavailable・stale 評価を扱う。Dependencies: project-context, current-build-management update
- [ ] backup-restore -- foundation の回復契約を利用する破損 root 回復に加え、restore 前 guard、commit 成功後の context refresh、refresh 失敗の回復表示を owner 内で実装し、context unavailable でも設定から復元可能にする。Dependencies: local-data-foundation update, project-context
- [ ] product-capture-transient-migration -- project 未解決 handoff intent と失敗時 retry/rollback を保持し、保存先解決を candidate owner の検証済み current context に委ねる。Dependencies: project-context, project-candidate-management update
- [ ] application-shell -- project-context singleton と selector slot を composition し、owner-local contribution へ能力別 port を注入する。共有 shell/runtime ファイルの唯一 owner とし、context unavailable でも settings・backup recovery を起動する。Dependencies: project-context, project-candidate-management update, current-build-management update, compatibility-checking update, backup-restore update, product-capture-transient-migration update

## Direct Implementation Candidates

- [ ] schema-dts-type-support -- #22。`schema-dts` を devDependency / type-only で導入し、JSON-LD extractor と synthetic fixture の編集時型支援だけを追加する。利用者挙動、runtime validation、公開契約を変えないため直接実装とする。
- [ ] user-facing-parts-terminology -- #25。内部の `Candidate` モデルを維持したまま、typed message catalog と関連する DOM/E2E 期待値の利用者向け「候補」を文脈に応じて「パーツ」へ変更する。新しい業務規則や責務境界を作らないため直接実装とする。

## Specs (dependency order)

- [x] runtime-schema-validation -- Zod Mini の CSP/build gate、共通 primitive・エラー変換、feature-owned schema の公開規約、優先信頼境界の段階移行を定義する。Dependencies: none
- [x] project-context -- 現在選択中 project の core contract、catalog projection、UI preference、選択・再検証 transaction、切替 guard protocol、共通 selector、公開境界 gate を定義し、feature 内 adapter と shell wiring は所有しない。Dependencies: runtime-schema-validation

## Implementation Validation History

| Feature | Result | Validated at | Commit | Evidence |
|---|---|---|---|---|
