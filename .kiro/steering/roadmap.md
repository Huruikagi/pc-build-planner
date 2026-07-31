# Roadmap

## Overview

v0.3.0 は、v0.1.0 / v0.2.0 を実際に使って見えてきた課題を解消し、拡張の性格を「パーツを取り込むツール」から steering `product.md` が掲げる**検討中ブックマーク**の体験へ寄せるリリースである。取り込み動線の欺瞞的アフォーダンスを構造的に殺し、一つの商品を複数ページで束ねて再訪・比較・更新できるようにし、あわせて Web ページからの情報取得に関する規約・法務ポリシーを明文化する。

対応範囲は GitHub milestone v0.3.0 の open issue 9件（#6, #8, #9, #10, #11, #12, #13, #14, #19）。完了後は、安定した操作要件をもとに UI 全面刷新へ進む。

## Approach Decision

- **Chosen**: 「一過性ビューの情報設計」と「複数ソースのデータモデル」を2本の独立した土台として先に立て、その上に価格更新・同一商品統合・設定画面を載せる。
- **Why**:
  - #6 の本質は「`activeTab` の付与ジェスチャーと実行ジェスチャーが分離していること」である。issue 内の選択肢 A（付与フラグ通知）+ B（有効性ゲート + 遷移リセット）を個別機構として作るのではなく、**選択肢 E（product-capture を常設ナビから外し、アイコン起動時だけ立ち上がる一過性ビューにする）** を軸に据えると、`一過性ビューの寿命 ≡ activeTab 付与の寿命` と定義でき、A/B が情報設計の帰結として自然に満たされる。遷移で失効したら**ビューごと畳む**ため、失敗するボタンが構造的に存在しなくなる。
  - この一過性ビュー契約は #12（価格更新）の動線にもそのまま再利用できる。コンテキストメニュー「価格を更新」（#6 の選択肢 D）は、この契約の2番目の起動口として位置づけられる。
  - #10 の複数ソース化は `schemaVersion` を上げる構造変更であり、#9 / #11 / #12 / #13 のすべてがこの上に乗る。ここを先に確定させないと全体が手戻りする。
- **Rejected alternatives**:
  - **A + B のみ（E なし）**: 付与フラグと有効性ゲートを capture feature 内に閉じて実装する案。shell の情報設計に踏み込まずに済む反面、「ナビに常設されているのに押せないタブ」という状態が残り、欺瞞的アフォーダンスを消しきれない。#12 の動線も同じ問題を再発明することになる。
  - **アイコン = 即取り込み（auto-run）**: #6 で明示的に却下済み。構成確認目的でパネルを開くケースに副作用（注入・スピナー・エラー表示・強制ジャンプ）が出る。
  - **#9 / #11 を独立 spec に切る**: issue と 1:1 になるが、いずれも #10 のソース構造の上に乗る薄い属性・導線であり、単独では spec としてほぼ空になる。#10 と同一 spec に含める。
  - **curated な `host_permissions` へ路線変更**: #6 のスコープ外メモにある通り、対象サイトへの権限同意プロンプトが増えるトレードオフを負う。MVP の「全サイトへの恒久的な読み取り許可を要求しない」（product-page-capture 要件1.3）を崩すため採らない。

## Scope

- **In**: 取り込み動線の情報設計刷新（一過性ビュー契約）、同一商品の複数ソース化とプライマリ導出、取得元ページへの再訪導線、ソース種別（販売 / メーカー紹介）、ブックマーク済みページの価格再取得、取り込み時の同一商品検知と統合、ドメイン→メーカー名マップによるメーカー名補完、設定画面への言語設定・バックアップ復元の集約、抽出の規約・法務ポリシーの steering 明文化。
- **Out**: UI 全面刷新（次リリース）、バックグラウンドの巡回・定期クロール、価格・在庫の自動監視、サーバー側スクレイピング、AI 抽出、為替換算、他ブラウザ対応、Chrome Web Store 公開。

## Constraints

- Chrome 116以降・未パッケージ Manifest V3 拡張、ローカルファースト（サーバー・アカウント・同期なし）を維持する。
- `activeTab` を維持し、全サイトへの恒久的な `host_permissions` は要求しない。
- 取得は明示的なユーザー操作を契機とし、閲覧中のページのみを対象とする（steering `product.md` プロダクト原則）。この線は #14 で steering に明文化する。
- `src/features/<feature>/public.ts` のみを feature 外の公開入口とする境界規約（steering `structure.md`）と `scripts/validate-boundaries.mjs` の検証を破らない。
- 実サイト由来の HTML・画像・商品データをテスト資産に使わない（product-page-capture 要件7）。
- 初回リリース前の保存形式変更は、開発中データを互換対象とせず、リリース時点のcanonical schemaとbackup形式へ直接統一する。初回リリース後に`LocalDataRoot.schemaVersion`を引き上げる変更では、既存データの非破壊移行とbackup/restore互換を保つ。

## Boundary Strategy

- **Why this split**:
  - **shell の表示契約**（一過性 feature をどう登録し、いつ畳むか）と、**ドメインのデータ構造**（1商品 : N ソース）は互いに独立しており、並行して着手できる。この2本を土台に置くことで、後続3本（価格更新・統合・設定画面）は「既に確定した契約の利用者」として設計できる。
  - `transient-feature-surface` は shell/runtime の登録・起動・寿命契約だけを所有し、最初の利用者への適用は `product-capture-transient-migration` が所有する。旧案は両責務を一つのspecへ閉じたが、設計が約900行へ拡大し、runtime配送の競合レビューとcapture/candidate移行のレビューが互いに干渉したため分割した。
  - #8（ドメイン→メーカー名マップ）は既存の collector 構造に1つ足すだけの加算的変更であり、`product-page-capture` の既存 spec 更新として扱う。新規 spec を立てる境界には満たない。
  - #14 は steering 文書の追記のみで、実装を伴わないため spec 化しない。
- **Shared seams to watch**:
  - **サイドパネルのナビ面**: `product-capture-transient-migration`（captureを外す）と `settings-screen`（settingsを足しbackup-restoreを畳む）が同じ面を触る。shell契約を先に確定し、capture移行後にsettingsへ進むことで、E2Eロケータとナビカタログの二度触りを避ける。
  - **`SourceInfo` / `price` の所有**: `candidate-source-bookmarks` が per-source 化の canonical owner。`source-price-refresh` と `duplicate-product-merge` はその契約の利用者であり、価格の置き場所を再定義しない。
  - **ドメイン→メーカー名マップの利用先**: #8 のマップは `product-page-capture` が所有し、#11 のソース種別自動判定はそれを**参照する**（マップを二重に持たない）。
  - **付与ジェスチャー経路**: `transient-feature-surface` が起動口（アイコン / コンテキストメニュー）の契約を所有し、`source-price-refresh` は「価格更新」メニュー項目をその契約に登録する形にする。service worker 側で経路を再実装しない。
  - **初期`schemaVersion`確定**: `candidate-source-bookmarks` が複数ソース形式を初回リリースのcanonical schemaとして確定する。開発中の旧保存形式・旧backup形式は互換対象にせず、将来のmigration基盤だけをlocal-data-foundationに維持する。

## Existing Spec Updates

- [x] candidate-source-bookmarks -- `source-price-refresh` の実装前提として、candidate-management の `public.ts` が所有する読み取り専用 `CandidateSourceCatalogPort` を追加し、保存rootや編集draftを公開せず全source／候補限定の列挙とID指定の現行source再取得を提供する。利用者は `source-price-refresh`。Dependencies: source-price-refresh
- [x] transient-feature-surface -- `source-price-refresh` の実装前提として、application shell の `public.ts` が所有する `TransientGestureRegistrationPort` を追加し、feature-owned gesture sourceを既存scheduler／store／side panel open経路へ同期登録できるようにする。利用者は `source-price-refresh`。Dependencies: source-price-refresh
- [x] product-page-capture -- `source-price-refresh` の実装前提として、product-capture の `public.ts` が所有する読み取り専用 `PagePriceExtractionPort` を追加し、固定tabからpage-derived URL・取得時点・既存抽出規則によるprice provenanceだけを返す。利用者は `source-price-refresh`。Dependencies: source-price-refresh
- [x] product-page-capture -- #8: ドメイン→メーカー名マップを最下位優先度の collector（`ExtractionSource: "domain-map"`）として追加し、メーカー自社サイトでの `manufacturer` 欠損を補完する。マップは `manufacturer-domain-map.ts` に分離し eTLD+1 で照合。Dependencies: none
- [x] product-page-capture -- product-capture-transient-migration に合わせ、要件4（簡易確認・補正）と要件5（project選択・保存）を候補管理への即時引き渡しへ改訂し、要件1.4 / 6.1 / 6.4の権限失効・遷移・再実行を一過性面の寿命と新世代起動へ合わせる。Dependencies: product-capture-transient-migration
- [x] application-shell -- 要件1.1 / 1.5 / 2.1 / 4.3 / 4.4 / 要件7 の改訂（ナビ・初期選択・fallbackに載らない一過性feature種別、単一主表示領域、安全なテキストとして常設面と併存する`transientNotice`、既存typed activationの受け入れ）。Dependencies: transient-feature-surface
- [x] application-shell -- `settings-screen` に合わせ、shellヘッダの言語セレクタ配置責務を削除して設定画面へ移し、`settings` の常設navigation／表示面とloading・startup error時の二言語回復案内をshellの状態表示・compositionへ統合する。Dependencies: settings-screen
- [x] project-candidate-management -- project未解決・空名のpre-edit activationと、編集開始/保存時検証の分離を受け入れる。Dependencies: product-capture-transient-migration
- [x] ui-message-catalog -- 一過性起動失敗・失効案内と、product-captureのナビ除去・権限再付与案内を日本語/英語で反映する。Dependencies: transient-feature-surface, product-capture-transient-migration
- [x] ui-message-catalog -- `settings-screen` に合わせ、`nav.settings`、settingsの言語／backup区画、shell回復案内の日本語／英語messageを追加・更新し、`nav.backupRestore`の廃止とshellヘッダからの言語切替・独立backup navigationからの配置移動をcatalog契約へ反映する。Dependencies: settings-screen
- [x] backup-restore -- #19: 独立タブから設定画面内セクションへの再配置に伴う registration / navigation の改訂。Dependencies: settings-screen
- [x] ui-internationalization -- #19: 言語セレクタの設置面が shell ヘッダから設定画面へ移ることに伴う改訂。Dependencies: settings-screen

## Direct Implementation Candidates

- [x] #14 抽出の規約・法務ポリシーを steering に明記 -- `.kiro/steering/web-content-acquisition.md` に、ユーザー操作起点・閲覧中ページ限定、robots / 各サイト規約の尊重、汎用構造化データ優先、サイト固有 DOM 抽出のオプトイン審査、domain map の非権限性、再審査・撤去基準を明文化した。

## Specs (dependency order)

> この一覧のチェックは仕様作成と承認の完了を示すものであり、実装タスクの完了を示すものではない。実装進捗は各specの`tasks.md`と下記のImplementation Validation Historyで確認する。

- [x] transient-feature-surface -- shell/runtime に「ナビへ常設せず、付与ジェスチャーで起動し付与失効で自動的に畳まれる一過性feature」の登録・起動・終了・汎用引き渡し契約を導入する（#6、基盤部分）。Dependencies: none
- [x] product-capture-transient-migration -- product-captureを一過性featureの最初の利用者へ移行し、実行面と候補編集・保存面を分離する（#6、業務移行部分）。Dependencies: transient-feature-surface
- [x] candidate-source-bookmarks -- 1商品に複数の取得元ページを束ねる構造へ移行し（`sourceInfo` の 1:N 化・価格の per-source 化・プライマリ導出・`schemaVersion` 移行）、取得元ページへの再訪導線とソース種別（販売 / メーカー紹介）を提供する（#10, #9, #11）。Dependencies: product-page-capture 更新（#8, 種別自動判定のマップ参照のみ）
- [x] settings-screen -- 設定画面 feature を新設し、表示言語切り替え（shell ヘッダから移設）とバックアップ・復元を集約する（#19）。Dependencies: transient-feature-surface, product-capture-transient-migration
- [x] source-price-refresh -- ブックマーク済みページを再訪した状態で価格を再取得し、URL 突き合わせで特定したソースの価格・取得日時へ反映する（#12）。Dependencies: transient-feature-surface, candidate-source-bookmarks
- [x] duplicate-product-merge -- 取り込み時にプロジェクト内の既存候補との一致を検知し、新規候補として保存する代わりに既存パーツの別ソースとして統合する導線を提供する（#13）。Dependencies: candidate-source-bookmarks

## Implementation Validation History

| Feature | Result | Validated at | Commit | Evidence |
|---|---|---|---|---|
| application-shell | GO | 2026-07-31T11:49:54+09:00 | `4ac4ad6` | `ui-message-catalog` remediation後にnotice表示・clear順序とruntime callback／cleanup seamを再検証。`pnpm validate` exit 0（Node 1,164/1,164、Playwright 15/15）、unpacked-extension smoke PASS、設計・境界監査PASS |
| backup-restore | GO | 2026-07-31T00:09:57+09:00 | `babceebdbf08` | `pnpm validate` exit 0（Node 1,151/1,151、Playwright 14/14）、要件6/6・受入基準35/35、unpacked-extension smoke PASS、統合・設計・境界監査PASS |
| ui-internationalization | GO | 2026-07-31T09:57:39+09:00 | `ef73db87dfcc` | `pnpm validate` exit 0（Node 1,161/1,161、Playwright 15/15）、要件9/9・受入基準52/52、unpacked-extension smoke PASS、統合・設計・境界監査PASS |
| transient-feature-surface | GO | 2026-07-31T11:49:54+09:00 | `4ac4ad6` | 起動失敗／失効のtyped notice callback、上流task 1.4のclear順序、監視cleanupを再検証。`pnpm validate` exit 0、unpacked-extension smoke PASS、統合・境界監査PASS |
| product-capture-transient-migration | GO | 2026-07-31T11:49:54+09:00 | `4ac4ad6` | handoff保持結果・新世代案内・同activation再試行をproduction view/state seamで再検証。`pnpm validate` exit 0、Playwright 15/15、境界監査PASS |
| ui-message-catalog | GO | 2026-07-31T11:49:54+09:00 | `4ac4ad6` | 5つのexact key接続、旧generic key撤去、AST dead-key gate、64/64受入基準FULL。`pnpm validate` exit 0（Node 1,164/1,164、Playwright 15/15）、smoke・artifact・設計・境界監査PASS |
| project-candidate-management | GO | 2026-07-31T14:57:55+09:00 | `49c9eef6b637` | `pnpm validate` exit 0（Node 1,169/1,169、Playwright 16/16）、要件7/7・受入基準41/41、unpacked-extension smoke PASS、統合・設計・境界監査PASS |
