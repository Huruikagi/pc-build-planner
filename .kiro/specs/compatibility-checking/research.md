# Research & Design Decisions

## Summary
- **Feature**: `compatibility-checking`
- **Discovery Scope**: Extension
- **Key Findings**:
  - `CurrentBuildQuery` は候補IDと数量だけを返し、候補詳細は `CandidateQuery.listBuildEligible` から同一プロジェクトに限定して取得する必要がある。
  - Foundationの `CandidatePart.normalizedAttributes` は元表記と確認値を分離するため、判定エンジンは確認済み値だけを射影した入力を受け取れる。
  - 判定結果は保存対象でなく、上流スナップショットから再現可能な派生データとして扱う。

## Research Log

### 上流契約と拡張点
- **Context**: 現在構成と候補属性の所有権を越えずに判定入力を構築する必要がある。
- **Sources Consulted**: `.kiro/specs/local-data-foundation/design.md`、`.kiro/specs/project-candidate-management/design.md`、`.kiro/specs/current-build-management/design.md`。
- **Findings**: CurrentBuildは同一プロジェクトの候補参照と正整数数量を保持する。CandidateQueryは分類済みCandidatePartを返す。RepositoryとStorage APIの直接利用は不要である。
- **Implications**: 入力組立は二つの公開Query契約だけへ依存し、ID結合と参照検証をCompatibilityServiceが所有する。

### 判定範囲と集約
- **Context**: 4区分を、5種類の決定的な二項規格ルールと複数選択へ一貫して適用する必要がある。
- **Sources Consulted**: `docs/requirements.md`、`docs/project-overview.md`、本specのbrief。
- **Findings**: MVP規則は等値または集合包含で表現できる。欠損は非互換でない。数量は規格比較数を増やさず、異なる選択候補だけを展開すればよい。
- **Implications**: 個別規則は compatible / incompatible / unknown を返し、集約器が「ありと不明の混在」を caution として表現する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 純粋ルール関数 + feature service | 規則を副作用なしで評価し、serviceが上流読取と集約を担当 | 決定的、単体検証容易、保存不要 | 入力射影契約を明確にする必要 | 採用 |
| 判定結果の永続化 | 結果をCurrentBuild付近へ保存 | 再表示が速い | 陳腐化、上流所有権侵害、移行増加 | 不採用 |
| 汎用ルールDSL | 規則をデータ駆動で記述 | 将来拡張性 | MVPの5規則には過剰 | 不採用 |

## Design Decisions

### Decision: 評価結果を派生データにする
- **Context**: 構成または属性変更後に古い結果を残さない。
- **Alternatives Considered**: 結果保存、入力変更時の無効化、表示時再計算。
- **Selected Approach**: 表示要求ごとに検証済みスナップショットを読み、純粋エンジンで再計算する。
- **Rationale**: CurrentBuildの「互換性結果を含めない」契約を守り、同期責任を増やさない。
- **Trade-offs**: 表示ごとに計算するが、最大10MBのローカルMVPと5規則では負荷が小さい。

### Decision: ルールインターフェースだけを一般化する
- **Context**: 5規則は同じ適用・不足・根拠構造を持つ。
- **Selected Approach**: 共通Rule契約と固定レジストリを作り、DSLや外部規則読み込みは作らない。
- **Rationale**: 新規依存なく将来規則を追加でき、MVP範囲を超えない。
- **Trade-offs**: 規則追加にはコード変更とテストが必要である。

## Risks & Mitigations
- 未確認値の混入 — 入力射影で確認状態を必須判定し、元表記を規則へ渡さない。
- 上流参照の不整合 — projectId、partId、categoryを評価前に照合し、全評価を停止する。
- 複数メモリ候補の見落とし — 候補ID単位で直積展開し、数量による重複だけを抑止する。
- 集約の誤解 — 優先規則と全個別結果を同時表示する。

## References
- `.kiro/steering/roadmap.md`
- `.kiro/specs/local-data-foundation/design.md`
- `.kiro/specs/project-candidate-management/design.md`
- `.kiro/specs/current-build-management/design.md`
- `docs/requirements.md`
- `docs/project-overview.md`

### 2026-07-19 React UI方針更新
- **背景**: 集約区分、個別根拠、不足項目、loading/empty/errorを同じ画面で安全に切り替える必要がある。
- **判断**: `view.tsx`をReact function componentとし、feature固有の`react-root.tsx`で既存`FeatureMountContext`へ接続する。
- **境界**: CompatibilityState、rule、aggregator、queryはframework非依存を維持する。表示値は通常のJSX childとし、`dangerouslySetInnerHTML`と`innerHTML`を禁止する。
- **統合**: featureは`public.ts`とregistration moduleを所有し、共有side panel runtimeとroot barrelを編集しない。
- **検証**: React DOM表示、旧評価破棄、unmount cleanupを統合testで確認する。
- **参照**: [React createRoot](https://react.dev/reference/react-dom/client/createRoot)、[React TypeScript](https://react.dev/learn/typescript)
