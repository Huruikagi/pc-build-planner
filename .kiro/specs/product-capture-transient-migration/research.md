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
5. `editor-navigation.ts`とshellのtyped activationは引き渡しに再利用できる。
6. 抽出中の世代失効後に後着した結果を捨てるgeneration checkが必要である。

## Selected Boundary

- product-capture: fixed tab execution、実行状態、failure presentation、handoff intent作成
- candidate-management: project解決、pre-edit validation、編集状態、保存時validation
- shell: activation generation、lifecycle、conclude（参照のみ）

## Validation Focus

- 実product-capture登録による上流shell 4.5のproduction MV3 E2E
- 起動だけでは解析しない
- stale resultをhandoffしない
- handoff成功/失敗の原子性
- 空名手入力の編集開始と保存拒否
- 既存抽出・候補保存の非回帰
- 常設ナビからのcapture除去
