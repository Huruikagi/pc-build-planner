# 調査と設計判断

## 概要

- **機能**: `candidate-source-bookmarks`
- **Discovery Scope**: 既存spec間の所有権再調整を中心とするlight discovery
- **Change Brief**: `v0.5.0-boundary-reconciliation`
- **結論**: source型・policy・catalog・mutation・URL identity・明示scope matcherを独立共有coreへ集約する。candidate editorはconsumer、source-price-refreshはmatcher/conditional patchを使う価格workflow consumer、duplicate-product-mergeはcandidate限定matcher/add/conditional mutationを使うproduct identity/merge workflow ownerとし、foundation所有`AppDataError`を意味変更せず消費する。

## 調査ログ

### 現行source実装と循環境界

- **参照先**: 本specのrequirements/design/tasks、`project-candidate-management`の最新requirements/design/tasks、`.kiro/steering/structure.md`
- **発見**: 現行契約はsource catalog/mutationをcandidate-managementの`sources` facetとして公開し、source editorとsource coreを同じownerに置く。最新candidate specはcandidate CRUD、pre-edit、draft guard、source editor UIだけを残し、canonical source portが利用可能になった後に旧source core/facetを撤去する。
- **影響**: source coreを`src/candidate-sources/`へ独立させ、candidate-managementには`CandidateSourceEditorAdapter`だけを残す。candidate public APIはsource coreを再exportしない。canonical port完成前に旧ownerを削除せず、完成後にfallbackなしで切り替える。

### foundationの共有AppDataError

- **参照先**: `local-data-foundation`の最新requirements/design/tasks、特に`AppDataErrorMapper`とconsumer migration seam
- **発見**: `src/domain/public.ts`が`AppDataError`とcanonical mapperの唯一ownerで、既存`FoundationError`のvariant、payload、contextを一対一で保持する。candidate-sourceはconsumerであり、feature固有validation/workflow errorを`AppDataError`へ統合してはならない。
- **影響**: source coreは`AppDataError`をtype-onlyで受けるexhaustive projectionを持つ。`FoundationError` mapping、共有error定義、candidate-owned alias/re-exportを作らない。validation、not-found、primary-required、patch precondition、URL identity failureはsource固有errorとして残す。

### source URL identityのowner

- **参照先**: latest Change Brief、旧source catalog契約、`source-price-refresh`の隣接契約、標準`URL` API
- **発見**: 旧設計はcatalogがraw referenceだけを返し、各consumerがURL normalizationと0/1/many判定を重複所有していた。これによりconsumer間でidentity規則がずれ、candidate-managementとの依存も残る。Change BriefはURL identity・match scope・unique matchingをsource coreへ移す。
- **影響**: HTTP/HTTPSだけを標準`URL`で解析し、fragment/userinfoをidentityから除外する。scheme/host/default port/pathは標準正規化を利用し、queryはsource URLの一部として保持する。tracking parameter削除などの商品推測は行わない。

### scopeと曖昧一致

- **参照先**: source-price-refreshの保存source探索要件、既存catalog reference DTO
- **発見**: consumerは全候補または指定候補の明示scopeを必要とする。同一identityが複数存在し得るため、primaryや配列順で選ぶと誤更新になる。
- **影響**: matcherは`all-candidates`と`candidate`だけを受け、結果を`no-match | unique | ambiguous-match`で返す。曖昧時は全referenceを保持し、kind/primary/price/順序で選択しない。retail eligibilityは価格workflow側が判断する。

### source identityとproduct identity

- **参照先**: latest Change Brief、`duplicate-product-merge`隣接境界
- **発見**: 同じsource URLであることと同じ商品であることは別概念であり、URL queryを商品単位に縮退するとsourceの正確な再訪・更新先を失う。duplicate-product-mergeが商品identityと統合判断のownerである。
- **影響**: source matcherは保存source referenceの一致だけを返し、同一商品判定を返さない。商品identity用normalizer、match score、merge plan/confirmationをsource coreへ追加しない。一方、source addとconditional mutationは本coreの既存owner責務としてduplicate workflowにも公開する。

### 条件付き価格patch

- **参照先**: 本spec既存Task 8.1、source-price-refreshのconsumer seam、candidate mutationのatomicity
- **発見**: downstreamが古いsource entry全体を再送すると、並行して更新されたsiteNameを上書きし得る。既存remediationはcandidate/source ID、期待raw URL、期待retail kindをcommit時に照合し、price/capturedAtだけをpatchする。
- **影響**: この契約を独立source mutation portへ移す。source/URL/kind不一致は専用precondition、revision競合は`AppDataError`の既存conflictとして区別し、後発fieldを保持する。

### 保存schemaとUIの非回帰境界

- **参照先**: local-data-foundation canonical model、project-candidate-management最新境界、本spec既存実装履歴
- **発見**: 1:N sources、`primarySourceId`、取得元別priceはすでにcanonical保存契約であり、今回のowner移管にschema migrationは不要である。source editor UI/stateと安全なnew-tab再訪はcandidate-managementの責務として残る。
- **影響**: root/schema version、backup format、migration、field semanticsを変えない。candidate editor adapterは公開source port resultを既存state/error shapeへ適合し、port失敗時にdraftと表示を保持する。

### production composition

- **参照先**: `.kiro/steering/structure.md`、application-shell境界、latest Change Brief Out
- **発見**: production singleton、feature registration、public port injectionはapplication-shell ownerであり、source coreがshellへ依存すると共有coreからcompositionへの逆依存になる。
- **影響**: 本specは公開factory/portとconsumer fixtureまでを定義する。実際のshell wiringとproduction artifact E2Eはapplication-shell更新後のgateへ委ねる。

## 設計判断

### 判断: 独立source coreを唯一ownerにする

- **採用案**: `src/candidate-sources/public.ts`をsource型・policy・catalog・mutation・matcherの唯一のfeature間入口とする。
- **理由**: candidate editor、価格更新、product identityの各consumerからownerを分離し、循環とdeep importを防げる。
- **棄却案**: candidate-managementの`sources` facetをcanonical ownerとして維持する。candidate UI境界へ共有domainが従属するため棄却する。

### 判断: URL identityはsource意味だけを正規化する

- **採用案**: 標準URLの安全な構文正規化とfragment/userinfo除外だけを行い、query意味を推測しない。
- **理由**: 再訪・更新対象のsource identityを安定させつつ、product identity ownerを侵食しない。
- **棄却案**: tracking parameterの包括除去、pathnameからSKU抽出、domain別規則。商品identity・catalog保守へ逸脱するため棄却する。

### 判断: matcherは0/1/manyを明示する

- **採用案**: caller指定scopeの全referenceを比較し、曖昧時は全候補を返してfail closedする。
- **理由**: primaryや保存順による誤更新を防ぎ、価格workflowが一意対象だけをpatchできる。

### 判断: AppDataErrorを包んで保持する

- **採用案**: `{ kind: "data"; error: AppDataError }`として一対一保持し、source固有errorとdiscriminated unionにする。
- **理由**: canonical ownerを変えず、既存variant/payload/contextとUI挙動を保持できる。
- **棄却案**: `ManagementError`を改名して再所有、message stringへ縮退、source固有errorをAppDataErrorへ統合。いずれもownershipまたはerror semanticsを壊す。

## リスクと軽減策

- **二重owner**: canonical public port利用可能後だけ旧candidate source facet/coreを撤去し、negative import fixtureで再発を拒否する。
- **URL規則の過剰化**: identity fixtureでquery保持とproduct推測禁止を固定する。
- **曖昧対象の誤更新**: matcherは全候補付きambiguityを返し、patchはcandidate/source IDとraw URL/kindを再検証する。
- **error粒度の変化**: 全`AppDataError` variantのexhaustive type fixtureと既存source error characterizationを追加する。
- **移行途中のfallback**: consumer port未注入時はfail closedし、旧candidate-owned実装へ戻らない。
- **shell越境**: source specのfile/boundary gateでapplication-shell変更を禁止し、compositionは後続taskの開始条件にする。

## 参考資料

- `.kiro/specs/candidate-source-bookmarks/brief.md`
- `.kiro/specs/project-candidate-management/{requirements,design,tasks}.md`
- `.kiro/specs/local-data-foundation/{requirements,design,tasks}.md`
- `.kiro/steering/{product,tech,structure,roadmap,delivery-policy,security,testing,web-content-acquisition}.md`
- WHATWG URL / 標準`URL` API（既存platform能力を使用し、新規libraryは追加しない）
