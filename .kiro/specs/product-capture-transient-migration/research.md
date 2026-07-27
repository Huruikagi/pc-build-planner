# Research: product-capture-transient-migration

## 分割メモ

2026-07-27、旧 `transient-feature-surface` からproduct-capture/candidate-managementの移行責務を分離した。本書は上流shell契約を利用する業務feature側だけを扱う。

## Existing Assets

- `src/features/product-capture/state.ts`: `idle | extracting | review | submitting | saved | failed`
- `src/features/product-capture/view.tsx`: 実行から確認・保存までを同一viewで描画
- `src/features/product-capture/coordinator.ts`: 実行時のタブ解決と抽出
- `src/features/product-capture/editor-navigation.ts`: candidate editorへのtyped activation
- `src/features/product-capture/draft-mapper.ts`: `CandidateDraft`生成と名前必須検証
- `src/features/candidate-management/activation.ts`: payload検証と編集状態開始
- `src/features/candidate-management/contracts.ts`: canonical `CandidateDraft`

## Key Findings

1. capture stateはfeature mount/unmountと独立して保持されるため、世代変更時の明示resetが必要である。
2. `review | submitting | saved`は一過性面の責務外で、candidate-managementへ移すべきである。
3. 既存`CandidateDraft`は`projectId`と商品名を必須にするため、project未解決の編集開始には別のpre-edit契約が必要である。
4. 候補ゼロ時は商品名も空であるため、編集開始の構造検証と保存時検証を分離しなければ手入力画面へ到達できない。
5. `editor-navigation.ts`のdraft変換知識は再利用できるが、直接navigation callbackは原子的`conclude`を迂回する。純粋な`editor-handoff.ts`とcandidate-management所有のtyped intent factoryへ置き換える必要がある。
6. 抽出中の世代失効後に後着した結果を捨てるgeneration checkが必要である。
7. 現行capture contributionの`capture`、`listProjects`、`openCandidateEditor`は、直接保存・capture内project選択・直接navigationの旧責務に属する。移行後は固定tab抽出runtime、lifecycle port、typed intent factoryだけが必要である。
8. projectが0件のときにactivationを失敗させると、project作成のための常設navigationがcapture stateを終了させ、保持した抽出結果を失う。candidate-managementが解決前draftを先に受理する必要がある。

## Selected Boundary

- product-capture: fixed tab execution、実行状態、failure presentation、handoff intent作成
- candidate-management: pre-edit受理、project-required state、project解決、編集状態、保存時validation
- shell: activation generation、lifecycle、conclude（参照のみ）

## Design Decisions

### project未作成時は非一過性pre-editへ引き渡す

- **選択**: candidate-managementが解決前draftを受理してproject作成を提示し、作成成功後に返されたProjectIdでcanonical draftへ解決する。
- **棄却**: no-projectをhandoff失敗としてcaptureに留める案は、project作成のためのnavigationでcapture stateを失う。default projectの自動作成は明示的なproject作成要件と構成検討単位の意味を変更する。
- **帰結**: `conclude`の成功条件はeditor完成ではなく、candidate-managementが回復可能なpre-edit stateを受理したことになる。

### captureの公開依存を移行後の責務へ縮小する

- **選択**: 固定tab抽出runtime、`TransientSurfaceLifecyclePort`、candidate-management所有のtyped intent factoryだけを注入する。
- **棄却**: `CaptureCandidatePort`、`listProjects`、直接`openCandidateEditor`は旧保存・project選択・navigation責務をcaptureへ残すため削除する。
- **帰結**: candidate-managementの保存authorityとproject解決を公開consumerへ漏らさず、handoffの原子性を上流`conclude`へ一本化できる。

## Validation Focus

- 実product-capture登録による上流shell 4.5のproduction MV3 E2E
- 起動だけでは解析しない
- stale resultをhandoffしない
- handoff成功/失敗の原子性
- 空名手入力の編集開始と保存拒否
- project 0件でのpre-edit保持、project作成後の継続、作成失敗時の保持
- 既存抽出・候補保存の非回帰
- 常設ナビからのcapture除去
