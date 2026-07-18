# 調査・設計判断

## サマリー
- **Feature**: `application-shell`
- **Discovery Scope**: New Feature（greenfield、統合境界中心）
- **主な所見**:
  - 実装済みコードや既存extension pointはなく、roadmapとbriefが契約の正本である。
  - shellは永続化やmaintenance leaseを所有せず、foundationの世代付きread-only状態だけを投影する必要がある。
  - 外部UI frameworkは要件上不要であり、TypeScriptと標準DOM/CSSで最小のhostを構成できる。

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
| UI framework/plugin基盤 | 高機能 | MVPに不要な依存と抽象化 | 不採用 |

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

### 判断: 標準DOM/CSSを採用
- **背景**: shellは薄いhostであり複雑なUI framework機能を必要としない。
- **選択**: 外部runtime依存を追加しない。
- **理由**: CSP、同梱要件、Chrome互換性を最小構成で満たす。

## リスクと緩和策
- 下流featureの契約解釈ずれ — contract test kitと型検査で検出する。
- mount失敗によるhost停止 — feature単位のerror boundaryと確実なunmountで分離する。
- maintenance通知の逆転 — 世代比較を状態更新の前提にする。
- gesture消失 — `sidePanel.open()`を同期的なユーザー操作adapter内で呼ぶ統合試験を設ける。

## 参照
- `.kiro/steering/roadmap.md`
- `.kiro/specs/application-shell/brief.md`
