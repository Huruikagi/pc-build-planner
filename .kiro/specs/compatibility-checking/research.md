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
- **Sources Consulted**: `docs/requirements-v0.1.0.md`、`docs/project-overview.md`、本specのbrief。
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
- `docs/requirements-v0.1.0.md`
- `docs/project-overview.md`

## 2026-08-03 project-context追従の再設計

### Summary

本specは実装済み互換性機能の拡張であるためlight discoveryを実施した。純粋な5規則、対象展開、集約器、`CompatibilityQuery`は維持できる。一方、現行production compositionは候補一覧の先頭projectをmount時に一度だけ解決しており、共通の現在projectへの追従、stale評価の排除、0件・利用不能・再試行を満たさない。

### Research Log

#### project-context公開契約と上流不変条件
- **Context**: 互換性機能がproject選択authorityを持たず、現在projectへ追従する必要がある。
- **Sources Consulted**: `.kiro/specs/project-context/{requirements.md,design.md,tasks.md}`、`.kiro/steering/roadmap.md`。
- **Findings**: `project-context`は`ready | empty | unavailable`とgenerationを持つsnapshot、および`getSnapshot`/`subscribe`のread portを公開予定である。`ready`は必ず有効な選択を持ち、catalogが空なら`empty`となるため、「projectあり・未選択」は公開不変条件上発生しない。
- **Implications**: compatibilityはread portだけをowner-local adapterへ注入し、`ready`だけを評価する。要件7.6は削除し、7.2はunavailableからreadyへの回復に限定した。project-context実装とcurrent-buildのcontext更新を実装前提とする。

#### 現行実装とproduction統合差分
- **Context**: 既存の純粋判定を保ちながらproject追従へ移行する範囲を特定する。
- **Sources Consulted**: `src/features/compatibility/*`、`src/application-shell/side-panel-contributions.ts`、`src/features/current-build/public.ts`、`src/features/candidate-management/public.ts`。
- **Findings**: 現行serviceは`CurrentBuildQuery`と`CandidateQuery.listBuildEligible`だけで決定的なreportを生成する。stateは評価要求世代で遅延完了を破棄できる。shellの`listProjects()[0]` fallbackとregistrationのone-shot `getProjectId`が更新対象である。
- **Implications**: rule/service公開契約は原則維持し、context adapter、state lifecycle、retry、messageをfeature owner内へ追加する。shell共有fileのproduction wiringはapplication-shell更新specが所有する。

#### 日英表示・アクセシビリティ・テスト基盤
- **Context**: 新しい空・失敗・回復状態を既存UI規約で表示する必要がある。
- **Sources Consulted**: `.kiro/steering/testing.md`、`.kiro/steering/security.md`、`src/ui-messages/catalog/{ja,en}/compatibility.ts`、`src/ui-language/public.ts`、既存compatibility DOM tests。
- **Findings**: UIは`LanguageProvider`とtyped message keyを利用し、Node標準test runner、testing-library、user-eventで検証する。外部文字列はJSX child、状態通知はlive region、失敗はalertを既存方針として拡張できる。Vitestは採用しない。
- **Implications**: 両言語へ同一keyを追加し、context切替、旧完了破棄、再試行、ARIA通知、安全描画をcontract/DOM/E2Eへ割り当てる。新規runtime依存は追加しない。

### Design Decisions

#### Decision: project-context read portを採用し独自選択を撤去する
- **Context**: 複数featureで同じ現在projectを参照し、fallbackの不一致を防ぐ。
- **Alternatives Considered**: 候補一覧先頭の継続、compatibility専用selector、project-context購読。
- **Selected Approach**: `ProjectContextReadPort`をowner-local adapterへ注入し、ready snapshotだけを評価する。
- **Rationale**: 選択authorityを一元化し、compatibilityがpreferenceやcatalogを複製しない。
- **Trade-offs**: project-context coreとcurrent-build更新が実装前提になる。
- **Follow-up**: upstream snapshot unionまたはgeneration契約変更時に本specを再検証する。

#### Decision: context generationと評価要求番号を組み合わせる
- **Context**: 切替前の遅い評価が新projectの表示を上書きしてはならない。
- **Selected Approach**: context通知時に旧reportを外し、context generationと評価要求番号が双方一致する完了だけを採用する。
- **Rationale**: serviceやrule engineへcancel責務を持ち込まず、既存generation patternを一般化できる。
- **Trade-offs**: 旧Promise自体は完了するが結果は破棄される。

#### Decision: 新規ライブラリと永続状態を追加しない
- **Context**: context追従、i18n、アクセシビリティはいずれも既存公開基盤で実現できる。
- **Selected Approach**: project-context、ui-messages、ui-language、React external-store patternを採用する。
- **Rationale**: MV3/CSP、境界、bundle、migrationへの影響を最小化する。

### Synthesis
- **Generalization**: project 0件、利用不能、readyを`CompatibilityProjectAvailability`へ射影し、画面・再試行・stale制御の共通入力にする。
- **Build vs. Adopt**: 独自selector/preference/event busは作らず、project-context read portと既存message/language基盤を採用する。
- **Simplification**: 既存`CompatibilityQuery.evaluate(projectId)`、固定rule registry、派生reportを維持し、context adapter以外の抽象化を追加しない。

### Risks & Mitigations
- project-context未実装 — dependency順を明示し、port contract kitによるconsumer testを先に用意する。
- 旧project結果の残留 — context通知時にreportを除去し、二重generationで完了を検査する。
- fallback再混入 — `listProjects()[0]`とone-shot resolverをproduction compositionから削除し、boundary/contract testで禁止する。
- 構成recordなしとitem 0件の混同 — `no-build`と`empty-build`を分離して表示・testする。

### 2026-07-19 React UI方針更新
- **背景**: 集約区分、個別根拠、不足項目、loading/empty/errorを同じ画面で安全に切り替える必要がある。
- **判断**: `view.tsx`をReact function componentとし、feature固有の`react-root.tsx`で既存`FeatureMountContext`へ接続する。
- **境界**: CompatibilityState、rule、aggregator、queryはframework非依存を維持する。表示値は通常のJSX childとし、`dangerouslySetInnerHTML`と`innerHTML`を禁止する。
- **統合**: featureは`public.ts`とregistration moduleを所有し、共有side panel runtimeとroot barrelを編集しない。
- **検証**: React DOM表示、旧評価破棄、unmount cleanupを統合testで確認する。
- **参照**: [React createRoot](https://react.dev/reference/react-dom/client/createRoot)、[React TypeScript](https://react.dev/learn/typescript)

## 2026-08-12 v0.5.0 boundary reconciliation

### Summary

- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **Discovery Scope**: Extension / Light Integration Update
- **Sources Consulted**: 最新Change Brief、roadmap、全steering、承認済み`local-data-foundation`・`current-build-management` requirements/design/tasks、本specの全現行文書。
- **Findings**:
  - local-data-foundationは全`FoundationError` variantとpayloadを一対一で保持する共有`AppDataError`を`src/domain/public.ts`から公開し、compatibilityを明示的なconsumerとして固定している。
  - current-buildは共有errorを既存`BuildError`へowner-localに投影し、`CurrentBuildQuery.getByProject`の`Result<CurrentBuildSnapshot, BuildError>` shapeを維持する。
  - candidate queryのdata operation failureだけがcandidate-owned `ManagementError`から共有`AppDataError`へ移る。compatibility固有のno-build、empty-build、invalid-referenceとruleのunknown resultは共有errorではない。
  - compatibilityはread-only queryを結合するだけで、foundation/current-build/candidateの実装、mutation、shell compositionを必要としない。

### Design Decisions

- **Generalization**: 全上流errorを一つへ平坦化せず、candidate queryの`AppDataError`とcurrent-buildの確定`BuildError`を各公開seamで受け、既存`CompatibilityError`へ入口別に意味不変で投影する。
- **Build vs. Adopt**: 共有error variantや低位mapperを再定義せずfoundation公開contractを採用する。current-buildの既存projectionも再実装しない。
- **Simplification**: 新しいUI stateやerror categoryを追加せず、`AppDataErrorProjection`一つとpublic consumer boundary fixtureだけを追加する。rules、target expansion、aggregation、context generation、viewは変更しない。

### Risks & Mitigations

- shared variant欠落・誤統合 — exhaustive projectionと全variant contractで検出し、default fallbackを禁止する。
- CurrentBuildQueryの確定seamをAppDataErrorへ誤変更 — positive fixtureで`BuildError`を固定し、upstream実装変更を本taskへ含めない。
- read-only境界の逆流 — mutation port、foundation内部、candidate-owned error importをnegative gateで拒否する。
- UI意味の漂流 — 4区分、unknown、失敗表示、stale抑止、日英/ARIAを既存DOM/integration/E2Eで再実行する。
