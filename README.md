# pc-build-planner

Web上で見つけたPCパーツを、閲覧の流れのままローカルへ溜めて整理する、自作PCユーザー向けのローカルファーストChrome拡張。

商品カタログを提供するのではなく、「ユーザー自身が見つけた候補」をプロジェクト単位で貯め、現在の構成としてまとめ、基本的な規格の互換性を確認することに集中している。アカウント・サーバー・同期には一切依存しない。

## できること

- **商品取り込み** — 閲覧中の商品ページから、明示操作を起点に取得可能な情報をローカルで抽出する。
- **候補管理** — 抽出結果を確認・補正し、URLだけの未分類候補も含めてプロジェクトへ保存する。
- **現在の構成** — 候補から採用するパーツと数量を選び、一つの構成として管理する。
- **互換性確認** — 確認済みの正規化属性だけから、CPUソケットやメモリ規格などの整合性・不一致・注意・情報不足を根拠つきで示す。
- **バックアップ / 復元** — ローカルデータをバージョン付きJSONとして退避し、原子的に復元する。

情報が欠けた商品も候補として保存できることを前提にしており、自動抽出はあくまで補助として扱う。不確かな情報から互換性を断定しない。

## 動作環境

- PC版 Chrome 116 以降（Manifest V3、side panel UI）
- Node.js 26.5.0 / pnpm 11.13.1（開発時。`mise.toml` に固定済み）

## セットアップ

```bash
pnpm install
```

## ビルドと拡張の読み込み

```bash
pnpm build
```

生成された `dist/` を Chrome の `chrome://extensions` から「パッケージ化されていない拡張機能を読み込む」で指定する。Chrome Web Store には公開していない。

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | 実装の型検査 |
| `pnpm lint` | Biome による静的検査 |
| `pnpm test` | unit / contract / integration / DOM テスト |
| `pnpm test:e2e` | production build 後の Playwright E2E |
| `pnpm build` | MV3 production artifact の生成 |
| `pnpm validate` | 上記に境界・fixture・最終build gate を加えた一括検証 |

機能の完了判定は `pnpm validate` を基準とする。E2E を初めて実行する場合は `pnpm install:e2e-browser` で Chromium を取得する。

## プロジェクト構成

feature-first の垂直スライス構成。業務機能は `src/features/<feature>/` に閉じ、外部へは `public.ts` だけを公開する。

```text
src/domain, src/persistence  共通ドメイン契約・検証・migration・単一write authority
src/features/*               業務feature（候補管理・現在構成・取り込み・互換性・backup/restore）
src/application-shell        side panel host、feature registry、navigation、composition
src/runtime                  Chrome実行入口（side panel / service worker）
tests/, e2e/, scripts/       テスト・E2E・build/検証gate
```

詳細な配置原則は [.kiro/steering/structure.md](.kiro/steering/structure.md) を参照。

## セキュリティ方針

- 商品取得はユーザーの明示操作のみを契機とし、権限は `activeTab` と `scripting` の一時権限に限定する。恒久的な host permission は使用しない。
- remote code、`eval`、`innerHTML` / `dangerouslySetInnerHTML` を使用せず、CSP を弱めない。
- ページ由来のデータと content script からのメッセージは未信頼入力として境界で検証する。
- 実サイト由来の HTML・画像・商品データを fixture としてリポジトリへ含めない。

判断の背景は [.kiro/steering/security.md](.kiro/steering/security.md) にまとめている。

## ドキュメント

- [docs/requirements-v0.1.0.md](docs/requirements-v0.1.0.md) — MVP の要件（製品判断はこちらを優先）
- [docs/project-overview.md](docs/project-overview.md) — 長期像
- [.kiro/steering/](.kiro/steering/) — プロダクト・技術・構造・テスト・セキュリティの方針
- [.kiro/specs/](.kiro/specs/) — feature単位の requirements / design / tasks

開発は Kiro スタイルの spec-driven なワークフロー（Requirements → Design → Tasks → Implementation）で進めている。詳細は [CLAUDE.md](CLAUDE.md) を参照。

## ライセンス

UNLICENSED（個人利用）
