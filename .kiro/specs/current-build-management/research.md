# Research & Design Decisions

## Summary

- **Feature**: `current-build-management`
- **Discovery Scope**: Extension / light discovery
- **Key Findings**:
  - 現行実装の独自project selector、先頭project fallback、snapshot projectへの先行切替は、`project-context` をselection authorityとする現行要件に反する。
  - `project-context` はread portとswitch guard registration portを分離しており、current-buildはowner-local adapterだけで追従とdraft保護を実現できる。
  - 既存snapshot v1はshapeを維持でき、`selectedProjectId`を現在contextとの一致検査専用metadataへ意味変更すればversion bumpは不要である。
  - 現行カテゴリnavigationには選択要約がなく、load済み候補とcurrent buildから純粋なsummary projectionを追加するのが最小変更である。

## Research Log

### 既存current-buildの統合点

- **Context**: 実装済みfeatureを新要件7〜9へ拡張する境界を確認した。
- **Sources Consulted**: `src/features/current-build/*`、関連unit/integration/E2E、`tech.md`、`structure.md`、`security.md`。
- **Findings**: service/query/category policyは再利用可能である。変更中心はstate、snapshot codec、view、registration、feature contributionである。現行stateはproject一覧を候補queryから取得して先頭へfallbackし、viewは独自selectorを持つ。
- **Implications**: persistence/domain境界は維持し、project selectionだけをproject-context adapterへ置換する。root runtimeとshellは本specから編集しない。

### project-context公開契約

- **Context**: draft保護と共通選択追従に必要な最小能力を確認した。
- **Sources Consulted**: `.kiro/specs/project-context/requirements.md`、`.kiro/specs/project-context/design.md`。
- **Findings**: `ProjectContextReadPort` はcoherent snapshotとgenerationを公開し、`ProjectSwitchGuardRegistrationPort` はdraft内容を解釈せず `allow | confirmation-required` を調停する。command portはselector/lifecycle owner向けである。
- **Implications**: current-buildはread/guardだけを受け取り、project選択やconfirmation commitを直接所有しない。guard request identityとgenerationをowner-local stateで照合する。

### snapshot互換性

- **Context**: 要件8は既存version/shape維持とproject metadataの非権威化を同時に要求する。
- **Sources Consulted**: `state-snapshot.ts`、application shell mount/capture contract、project-context 8.6。
- **Findings**: v1の `selectedProjectId` を削除せず、復元前のproject選択に使用しないことで互換性を維持できる。現在contextと一致する場合だけcategory/draft referenceを検証すればよい。
- **Implications**: registrationの `peekSelectedProjectId` とsnapshot起点の `selectProject` を廃止する。不一致は識別可能な案内と安全な初期状態へ落とす。

### カテゴリ要約と安全な表示

- **Context**: 全カテゴリを開かずに採用品と数量を把握する必要がある。
- **Sources Consulted**: 現行 `view.tsx`、ui message/language方針、security rendering規約。
- **Findings**: candidate名称はload済みデータから取得でき、保存モデルへのdenormalizationは不要である。React text childとCSS ellipsisを組み合わせれば、markup実行を防ぎながら視覚省略と完全なaccessible textを両立できる。
- **Implications**: framework非依存の `category-summary.ts` を追加し、viewはprojectionだけを描画する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Decision |
|---|---|---|---|---|
| Owner-local context adapter | read/guard portをfeature stateへ変換 | authorityが一つ、境界が明確 | lifecycle/stale testが必要 | 採用 |
| Stateがcontext portを直接利用 | file数を抑える | 単純 | guardと購読責務がstateへ集中 | 不採用 |
| 独自selector/fallbackを維持 | 既存変更が少ない | 短期的に容易 | 共通authorityと矛盾 | 不採用 |
| Summary projection | load済みdataから派生 | 保存schema変更なし | candidate欠損時はquery errorが必要 | 採用 |

## Design Decisions

### Decision: project-contextを唯一のselection authorityとする

- **Context**: 1.5、1.6、7、8がconsumer独自fallbackとsnapshot起点切替を禁止する。
- **Alternatives Considered**: state内fallback継続、context readのみ採用、readとguardをadapterで採用。
- **Selected Approach**: read/guard portをowner-local adapterへ注入し、ready projectだけをstateへ公開する。
- **Rationale**: 共通selector、preference、fallbackを重複実装せずfeature draftの所有も維持できる。
- **Trade-offs**: project-context未実装中はproduction compositionが未完となるため、実装task順序に依存する。
- **Follow-up**: project-context public contract確定後にconsumer contract testを再実行する。

### Decision: snapshot v1 project IDを一致検査専用にする

- **Context**: shape/version互換性と非権威性の両立が必要である。
- **Selected Approach**: fieldを維持し、現在ready projectとの比較にだけ使う。
- **Rationale**: migrationなしで古いsnapshotによる誤project切替を防ぐ。
- **Trade-offs**: project不一致時はcategory/draftを復元できない。
- **Follow-up**: mismatch、empty、unavailable、invalid referenceのcontract testを追加する。

### Decision: 要約を純粋projectionとして構築する

- **Context**: 9.1〜9.9は表示能力であり、保存schema変更を要求しない。
- **Selected Approach**: candidate mapとcurrent buildから全カテゴリのsummary modelを導出する。
- **Rationale**: 候補名をcurrent buildへ複製せず、成功直後に同じstate更新で反映できる。
- **Trade-offs**: candidate参照が欠損する破損状態では要約を表示せず既存query errorへ閉じる。

### Decision: draft内容と処理をguard protocolから隔離する

- **Context**: project-contextは確認要否だけを調停し、draftの保存・破棄を解釈しない。
- **Selected Approach**: guard評価中にowner-local confirmation stateがsave/discard/cancelを実行する。save/discardだけが `allow` を返し、cancel・失敗・staleはtyped guard failureとしてcontext transactionを中止する。
- **Rationale**: feature ownershipと能力分離を維持する。
- **Trade-offs**: 非同期guard評価とfeature confirmationのowner-local tokenを厳密に同期する必要がある。
- **Follow-up**: generation、target、registry変更を含むstale race testを追加する。

### Superseded Decision: 候補変更後にfeatureがreconcile writeする

- **Status**: foundationの原子的参照修復により不採用。
- **Decision**: candidate/project lifecycleと同じroot transactionでfoundationが修復し、本featureは再queryのみ行う。

## Synthesis

- **Generalization**: project切替保護をcurrent-build専用selector処理ではなく、project-context guardを受けるowner-local adapterとして一般化した。ただし実装対象は数量draftだけに限定する。
- **Build vs Adopt**: 新規状態管理libraryやdialog libraryは採用せず、既存external-store state、React、project-context公開protocol、CSSを利用する。
- **Simplification**: persistence schema、下流DTO、event bus、snapshot version bumpを追加しない。summaryは保存せず派生させる。

## Risks & Mitigations

- project-context contract変更 — Revalidation Triggerとconsumer contract testで検出する。
- switch確認中のstale completion — request identity、base generation、from/toを全て照合する。
- 複数dirty draftの部分保存 — 全draftを検証して一つの `CurrentBuild` updateへまとめる `set-quantities` commandで原子化する。
- forced変更でdraft誤保存 — orphaned draftとして隔離し、新projectのcommandに流さない。
- 長い名称で操作不能 — visual textだけellipsisにし、button semanticsとaccessible textを維持する。

## References

- `.kiro/specs/project-context/design.md` — read/guard port、generation、confirmation protocol。
- `.kiro/specs/local-data-foundation/design.md` — root mutation、参照修復、保存authority。
- `.kiro/specs/project-candidate-management/design.md` — build eligible candidate query。
- `.kiro/steering/tech.md`、`structure.md`、`security.md` — runtime、境界、表示安全性。
