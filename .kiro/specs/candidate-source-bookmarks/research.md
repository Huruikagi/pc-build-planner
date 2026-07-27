# 調査と設計判断

## 概要

- **機能**: `candidate-source-bookmarks`
- **Discovery Scope**: Extension（既存システムへの統合を中心とするlight discovery）
- **主要な発見**:
  - 現行の候補集約は `product.price` と任意の単数 `sourceInfo` を持つ。候補draft、snapshot codec、backup交換形式もこの形へ密結合しているため、ドメイン型だけでなく公開契約と境界検証を同時に更新する必要がある。
  - local data foundationには純粋な `N -> N+1` migration registry、最終root検証、単一write authority、atomic replacementが既にある。新しい移行基盤は不要で、1→2 stepの登録が最小変更となる。
  - Chrome公式資料では新規タブ作成は `tabs` 権限なしで利用できる。既存の権限集合を維持したまま、side panelから `chrome.tabs.create` を呼ぶ専用adapterを注入できる。
  - 下流の価格更新は全候補または指定候補のソース参照列挙と、候補・ソースIDによる再取得だけを必要とする。URL正規化、一致判定、曖昧さの解決を上流へ持ち込まず、candidate-managementの `public.ts` から読み取り専用portを公開するのが最小のseamである。

## 調査ログ

### 現行候補モデルと検証境界

- **背景**: 単数取得元と商品価格を複数ソースへ移す影響範囲を確認した。
- **参照先**: `src/domain/normalized-attributes.ts`、`src/domain/model.ts`、`src/domain/validation.ts`、`src/features/candidate-management/contracts.ts`、`service.ts`、`state-snapshot.ts`、`view.tsx`
- **発見**:
  - `CandidateProductValues.price` と `CandidatePart.sourceInfo?` がcanonicalな保存形である。
  - `SourceInfo`のURL・日時・サイト名は個別に任意であり、手動候補や不完全な取得元は正常状態として扱われる。
  - `CandidateSummary`は商品価格をそのまま公開し、一覧に取得元URLを出していない。
  - editor snapshotはdraft全体を未信頼入力として再検証するため、複数ソース化と同時にcodec版も更新する必要がある。
- **設計への影響**: `CandidatePart.sources`を候補内のentity collectionとし、候補共通値から価格を除く。既存の欠損許容を壊さないため、保存ソースのURLと種別は任意とし、新規追加フロー側だけが有効URLと自動種別を保証する。

### プライマリ表現と代表値導出

- **背景**: フラグ方式とID参照方式を比較した。
- **参照先**: briefのBoundary Candidates、既存のUUID・重複ID検証パターン、候補一覧query。
- **発見**:
  - 各ソースに `isPrimary` を持たせると「0件・複数件primary」を表現でき、更新時に複数要素を書き換える。
  - 候補側の `primarySourceId` は代表状態を一か所に限定し、queryで価格・URLを純粋に導出できる。
- **設計への影響**: `primarySourceId`参照方式を採用する。ソースが空なら参照なし、1件以上なら存在するIDを必須とする。プライマリに価格がなくても他ソースへfallbackしない。

### 保存schema移行と原子性

- **背景**: 既存データを上書きせず1→2へ移す経路を確認した。
- **参照先**: `src/persistence/migration-registry.ts`、`runtime-contribution.ts`、`root-transaction-runner.ts`、`repository.ts`、`replacement.ts`、local-data-foundation design。
- **発見**:
  - registryは入力をcloneし、各stepのversion連続性と最終schemaを検証する。
  - read時の変換と書込みは分離され、永続化は明示mutation内だけで行われる。
  - production runtimeは現在空のstep配列を登録し、replacementには現行版定数の重複がある。
- **設計への影響**: `migration-v1-to-v2.ts`に純粋stepを追加し、production registryへ登録する。旧候補の唯一のソースIDには候補IDを再利用して再実行を決定的にする。`replacement.ts`とbackup mapperは共有された現行schema定数へ統一する。

### バックアップ交換形式

- **背景**: 保存schemaと独立した交換形式が複数ソースを往復できるか確認した。
- **参照先**: `src/features/backup-restore/contracts.ts`、`exchange.ts`、backup-restore design。
- **発見**:
  - formatVersion 1の候補形状も `product.price` と `sourceInfo?` であり、新保存形をそのまま写像できない。
  - 交換形式には連続migration registryの雛形があるが、現在stepは空である。
- **設計への影響**: 交換形式を2へ上げ、v1 envelopeを複数ソースへ変換する純粋stepを追加する。現行形式のexport/importは `sources` と `primarySourceId` を完全往復し、復元candidateはfoundationの現行schema検証へ渡す。

### メーカー判定マップとの境界

- **背景**: 本specでマップを二重保持せず、手動追加にも同じ判定を適用する必要がある。
- **参照先**: roadmapのShared seams、brief、`src/features/product-capture/public.ts`、application shell contribution composition。
- **発見**:
  - 現時点の `product-capture/public.ts` は空APIであり、#8更新後にメーカー登録ドメイン照合の公開契約が追加される前提である。
  - candidate-managementを先にcomposeし、その公開portをproduct-captureへ渡す既存順序のため、contribution instance同士を逆向きに参照させると循環する。
- **設計への影響**: candidate-managementはローカルの `SourceKindClassifier` portだけに依存し、application shellがproduct-captureの純粋な公開照合関数をadapterとして注入する。マップデータ・eTLD+1解析・保守は上流#8の所有のままとする。

### 新規タブ再訪と権限

- **背景**: side panelを遷移させず、追加権限なしで保存URLを開く経路を確認した。
- **参照先**: `src/application-shell/application-composition.ts`、`side-panel-contributions.ts`、`src/features/product-capture/chrome-runtime-port.ts`、Chrome Tabs API公式資料。
- **発見**:
  - production side panelは既に `chrome.tabs` handleをcompositionへ渡している。
  - Chrome公式資料は、新規タブ作成やURLへの遷移などTabs APIの多くの機能に追加権限は不要と明記している。
  - `tabs` 権限は主にTabの機微なフィールド参照を許可するもので、本機能の `tabs.create({url})` には不要である。
- **設計への影響**: candidate-management所有の `SourcePagePort` とChrome adapterを追加し、`SidePanelChromeApis.tabs`へ `create` の最小shapeだけを加える。adapter直前でもHTTP/HTTPSを検証し、失敗はURLをログへ出さない判別unionで返す。

### 下流向けソース参照catalog

- **背景**: `source-price-refresh` がfoundation rootやcandidate-management内部へ到達せず、保存済みsourceを列挙・再取得できる公開read seamを確認した。
- **参照先**: `.kiro/specs/source-price-refresh/design.md`、`.kiro/specs/source-price-refresh/tasks.md`、`src/features/candidate-management/contracts.ts`、`public.ts`、`registration.ts`
- **発見**:
  - 下流契約は、全candidateまたは指定candidateのsource参照を返す `listSourceReferences` と、`candidateId + sourceId` で現行参照を返す `getSourceReference` の2操作に限定される。
  - 必要な投影は `candidateId`、`sourceId`、任意 `pageUrl`、任意 `kind`、`isPrimary` だけであり、price、siteName、capturedAt、root revision、保存root全体は不要である。
  - URL正規化、retail eligibility、0件・1件・複数件の一致判定と `ambiguous-match` は `source-price-refresh` のStoredSourceLocatorが所有する。catalogが重複sourceを除外または配列順で選ぶと、下流のfail-closed規則を壊す。
  - candidate-managementのcanonical公開APIは `query`、`createCandidateEditorIntent(prefill): FeatureActivationIntent`、`sources: { catalog, mutations }` である。本specはcatalog/mutation facetを所有し、product-captureはsource付きprefillをtyped intent factoryへ渡してhandoffするため、queryやmutationを直接呼ばない。
- **設計への影響**: `CandidateSourceCatalogPort` と `CandidateSourceReference` をcandidate-management契約として定義し、`public.ts` だけからexportする。列挙はsource順を保った完全な参照集合を返し、未知candidate/sourceは既存 `ManagementError` の識別可能な `not-found` とする。

## アーキテクチャパターン評価

| 選択肢 | 説明 | 強み | リスク・制約 | 判断 |
|---|---|---|---|---|
| 候補内埋め込み + primary ID | 候補aggregate内にsource entityを配列保持し代表IDを参照 | 既存の単一root transactionと自然に整合し、候補更新が原子的 | 候補更新payloadが増える | 採用 |
| 独立source aggregate | root直下でsourceを別collectionにする | source単体queryを作りやすい | 参照整合・削除cascade・mutation境界が増え、現要件には過剰 | 不採用 |
| sourceごとのprimary flag | 各要素に代表flagを持つ | 表示時の検索が単純 | 複数primary/primaryなしを表現し、切替で複数要素更新 | 不採用 |
| side panel内の通常link | `<a href>`で遷移 | 実装量が少ない | panel自体が外部URLへ遷移して作業状態を失う | 不採用 |
| Chrome native tab API | port経由で `tabs.create` | 追加依存・権限不要、side panel維持 | runtime失敗の型付き処理が必要 | 採用 |

## 設計判断

### 判断: ソースを候補aggregate内entityとして保持する

- **背景**: 一つの商品の複数ページを一回の整合したmutationで管理する。
- **検討案**: root直下の独立collection、候補内配列。
- **採用案**: `CandidatePart.sources` と `primarySourceId` を候補内に保持する。
- **理由**: 候補削除・更新と同じwrite authority、revision、validationをそのまま利用できる。
- **トレードオフ**: source単体の独立queryは作らない。下流はcandidate公開契約からsourceを取得する。
- **フォローアップ**: `source-price-refresh` と `duplicate-product-merge` はこのcollectionとIDをcanonical contractとして再検証する。

### 判断: 種別は任意保存、表示時と新規作成時に解決する

- **背景**: briefはoptional fieldを要求し、旧保存データには種別がない。
- **検討案**: schema v2で種別必須、optionalのままclassifierで補う。
- **採用案**: `kind?: "retail" | "manufacturer"` とし、新規追加・取り込みではclassifier結果を保存する。旧移行sourceはkind欠損を許し、表示時に同じclassifierで解決する。
- **理由**: foundation migrationからfeature-ownedメーカーmapへの逆依存を作らず、旧メーカーURLを一律販売ページとして固定しない。
- **トレードオフ**: 上流マップ変更で未上書きの旧source表示が変わり得る。利用者の明示上書きは常に優先する。
- **フォローアップ**: #8公開契約の命名・戻り値が変わった場合はclassifier adapterだけを再検証する。

### 判断: 旧source IDにcandidate IDを再利用する

- **背景**: migrationは純粋・決定的で、再評価時に結果が安定する必要がある。
- **検討案**: random UUID生成、URL hash、candidate ID再利用。
- **採用案**: 旧候補から生成する唯一のsource IDにcandidate ID文字列をブランド変換して使う。
- **理由**: UUID要件を満たし、衝突せず、URL欠損でも生成でき、migrationの再実行で変わらない。
- **トレードオフ**: candidate IDとsource IDの文字列が同じだが、ブランド型とcollection境界で意味は分離される。

### 判断: 交換形式もv2へ連続移行する

- **背景**: 保存schemaだけ更新すると、export/importで複数sourceが欠落する。
- **検討案**: format v1を破壊的に置換、format v2 + v1 migration。
- **採用案**: formatVersion 2を現行とし、v1→v2 migrationを提供する。
- **理由**: 既存backupを復元可能に保ち、保存schema versionとの独立性も維持できる。
- **トレードオフ**: 検証器はv1/v2両方の形状を境界で扱う必要がある。

### 判断: 新しいライブラリを採用しない

- **背景**: URL検証、UUID、migration、tab作成に必要な能力を評価した。
- **採用案**: 標準 `URL`、既存UUID/Result、foundation migration、Chrome native Tabs APIを利用する。
- **理由**: 現行stackですべて満たせ、MV3/CSP・bundle・保守リスクを増やさない。

### 判断: 読み取り専用catalogはsource参照投影だけを所有する

- **背景**: 価格更新と同一商品統合が保存済みsourceを探索する一方、候補aggregateとURL同一性の所有権を混ぜない必要がある。
- **検討案**: foundation rootの公開、既存editor draft queryの流用、URL lookupを含むcatalog、最小source参照catalog。
- **採用案**: `CandidateSourceCatalogPort` が全候補または指定候補の参照列挙とID指定の再取得だけを提供する。
- **理由**: downstreamが必要とする識別子・URL・kind・primary状態だけを公開し、保存root、編集draft、revisionを漏らさずに済む。URL normalizationとambiguityをconsumer側に残せる。
- **トレードオフ**: consumerは取得した参照へ独自の照合policyを適用する必要があるが、異なる照合目的をcandidate source ownerへ固定しない。
- **フォローアップ**: DTO、method、error、公開APIの形状が変わる場合は `source-price-refresh` と `duplicate-product-merge` のconsumer contractを再検証する。

## リスクと軽減策

- #8のproduct-capture公開契約が未実装または形状変更される — classifierを単一adapterへ隔離し、実装開始前に上流公開契約を確認する。
- schema定数が複数moduleへ重複している — persistence publicから現行版を一元参照し、replacementとbackup mappingの回帰testを追加する。
- primary削除で参照が壊れる — feature policyで保存前に選択を要求し、domain validatorでも存在参照をfail closedする。
- 旧sourceにURLがない — migrationでは値を捨てず任意URLを許容し、再訪操作だけを無効化する。
- 外部URLがpanel遷移や危険schemeを起こす — UIは通常linkを使わず、port直前でHTTP/HTTPSを再検証する。
- snapshot/backupの旧shapeが残る — codecと交換形式に明示version migrationを設け、未知版は拒否する。
- catalogがURL正規化や重複排除を引き受ける — source参照を値どおり列挙するcontract testと公開consumer型検査で、照合責務の逆流を防ぐ。

## 参考資料

- `.kiro/specs/candidate-source-bookmarks/brief.md` — 問題、範囲、境界候補、制約。
- `.kiro/steering/product.md` — 検討中ブックマーク、欠損・通貨の原則。
- `.kiro/steering/tech.md` — MV3、React、local data foundation、型安全。
- `.kiro/steering/structure.md` — feature公開境界、単一write authority、composition所有。
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) — `tabs.create`を含む多くの操作が追加権限を要しないこと、および`tabs`権限の範囲。
