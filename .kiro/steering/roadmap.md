# Roadmap

## Overview

Milestone [v0.4.0](https://github.com/Huruikagi/pc-build-planner/milestone/4) は、v0.3.0 の実利用で見えた課題を反映し、現在の構成検討を画面間で一貫させ、取得元情報の識別性と未信頼入力・保存境界の堅牢性を高めるリリースとする。主要な操作要件をこのリリースで実利用により固め、v1.0.0 の UI 全面刷新へ引き渡す。

実装は、共通プロジェクト選択と実行時スキーマ検証だけを新しい責務境界として切り出し、商品取得、永続化、バックアップ、現在構成、互換性、メッセージカタログの意味は既存 owner に残す。これにより、Milestone 全体を一つの巨大な仕様へまとめず、既存の feature-first / vertical slice と公開 API 規約を維持する。

## Approach Decision

- **Chosen**: 境界維持型の混合ロードマップ。新規 spec は `runtime-schema-validation` と `project-context` の2件に限定し、既存境界に属する変更は既存 spec 更新、振る舞いや契約を変えない変更は直接実装として管理する。
- **Why**: #29 と #30 は複数 feature が共有する新しい責務と移行規約を必要とする一方、#21〜#25 と #28 は既存 owner が明確である。新規境界を必要最小限に抑えることで、独立実装・レビュー・回帰検証が可能になる。
- **Rejected alternatives**: v0.4.0 の8 Issue を一つの統合 spec にする案は責務混在と20件超のタスク化が見込まれるため不採用。`project-context` だけを新規化して Zod 移行を既存 spec へ分散する案は、共通 primitive、エラー変換、CSP gate、移行順の重複と追跡漏れを招くため不採用。

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
- 日本語・英語 UI、キーボード操作、読み上げ可能なラベル、架空 fixture のみを使う検証規約を維持する。

## Boundary Strategy

- **Why this split**: `runtime-schema-validation` は信頼境界で共通利用する primitive、エラー変換、導入 gate、段階移行規約を所有する。`project-context` は利用者の現在作業対象という横断状態と切替契約を所有する。個々の業務 schema、project CRUD、候補・構成・互換性の意味は既存 feature に残す。
- **Shared seams to watch**: Zod Mini の schema を feature 間で直接 deep import しないこと、application shell を project 業務状態の owner にしないこと、project 削除・復元後の選択修復を domain root の参照整合性と混同しないこと、商品ページの metadata 採否を candidate source 保存側へ漏らさないこと、schema version の canonical owner を backup feature へ移さないこと。

## Existing Spec Updates

- [ ] product-page-capture -- #21 の `siteName` 抽出・検証・handoff と、#23 の型付き metadata allowlist を既存の汎用抽出境界へ追加する。Dependencies: runtime-schema-validation, direct candidate `schema-dts-type-support`
- [ ] local-data-foundation -- #24 の canonical schema version 一元化、未知 version 拒否、破損 canonical root からの明示的回復を可能にする安全な置換契約を追加する。Dependencies: runtime-schema-validation
- [ ] backup-restore -- foundation の回復契約を利用し、破損 root を暗黙更新せず正常 backup から回復できる production E2E を追加する。Dependencies: local-data-foundation update
- [ ] application-shell -- 共通 project selector の常設表示、project-context の composition と consumer への注入を追加し、project CRUD や選択規則の意味は所有しない。Dependencies: project-context
- [ ] project-candidate-management -- project CRUD、取り込み handoff、未保存編集を project-context の現在選択と同期し、切替時に入力を黙って破棄しない。Dependencies: project-context
- [ ] current-build-management -- project-context を唯一の選択元として利用し、#28 のカテゴリ別選択パーツ・数量・未選択要約を表示する。Dependencies: project-context
- [ ] compatibility-checking -- 独自の project 選択や一覧先頭 fallback を廃止し、project-context の現在選択へ追従する。Dependencies: project-context

## Direct Implementation Candidates

- [ ] schema-dts-type-support -- #22。`schema-dts` を devDependency / type-only で導入し、JSON-LD extractor と synthetic fixture の編集時型支援だけを追加する。利用者挙動、runtime validation、公開契約を変えないため直接実装とする。
- [ ] user-facing-parts-terminology -- #25。内部の `Candidate` モデルを維持したまま、typed message catalog と関連する DOM/E2E 期待値の利用者向け「候補」を文脈に応じて「パーツ」へ変更する。新しい業務規則や責務境界を作らないため直接実装とする。

## Specs (dependency order)

- [ ] runtime-schema-validation -- Zod Mini の CSP/build gate、共通 primitive・エラー変換、feature-owned schema の公開規約、優先信頼境界の段階移行を定義する。Dependencies: none
- [ ] project-context -- 現在選択中 project の単一状態、永続復元、無効参照回復、切替 guard、共通 selector と feature consumer port を定義する。Dependencies: runtime-schema-validation

## Implementation Validation History

| Feature | Result | Validated at | Commit | Evidence |
|---|---|---|---|---|
