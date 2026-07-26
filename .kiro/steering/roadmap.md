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
- `LocalDataRoot.schemaVersion` の引き上げを伴う変更は、既存データの非破壊移行と backup/restore の互換を保つ。

## Boundary Strategy

- **Why this split**:
  - **shell の表示契約**（一過性 feature をどう登録し、いつ畳むか）と、**ドメインのデータ構造**（1商品 : N ソース）は互いに独立しており、並行して着手できる。この2本を土台に置くことで、後続3本（価格更新・統合・設定画面）は「既に確定した契約の利用者」として設計できる。
  - `transient-feature-surface` は shell の登録契約変更を含むため、application-shell の既存 spec を改訂するのではなく**新規 spec に契約ごと所有させる**。application-shell 側は touchpoint として要件を改訂する。理由は、契約の追加と最初の利用者（product-capture）への適用を同一 spec 内で閉じて検証したいため。
  - #8（ドメイン→メーカー名マップ）は既存の collector 構造に1つ足すだけの加算的変更であり、`product-page-capture` の既存 spec 更新として扱う。新規 spec を立てる境界には満たない。
  - #14 は steering 文書の追記のみで、実装を伴わないため spec 化しない。
- **Shared seams to watch**:
  - **サイドパネルのナビ面**: `transient-feature-surface`（capture を外す）と `settings-screen`（settings を足し backup-restore を畳む）が同じ面を触る。**E を先に確定させてから #19 に着手する**ことで、settings の設計時に最終形のナビが見えている状態にする。E2E ロケータ（`e2e/locators.ts`）とカタログキー（`src/ui-messages/catalog/{ja,en}/nav.ts`）の二度触りを避ける。
  - **`SourceInfo` / `price` の所有**: `candidate-source-bookmarks` が per-source 化の canonical owner。`source-price-refresh` と `duplicate-product-merge` はその契約の利用者であり、価格の置き場所を再定義しない。
  - **ドメイン→メーカー名マップの利用先**: #8 のマップは `product-page-capture` が所有し、#11 のソース種別自動判定はそれを**参照する**（マップを二重に持たない）。
  - **付与ジェスチャー経路**: `transient-feature-surface` が起動口（アイコン / コンテキストメニュー）の契約を所有し、`source-price-refresh` は「価格更新」メニュー項目をその契約に登録する形にする。service worker 側で経路を再実装しない。
  - **`schemaVersion` 移行**: `candidate-source-bookmarks` のみが移行を書く。backup/restore のエクスポート形式との整合を同 spec 内で確認する。

## Existing Spec Updates

- [ ] product-page-capture -- #8: ドメイン→メーカー名マップを最下位優先度の collector（`ExtractionSource: "domain-map"`）として追加し、メーカー自社サイトでの `manufacturer` 欠損を補完する。マップは `manufacturer-domain-map.ts` に分離し eTLD+1 で照合。Dependencies: none
- [ ] product-page-capture -- transient-feature-surface による要件1.4 / 要件6.1 の改訂（付与失効時の案内・遷移時の扱いが「ビューを畳む」へ変わる）。Dependencies: transient-feature-surface
- [ ] application-shell -- 要件1.1 / 1.5 / 2.1 / 要件7 の改訂（ナビに載らない一過性 feature 種別の受け入れ）。Dependencies: transient-feature-surface
- [ ] backup-restore -- #19: 独立タブから設定画面内セクションへの再配置に伴う registration / navigation の改訂。Dependencies: settings-screen
- [ ] ui-internationalization -- #19: 言語セレクタの設置面が shell ヘッダから設定画面へ移ることに伴う改訂。Dependencies: settings-screen

## Direct Implementation Candidates

- [ ] #14 抽出の規約・法務ポリシーを steering に明記 -- `.kiro/steering/` への追記のみで実装を伴わない。ユーザー操作起点・閲覧中ページ限定、robots / 各サイト規約の尊重、汎用構造化データを基本としサイト固有 DOM 抽出は例外、サイト固有ロジックはサイト単位オプトインで規約確認を記録、定期巡回は行わない。#8 のマップ運用および将来のサイト固有ロジック追加の可否判断の前提になる
- [ ] #6-C `permission-lost` メッセージの文言修正 -- `src/features/product-capture/view.tsx:62` の「ページを表示し直してから再実行してください」は誤誘導（リロードでは直らない）。「拡張アイコンをもう一度クリックしてください」へ。他ピースの方針に依存せず即着手可能。transient-feature-surface 完了後は出番が激減するが、それまでの期間の誤誘導を消す価値がある

## Specs (dependency order)

- [ ] transient-feature-surface -- shell に「ナビへ常設せず、付与ジェスチャーで起動し付与失効で自動的に畳まれる一過性 feature」の登録・起動・終了契約を導入し、product-capture をその最初の利用者として移行する（#6）。Dependencies: none
- [ ] candidate-source-bookmarks -- 1商品に複数の取得元ページを束ねる構造へ移行し（`sourceInfo` の 1:N 化・価格の per-source 化・プライマリ導出・`schemaVersion` 移行）、取得元ページへの再訪導線とソース種別（販売 / メーカー紹介）を提供する（#10, #9, #11）。Dependencies: product-page-capture 更新（#8, 種別自動判定のマップ参照のみ）
- [ ] settings-screen -- 設定画面 feature を新設し、表示言語切り替え（shell ヘッダから移設）とバックアップ・復元を集約する（#19）。Dependencies: transient-feature-surface
- [ ] source-price-refresh -- ブックマーク済みページを再訪した状態で価格を再取得し、URL 突き合わせで特定したソースの価格・取得日時へ反映する（#12）。Dependencies: transient-feature-surface, candidate-source-bookmarks
- [ ] duplicate-product-merge -- 取り込み時にプロジェクト内の既存候補との一致を検知し、新規候補として保存する代わりに既存パーツの別ソースとして統合する導線を提供する（#13）。Dependencies: candidate-source-bookmarks
