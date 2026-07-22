# Research & Design Decisions

## Summary
- **Feature**: `current-build-management`
- **Discovery Scope**: Extension
- **Key Findings**:
  - Foundationは参照と正整数数量を検証するが、projectごと最大一構成、item重複、カテゴリ別選択数は本featureが検証する。
  - CandidateQueryはcanonical literal `uncategorized`を除く`listBuildEligible`を公開し、候補の所有権は候補管理境界に残る。
  - 最新shellはopaque stateのcapture/restoreを公開するため、current-build registrationもsnapshot-aware lifecycleへ追従する。

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

### Superseded Decision: 候補変更の整合性を明示的調停にする
- **Status**: 2026-07-20のFoundation原子的参照修復への追従により不採用へ変更した。以下は判断履歴として残す。
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
- **判断**: `view.tsx`をReact function componentとし、feature registrationが既存`FeatureMountContext`とReact root lifecycleを接続する。独立`react-root.tsx`案は、実装済みcandidate registrationとの整合と単純化のため2026-07-22に統合した。
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

### 2026-07-22 実装済み上流契約との再照合
- **Context**: `local-data-foundation`、`application-shell`、`project-candidate-management`の設計・実装更新後に、既存current-build設計の実装可能性を再確認した。
- **Sources Consulted**: 上流3 specのrequirements/design/tasks、`src/domain/public.ts`、`src/persistence/public.ts`、`src/application-shell/public.ts`、`src/features/candidate-management/public.ts`、`package.json`。
- **Findings**:
  - canonical保存契約は`BuildItem.candidatePartId`、`PositiveInteger`、`UtcTimestamp`、`CurrentBuildId`であり、旧設計の`partId`と`UtcIsoDateTime`は存在しない。
  - Foundationの書込は専用putではなく、`requestId`、`expectedRevision`、`RootOperation`を持つ`RootMutationCommand`である。currentBuildの初回はcreate、既存時はIDを保持したupdateが必要である。
  - Foundationはprojectごと一構成やカテゴリ別選択数を保証しないため、CurrentBuildQueryが同じroot内のcandidateと照合してfeature不変条件を検証する。
  - shellの公開mount契約には`restoredState`と`captureState`が実装済みである。activation rollback時に未保存UI状態を安全に戻すにはfeature-owned snapshot codecが必要である。
  - テスト基盤はVitestではなくNode.js test runner、tsx、jsdomであり、E2EだけPlaywrightを使用する。
  - Foundationの最新参照修復はcandidate変更・削除だけでなくproject削除時のcandidateとCurrentBuildカスケードも同一commitで扱う。
- **Implications**: designの型名、mutation flow、query validation、file plan、shell registration、test stackを更新する。候補・project lifecycle後の追加reconcile write禁止は維持する。

### 2026-07-22 上流文書と公開実装の差異
- **Context**: application-shell設計本文のinterface例と、同specのrequirements/tasksおよび実装済み公開契約に差異があった。
- **Sources Consulted**: `application-shell/design.md`、`application-shell/tasks.md`、`src/application-shell/contracts.ts`。
- **Findings**: 設計中の古いinterface例にはsnapshot fieldがない一方、requirements/tasksと実装には`FeatureMountContext.restoredState`、`FeatureMountHandle.captureState`が存在する。
- **Implications**: 実装済みpublic contractと承認済みlifecycle要件をcurrent-buildの統合基準とする。上流契約が再変更された場合はRevalidation Triggerで再確認する。

### Decision: canonical CurrentBuildをprojectionで改名せず公開する
- **Context**: 旧設計の公開snapshotが`partId`と`number`へ再定義され、Foundation modelとの変換責任が不明だった。
- **Alternatives Considered**: feature固有DTOへrenameする、canonical `CurrentBuild`をread-onlyで包む。
- **Selected Approach**: `CurrentBuildSnapshot`はrootの`Revision`と`Readonly<CurrentBuild> | null`を持ち、itemは`candidatePartId`と`PositiveInteger`を維持する。
- **Rationale**: 候補詳細や互換性結果を増やさず、下流の解釈ずれと重複型を防げる。
- **Trade-offs**: 下流はFoundationの安定したdomain型へ依存するため、その形状変更時は再検証が必要になる。
- **Follow-up**: public consumer typecheckでfield名とreadonly性を固定する。

### Decision: snapshot-aware registrationを最小構成で採用する
- **Context**: cross-feature activation失敗時、shellはsource featureのopaque snapshotを使ってrollback mountする。
- **Alternatives Considered**: snapshot非対応としてactivationを拒否する、永続状態だけ再queryする、未保存UI状態だけをcodecでcaptureする。
- **Selected Approach**: 選択project/categoryと数量draftだけをversion付きsnapshotに含め、永続root、保存中request、React objectは含めない。
- **Rationale**: shell境界へ業務stateを漏らさず、利用者の未保存入力をactivation rollback後も維持できる。
- **Trade-offs**: restore時に永続参照の再検証が必要になる。
- **Follow-up**: invalid shape、unknown version、stale reference、cleanupをregistration contract testで検証する。
