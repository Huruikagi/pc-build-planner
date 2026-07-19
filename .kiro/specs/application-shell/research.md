# 調査・設計判断

## サマリー
- **Feature**: `application-shell`
- **Discovery Scope**: New Feature（greenfield、統合境界中心）
- **主な所見**:
  - 実装済みコードや既存extension pointはなく、roadmapとbriefが契約の正本である。
  - shellは永続化やmaintenance leaseを所有せず、foundationの世代付きread-only状態だけを投影する必要がある。
  - 一覧、フォーム、確認、失敗回復を横断するUI規模を踏まえ、React 19系を宣言的な表示adapterとして採用する。
  - React DOMの`createRoot`と`root.unmount()`は既存のcontainerベースmount/unmount契約を変更せず統合できる。
  - MV3のCSPを維持するため、React runtimeとUI codeはproduction bundleへ同梱し、runtime JSX変換やremote codeを使用しない。

## 調査ログ

### 既存構造と統合点
- **背景**: 共有runtime入口の所有権競合を解消する必要がある。
- **参照元**: `brief.md`、`.kiro/steering/roadmap.md`、リポジトリのファイル構造。
- **所見**: `src/` と `tests/` は未作成。下流featureはregistration moduleと`public.ts`を供給し、shellだけが`side-panel.html`、`src/runtime/side-panel.ts`、`src/index.ts`を所有する。
- **影響**: contract-firstでファイル境界を新設し、統合fixtureで下流featureを模擬する。

### Platform適合性
- **背景**: Chrome 116以降のManifest V3 side panelを対象とする。
- **参照元**: roadmapとbriefの確定制約。
- **所見**: `sidePanel.open()`のユーザージェスチャー制約をcomposition後の非同期処理へ移さない。実行コードはすべて同梱する。
- **影響**: gesture entryは薄いruntime adapterとし、host初期化とは契約を分離する。

## アーキテクチャパターン評価

| 選択肢 | 強み | 制約 | 判断 |
|---|---|---|---|
| Registry + Composition Root | 共有入口を単独所有しfeatureを独立化 | 登録契約の安定性が必要 | 採用 |
| 各featureがrootを編集 | 初期実装が単純 | 競合と逆依存を再発 | 不採用 |
| React 19系 + feature単位UI adapter | 宣言的描画、複雑なフォームと状態表示、成熟したTypeScript支援 | bundle増加、root cleanup規約が必要 | 採用 |
| Preact互換層 | 小さいruntime、Reactに近いAPI | 互換差分と周辺情報の確認コスト | 不採用 |
| 標準DOM/CSS | 依存最小 | 手動描画・イベント・cleanupがUI規模に対して複雑化 | 不採用 |

## 設計判断

### 判断: 宣言的registrationとlifecycle port
- **背景**: ナビゲーション、mount、利用可能性、mutation抑止を同じ参加方式で扱う。
- **選択**: 一意なid、表示metadata、availability購読、mount/unmountを持つ型付き契約を定義する。
- **理由**: interfaceを一般化しつつ、実装は現在必要なside panel lifecycleだけに限定できる。
- **トレードオフ**: feature側にadapterが必要だが共有ファイル競合を除去できる。

### 判断: Maintenanceは世代・revision cursor付きの単調projection
- **背景**: 通知の遅延やworker再生成で古い状態が到着し得る。
- **選択**: shellは`(generation, revision)`の最大cursorを保持し、それ以下の通知を無視するread-only projectionとする。
- **理由**: lease所有をfoundationに残しながらUIの状態後退を防ぐ。

### 判断: Reactを表示adapterとして採用
- **背景**: shell自体は薄いが、下流featureは一覧、複数フォーム、確認、非同期失敗回復を持ち、標準DOMの手動更新では見通しが悪化する。
- **選択**: React 19系とReact DOMをproduction bundleへ同梱し、function componentとJSXでUIを実装する。
- **理由**: 宣言的描画とTypeScript支援を利用しつつ、既存の`FeatureMountContext`とmount/unmount契約を維持できる。
- **トレードオフ**: bundleは増えるが、MV3 extension pageではローカル同梱できる。ReactはUI adapterに限定し、state、service、portはframework非依存に保つ。

### 判断: React root lifecycleを既存feature契約へ閉じ込める
- **背景**: shellとfeatureの所有権を崩さずReactを導入する必要がある。
- **選択**: shellはshell rootを、各feature registrationは自身のfeature rootを生成し、公開mountが返すunmountで`root.unmount()`を一度だけ呼ぶ。
- **理由**: componentをfeature境界越しに共有せず、既存contract test kitでcleanupを検証できる。

### 判断: UIとworkerのregistrationをshellで合成する
- **背景**: product captureはaction handlerを必要とするが、featureによる共有service worker入口の直接編集は禁止される。
- **選択**: side panel用`ApplicationFeatureRegistration`とは別に型付きworker registrationを定義し、composition rootだけが共有workerへ登録する。
- **理由**: UI lifecycleとworker event lifecycleを混同せず、共有runtimeの単一所有権を維持できる。

## リスクと緩和策
- 下流featureの契約解釈ずれ — contract test kitと型検査で検出する。
- mount失敗によるhost停止 — feature単位のerror boundaryと確実なunmountで分離する。
- maintenance通知の逆転 — 世代比較を状態更新の前提にする。
- gesture消失 — `sidePanel.open()`を同期的なユーザー操作adapter内で呼ぶ統合試験を設ける。
- React rootまたは購読の残存 — feature切替、mount失敗、shell停止のcontract/integration testでcleanupを検証する。
- React開発buildやremote codeの混入 — production conditionでbundleし、artifact検査でremote script、eval、runtime JSX変換を拒否する。

## 参照
- `.kiro/steering/roadmap.md`
- `.kiro/specs/application-shell/brief.md`
- [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [ReactでTypeScriptを使用する](https://react.dev/learn/typescript)
- [Chrome Extensions Content Security Policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Manifest V3 security migration](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
