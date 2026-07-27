# 調査・設計判断

## サマリー

- **Feature**: `source-price-refresh`
- **Discovery Scope**: Complex Integration
- **主要所見**:
  - `candidate-source-bookmarks` は `CandidateSource.id`、`pageUrl`、`kind`、`price`、`capturedAt` と `primarySourceId` をcanonical contractとし、代表価格を保存せずプライマリから導出する。価格更新はこのaggregateを一回のmutationで更新する必要がある。
  - `transient-feature-surface` は `ActivationId`、固定 `TargetTabId`、世代照合と起動store/schedulerを所有する。価格更新側はコンテキストメニュー項目だけを所有し、起動recordやpanel open経路を再実装してはならない。
  - Chrome公式仕様ではコンテキストメニュー実行が `activeTab` を付与する明示gestureである一方、`chrome.contextMenus` APIの利用にはmanifestの `contextMenus` 権限が必須である。既存の権限allowlistとartifact gateには限定的な改訂が必要となる。

## 調査ログ

### 候補ソース契約と更新境界

- **背景**: 価格の保存先、更新識別子、代表価格への反映方法を既存の承認済みspecと一致させる必要がある。
- **参照先**: `.kiro/specs/candidate-source-bookmarks/{requirements,design,tasks}.md`、`src/features/candidate-management/public.ts`、`src/domain/normalized-attributes.ts`。
- **所見**:
  - 価格の唯一の保存先は `CandidateSource.price?: SourcedValue<MoneyValue>` である。
  - 更新対象は `CandidatePartId + CandidateSourceId` で固定し、URLや配列indexを永続識別子にしない。
  - `primarySourceId` が指すsourceの価格だけが代表価格になる。非primary更新で代表価格を変更せず、primary更新ではprojectionが自然に追従する。
  - `CandidateSourceCatalogPort` は `listSourceReferences({ candidateId? })` と `getSourceReference({ candidateId, sourceId })` を提供し、`CandidateSourceReference` に識別子、任意URL、任意kind、primary状態だけを投影する確定済みread-only契約である。
  - candidate-management公開APIは `sources: { catalog, mutations }` を公開し、catalogと既存 `CandidateSourceMutationPort.updateSource` を同じownerから受け取れる。
- **設計への影響**: 価格更新は `candidate-management/public.ts` の確定済みsource facetだけを利用する。URL正規化とambiguityはconsumer側に保持し、foundation rootへの直接readを行わない。port shape、not-found規則、facet構造が変わる場合だけ再検証する。

### 一過性起動と別gesture経路

- **背景**: コンテキストメニューclickから既存の起動世代・store・tab監視へ接続し、service workerで同じ仕組みを再実装しない必要がある。
- **参照先**: `.kiro/specs/transient-feature-surface/{requirements,design,tasks}.md`、`.kiro/specs/product-capture-transient-migration/design.md`。
- **所見**:
  - 下流featureはactivation payloadとして `activationId + tabId` を受け、`TransientSurfaceLifecyclePort.isCurrent` でstale世代を拒否する。
  - `TransientGestureSource.start(emit)` と `TransientGestureRegistrationPort.register(source)` は同期 `Result<() => void, TransientGestureRegistrationError>` として確定し、`parseTargetTabId` が未信頼なChrome tab IDを固定tabへ昇格する。
  - `emit` はChrome event callback内でcanonical gesture ingressへ同期接続され、activation ID/sequence、scheduler、store、panel open、失敗signalをproducer内部に保つ。
- **設計への影響**: 価格更新側は `application-shell/public.ts` の確定済みregistration portへcontext menu sourceを登録するだけで、sequence、store、side panel open、失効墓標を所有しない。同期emit、cleanup、error unionが変わる場合はgesture integrationとE2Eを再検証する。

### 価格抽出の再利用

- **背景**: 既存の商品取り込みと価格候補の優先順位・正規化・provenanceを一致させ、ロジックを複製しない必要がある。
- **参照先**: `src/features/product-capture/{extractor,normalizer,ranker,chrome-runtime-port}.ts`、`.kiro/specs/product-page-capture/design.md`。
- **所見**:
  - 現行extractorは `ExtractionCandidate[]` を返し、priceはJSON-LD、metaの順を既存ranker/normalizerで一件へ絞る。
  - `PagePriceExtractionPort.extractPrice(TargetTabId)` は page-derived URL、canonical取得時点、任意の `SourcedValue<MoneyValue>` を返す確定済みread-only契約である。
  - `ProductCapturePublicApi.pagePriceExtraction` が組立済みinstanceを公開し、extractor、normalizer、ranker、runtime concreteは非公開のまま維持する。
  - ページ由来 `pageUrl` と固定tabのURLを照合する既存のfail-closed規則を維持する必要がある。
- **設計への影響**: source-price-refreshは `product-capture/public.ts` の確定済み `PagePriceExtractionPort` だけを利用し、抽出規則やerror unionを再定義しない。observation、error、公開API fieldが変わる場合はconsumer contractを再検証する。

### Chrome contextMenus と activeTab

- **背景**: 追加権限の要否と、context menu clickが一時host accessを与えるかを公式仕様で確認する必要がある。
- **参照先**: [chrome.contextMenus API](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)、[The activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)。
- **所見**:
  - `chrome.contextMenus` の利用にはmanifestの `contextMenus` permissionが必須である。
  - context menu itemの実行は `activeTab` を付与するuser gestureであり、`scripting` permissionと組み合わせて当該tabへ一時的に注入できる。
  - itemは `contexts: ["page"]` とHTTP/HTTPSの `documentUrlPatterns` に限定できる。
- **設計への影響**: `contextMenus` だけを既存permission集合へ追加し、host/optional permissionは追加しない。`scripts/validate-artifacts.mjs` のexact allowlistとerror文言を同時更新する。

### URL同一性と誤更新リスク

- **背景**: 保存後のtracking query、query順序、fragment差を許容しつつ、別商品を誤更新しない必要がある。
- **参照先**: briefのBoundary Candidates、標準 `URL` API、candidate-sourceのsource ID規則。
- **所見**:
  - eTLD+1 + pathの一致はqueryで商品variantを識別するサイトを誤統合する。
  - 完全文字列一致はfragment、既定port、query順序、tracking parameterだけの差を誤って不一致にする。
- **設計への影響**: scheme/host/pathと未知queryを保持する保守的正規化を採用する。fragment、既定port、root以外の末尾slash、既知tracking keyだけを除き、残るquery pairをsortする。複数一致はfail closedとする。

## アーキテクチャパターン評価

| 選択肢 | 説明 | 長所 | リスク・制約 | 判断 |
|---|---|---|---|---|
| feature内use case + upstream ports | URL照合と価格更新をsource-price-refreshに集約し、抽出・候補保存・一過性起動は確定済み公開portへ委譲 | canonical ownership、再利用、testability | producer実装との統合順を明示する必要がある | 採用 |
| foundation rootを直接読む | source-price-refreshが全rootを走査する | 実装が短い | candidate-management境界を迂回し将来のschema変更へ密結合 | 不採用 |
| product-capture内部をdeep import | extractor/normalizerを直接利用する | 重複なし | `public.ts`規約違反、内部変更に脆い | 不採用 |
| URL完全一致のみ | 保存URLと現在URLの文字列一致 | 最も単純 | tracking/query順序差で再訪を認識できない | 不採用 |
| eTLD+1 + path一致 | queryを無視して広く一致 | tracking差に強い | variant・商品ID queryを誤更新する | 不採用 |

## 設計判断

### 判断: URL照合と更新を二段階の公開portにする

- **背景**: context menu経路は全候補から照合し、duplicate-product-mergeは特定候補内で同一URLを判定したい。
- **代替案**:
  1. 各consumerがURL規則を実装する。
  2. context menu専用の一体型commandだけを公開する。
- **採用案**: `SourcePriceRefreshPort.matchSource` と `refreshCapturedPrice` を公開する。scopeはcatalog全体またはcandidate一件を判別共用体で表す。
- **理由**: URL規則を一か所にし、再取り込みは同一sourceを特定後に同じ原子的更新を利用できる。
- **トレードオフ**: match後にsourceが変わる可能性があるため、refresh時にURL・kindを再検証し、revision conflictをstale-targetへ写像する。

### 判断: コンテキストメニューclickで自動実行する

- **背景**: 目標は再訪ページから一操作で更新し、activeTab付与gestureと実行gestureを分離しないことである。
- **代替案**:
  1. menu click後にpanel内の実行ボタンを要求する。
  2. menu click時に更新を開始する。
- **採用案**: menu click自体を更新要求とし、一過性面は進行・成功・失敗だけを表示する。
- **理由**: clickがactiveTabを付与し、権限失効後に押せるボタンを残さない。
- **トレードオフ**: 失敗後の再試行は同じbuttonではなくcontext menuの再実行として案内する。

### 判断: 新規libraryを追加しない

- **背景**: URL正規化、価格抽出、Chrome API、原子的mutationは既存標準・公開基盤で実現できる。
- **採用案**: 標準 `URL`、既存 `Result`、既存capture rule、Chrome native API、candidate mutationを利用する。
- **理由**: MV3/CSPとbundle制約を変えず、interfaceだけを一般化する。

## リスクと緩和

- 上流3portのsignature drift — 各producer specの確定済み `CandidateSourceCatalogPort`、`TransientGestureRegistrationPort`、`PagePriceExtractionPort` をpublic consumer contractへ固定し、shape・error・公開入口が変わった場合に再検証する。producer実装の受け取りはsource-price-refreshのproduction統合タスクに明示し、core実装は承認済み契約のtest doubleで進める。
- tracking key一覧が不十分 — 未知queryは保持してfail-safeに不一致とし、誤更新より再操作・手動確認を優先する。
- 同じURLが複数候補へ保存済み — ambiguityとして更新せず、対象の整理を案内する。
- context menu itemが制限ページにも現れる — HTTP/HTTPS patternへ限定し、tab/URL検証失敗では一過性起動・永続化を行わない。
- manifest permission gateとの不整合 — `manifest.json` とartifact validatorを同一taskで更新し、host permission不追加を回帰検証する。

## 参考資料

- [chrome.contextMenus API](https://developer.chrome.com/docs/extensions/reference/api/contextMenus) — 必須permission、item定義、click event。
- [The activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) — context menu gestureによる一時access。
- `.kiro/specs/transient-feature-surface/design.md` — 起動世代、固定tab、store/scheduler、lifecycle port。
- `.kiro/specs/product-capture-transient-migration/design.md` — 一過性featureのactivation利用パターン。
- `.kiro/specs/candidate-source-bookmarks/design.md` — source entity、price、primary導出、mutation契約。
