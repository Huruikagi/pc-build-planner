# Research & Design Decisions

## Summary
- **Feature**: `current-build-management`
- **Discovery Scope**: Extension
- **Key Findings**:
  - Foundationは`CurrentBuild`の同一プロジェクト参照と正整数数量だけを保証し、カテゴリ別選択規則は下流へ委ねる。
  - CandidateQueryは未分類を除く`listBuildEligible`を公開し、候補の所有権は候補管理境界に残る。
  - 候補カテゴリ変更時の単一選択競合は自動解決せず、既存構成を保持して利用者へ選択を求める必要がある。

## Research Log

### 上流データ契約と統合点
- **Context**: 現在構成が候補や保存基盤の責務を重複して所有しない境界を確認した。
- **Sources Consulted**: `local-data-foundation` と `project-candidate-management` のrequirements、design、tasks。
- **Findings**: `LocalDataRoot.currentBuilds`、`putCurrentBuild`、`CandidateQuery.listBuildEligible`が利用可能である。Repositoryは全体検証、容量、移行、直列更新を所有する。
- **Implications**: 本機能は選択ポリシー、構成更新コマンド、UI状態、下流照会に限定し、Storage APIへ直接依存しない。

### カテゴリ変更時の整合性
- **Context**: 選択済み候補の分類変更が選択数規則を変える可能性がある。
- **Sources Consulted**: roadmapのShared seams、current-build-management brief。
- **Findings**: 未分類化と削除は参照除去で決定的に処理できる。一方、単一選択カテゴリの競合には利用者の意思決定が必要である。
- **Implications**: 整合性調停を明示的コマンドとし、競合中は有効な保存状態を変更しない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| Feature service + UI state | 選択規則をサービスへ、保存中・競合状態をUI stateへ分離 | 上流パターンと整合しテスト可能 | 候補変更との統合契約が必要 | 採用 |
| UI直接Repository更新 | 画面イベントから構成を組み立てて保存 | ファイル数が少ない | 規則が表示へ漏れ下流契約を再利用できない | 不採用 |
| イベント駆動同期 | 候補変更イベントで構成を更新 | 疎結合 | MVPにイベント基盤がなく過剰 | 不採用 |

## Design Decisions

### Decision: カテゴリポリシーを純粋な共有契約に集約する
- **Context**: UI、更新サービス、テストで選択方式が分岐する。
- **Alternatives Considered**: 各コンポーネントへ列挙、カテゴリメタデータ契約へ集約。
- **Selected Approach**: カテゴリから`single`、`multiple`、`ineligible`を返す純粋契約を一つ定義する。
- **Rationale**: 実装範囲を増やさず規則の重複と不一致を防ぐ。
- **Trade-offs**: カテゴリ追加時にポリシー更新と下流再検証が必要になる。
- **Follow-up**: 全カテゴリの網羅テストを追加する。

### Decision: 候補変更の整合性を明示的調停にする
- **Context**: 単一カテゴリ競合を暗黙に置換すると利用者の選択を失う。
- **Alternatives Considered**: 新候補を常に優先、既存候補を常に優先、競合解決を要求。
- **Selected Approach**: 未分類化・削除は自動除去し、単一カテゴリ競合だけは選択確定まで保存を保留する。
- **Rationale**: 決定可能な修復は自動化し、情報を失う判断だけ利用者へ戻す。
- **Trade-offs**: UI stateに競合状態が増える。
- **Follow-up**: 候補管理との統合テストで全遷移を検証する。

## Risks & Mitigations
- 上流カテゴリ集合の変更 — 網羅的ポリシーテストとRevalidation Triggerで検出する。
- 候補変更と構成更新の競合 — Repositoryの最新ルート検証と競合結果を利用する。
- 不正参照の表示漏れ — 読込時に構成ビューを検証し、変更操作を停止する。

## References
- `.kiro/steering/roadmap.md` — 依存順、カテゴリ・参照整合性の共有シーム。
- `.kiro/specs/local-data-foundation/design.md` — 保存ルート、Repository、CurrentBuild契約。
- `.kiro/specs/project-candidate-management/design.md` — `CandidateQuery.listBuildEligible`と候補所有境界。

### 2026-07-19 React UI方針更新
- **背景**: カテゴリ別候補、単一・複数選択、数量、競合、保存失敗を同一画面で一貫して表示する必要がある。
- **判断**: `view.tsx`をReact function componentとし、feature固有の`react-root.tsx`で既存`FeatureMountContext`へ接続する。
- **境界**: BuildState、service、query、category policyはframework非依存を維持する。表示値は通常のJSX childとし、`dangerouslySetInnerHTML`と`innerHTML`を禁止する。
- **統合**: featureは`public.ts`とregistration moduleを所有し、共有side panel runtimeとroot barrelを編集しない。
- **検証**: React DOM操作とroot cleanupを統合testで確認する。
- **参照**: [React createRoot](https://react.dev/reference/react-dom/client/createRoot)、[React TypeScript](https://react.dev/learn/typescript)

### 2026-07-20 Foundation原子的参照修復への追従
- **Sources Consulted**: `local-data-foundation/design.md`、`project-candidate-management/design.md`、`roadmap.md`、`cross-spec-review.md`
- **Findings**: FoundationのReferenceRepairPolicyは候補削除・未分類化・保持不能なカテゴリ変更をcandidate mutationと同じtransactionで修復する。成功後のcurrent-build reconcile writeは原子性を破る。
- **Decision**: BuildServiceからcandidate lifecycle command、`reconcile`、手動single-conflict resolutionを除去する。本featureは利用者による構成編集と修復済みqueryの表示だけを所有する。
- **Trade-offs**: カテゴリ変更された候補を新カテゴリで採用したい場合は、修復後に利用者が現在構成画面から明示的に選び直す。
- **Verification**: Foundation contract fixtureで単一commit、他選択維持、無効参照除去、本featureからの追加writeなしを検証する。
