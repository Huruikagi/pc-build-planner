# Brief: product-capture-transient-migration

出典: GitHub issue [#6](https://github.com/Huruikagi/pc-build-planner/issues/6)（milestone v0.3.0）

## Problem

product-captureは実行、抽出結果の確認・補正、保存までを一つの常設面で所有している。そのため対象タブへの一時権限が失効しても実行操作が残り、表示面の終了時に確認中の内容を失わない責務分割もできていない。

## Current State

状態は`idle | extracting | review | submitting | saved | failed`で、viewも全段階を描画する。対象タブは実行時に現在のactive tabとして解決され、候補管理へのtyped activationは存在するものの、抽出成功時の正式な引き渡し境界にはなっていない。

## Desired Outcome

product-captureをshellの一過性feature契約の最初の利用者へ移行し、一過性面には実行・実行中・実行失敗だけを残す。抽出結果は候補管理の非一過性編集面へ型安全に引き渡し、確認・補正・保存は対象タブの寿命から切り離す。

## Approach

上流spec `transient-feature-surface` の`ActivationId`、固定`tabId`、`conclude`契約を利用する。capture状態を縮小し、抽出成功時はproject未解決の`UnresolvedCandidateDraft`を候補管理へ渡す。編集開始の構造検証と保存時検証を分け、候補ゼロ時は空の商品名から手入力を開始できるようにする。

## Scope

- **In**: product-captureの一過性登録、状態・view縮小、固定タブでの実行、stale抽出結果抑止、候補管理への原子的引き渡し、pre-edit draft、手入力導線、文言・テスト・E2E更新。
- **Out**: 一過性feature基盤の再定義、抽出優先順位・正規化、候補保存規則、複数ソース化、価格更新。

## Boundary Candidates

- product-capture所有の実行状態と抽出coordinator
- candidate-management所有のproject解決、pre-edit検証、編集状態
- shell所有の一過性面終了・引き渡し契約

## Out of Boundary

- shell/runtimeの起動配送とタブ監視実装
- 候補の保存・編集規則そのもの
- 抽出ロジックと商品データschema
- コンテキストメニューによる価格更新

## Upstream / Downstream

- **Upstream**: `transient-feature-surface`、`product-page-capture`、`project-candidate-management`
- **Downstream**: `source-price-refresh`、`duplicate-product-merge`

## Existing Spec Touchpoints

- **Extends**: `product-page-capture` の要件4（簡易確認・補正）と要件5（project選択・保存）を候補管理への即時引き渡しへ置換し、要件1.4 / 6.1 / 6.4の権限失効・遷移・再実行を一過性面の寿命へ合わせる。`project-candidate-management` にはproject未解決・空名の編集開始activationを追加する
- **Adjacent**: `ui-message-catalog`、`candidate-source-bookmarks`

## Constraints

一過性面は起動だけでページを読み取らない。異なる`ActivationId`の結果を引き渡さない。候補管理のcanonical `CandidateDraft`と保存時validatorを維持し、仮project IDやunsafe castを使わない。

## Change Brief: v0.4.0

### Problem

アプリ共通の現在project導入後に、product-capture側やlegacy payloadが保存先projectを決めると、候補管理が表示している現在projectと異なるprojectへ取り込み内容を渡す危険がある。current contextが未選択・利用不能の場合にも、抽出結果を失わず後から再開できる責務分離が必要である。

### Current State

本specはproject IDを持たない`UnresolvedCandidateDraft`の原子的handoff、失敗時のintent保持、retry、rollback generationを所有する。project解決はcandidate activationへ委ねているが、candidate側には一覧先頭fallbackと任意payload IDの経路が残り、project-contextとの契約が未定義である。

### Desired Outcome

product-captureは引き続きproject未解決のhandoff intentだけを配送し、保存先の選択やfallbackを行わない。candidate ownerが検証済みcurrent contextへbindできない場合は、取り込みintentとpre-edit内容を保持し、利用者がprojectを選択・作成した後に再抽出せずretryできる。無効・staleなproject情報でcurrent contextを上書きしない。

### Scope

- **In**: project未解決handoff契約の維持、context未選択・unavailable・candidate受理失敗時のintent保持、明示的な選択・作成後のretry、成功時だけの一過性面終了、rollback generation、handoff回帰検証。
- **Out**: current projectの選択・fallback・永続化、candidate pre-editの保存先決定、project CRUD、candidate editor state、application shellのport注入、抽出schema・優先順位の変更。

### Boundary Impact

- **Extends**: `product-capture-transient-migration`のhandoff失敗保持、retry、conclude/rollback lifecycle。
- **Preserves**: 一過性面は抽出実行だけを所有し、project未解決draftを送り、確認・補正・保存をcandidate ownerへ委ねる境界。
- **Adjacent**: `project-candidate-management`が検証済みcurrent contextへのbindingとpending pre-editを、`project-context`が現在選択を、application shellがtyped activation配送を所有する。

### Dependencies

- **Upstream**: `project-context`、Milestone v0.4.0の`project-candidate-management` update。
- **Downstream**: product-captureから共通current projectへ一貫して保存するproduction flow。

### Source

- Milestone v0.4.0 roadmap、GitHub Issue #29、cross-spec decomposition review。
