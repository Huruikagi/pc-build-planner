# Research & Design Decisions

## Summary

- **Feature**: `product-page-capture`
- **Discovery Scope**: Extension（既存抽出pipelineへのdomain map追加と、一過性handoff契約への移行）
- **Key Findings**:
  - 既存extractor / normalizer / rankerは根拠付き候補を分離しており、domain mapはmanufacturer専用の候補供給源として追加できる。
  - `product-capture-transient-migration`はcapture面を`idle | extracting | failed`へ縮小し、project未解決pre-editを`TransientSurfaceLifecyclePort.conclude`でcandidate-managementへ渡す契約を確定している。
  - `PagePriceExtractionPort`は`source-price-refresh`の確定済みconsumer契約であり、domain mapやhandoff移行後もshapeを維持する必要がある。
  - `candidate-source-bookmarks/design.md`には廃止予定の`CaptureCandidatePort`参照が残り、実装前のcross-spec remediationが必要である。

## Research Log

### 一過性surfaceとcapture責務

- **Context**: 要件1.4、4、5、6.1、6.4を、常設capture UIから新しい一過性surface寿命へ合わせる必要がある。
- **Sources Consulted**: `transient-feature-surface`、`product-capture-transient-migration`、`project-candidate-management`のrequirements/design/tasks、既存product-capture state/view/coordinator。
- **Findings**:
  - activationは`ActivationId`と固定`TargetTabId`を持ち、tab遷移・更新・閉鎖または世代置換で終了する。
  - captureの実行状態は`idle | extracting | failed`だけで、`review | submitting | saved`はcandidate-managementへ移る。
  - project未解決・空名は`UnresolvedCandidateDraft`としてpre-editで受理し、保存時validationと分離する。
  - handoffは直接navigationではなくtyped intentを`conclude`へ渡す原子的transitionである。
- **Implications**: product-captureはproject query、`CaptureCandidatePort`、save service、直接navigation callbackへ依存しない。stale確認は抽出前とhandoff直前に行う。

### メーカーdomain mapと取得ポリシー

- **Context**: メーカー公式サイトでページmetadataにmanufacturerがない場合だけ、domainから欠損を補完したい。
- **Sources Consulted**: `web-content-acquisition.md`、roadmap #8、既存`extractor.ts`、`contracts.ts`、`ranker.ts`、`coordinator.ts`、関連synthetic tests。
- **Findings**:
  - domain mapはネットワーク到達、所有証明、利用許可、サイト固有DOM抽出の有効化を意味しない。
  - ページの明示metadataを上書きせず、最下位priorityでmanufacturerだけを供給する必要がある。
  - 任意hostnameから汎用的にeTLD+1を導出するにはpublic suffix知識が必要だが、現在stackにその依存はない。
  - entry自体を審査済みeTLD+1として保持し、hostnameの完全一致またはdot-boundary subdomain一致を行えば、未知suffixを推測せず要件を満たせる。
- **Implications**: `manufacturer-domain-map.ts`へentryと純粋照合を隔離し、`ExtractionSource`へ`"domain-map"`を追加する。entryにはevidence、review date、ownerを持たせ、unknownは候補なしとする。

### 価格だけを再利用する公開seam

- **Context**: `source-price-refresh`が通常取り込みと同じ価格順位・normalizer・provenanceを使う。
- **Sources Consulted**: `source-price-refresh/design.md`、既存product-capture design、`chrome-runtime-port.ts`、`coordinator.ts`、`public.ts`。
- **Findings**:
  - consumerは`extractPrice(TargetTabId)`からpage-derived URL、canonical取得時点、任意の`SourcedValue<MoneyValue>`と6 failureを期待する。
  - target URLは注入先照合に使うが、page URLの代用にはできない。
  - domain mapはmanufacturerだけを供給するためprice selectionへ影響しない。
- **Implications**: `PagePriceObservation`、`PagePriceExtractionError`、`PagePriceExtractionPort`、`ProductCapturePublicApi.pagePriceExtraction`を維持し、同じpayload decoder / normalizer / rankerを共有する。

### Cross-spec contract drift

- **Context**: source model移行とcapture transient移行が同じcandidate作成seamを異なる時点の設計で参照している。
- **Sources Consulted**: `candidate-source-bookmarks/design.md` Existing Architecture Analysis、Requirements Traceability、CaptureSourceMapper component、`product-capture-transient-migration/design.md` Existing Feature Contracts / Existing Spec Revisions。
- **Findings**:
  - `candidate-source-bookmarks/design.md`はproduct-captureがcandidate-management公開の`CaptureCandidatePort`へdraftを渡す前提を記載する。
  - `product-capture-transient-migration/design.md`は`CaptureCandidatePort`に他の公開consumerがないとして公開APIから削除し、`UnresolvedCandidateDraft`、candidate-managementのtyped intent factory、`TransientSurfaceLifecyclePort.conclude`へ置換する。
  - 同じsource初期化責務が旧save portと新pre-edit handoffの両方を前提にすると、production compositionと公開境界が矛盾する。
- **Implications**: `candidate-source-bookmarks`は実装前にcapture source初期化の入力点を新handoff経路へ再検証する必要がある。本spec外のため編集せず、designのRevalidation Triggersへexact contract名と証拠を記録する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Decision |
|---|---|---|---|---|
| 候補pipelineへdomain source追加 | manufacturer欠損時だけ根拠付き候補を加える | 既存rank/normalizerを再利用、決定的 | closed union追従が必要 | 採用 |
| extractor後にmanufacturerを直接上書き | 最終draftへdomain値を代入 | 実装が短い | provenanceとpriorityを迂回 | 不採用 |
| public suffix library導入 | 任意hostnameのeTLD+1を計算 | 一般性が高い | runtime依存、更新、現scopeに過剰 | 不採用 |
| entry eTLD+1とのboundary一致 | 審査済みentryにだけexact/subdomain match | 未知domainを推測しない、依存なし | entry整備が必要 | 採用 |
| capture内で確認・保存を継続 | 旧state/viewを維持 | 移行量が少ない | 一過性寿命と欺瞞的操作が残る | 不採用 |
| typed intent + conclude | candidate pre-editへ原子的handoff | 権限寿命と編集寿命を分離 | 上流contract実装が前提 | 採用 |

## Design Decisions

### Decision: domain mapを最下位の候補供給源にする

- **Context**: manufacturer欠損だけを補い、ページ明示値を尊重する。
- **Alternatives Considered**: 最終draft上書き、rank weightなしのcollector、根拠付き最下位候補。
- **Selected Approach**: `ExtractionSource: "domain-map"`を追加し、manufacturer候補がない場合だけ生成する。rankerでも全sourceの後へ置く。
- **Rationale**: collector合成順とrank順の二重防御で非上書きを固定し、provenanceを失わない。
- **Trade-offs**: contracts、payload validator、message mapping、testsのclosed union更新が必要。
- **Follow-up**: entry追加時にevidence、owner、review triggerを確認する。

### Decision: eTLD+1は審査済みentry側を基準に照合する

- **Context**: unknown hostnameを誤ってメーカーへ結び付けず、依存を増やさない。
- **Selected Approach**: entryにcanonical registrable domainを保持し、hostnameのexactまたはdot-boundary subdomain一致だけを許可する。
- **Rationale**: public suffixを推測せず、対象範囲がentryに閉じる。
- **Trade-offs**: 新しい地域domainは個別entryと審査が必要。

### Decision: captureはpre-editを保存可能draftへ昇格しない

- **Context**: project未作成・空名でも編集を開始し、保存規則をcandidate-managementへ一本化する。
- **Selected Approach**: project未解決の`UnresolvedCandidateDraft`をtyped intentへ載せて`conclude`する。
- **Rationale**: captureからproject query、save validation、repository dependencyを除去できる。
- **Trade-offs**: candidate-managementのpre-edit受理がproduction integrationの前提になる。

### Decision: price portを変更しない

- **Context**: 下流`source-price-refresh`が既に確定shapeを参照する。
- **Selected Approach**: fixed tab、page-derived URL、capturedAt、optional price、6 failureを維持する。
- **Rationale**: domain mapとhandoff変更は価格観測のconsumer concernを変えない。
- **Trade-offs**: product-captureのcomposition変更時に同じport instanceを再配線する必要がある。

## Synthesis Outcomes

- **Generalization**: domain mapをmanufacturerへの特別な後処理にせず、既存`ExtractionCandidate`のsource追加として一般化した。実装scopeはmanufacturerだけに制限する。
- **Build vs Adopt**: 外部public suffix libraryは採用せず、審査済みentry基準の照合を構築する。未知suffixの一般解析は要求されない。
- **Simplification**: capture-owned review/save state、direct editor navigation、save portを設計から除去し、extract → typed handoffへ縮小した。

## Risks & Mitigations

- suffix誤一致 — exactまたはdot-boundary一致だけを許可し、synthetic negative caseを固定する。
- domain所有変更 — evidence、owner、review dateをentryに持ち、変更triggerで再審査する。
- domain mapが権限として誤用される — map moduleは候補生成だけを公開し、runtime/permission判断へimportしない。
- stale activationからhandoff — 抽出前後の`isCurrent`と`conclude`でfail closedにする。
- price port drift — public consumer contract testでshapeと同一pipelineを固定する。
- source bookmark設計の旧save port依存 — cross-spec remediation triggerとして明示し、実装前に再検証する。

## References

- `.kiro/steering/web-content-acquisition.md`
- `.kiro/steering/{product,tech,structure,security,testing}.md`
- `.kiro/specs/product-capture-transient-migration/{requirements,design,tasks}.md`
- `.kiro/specs/transient-feature-surface/{requirements,design}.md`
- `.kiro/specs/project-candidate-management/{requirements,design}.md`
- `.kiro/specs/candidate-source-bookmarks/design.md`
- `.kiro/specs/source-price-refresh/design.md`
