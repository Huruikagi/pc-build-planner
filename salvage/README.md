# salvage

v0.4.0 / v0.5.0 のコードベースを削除するにあたり、**再取得コストが高い知識**だけを退避したもの。

そのまま新実装へコピーするためのものではない。**参照して書き直すための資料**として扱う。
インポートパスや型は旧構造のままなのでコンパイルは通らない。

- 出典: `488c6dc`（削除直前の main）。抽出ロジックとドメインモデルは `v0.4.0` と同一であることを確認済み
- 旧コード全体は git 履歴から取れる: `git show v0.4.0:src/persistence/recovery.ts` など
- 再実装の入力は `docs/reverse/` の 4 文書とデザインキャンバス。本ディレクトリはその補助

## 内容

| ディレクトリ | 行数 | 何が入っているか | なぜ残したか |
|---|---|---|---|
| `extraction/` | 1,287 | JSON-LD / OpenGraph / 表 / 定義リストからの抽出、価格パース、メーカードメイン対応表、カテゴリ推定、商品同一性正規化 | 実サイトでの試行錯誤の結晶。書き直すと確実に劣化する。**最も価値が高い** |
| `messages/` | 1,014 | 日本語・英語の全 UI 文言（カタログ形式）と `_locales/` | 文言そのものは資産。表現を練り直した結果が入っている |
| `compatibility/` | 509 | 5 つの互換性ルール、集約ロジック、判定対象の展開 | ルール定義と 3 値判定の仕様がコードとして残っている |
| `domain/` | 249 | カテゴリ別正規化属性、`SourcedValue`（元表記と確認済み値の分離）、データモデル | データモデルの語彙。`features.md` 1 章の裏付け |
| `identity/` | 92 | URL 正規化と商品同一性の照合 | 重複判定の実装知識 |
| `e2e/` | 3,614 | Playwright の E2E スペック 16 本 | 「v0.4.0 が実際に何をしたか」の最も忠実な記述 |
| `fixtures/` | 81 | 架空の商品ページフィクスチャ | 実在サイトを使わない検証データの型 |
| `build/` | 329 | MV3 の esbuild ビルド、配布 zip 生成、リリースワークフローとバージョン整合チェック | ビルド構成とリリースゲートの手順 |

## 意図的に外したもの

| | 理由 |
|---|---|
| `src/persistence/` 23 ファイル | 過剰設計の本体。`features.md` 6.2 の性質を満たす最小実装に書き直す |
| `packages/` (typed-messages-core, local-data) | 単一パッケージに戻す |
| `tests/` 82,063 行 | テストのためのツールのためのテストを含む |
| `.kiro/specs/` 20 spec | 過剰設計の過程の産物。参照すると複雑さが再輸入される |
| negative tsconfig 10 個 / `validate:*` スクリプト 20 本超 | 境界の機械検証は持たない |
| バックアップ・復元一式 | 機能ごと廃止（`changes.md` C-3） |
| `src/ui-messages/` `src/ui-language/` の機構 4,007 行 | `_locales` + `chrome.i18n` に置き換え（`changes.md` C-4）。**文言だけ**を `messages/` に残した |
| `messages/` の `backup.ts` `settings.ts` | 廃止した機能の文言。残すと復活を誘う |
| `e2e/support/` `e2e/models/` | 合成ハーネスと Page Object。実拡張を通さない検証は持たない（`changes.md` C-5） |

## `build/` について

再実装のビルドとリリースを組むときの参照。そのまま動かすものではない。

| ファイル | 内容 |
|---|---|
| `build.mjs` | esbuild による MV3 バンドル。ESM 6エントリ（side panel / service worker / index / foundation / build-contract / CSS）+ content script のみ IIFE で別ビルド（`chrome.scripting.executeScript` が classic script を注入するため） |
| `package.mjs` | `dist/` から配布 zip を `release/` へ生成 |
| `manifest.json.ref` | v0.4.0 の MV3 設定。権限は `activeTab` と `scripting` のみ |
| `release.yml.ref` | リリースワークフロー。version 整合・タグ重複・マイルストーン状態を前提ゲートにしていた |
| `release-version.mjs` | `manifest.json` と `package.json` の version 一致チェック |

## 使い方

再実装で対応する機能に着手するとき、該当ディレクトリを読んでから書く。

- 取り込みを作る → `extraction/` と `docs/reverse/features.md` 2 章
- 互換性判定を作る → `compatibility/` と `features.md` 5 章
- 文言を用意する → `messages/` から `_locales/{ja,en}/messages.json` へ移す
- 振る舞いの確認 → `e2e/` の該当スペックを読む（そのままは使わない）
