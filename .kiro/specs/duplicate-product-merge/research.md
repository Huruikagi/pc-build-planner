# 調査と設計判断

## 概要

- **Feature**: `duplicate-product-merge`
- **Discovery Scope**: Extension（既存の取り込み、候補管理、複数ソース、価格更新を接続する統合中心の light discovery）
- **主な知見**:
  - `candidate-source-bookmarks` は `CandidatePart.sources`、`primarySourceId`、`CandidateSourceMutationPort.addSource` を canonical contract とし、downstream は source ID を識別子に使う。URLや配列indexを更新識別子にしてはならない。
  - `product-capture-transient-migration` 後の抽出結果は候補管理の非一過性editorへ引き渡され、project解決と保存は候補管理が所有する。重複提示はcaptureの一過性面ではなく、候補管理の新規保存確定直前へ置く。
  - 同一URLは本機能で独自正規化せず、`candidate-sources/public.ts` のURL identity・source matcher・mutationへ委譲する。`source-price-refresh`は価格更新workflowだけを所有し、新規source追加と価格更新を二重実行しない。

## 調査ログ

### 既存の取り込み正規化と商品識別値

- **背景**: briefは大文字小文字、全角半角、型番区切りの差を吸収し、既存normalizerとの重複実装を避けるよう求めている。
- **参照先**: `src/features/product-capture/normalizer.ts`、`contracts.ts`、`draft-mapper.ts`、`.kiro/specs/product-page-capture/design.md`
- **知見**:
  - 現行normalizerは制御文字除去、連続空白の畳み込み、trim、長さ制限、URL・価格の形式検証を所有する。
  - 商品名・メーカー・型番の表示用確認値をlowercaseや区切り除去へ変換すると利用者確認値を壊すため、表示用normalizationと照合キー生成は分離する必要がある。
  - `SourcedValue` は `confirmed` と `original` を分離する。照合は `confirmed` を優先し、欠損時だけ `original` を参照しても保存値を変更しない。
- **設計への影響**: `src/product-identity/`へ純粋な型・normalizer・matcher・factory・public entryを置き、本specをcanonical ownerとする。product-captureとduplicate workflowはこの公開入口だけを介して照合結果を得る。

### 候補管理の保存位置とUI寿命

- **背景**: 一致候補をproduct-capture面とcandidate-management面のどちらへ提示するかを確定する必要がある。
- **参照先**: `.kiro/specs/product-capture-transient-migration/requirements.md`、`design.md`、`.kiro/specs/project-candidate-management/design.md`、現行 `state.ts`、`view.tsx`
- **知見**:
  - 移行後のproduct-capture面は実行、実行中、失敗だけを表示し、抽出結果を `UnresolvedCandidateDraft` としてcandidate-managementへ原子的に引き渡す。
  - project 0件時も候補管理が同一side panel sessionでdraftを保持し、project作成後にcanonical draftへ解決する。
  - 新規候補の保存時validator、revision、二重送信抑止、draft保持はcandidate-managementが既に所有する。
- **設計への影響**: 重複評価はprojectが解決されたcandidate-management editorのcreate modeでだけ開始する。edit modeと保存済み候補どうしの事後マージへ広げない。

### 複数ソースのcanonical contract

- **背景**: 統合で商品値とsource値を二重管理せず、上流の原子性を利用する必要がある。
- **参照先**: `.kiro/specs/candidate-source-bookmarks/requirements.md`、`design.md`、`research.md`
- **知見**:
  - `CandidateSource` は `id`、任意 `pageUrl`、`siteName`、`capturedAt`、per-source `price`、`kind` を持つ。
  - `CandidateSourceMutationPort.addSource` は一回のroot mutationでsourceを追加し、最初のsourceだけをprimaryにする。既存primaryは変更しない。
  - downstreamは `candidate-management/public.ts` だけを利用し、source IDを永続識別子にする。
- **設計への影響**: 統合は `AddCandidateSourceInput` を組み立てて `addSource` を一度呼ぶ。既存候補のproduct、normalized attributes、sourceSnapshotをマージしない。createしてからdeleteする補償処理も行わない。

### 同一URLと価格更新の責任分界

- **背景**: 同じページの再取り込みでsourceを重複追加せず、URL揺れを複数specで別々に定義しない必要がある。
- **参照先**: `.kiro/specs/candidate-source-bookmarks/brief.md`とlatest Change Brief、`.kiro/specs/source-price-refresh/brief.md`
- **知見**:
  - `candidate-source-bookmarks`が標準URLに基づくsource URL identity、明示scopeの0/1/many matcher、addと条件付きprice patchをcanonicalに所有する。
  - queryはsource URLの一部として保持し、商品同一性推測によるtracking key除去やpath曖昧一致を行わない。
  - `source-price-refresh`は一意referenceを受け取った後の価格取得workflow、eligibility、retry/progressを所有する。
- **設計への影響**: 統合確定時はcandidate-source公開matcherでcandidate scopeを照合する。一意一致はsource追加せず価格更新workflowへ渡し、no-matchだけが公開`addSource`へ進む。ambiguous、stale、price-unavailableはdraftを保持する型付き失敗になる。

### カテゴリと一致キー

- **背景**: 型番がない候補、未分類候補、異カテゴリの誤統合をどう扱うかを確定する必要がある。
- **参照先**: brief、`src/domain/normalized-attributes.ts`、candidate-managementのquery/draft契約
- **知見**:
  - canonical未分類値は `uncategorized` である。
  - 型番は最も強いキーであり、メーカー+商品名は補助キーである。
  - 分類済み異カテゴリは同一商品ではない可能性が高いが、片側未分類は通常の欠損状態であり除外理由にできない。
- **設計への影響**: 両側分類済み異カテゴリは先に除外する。両型番が存在して不一致なら補助キーへのfallbackを禁止する。型番一致をhigh、メーカー+名称一致をsupportingとし、同順位はcandidate IDで決定的に並べる。

### 技術・依存確認

- **背景**: 新しいruntime/libraryが必要かを確認した。
- **参照先**: `.kiro/steering/tech.md`、`structure.md`、`security.md`、`testing.md`
- **知見**:
  - TypeScript strict、React 19、標準 `String.prototype.normalize`、既存canonical `Result`、Node test runnerで充足する。
  - feature間importは `public.ts` に限定し、永続化はfoundation single write authorityへ集約する。
  - fixtureは架空データだけを使い、商品値・完全URLをログへ出さない。
- **設計への影響**: 新規library、権限、storage schema、migrationを追加しない。Unicode NFKCとlocale-neutral lowercaseは標準APIで実装する。

## アーキテクチャパターン評価

| 案 | 説明 | 長所 | リスク / 制約 | 判断 |
|---|---|---|---|---|
| capture面で照合・提示 | 抽出成功直後に一致候補を表示 | 早く気付ける | project未解決、activeTab寿命、保存責務をcaptureへ戻す | 不採用 |
| candidate-management保存前guard | create modeの保存要求を評価し、state/viewで判断を保持 | project scopeとdraft保持を再利用、保存責務が一か所 | candidate-management拡張が必要 | 採用 |
| 自動統合 | high confidenceを即時addSource | 操作が少ない | 誤統合時の損失が大きく制約違反 | 不採用 |
| 新規保存後に事後統合 | candidateを作り後からsourceを移す | 既存createを流用 | 二段writeと一時重複、失敗時補償が必要 | 不採用 |

## 設計判断

### 判断: 照合は純粋、判断とwriteはstate/coordinatorで分離する

- **背景**: 照合規則を架空データだけで検証し、UIやstorage failureに依存させない必要がある。
- **検討案**: service内へ埋め込む、React componentで算出する、純粋matcherへ分離する。
- **採用案**: `DuplicateCandidateMatcher` は入力候補集合から説明付きmatchを返す純粋関数とする。`DuplicateMergeCoordinator` がquery、matcher、source mutationを調停し、state/viewは利用者判断だけを保持する。
- **理由**: 業務規則とI/Oの境界が明確で、誤検知規則を高速・決定的に検証できる。
- **トレードオフ**: 型とファイルが増えるが、identity matcherは`src/product-identity/public.ts`だけから公開し、candidate-management内部には所有させない。

### 判断: 照合キーを一般化しすぎない

- **背景**: fuzzy searchや類似度scoreを入れると誤検知と説明困難性が増す。
- **採用案**: high/model-number と supporting/manufacturer-name の二段階だけを実装する。編集距離、トークン類似、外部DBは採用しない。
- **理由**: briefの優先順位を満たす最小構成で、提示根拠を利用者へ説明できる。
- **フォローアップ**: キー追加・score化は受入基準と誤検知評価を再検証する。

### 判断: source ownerのURL identity/matcher/mutationと価格workflowを分離して採用する

- **背景**: URL正規化はsource-price-refreshと重複しやすい。
- **採用案**: `candidate-sources/public.ts`のURL matcher/add/conditional patchと、`source-price-refresh`の価格workflowをそれぞれ利用する。
- **理由**: source identity・target再検証・mutationはsource ownerへ、価格取得workflowは価格ownerへ一意に保たれる。
- **トレードオフ**: candidate-sourceまたはsource-price-refresh public contract変更時は本specのintegrationを再検証する。

## リスクと緩和策

- 型番区切り除去が別型番を同一視する — 自動統合せず、カテゴリgateと説明付き利用者確定を必須にする。
- 候補一覧取得後に対象が変更される — source add/update時のrevision・target再検証を必須にし、stale結果でwriteしない。
- 同一URLが複数sourceへ一致する — ambiguousを成功扱いせず、利用者へ理由を示して無変更で停止する。
- candidate-managementのstateが複雑化する — create editorに限る判別状態として追加し、edit modeや通常一覧へ広げない。
- 並行specのpublic contract drift — `SourcePriceRefreshPort`、`CandidateSourceMutationPort`、pre-edit契約をrevalidation triggerにする。

## 参照

- `.kiro/steering/product.md` — 検討中ブックマークと複数出典の製品原則
- `.kiro/steering/tech.md` — React/TypeScript、single write authority、テスト基盤
- `.kiro/steering/structure.md` — feature公開境界と依存方向
- `.kiro/steering/security.md` — 未信頼ページ値、ログ、追加権限の制約
- `.kiro/specs/candidate-source-bookmarks/design.md` — source model、mutation port、primary規則
- `.kiro/specs/product-capture-transient-migration/design.md` — candidate editor handoffとproject解決
- `.kiro/specs/source-price-refresh/brief.md` — 同一URL再取り込みの隣接責任

### 2026-08-12 v0.5.0 boundary reconciliation light discovery

- **Change Brief**: `v0.5.0-boundary-reconciliation`
- **Context**: duplicate workflowがproduct-capture由来normalizer、candidate-owned source/query/mutationと`ManagementError`を参照し、identity/candidate/errorのcanonical ownerとcompositionに循環proxyを残していた。
- **Sources Consulted**: 全steering、`duplicate-product-merge`全spec文書、承認済み`local-data-foundation`、`project-candidate-management`、latest Change Brief、および確定identity/candidate public seam記述。
- **Findings**: roadmapとlatest Change Briefは本specをcanonical product identity coreのownerとする。`project-candidate-management`はproject限定queryとduplicate専用の最小`CandidateCreatePort`を所有し、`candidate-source-bookmarks`はsource URL match/add/conditional mutationとatomicityを所有する。Foundationは共有`AppDataError`を、application-shellは最終port compositionだけを所有する。
- **Selected Approach**: `src/product-identity/`へ型・normalizer・matcher・factory・public entryを移し、現行algorithm/resultをcharacterizationで固定する。duplicate workflowはそのpublic entryとcandidate/source public portsを相互排他的に利用する。
- **Alternatives Rejected**: identity coreを外部ownerのconsumer扱いにする案、product-capture/candidate-management proxyや`ManagementError` aliasを残す案、source mutationをmerge coordinatorへ複製する案、shell wiringを本specで変更する案はowner重複または循環を残すため採用しない。
- **Out of scope**: identity algorithm/result意味の変更、canonical error、candidate/source実装、source URL identity、price refresh、保存schema、shell production composition、merge UI layout。
- **Validation implication**: identity owner public consumer fixtureとcharacterization、candidate/source/error consumer fixture、旧import/deep proxy negative gate、明示確認・atomic route・draft保持・UI/E2E非回帰をtaskへ追加する。
