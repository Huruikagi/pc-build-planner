# セキュリティ規約

本プロダクトの脅威モデルは、ネットワーク越しの攻撃者ではなく**閲覧中のWebページ**である。ユーザーは任意のECサイト・メーカーサイトで拡張を起動するため、ページDOM、content scriptからのメッセージ、抽出結果はすべて攻撃者が制御しうる入力とみなす。認証、サーバー、シークレットは存在しないため、防御の中心は**権限の最小化・境界での検証・ローカルデータの保全**にある。

戦略レベルの技術方針は `tech.md`、境界と所有権は `structure.md` を参照する。本書はセキュリティ判断の根拠と、破ってはならない規約を記録する。

## 基本姿勢

- **最小権限**: 恒久的なhost permissionを持たない。ユーザーが明示操作した瞬間のタブにだけ、一時権限で到達する。
- **fail closed**: 検証に落ちた入力は破棄し、部分的に信頼して処理を続けない。判断材料が足りないときは「情報不足」として扱い、推測で補わない。
- **境界で検証する**: ページ、content script、runtime message、JSON、storageから来る値は `unknown` として受け取り、境界で検証してからドメイン型へ変換する。内部へ未検証値やChrome固有payloadを拡散させない。
- **規約はscriptで守る**: 人手のレビューに依存せず、破ってはならない規約は `scripts/validate-*.mjs` の機械的検査として実行可能にする。

## 権限とmanifest

宣言する権限は `storage` / `activeTab` / `scripting` / `sidePanel` / `contextMenus` の5つに固定する。`contextMenus` はmenu item提供だけに使用し、host permissionを伴わない。この集合は `scripts/validate-artifacts.mjs` が生成物の `manifest.json` に対して検査し、以下を**ビルドgateで失敗させる**。

- 許可集合外の権限、重複、`storage` の欠落
- `host_permissions` / `optional_host_permissions` / `optional_permissions` の存在
- `manifest_version !== 3`、`minimum_chrome_version !== "116"`
- extension pages CSPが `script-src 'self'; object-src 'self'` 以外であること

権限を増やす提案は、この検査を書き換える提案と同義である。まず「なぜ一時権限で足りないか」を要求仕様側で示す。

## 商品取得（最も外側の境界）

- 取得はユーザーの明示操作だけを契機とする。バックグラウンドの巡回・自動再取得・投機的取得を行わない。
- `sidePanel.open()` は有効なユーザージェスチャー内で呼び出す。
- ページDOMの解析は注入関数またはcontent scriptで行い、MV3 service workerの寿命に処理継続や排他状態を依存させない。
- **出所の取り違えを禁じる**: 商品ページのURLはページ自身が報告した値を使い、注入先タブの `target.url` で代用しない。`tabId` はChromeの注入先、`requestId` は往復の対応付けであって、いずれもページ由来データの信頼根拠にはならない。

```typescript
// pageUrl はページ由来。tabId / requestId は信頼の根拠ではなく対応付けの手段。
// 参照実装: src/features/product-capture/chrome-runtime-port.ts
```

## メッセージ送信元の検証

runtime messageは受け取った時点では未信頼である。handlerへ渡す前に送信元を分類し、権限のある呼び出しかを判定する。

判定軸は次の3つで、`src/runtime/foundation-message-target.ts` の `classifyCaller` が参照実装となる。

1. `sender.id` が自拡張のIDと一致するか（他拡張・他オリジンからの到達を排除）
2. `sender.tab` が存在しないこと（タブ = ページ文脈からの呼び出しを信頼済み側と扱わない）
3. `sender.url` が自拡張の `getURL("")` 配下にあること

content scriptは常に未信頼側に落ちる。信頼済み文脈でしか許されない操作を、送信元の自己申告（メッセージ本文中のロール名など）で判定しない。

## 永続化とデータ保全

- storageのaccess levelは `TRUSTED_CONTEXTS` に設定し、content scriptへ保存APIを到達させない（`src/persistence/chrome-storage-adapter.ts`）。
- すべての永続化mutationは単一write authorityへルーティングする。featureがChrome Storage adapterを直接呼ぶ経路を作らない。
- 復元は原子的置換として扱い、maintenance generationとowner fencingをcommit直前にも再検証する。worker再生成やstale lockで排他を破らない。
- **書き込み失敗時は既存の有効データを保持する**。壊れた中間状態を書き残すより、操作を失敗させる。
- 生HTMLと商品画像は永続保存しない。`chrome.storage.local` の既定10MB上限を前提に容量を監視する。

## コード実行とレンダリング

生成物に対して `scripts/validate-artifacts.mjs` が以下を機械検査する。該当パターンはビルドgateで失敗する。

- `eval` / `new Function` / 実行時JSX変換
- リモートimport、`importScripts` によるリモート読み込み
- `dangerouslySetInnerHTML` および `innerHTML` への代入
- HTML中のインラインscript、`on*=` 属性、`javascript:` URL、非moduleスクリプト、ローカル以外のscript src

外部文字列は通常のJSX childまたは安全なDOM textとして描画する。未信頼文字列を扱うcomponentでは、HTML注入が起きないこと（例: `querySelector("img")` が `null`）を回帰対象にする（`testing.md` 参照）。

## ログとエラー

シークレットは存在しないが、**ユーザーの閲覧履歴と検討内容は機微データ**である。ログ・エラーメッセージへ次を出さない。

- 生HTML、抽出した商品値、完全URL、保存内容
- 例外オブジェクトのそのままのdump

失敗は判別可能な `Result<T, E>` またはerror unionで表現し、ログへ出すのは安定した**エラーコード**に限る（参照: `src/persistence/production-runtime-contribution.ts` の `console.error(error.code)`）。呼び出し側が原因を必要とするなら、文字列化ではなく型で返す。

## リポジトリに置いてよいデータ

実サイト由来のHTML、画像、取得した商品データを、fixtureやサンプルとしてリポジトリへ含めない。`scripts/validate-fixture-assets.mjs` が `tests/fixtures` と生成物を走査し、以下を違反として検出する。

- `raw-html`: 生HTML断片
- `image-file` / `data-url`: 画像ファイル、data URL埋め込み
- `non-synthetic-url` / `non-synthetic-sourced-value`: 実在サイトを指すURLや、出所付きフィールドに入った非架空値

fixtureは架空の商品・HTML・データだけで構成する。実サイトで発見した不具合を再現するときは、**現象を再現する最小の架空データへ翻訳してから**コミットする。

## 依存とサプライチェーン

- 実行コードはすべて拡張へ同梱する。CDN、リモートスクリプト、実行時ダウンロードに依存しない。
- 依存追加時はMV3・CSP適合、バンドルサイズ、保守性への影響を明示する。CSPを弱める前提の依存は採用しない。
- 生成物側にも公開境界検査（`validate-boundaries`）を適用し、bundleがfoundationの非公開能力（storage adapter、composition root、write authority等の生成関数）を露出しないことを検査する。

---
_設定値の一覧ではなく、脅威モデルと、機械検査に落とし込んだ「破ってはならない規約」の根拠を記録する。_
