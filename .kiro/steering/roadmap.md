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

- [x] product-page-capture -- #21 の `siteName` 抽出・検証・handoff と、#23 の型付き metadata allowlist を既存の汎用抽出境界へ追加する。Dependencies: runtime-schema-validation, direct candidate `schema-dts-type-support`
- [x] local-data-foundation -- #24 の canonical schema version 一元化、未知 version 拒否、破損 canonical root からの明示的回復を可能にする安全な置換契約を追加する。Dependencies: runtime-schema-validation
- [x] project-candidate-management -- context consumer adapter、CRUD 前後の guard・refresh、候補 draft 保持、handoff の current-project 解決、snapshot の非権威的 legacy ID 扱いを owner 内で実装する。Dependencies: project-context
- [x] current-build-management -- context consumer adapter、数量 draft guard、snapshot の非権威的 legacy ID 扱いと独自選択撤去を owner 内で実装し、#28 のカテゴリ別選択パーツ・数量・未選択要約を表示する。Dependencies: project-context
- [x] compatibility-checking -- owner 内の one-shot/list-first project 解決を context 購読へ置換し、null・unavailable・stale 評価を扱う。Dependencies: project-context, current-build-management update
- [x] application-shell recovery contract gate -- `OperationKind`の`recovery`分類、`recovery-required` projection、通常mutationを拒否するgate契約だけを先行提供する。production feature wiringは行わない。Dependencies: local-data-foundation update
- [x] backup-restore -- foundation のassessment ticket付き回復契約を利用する破損 root 回復に加え、restore 前 guard、commit 成功後の context refresh、refresh 失敗の回復表示を owner 内で実装し、context unavailable でも設定から復元可能にする。Dependencies: runtime-schema-validation, local-data-foundation update, project-context, application-shell recovery contract gate
- [x] product-capture-transient-migration -- project 未解決 handoff intent と失敗時 retry/rollback を保持し、保存先解決を candidate owner の検証済み current context に委ねる。Dependencies: project-context, project-candidate-management update
- [x] application-shell production wiring -- project-context singleton と selector slot を composition し、owner-local contribution へ能力別 port を注入する。先行済みrecovery contract gateへbackup sectionを接続する共有 shell/runtime ファイルの唯一 owner とし、context unavailable でも settings・backup recovery を起動する。Dependencies: project-context, project-candidate-management update, current-build-management update, compatibility-checking update, backup-restore update, product-capture-transient-migration update

## Direct Implementation Candidates

- [x] schema-dts-type-support -- #22。`schema-dts` を devDependency / type-only で導入し、JSON-LD extractor と synthetic fixture の編集時型支援だけを追加する。利用者挙動、runtime validation、公開契約を変えないため直接実装とする。
- [x] user-facing-parts-terminology -- #25。内部の `Candidate` モデルを維持したまま、typed message catalog と関連する DOM/E2E 期待値の利用者向け「候補」を文脈に応じて「パーツ」へ変更する。新しい業務規則や責務境界を作らないため直接実装とする。

## Specs (dependency order)

- [x] runtime-schema-validation -- Zod Mini の CSP/build gate、共通 primitive・エラー変換、feature-owned schema の公開規約、優先信頼境界の段階移行を定義する。Dependencies: none
- [x] project-context -- 現在選択中 project の core contract、catalog projection、UI preference、選択・再検証 transaction、切替 guard protocol、共通 selector、公開境界 gate を定義し、feature 内 adapter と shell wiring は所有しない。Dependencies: runtime-schema-validation

## Implementation Validation History

| Feature | Result | Validated at | Commit | Evidence |
|---|---|---|---|---|
| runtime-schema-validation | GO | 2026-08-08T13:33:56+09:00 | `1273a7e65d88` | `pnpm validate` exit 0（unit/contract/integration 1486/1486 pass、E2E 26 passed / 1 skipped は env gate の native smoke）。smoke boot PASS（`unpacked-extension.spec.ts` が Chrome 116+ で error-free な MV3 unpacked extension として認識）。gate report は dynamicFunctionCalls 0 / licenseNoticePresent true。要件 43/43 対応、境界監査・依存方向・File Structure Plan いずれも違反なし。 |
| project-context | GO | 2026-08-08T18:49:51+09:00 | `850da28d9a6f+dirty` | `pnpm validate` exit 0（Node 1549/1549 pass、Playwright 27 passed / 1 skipped は env gate の native smoke）。smoke boot PASS（`unpacked-extension.spec.ts`）。source-price-refresh blocker は追加 side panel target の二重監視を fixture で隔離し、120-case 高負荷反復も pass。Task 1–5、要件 coverage、公開境界、integration、design alignment、blocked-task status を再確認し未解決 blocker なし。 |
| project-context | GO | 2026-08-08T18:52:45+09:00 | `f18db452e784` | clean worktree の `pnpm validate` exit 0（Node 1549/1549 pass、Playwright 27 passed / 1 skipped は env gate の native smoke）。smoke boot PASS（`unpacked-extension.spec.ts`）。Task 1–5、要件 coverage、公開境界、integration、design alignment、blocked-task status を再確認し未解決 blocker なし。 |
| project-context | GO | 2026-08-08T19:34:29+09:00 | `4aa2dcc45389` | clean worktree で `pnpm validate:ci` exit 0（Node 1552/1552 pass）、`pnpm test:e2e` exit 0（Playwright 27 passed / 1 skipped は env gate の native smoke）。smoke boot PASS（`unpacked-extension.spec.ts`）。legacy authority / unavailable recovery の coverage 追補後に要件 8/8 セクション被覆、Allowed Dependencies 準拠、File Structure Plan 一致、TODO・secrets grep CLEAN、blocked task なしを再確認。 |
| product-page-capture | GO | 2026-08-08T23:20:03+09:00 | `81d34c32fc3c` | clean worktree で `pnpm validate:ci` exit 0（Node 1613/1613 pass、fail 0 / skipped 0）。初回の stale `dist`（Aug 2）を `pnpm build` で再生成し、`pnpm validate:final-build` exit 0・`pnpm validate:boundaries` exit 0・Playwright 27 passed / 1 skipped を fresh artifact で再取得。smoke boot PASS（`unpacked-extension.spec.ts` が Chrome 116+ で error-free な MV3 unpacked extension として認識）。要件 53/53 セクション被覆、closed source union が contracts/zod schema/coordinator/extractor/normalizer/ranker で一致（metadata 3 family 同順位、`domain-map` 最下位）、`siteName` は `CaptureField` 空間外、公開 API は manufacturerDomains / pagePriceExtraction の 2 read-only 能力のみ、依存方向・deep import・legacy save/navigation 境界いずれも違反なし、TODO・secrets grep CLEAN、blocked task なし。既知 drift は DEF-009 / DEF-010（docs/deferred-v0.x.md 記録済み、v1.0 期限）と fixture 配置の軽微差異のみ。 |
| local-data-foundation | GO | 2026-08-09T16:05:31+09:00 | `5bed7d72bf8b+dirty` | `pnpm validate:ci` exit 0（Node 1650/1650 pass、fail 0 / skipped 0）、`pnpm test:e2e` exit 0（Playwright 27 passed / 1 skipped は env gate の native smoke）。smoke boot PASS（`unpacked-extension.spec.ts` が Chrome 116+ で error-free な MV3 unpacked extension として認識）。TODO・secrets grep CLEAN。要件 8/8 セクション被覆、blocked task なし。用途別 port 分離を検証: contribution handle key は backupRestoreDataPort / dataPort / dispose / maintenanceSource / workerRegistration に厳密固定、scoped port は query+mutate のみ、backup 専用 port の禁止 capability は `@ts-expect-error` で型検査 gate 化。`dist/foundation.js` の実 export は schema 正規値・registration 系・contribution factory 2 種のみで raw root・回復 control・write authority の漏洩なし。dirty は本検証で修正した tasks.md 親 task 7./9. のチェック欠落（実装変更なし）。既知 drift は File Structure Plan の配置差異（BackupRestoreDataPort が write-authority.ts 内、回復 integration test が recovery.test.ts へ集約）のみ。 |
| application-shell | GO | 2026-08-09T21:11:34+09:00 | `6fb2a72e49ac+dirty` | `pnpm validate` exit 0（Node 1659/1659 pass、fail 0 / skipped 0、Playwright 27 passed / 1 skipped は env gate の native menu smoke）。typecheck / typecheck:public-consumer / lint / validate:boundaries / validate:fixtures / validate:final-build（build + dist artifact・boundary・fixture gate）/ validate:ui-text を含む。smoke boot PASS（`unpacked-extension.spec.ts` が Chrome 116+ で error-free な MV3 unpacked extension として認識）。TODO・secrets grep CLEAN（唯一の一致は `URL.password` 比較で秘密値ではない）。要件 10/10 セクション被覆、blocked task なし。cross-task 統合を確認: MaintenanceProjection → MutationGate（read / mutation / recovery の閉じた分類、recovery-required で通常 mutation のみ抑止）→ SidePanelHost・feature 購読、ProjectContextShellAdapter の単一購読が selector と依存 feature へ同一 generation を配送し generation 後退を拒否、project-context 初期化失敗は shell 全体の startup failure へ昇格しない。境界は worker-safe catalog と UI 専用 side-panel-contributions の分離、root barrel の `composeApplicationApi(context)` 化を確認し依存方向違反なし。dirty は本検証で修正した tasks.md 親 task 11. のチェック欠落（実装変更なし）。既知 drift は design.md ファイル構造計画への未記載 module（nav-icons / late-bound-lifecycle / runtime-bootstrap / worker-public / transient-surface 系。transient-surface 系は境界コミットメント上 `transient-feature-surface` 所有と明記済み）のみ。 |
| backup-restore | GO | 2026-08-10T18:00:24+09:00 | `1340bbac41ca` | clean worktree で `pnpm validate` exit 0（Node 1734/1734 pass、fail 0；Playwright 35 passed / 1 skipped は headed 限定の native smoke）。smoke boot PASS（`unpacked-extension.spec.ts` が dist を error-free MV3 として起動）。TODO/secrets grep CLEAN、44/44 AC を `final-audit.test.ts` が機械照合、依存方向は全て公開入口経由で違反なし、blocked task なし。注記は design.md L163 の wiring 記述陳腐化と `backup-schema.ts` の File Structure Plan 未記載の2件のみ（非ブロッキング）。 |
| project-candidate-management | GO | 2026-08-11T14:52:23+09:00 | `692b7056729e+dirty` | `pnpm validate` exit 0（typecheck、public-consumer、lint、boundary/runtime schema/fixture/final-build/UI text gates、全unit、Playwright 36 passed / 1 skipped は headed限定native smoke）。candidate-management 204/204 pass。current project authorityなしのdirect binding・一覧先頭fallback・snapshot一致免除を撤去し、project作成後はrefresh済みcontextだけへbinding、独自selectorを撤去。Requirement 1.5のrename成功後refresh 1回を直接検証。要件58/58、TODO/secrets CLEAN、独立review APPROVED、blocked taskなし。 |
| project-candidate-management | GO | 2026-08-11T16:08:28+09:00 | `e7e0a31d44c9` | `pnpm validate` exit 0（Node 1773/1773 pass、Playwright 36 passed / 1 skipped は headed限定native smoke）。smoke boot PASS（候補管理の実storage CRUD・再読込復元・共通project selector・dirty確認、および`unpacked-extension.spec.ts`のerror-free MV3起動）。要件9/9セクション・58/58 Acceptance Criteria、cross-task integration、設計・公開境界、依存方向、File Structure Planを確認し、対象featureのblocked taskなし。 |
| current-build-management | GO | 2026-08-11T19:27:50+09:00 | `294fb3d29bd3+dirty` | `pnpm validate` exit 0（Node 1834/1834 pass、Playwright 36 passed / 1 skipped はheaded限定native smoke）。current-build E2Eとunpacked MV3 smokeを通過。要件9/9セクション・53/53 Acceptance Criteria、mutation前後のproject/generation authority、legacy fallback撤去、CategorySummary責務、`listBuildEligible`限定依存、File Structure Plan、blocked taskなしを確認。application-shell隣接再検証もGO（要件10/10、targeted 80/80、boundary clean）。 |
| current-build-management | GO | 2026-08-11T20:25:45+09:00 | `e176c1089baf` | `pnpm validate` exit 0（Node 1837/1837 pass、Playwright 36 passed / 1 skipped は別機能のheaded限定native-menu smoke）。current-build E2Eとunpacked MV3 smoke boot PASS。要件9/9セクション・53/53 Acceptance Criteria、cross-task integration、project-context authority・draft保持、設計・公開境界、依存方向、File Structure Plan、blocked taskなしを確認。application-shell隣接再検証202/202 pass。 |
| compatibility-checking | GO | 2026-08-12T00:11:48+09:00 | `4591d5a27744` | clean worktreeで`pnpm validate` exit 0（Node 1868/1868 pass、Playwright 37 passed / 1 skipped は別機能のheaded限定native-menu smoke）。smoke boot PASS（`unpacked-extension.spec.ts`がproduction `dist`をerror-free MV3として起動）。要件45/45、cross-task integration、設計・公開境界、依存方向、blocked taskなしを確認。application-shellのcandidate一覧先頭fallbackとcompatibilityのlegacy state入口・optional context silent idleをowner別に修復し、context欠落時は`context-unavailable`へfail closed、上流query・別project fallbackへ到達しない。TODO・secrets grep CLEAN。 |
| product-capture-transient-migration | GO | 2026-08-12T08:59:37+09:00 | `37c457dd7b1a+dirty` | `pnpm validate` exit 0（Node 1882/1882 pass、Playwright 37 passed / 1 skipped は別機能のheaded native-menu smoke）。unpacked MV3 smokeとユーザー実施の同一production code manual smoke（toolbar icon、明示開始前の非抽出、`activeTab`固定tabへの実script抽出、candidate editor到達、表示エラーなし）をPASS。要件36/36、全task完了、blocked taskなし。current-context binding、project未解決pending回復、stale project排除、candidate受理失敗、atomic rollback retained-intent retryをproduction同形で確認。最終remediationでproject snapshot listener例外を隔離し、application-shell 243/243・project-context 132/132の隣接再検証もGO。公開境界・permission・fixture・artifact gate CLEAN。 |
