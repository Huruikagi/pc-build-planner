# 技術方針

## アーキテクチャ

PC版Chrome 116以降を対象とする、ローカルファーストのManifest V3拡張である。UIはside panelとReact/CSSを中心に構成し、バックエンド、アカウント、同期に依存しない。

業務機能はfeature単位の垂直スライスに閉じ、共有基盤とは型付きportで接続する。local data foundationがデータ契約と永続化の整合性を、application shellが共有runtimeとUI compositionを所有する。featureをまたぐ横断責務（UIメッセージ、表示言語、現在選択プロジェクト）は、featureでもfoundationでもない共有コアモジュールがcanonical ownerとなる（`structure.md` 参照）。

依存はドメイン契約からadapter/runtimeへ一方向に流す。featureは公開portを利用し、Chrome Storageや共有runtime入口へ直接依存しない。

## 現在の開発基盤

- **Runtime toolchain**: Node.js 26.5.0
- **Package manager**: pnpm 11.13.1
- **Module system**: ESM
- **Code quality tool**: Biome 2.5.6
- **Application source**: MVP（v0.1.0）以降、v0.3.0までをリリース済み。local data foundation、application shell、共有コアモジュール、Manifest V3 runtime、7つの業務feature（候補管理、現在構成、商品取り込み、互換性、backup/restore、設定、取得元価格更新）、型検査、build、test、E2E、検証gateが揃っている。以降の変更は既存の公開境界と検証フローに乗せる。

UI実装にはReact 19系とReact DOMを使用し、production buildへ同梱する。TypeScript 7、esbuild、Node test runner、jsdom、Playwright、Chrome typingsを固定済みであり、Node.js 26とChrome 116以降を対象に共通検証scriptから実行する。実行時依存はZod Mini（`zod/mini`）だけであり、配布物にはそのライセンスnotice（`THIRD_PARTY_NOTICES.txt`）を同梱する。`schema-dts` はdevDependencyかつtype-only importとし、production bundleへ含めない。依存更新時はReact、React DOM、型定義の対応majorと、MV3/CSP互換性を維持する。

## 実行環境とUI

- Manifest V3に準拠し、実行コードはすべて拡張へ同梱する。
- UIの宣言的描画、フォーム、一覧、確認フローにはReact function componentとJSXを使用し、CSSはfeature単位に所有する。
- Reactは表示adapterに限定し、ドメインstate、service、port、永続化契約をReact hookやcomponentへ埋め込まない。
- shellとfeatureの境界では既存の`FeatureMountContext`とmount/unmount lifecycleを維持し、React rootの生成と`root.unmount()`は各UI adapterが責任を持つ。
- `sidePanel.open()` は有効なユーザージェスチャー内で呼び出す。
- MV3 service workerのメモリや寿命を、永続状態、処理継続、排他制御の唯一の根拠にしない。
- 標準Web APIを優先し、runtime依存を追加するときはMV3、CSP、容量、保守性への影響を明示する。

## データと永続化

- 永続化には `chrome.storage.local` を使用し、既定10MB上限を前提に容量を監視する。一時的な起動状態だけ `chrome.storage.session` を使い、業務データを置かない。
- local data foundationを単一の信頼済みwrite authorityとし、すべての永続化mutationをそこへルーティングする。
- 例外はcanonical rootの外に置くUI preference（表示言語、現在選択プロジェクト）に限り、専用keyへscopeした所有adapterからのみ書き込む。例外を増やすときは公開境界gateのallowlistとnegative testを同じ変更で追加する。
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

### 実行時スキーマ検証

境界検証はZod Miniによる宣言的schemaを基盤とする。MV3のCSPは動的コード評価を禁じるため、schema生成より前に `jitless` を有効化できることが採用の前提である。

- vendorパッケージのimportは単一のcanonical入口（`src/domain/runtime-schema/`）に限り、そこから名前付きre-exportした表面だけを利用する。名前空間丸ごとのre-exportはtree shakingを壊すため行わない。
- vendorのerror class、locale、schema instanceを公開契約へ露出しない。検証失敗はcanonical `Result<T, E>` と安定したエラーコードへ変換する。
- production bundleに動的な `Function` 呼び出しが残らないことをbuild gateで検査する。文字列一致だけに依存せず、alias経由の呼出しも検出する。
- schemaはownerのfeature/foundation内に置き、feature間でdeep importしない。

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
- `pnpm validate:ui-text`: UI層のソースに直書きの自然言語文字列が混入していないことの検査（メッセージカタログが唯一の文言source of truth）
- `pnpm validate:runtime-schema`: 実行時schema vendorのCSP適合gate。`build` と `validate:artifacts` からも呼ばれる
- `pnpm validate:ci`: 型（実装・公開consumer）、lint、境界、fixture、最終build gate、UI文言、testの逐次実行（E2Eを含まない）
- `pnpm validate`: `validate:ci` にPlaywright E2Eを加えた完全検証
- `pnpm package`: build後、配布用zipを`release/`へ生成する

局所タスクでは関連する軽量commandを先に実行し、feature完了時は `pnpm validate` を基準とする。

CIとリリースの責務は分離している。検証CI（`.github/workflows/ci.yml`）は`main`へのpush・PR・手動起動でE2Eを含まない`pnpm validate:ci`のみを実行し、検証ロジック自体は持たない。E2Eを含む完全検証（`pnpm validate`）は手動起動のみのリリースワークフロー（`.github/workflows/release.yml`）で実行し、version整合・タグ重複・マイルストーン状態の前提ゲートを通過した後にのみ走らせる。

## 主要な技術判断

- application shellだけがside panel host、feature registration、typed navigation、service-worker composition、root公開API、共通maintenance表示を組み立てる。
- application shellはReact runtime導入、shell root、feature mount container、共通error boundaryの統合規約を所有する。各featureは自身のReact componentとroot adapterを所有し、他featureのcomponentを直接importしない。
- local data foundationだけが共通結果型、保存検証・移行、単一write authority、原子的root mutation、参照修復、maintenance fencing、実行時schema primitiveを所有する。
- 共有コアモジュールがそれぞれ単一の横断責務を所有する。UIメッセージカタログと解決、表示言語の決定と永続化、現在選択プロジェクトのcontract・選択transaction・切替guard・共通selectorを、featureごとに再実装しない。
- UI文言はカタログを唯一のsource of truthとし、componentへ直接自然言語を書かない。ロケール固有の取り込み支援データは表示文言ではなく、カタログの外にロケール別データとして置く。
- featureは `public.ts`、登録モジュール、必要なruntime registration portを公開し、共有runtime入口を直接編集しない。
- ライブラリの固定より、境界契約、最小権限、データ整合性、決定的テストを優先する。
- ライブラリは実装開始時点の最新stable majorを採用し、対象Node/Chromeとの互換性を確認する。旧major互換の維持や段階的migrationは行わない。

---
_依存パッケージの一覧ではなく、技術選択と実装判断を導く原則を記録する。_
