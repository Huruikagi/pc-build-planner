# 技術方針

## アーキテクチャ

PC版Chrome 116以降を対象とする、ローカルファーストのManifest V3拡張である。UIはside panelとReact/CSSを中心に構成し、バックエンド、アカウント、同期に依存しない。

業務機能はfeature単位の垂直スライスに閉じ、共有基盤とは型付きportで接続する。local data foundationがデータ契約と永続化の整合性を、application shellが共有runtimeとUI compositionを所有する。

依存はドメイン契約からadapter/runtimeへ一方向に流す。featureは公開portを利用し、Chrome Storageや共有runtime入口へ直接依存しない。

## 現在の開発基盤

- **Runtime toolchain**: Node.js 26.5.0
- **Package manager**: pnpm 11.13.1
- **Module system**: ESM
- **Code quality tool**: Biome 2.5.4
- **Application source**: MVP（v0.1.0）の全specが実装済み。local data foundation、application shell、Manifest V3 runtime、5つの業務feature、型検査、build、test、E2E、検証gateが揃っている。以降の変更は既存の公開境界と検証フローに乗せる。

UI実装にはReact 19系とReact DOMを使用し、production buildへ同梱する。TypeScript 7、esbuild、Node test runner、jsdom、Playwright、Chrome typingsを固定済みであり、Node.js 26とChrome 116以降を対象に共通検証scriptから実行する。依存更新時はReact、React DOM、型定義の対応majorと、MV3/CSP互換性を維持する。

## 実行環境とUI

- Manifest V3に準拠し、実行コードはすべて拡張へ同梱する。
- UIの宣言的描画、フォーム、一覧、確認フローにはReact function componentとJSXを使用し、CSSはfeature単位に所有する。
- Reactは表示adapterに限定し、ドメインstate、service、port、永続化契約をReact hookやcomponentへ埋め込まない。
- shellとfeatureの境界では既存の`FeatureMountContext`とmount/unmount lifecycleを維持し、React rootの生成と`root.unmount()`は各UI adapterが責任を持つ。
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

脅威モデルは閲覧中のWebページであり、防御の中心は最小権限・境界での検証・ローカルデータの保全にある。判断の根拠と機械検査に落とし込んだ規約は `security.md` に集約する。技術選択に直結する要点だけを再掲する。

- 商品取得はユーザーの明示操作だけを契機とし、基本権限は `activeTab` と `scripting` の一時権限に限定する。恒久的host permissionと `unlimitedStorage` を使用しない。
- remote code、`eval`、動的コード評価、インラインJavaScript、`dangerouslySetInnerHTML` / `innerHTML` を使用せず、CSPを弱めない。
- ページ由来のデータとcontent scriptからのメッセージを未信頼入力として扱い、送信元と payload 形状を境界で検証する。
- 実サイト由来のHTML、画像、取得商品データをfixtureやサンプルとしてリポジトリへ含めない。

## テストと品質

- 純粋なrule、validator、stateはunit testで検証する。
- repository、service、composition、公開契約はintegration/contract testで検証する。
- React componentの表示と操作状態を利用者視点のDOM testで、manifest、権限、runtime境界をChrome 116以降相当のMV3 fixtureで検証する。
- mount/unmount、購読解除、feature切替時のReact root cleanupをcontract/integration testで検証する。
- Chrome APIはstubまたはin-memory adapterへ置換し、決定的なテストを保つ。
- fixtureは架空の商品、HTML、データだけで構成する。
- 破損入力、schema移行、容量不足、競合、原子的置換、maintenance fencing、navigation、feature障害分離を回帰対象にする。
- 型検査、Biome、test、build、生成物のセキュリティ検査を、最終的に一つの検証フローへまとめる。

## 開発コマンド

`package.json` に再現可能な共通scriptを整備済みである。

- `pnpm typecheck` / `pnpm typecheck:public-consumer`: 実装と公開consumerの型検査
- `pnpm lint`: Biomeによる静的検査
- `pnpm test`: Node test runner（tsx loader）によるunit・contract・integration・DOM test
- `pnpm build`: MV3 production artifactの生成
- `pnpm test:e2e`: production build後のPlaywright E2E
- `pnpm validate:boundaries` / `validate:fixtures` / `validate:final-build` / `validate:artifacts`: 公開境界違反、実データ混入、最終build gate、生成物の機械的検査
- `pnpm validate`: 上記をまとめたcanonical validation（型、lint、境界、fixture、最終build gate、test、E2E）

局所タスクでは関連する軽量commandを先に実行し、feature完了時は `pnpm validate` を基準とする。

## 主要な技術判断

- application shellだけがside panel host、feature registration、typed navigation、service-worker composition、root公開API、共通maintenance表示を組み立てる。
- application shellはReact runtime導入、shell root、feature mount container、共通error boundaryの統合規約を所有する。各featureは自身のReact componentとroot adapterを所有し、他featureのcomponentを直接importしない。
- local data foundationだけが共通結果型、保存検証・移行、単一write authority、原子的root mutation、参照修復、maintenance fencingを所有する。
- featureは `public.ts`、登録モジュール、必要なruntime registration portを公開し、共有runtime入口を直接編集しない。
- ライブラリの固定より、境界契約、最小権限、データ整合性、決定的テストを優先する。

---
_依存パッケージの一覧ではなく、技術選択と実装判断を導く原則を記録する。_
