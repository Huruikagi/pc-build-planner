# pc-build-planner

Web上で見つけたPCパーツを、閲覧の流れのままローカルへ溜めて整理する、自作PCユーザー向けのローカルファーストChrome拡張。

商品カタログを提供するのではなく、「ユーザー自身が見つけた候補」をプロジェクト単位で貯め、現在の構成としてまとめ、基本的な規格の互換性を確認することに集中している。アカウント・サーバー・同期には一切依存しない。

## できること

- **商品取り込み** — 閲覧中の商品ページから、拡張アイコンの操作を起点に取得可能な情報をローカルで抽出する。取得できた項目には出典（構造化データ / メタ情報 / 見出し / パンくず / 表 / 定義リスト）と元表記を添え、取得できなかった項目も理由付きで示す。
- **候補管理** — 抽出結果を確認・補正し、URLだけの未分類候補も含めてプロジェクトへ保存する。保存時に既存パーツとの一致を照合し、新規保存か統合かを選べる。
- **現在の構成** — 候補から採用するパーツと数量を選び、一つの構成として管理する。
- **互換性確認** — 確認済みの正規化属性だけから、CPUソケットやメモリ規格など5つの基本規格を判定し、適合・不適合・情報不足を根拠つきで示す。

## 設計上の判断

このプロダクトの挙動を決めている前提。仕様を読む前にここを押さえると早い。

- **欠損は正常状態**。情報が欠けた商品も候補として保存でき、未入力・未分類・未確認を異常として扱わない。
- **自動抽出は補助**。取り込んだ値（元表記）と、利用者が確認した値（確定値）を分離して保持する。編集で書き換わるのは確定値だけ。
- **不確かな情報から互換性を断定しない**。判定に使うのは確定値だけで、取り込んだままの値は使わない。**情報不足は不適合ではない**。
- **サイト固有の取り込みロジックを持たない**。汎用の構造化メタデータだけに依存する結果、国・言語に依存しない。通貨は取得元の表記を尊重し、取れなければ推測しない。
- **ページ由来のデータは未信頼入力**。境界で検証し、通らなかった値は黙って捨てず理由を示す。

バックアップ・復元は持たない。データ喪失は許容する。表示言語はブラウザのUI言語に従い、アプリ内に切り替えを持たない。この2つを持たないため設定画面が無く、常設ナビは3面。

## 動作環境

- PC版 Chrome 116 以降（Manifest V3、side panel UI）
- Node.js 26.5.0 / pnpm 11.13.1（開発時。`mise.toml` に固定済み）

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

E2E を初めて実行する場合は `pnpm install:e2e-browser` で Chromium を取得する。Windows で `pnpm package` を実行するには pwsh (PowerShell 7+) が必要（Windows PowerShell 5.1 は Chrome が読めない区切り文字で zip を書く）。

### 検証の方針

**検証の正は、未パッケージ拡張を実ブラウザへ読み込んで動かす E2E のみ。** コンポーネントを実アプリの外でマウントする合成ハーネスは持たない。過去にハーネス上のテストが緑のまま、出荷ビルドでプロジェクトを1つも作れない状態が進行したことがある。

`pnpm dev` の開発ハーネスも例外ではない。実アプリの composition をそのまま起動し、差し替えるのは保存先（メモリ）と文言解決だけなので、配線が繋がっていなければハーネスでも壊れる。

CI は lint / typecheck / build / E2E の4ゲート。E2E は ja / en 両ロケールで同一シナリオを流し、UIではなく `chrome.storage.local` の実際の内容を突き合わせる。

## リポジトリ構成

```text
src/              実装
  capture/        商品ページからの抽出（未信頼入力の境界）
e2e/              実拡張を通すE2E
docs/             仕様と設計記録
_locales/         chrome.i18n の文言置き場
scripts/          ビルド・パッケージング
```

## 仕様

| 文書 | 内容 |
|---|---|
| [docs/reverse/requirements.md](docs/reverse/requirements.md) | 目的・対象利用者・課題と要求・非機能要求 |
| [docs/reverse/features.md](docs/reverse/features.md) | データモデル・抽出規則・互換性ルール・永続化・i18n |
| [docs/reverse/changes.md](docs/reverse/changes.md) | 設計判断の記録（C-1〜C-6）。実装がなぜこの形なのかはここ |
| [docs/reverse/screens.md](docs/reverse/screens.md) | v0.4.0 の画面構成の記録。**更新しない**（`changes.md` が優先する） |
| [デザインキャンバス](https://claude.ai/code/artifact/2b9a2685-8300-4fb1-8d26-2b4a5e20c705) | 画面のレイアウト・配色・アイコン |

## リリース

1. `manifest.json` と `package.json` の `version` を更新する（両者が一致しないとリリースが止まる）
2. 対象バージョンのマイルストーンの issue をすべて閉じる
3. GitHub Actions の Release ワークフローを手動起動する

Release は前提ゲート（version 整合・タグ重複なし・マイルストーンが open で未完了 issue が 0）を通ってから `pnpm validate` を実行し、zip とリリースノートを作ってマイルストーンを閉じる。リリースノートはマイルストーンの closed issue から生成されるため、ラベル（`enhancement` / `bug` / `documentation`）が見出しの分類になる。

## セキュリティ方針

- 商品取得はユーザーの明示操作のみを契機とし、権限は `activeTab` と `scripting` の一時権限に限定する。恒久的な host permission は使用しない。
- remote code、`eval`、`innerHTML` / `dangerouslySetInnerHTML` を使用せず、CSP を弱めない。
- ページ由来のデータと content script からのメッセージは未信頼入力として境界で検証する。
- content script は任意のページへ注入されるため、依存を持ち込まず小さく保つ。
- 実サイト由来の HTML・画像・商品データを fixture としてリポジトリへ含めない。

## そのほかのドキュメント

- [docs/project-overview.md](docs/project-overview.md) — 長期像
- [docs/requirements-v0.1.0.md](docs/requirements-v0.1.0.md) — MVP当時の要件（履歴として保持）

製品判断は `docs/reverse/` を優先する。

## ライセンス

UNLICENSED（個人利用）
