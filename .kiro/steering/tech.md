# 技術方針

## アーキテクチャ

PC版Chrome 116以降を対象とする、ローカルファーストのManifest V3拡張である。UIはside panelと標準DOM/CSSを中心に構成し、バックエンド、アカウント、同期に依存しない。

業務機能はfeature単位の垂直スライスに閉じ、共有基盤とは型付きportで接続する。local data foundationがデータ契約と永続化の整合性を、application shellが共有runtimeとUI compositionを所有する。

依存はドメイン契約からadapter/runtimeへ一方向に流す。featureは公開portを利用し、Chrome Storageや共有runtime入口へ直接依存しない。

## 現在の開発基盤

- **Runtime toolchain**: Node.js 26.5.0
- **Package manager**: pnpm 11.13.1
- **Module system**: ESM
- **Code quality tool**: Biome 2.5.4
- **Application source**: 未実装。`src/`、manifest、型検査、build、test設定はこれから導入する。

TypeScript、bundler、test runner、DOM test環境、Chrome typingsは実装開始時点の最新stable majorを選び、Node.js 26とChrome 116以降との互換性を確認して固定する。旧specに記載された候補バージョンを、導入済みの事実として扱わない。

## 実行環境とUI

- Manifest V3に準拠し、実行コードはすべて拡張へ同梱する。
- UIは標準DOM/CSSを基本とし、外部UI runtimeは必要性が確認できるまで導入しない。
- `sidePanel.open()` は有効なユーザージェスチャー内で呼び出す。
- MV3 service workerのメモリや寿命を、永続状態、処理継続、排他制御の唯一の根拠にしない。
- 標準Web APIを優先し、runtime依存を追加するときはMV3、CSP、容量、保守性への影響を明示する。

## データと永続化

- 永続化には `chrome.storage.local` を使用し、既定10MB上限を前提に容量を監視する。
- local data foundationを単一の信頼済みwrite authorityとし、すべての永続化mutationをそこへルーティングする。
- 保存ルートとJSON交換形式はバージョン付きかつ実行時検証可能にし、将来の移行経路を維持する。
- 候補変更とCurrentBuild参照修復は、同一root transaction内で修復、検証、commitする。
- 復元は原子的置換として扱い、maintenance generationとowner fencingをcommit直前にも再検証する。
- 生HTMLと商品画像は永続保存しない。書き込み失敗時は既存の有効データを保持する。

## 型安全とエラー処理

- TypeScriptはstrict modeとし、`any`を禁止する。
- ページ、content script、runtime message、JSON、storageからの値は `unknown` として受け取り、境界で検証してからドメイン型へ変換する。
- 失敗は判別可能な `Result<T, E>` またはerror unionで明示する。
- canonical `Result<T, E>` はlocal data foundationが所有し、shellやfeatureごとに同等型を再定義しない。
- 永続化する契約はJSON直列化可能にし、識別子、日時、schema versionの規約を共有する。

## セキュリティ

- 商品取得はユーザーの明示操作だけを契機とし、基本権限は `activeTab` と `scripting` の一時権限に限定する。
- Storageアクセスは `TRUSTED_CONTEXTS` へ限定し、content scriptへ保存APIを公開しない。
- sender、tab、URL、request ID、payload形状を検証し、ページ由来のデータを信頼しない。
- remote code、`eval`、動的コード評価、インラインJavaScript、恒久的host permission、`unlimitedStorage`を使用せず、CSPを弱めない。
- 外部文字列はHTMLとして挿入せず、安全なtext nodeとして描画する。
- ログやエラーへ生HTML、商品値、完全URL、保存内容などの未信頼・機微データを出さない。
- 実サイト由来のHTML、画像、取得商品データをfixtureやサンプルとしてリポジトリへ含めない。

## テストと品質

- 純粋なrule、validator、stateはunit testで検証する。
- repository、service、composition、公開契約はintegration/contract testで検証する。
- DOM表示と操作状態をDOM testで、manifest、権限、runtime境界をChrome 116以降相当のMV3 fixtureで検証する。
- Chrome APIはstubまたはin-memory adapterへ置換し、決定的なテストを保つ。
- fixtureは架空の商品、HTML、データだけで構成する。
- 破損入力、schema移行、容量不足、競合、原子的置換、maintenance fencing、navigation、feature障害分離を回帰対象にする。
- 型検査、Biome、test、build、生成物のセキュリティ検査を、最終的に一つの検証フローへまとめる。

## 開発コマンド

現時点では `package.json` のbuild、typecheck、test、validate scriptは未整備であり、既存の `test` は失敗するplaceholderである。実装基盤を導入するときに、再現可能な共通scriptとCI契約を同時に定義する。未整備のコマンドを成功する検証手段として扱わない。

## 主要な技術判断

- application shellだけがside panel host、feature registration、typed navigation、service-worker composition、root公開API、共通maintenance表示を組み立てる。
- local data foundationだけが共通結果型、保存検証・移行、単一write authority、原子的root mutation、参照修復、maintenance fencingを所有する。
- featureは `public.ts`、登録モジュール、必要なruntime registration portを公開し、共有runtime入口を直接編集しない。
- ライブラリの固定より、境界契約、最小権限、データ整合性、決定的テストを優先する。

---
_依存パッケージの一覧ではなく、技術選択と実装判断を導く原則を記録する。_
