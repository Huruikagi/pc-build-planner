# pc-build-planner

Web上で見つけたPCパーツを、閲覧の流れのままローカルへ溜めて整理する、自作PCユーザー向けのローカルファーストChrome拡張。

商品カタログを提供するのではなく、「ユーザー自身が見つけた候補」をプロジェクト単位で貯め、現在の構成としてまとめ、基本的な規格の互換性を確認することに集中している。アカウント・サーバー・同期には一切依存しない。

## 現在の状態

v0.4.0 まで動作していたが、過剰設計により機能追加が停滞したため、2026-08-24 にコードベースを全削除し、稼働する v0.4.0 から逆算した仕様を唯一の入力として再実装した。

削除時点の規模は TypeScript 130,647 行、うちテストが 82,063 行（`src` の 2.2 倍）。実際の画面は 22 コンポーネント・常設ナビ 4 面。永続化層は単一利用者のローカル拡張が `chrome.storage.local` へ JSON を読み書きするだけの責務に対して 23 ファイルを持ち、直前のマイルストーンはスコープ全体が内部境界の整理で、利用者に届く変更がゼロだった。

`docs/reverse/features.md` の全機能を再実装済み。検証は実拡張を未パッケージで読み込む E2E のみで、CI で lint / typecheck / build / E2E を通す。

| 入力 | 役割 |
|---|---|
| [docs/reverse/requirements.md](docs/reverse/requirements.md) | 目的・対象利用者・課題と要求・非機能要求 |
| [docs/reverse/screens.md](docs/reverse/screens.md) | v0.4.0 の画面構成の忠実な記録（更新しない） |
| [docs/reverse/features.md](docs/reverse/features.md) | データモデル・抽出規則・互換性ルール・永続化・i18n |
| [docs/reverse/changes.md](docs/reverse/changes.md) | 再実装で意図的に変える点（C-1〜C-6） |
| [デザインキャンバス](https://claude.ai/code/artifact/2b9a2685-8300-4fb1-8d26-2b4a5e20c705) | 決定した具体レイアウト・配色・アイコン |

`screens.md` と `changes.md` が矛盾する箇所は `changes.md` が優先する。

旧実装は git 履歴から参照できる。

```bash
git show v0.4.0:src/features/product-capture/extractor.ts
```

## できること

- **商品取り込み** — 閲覧中の商品ページから、明示操作を起点に取得可能な情報をローカルで抽出する。取得できた項目には出典と元表記を添え、取得できなかった項目も理由付きで示す。
- **候補管理** — 抽出結果を確認・補正し、URLだけの未分類候補も含めてプロジェクトへ保存する。保存時に既存パーツとの一致を照合し、新規保存か統合かを選べる。
- **現在の構成** — 候補から採用するパーツと数量を選び、一つの構成として管理する。
- **互換性確認** — 確認済みの正規化属性だけから、CPUソケットやメモリ規格など5つの基本規格を判定し、適合・不適合・情報不足を根拠つきで示す。

情報が欠けた商品も候補として保存できることを前提にしており、自動抽出はあくまで補助として扱う。不確かな情報から互換性を断定しない。

v0.4.0 が持っていたバックアップ・復元は廃止した（[changes.md](docs/reverse/changes.md) C-3）。データ喪失は許容し、退避機能は持たない。表示言語のアプリ内切り替えも廃止し、`chrome.i18n` によるブラウザ言語追従にした（C-4）。この 2 つを落とした結果、設定画面を持たず常設ナビは 3 面。

## 動作環境

- PC版 Chrome 116 以降（Manifest V3、side panel UI）
- Node.js 26.5.0 / pnpm 11.13.1（開発時。`mise.toml` に固定済み）

## リポジトリ構成

```text
src/              実装
  capture/        商品ページからの抽出（未信頼入力の境界）
e2e/              実拡張を通すE2E。合成ハーネスは持たない
docs/reverse/     再実装の入力（上表の4文書 + design/ のUIアートボード）
salvage/          v0.4.0 から退避した知識。参照用でありコンパイルは通らない
_locales/         chrome.i18n の文言置き場
```

### salvage/ について

そのまま新実装へコピーするものではなく、**参照して書き直すための資料**。インポートパスや型は旧構造のままなのでコンパイルは通らない。

| | 内容 |
|---|---|
| `extraction/` | JSON-LD / OpenGraph / 表 / 定義リストからの抽出、価格パース、メーカードメイン対応表、カテゴリ推定 |
| `messages/` | 日英の全UI文言と `_locales/` |
| `compatibility/` | 5つの互換性ルールと集約ロジック |
| `domain/` | カテゴリ別正規化属性、元表記と確認済み値の分離 |
| `identity/` | URL正規化と商品同一性の照合 |
| `e2e/` | Playwright E2E 16本（v0.4.0 が何をしたかの記述） |

詳細は [salvage/README.md](salvage/README.md)。

## セットアップと開発

```bash
pnpm install
```

| コマンド | 内容 |
| --- | --- |
| `pnpm build` | MV3 の未パッケージ拡張を `dist/` へ生成 |
| `pnpm dev` | 開発ハーネスを配信（実アプリを起動し、保存先と文言解決だけ差し替える） |
| `pnpm typecheck` | 型検査 |
| `pnpm lint` | Biome |
| `pnpm test:e2e` | build 後に実拡張を読み込む E2E |
| `pnpm validate` | lint + typecheck + build + E2E |
| `pnpm package` | build 後、配布用 zip を `release/` へ生成 |

`dist/` を Chrome の `chrome://extensions` から「パッケージ化されていない拡張機能を読み込む」で指定する。Chrome Web Store には公開していない。

**検証の正は実拡張を通す E2E のみ。** コンポーネントを実アプリの外でマウントする合成ハーネスは持たない（[changes.md](docs/reverse/changes.md) C-5）。v0.4.0 ではハーネス上のテストが緑のまま、出荷ビルドでプロジェクトを 1 つも作れない状態が進行した。

## リリース

1. `manifest.json` と `package.json` の `version` を更新する（両者が一致しないとリリースが止まる）
2. 対象バージョンのマイルストーンの issue をすべて閉じる
3. GitHub Actions の Release ワークフローを手動起動する

Release は前提ゲート（version 整合・タグ重複なし・マイルストーンが open で未完了 issue が 0）を通ってから `pnpm validate` を実行し、zip とリリースノートを作ってマイルストーンを閉じる。Chrome Web Store には公開していない。

## セキュリティ方針

- 商品取得はユーザーの明示操作のみを契機とし、権限は `activeTab` と `scripting` の一時権限に限定する。恒久的な host permission は使用しない。
- remote code、`eval`、`innerHTML` / `dangerouslySetInnerHTML` を使用せず、CSP を弱めない。
- ページ由来のデータと content script からのメッセージは未信頼入力として境界で検証する。
- 実サイト由来の HTML・画像・商品データを fixture としてリポジトリへ含めない。

## そのほかのドキュメント

- [docs/requirements-v0.1.0.md](docs/requirements-v0.1.0.md) — MVP当時の要件（履歴として保持）
- [docs/project-overview.md](docs/project-overview.md) — 長期像

製品判断は `docs/reverse/` を優先する。

## ライセンス

UNLICENSED（個人利用）
