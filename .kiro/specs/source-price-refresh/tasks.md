# 実装計画

## Change Integration

- **Change Brief**: `v0.5.0-boundary-reconciliation`
- **In scope**: source public match/conditional patch consumer、`ManagementError`撤去、共有`AppDataError` mapping、価格workflowとunit/contract/runtime/UI/E2E非回帰をtask 7へ割り当てる。
- **Out of scope**: URL identity・source core/policy/ambiguity、candidate mutation、canonical error定義・意味・粒度、価格抽出規則、監視・履歴、application-shell composition、UI layout。
- **History preservation**: task 1〜6の完了履歴とnative menu証跡を維持し、boundary reconciliation差分だけを未完了taskとして追加する。

- [x] 1. 公開境界と実行前提を確立する

- [x] 1.1 上流portを消費する価格更新の公開契約を確立する
  - 各producer specで定義・承認済みの `CandidateSourceCatalogPort`、`CandidateSourceMutationPort`、`PagePriceExtractionPort`、`TransientGestureRegistrationPort` だけを依存として受け入れる。
  - candidate-managementの `sources.catalog` / `sources.mutations`、product-captureの `pagePriceExtraction`、application shellの同期gesture registrationという確定済み公開入口をconsumer contractへ固定する。
  - URL照合scope、matched target、price observation、receipt、判別可能なerror unionを型安全に公開する。
  - catalog全体と候補一件のscopeを判別共用体で区別し、foundation root、shell store、product-capture内部への迂回依存を公開consumer型検査で拒否する。
  - 公開consumer fixtureが内部moduleをimportせず全portを組み立て、TypeScript strictで通ることを完了条件とする。
  - _Requirements: 2.5, 4.1, 4.5, 6.3, 6.4_
  - _Boundary: SourcePriceRefreshPublicApi_

- [x] 1.2 保守的なsource URL同一性を実装する
  - HTTP/HTTPSだけを受理し、scheme、host、pathと未知queryを比較keyへ保持する。
  - host case、既定port、fragment、root以外の末尾slash、既知tracking keyを規則どおり正規化する。
  - 残るquery pairをvalue損失なく安定sortし、重複keyとpercent encodingを標準URL serializationで維持する。
  - exact normalizationとboolean同一性の両APIが、tracking差を一致、商品query差を不一致として返すことを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.3_
  - _Boundary: SourceUrlIdentity_

- [x] 1.3 context menu permissionを最小権限gateへ追加する
  - manifestの既存permission集合へ `contextMenus` だけを追加する。
  - artifact validatorのexact allowlistと診断を5権限へ更新し、host、optional、tabs、alarms permissionは引き続き拒否する。
  - production manifestと生成物検査が `contextMenus` を受理し、許可外permissionのfixtureを失敗させることを完了条件とする。
  - _Requirements: 6.1, 6.2, 6.6_
  - _Boundary: ManifestPermissionGate_

- [x] 2. 独立したcoreコンポーネントを構築する

- [x] 2.1 (P) scope内の保存済みsourceを一意に特定する
  - catalog scopeとcandidate scopeを上流read-only portへ写像する。
  - 欠損URLを除外し、正規化URLの0件・1件・複数件を `no-match`、matched target、`ambiguous-match` に分ける。
  - 一件一致後もkindが明示 `retail` でないsourceを `ineligible-source` とし、配列順やprimaryで暗黙選択しない。
  - matched targetがcandidate ID、source ID、正規化URL、primary flagを保持し、source順に依存しないことを完了条件とする。
  - _Requirements: 2.5, 2.6, 2.7, 2.8, 4.5, 6.3_
  - _Boundary: StoredSourceLocator_
  - _Depends: 1.1, 1.2_

- [x] 2.2 (P) activation世代ごとの価格更新stateを構築する
  - activation受理時に固定tabを保持したrunning状態から自動実行する。
  - succeeded receiptとrecoverable判定付きfailed errorを判別可能なsnapshotとして公開する。
  - 新世代で旧stateを置換し、旧抽出・旧mutation完了とunmount後callbackを無視する。
  - running、succeeded、failed以外の実行button待機状態が存在せず、新activationで自動開始することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 5.5_
  - _Boundary: SourcePriceRefreshState_
  - _Depends: 1.1_

- [x] 2.3 (P) feature固有のcontext menu gesture sourceを構築する
  - stable item ID、page context、HTTP/HTTPS document patternでmenu itemを冪等登録する。
  - click eventのitem IDと数値tab IDだけを検証し、上流gesture callbackへ固定tabを同期emitする。
  - URL、selection、link、frame dataをstoreやlogへ渡さず、別itemと不正tabを無視する。
  - 一つの有効clickが一つの同期emitになり、adapter自身がactivation store、sequence、side panel openを作らないことを完了条件とする。
  - _Requirements: 1.1, 1.4, 6.1, 6.2, 6.6_
  - _Boundary: PriceRefreshContextMenuSource_
  - _Depends: 1.1, 1.3_

- [x] 2.4 価格更新の進行・成功・失敗viewを構築する
  - running時は進行、success時はconfirmed money、取得日時、primary反映有無を表示する。
  - failure kindごとにcontext menu再実行、source整理、保守終了、保存領域確認の回復案内を表示する。
  - panel内の再実行button、完全URL、raw HTML、商品値、例外dumpを表示しない。
  - 架空の外部文字列を渡してもHTML要素として解釈されず、3状態が既存message resolverで日本語・英語表示されることを完了条件とする。
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 3.5, 5.1, 5.2, 5.3, 5.4, 5.6_
  - _Boundary: SourcePriceRefreshView_

- [x] 3. 価格更新use caseと一過性featureを完成させる

- [x] 3.1 price observationを現行sourceへ原子的に反映する
  - price欠損またはconfirmed money欠損をmutation前に拒否し、旧priceとcapturedAtを保持する。
  - target sourceを更新直前に再読込し、observed URL同一性、retail kind、candidate/source IDを再検証する。
  - 既存sourceのpriceとcapturedAtだけを置換して上流mutation portへ渡し、URL、siteName、kind、他source、product、normalized attributesを維持する。
  - validation、conflict、maintenance、quota、storageを既存management errorから安定mappingし、失敗時に部分更新を残さない。
  - primary更新receiptでは代表projectionが新価格へ追従し、non-primary更新では代表価格が変わらないことを完了条件とする。
  - _Requirements: 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.6, 6.3_
  - _Boundary: SourcePriceRefreshService_
  - _Depends: 2.1_

- [x] 3.2 固定tab抽出と世代gateを価格更新workflowへ接続する
  - 現行activationだけが上流price extraction portへ固定tab IDを渡す。
  - page-derived URL、capturedAt、既存rank/normalizer由来price provenanceを受け取り、catalog scopeの照合と原子的更新へ進める。
  - extraction完了後とmutation完了後に世代を照合し、旧世代の結果でstateを変更しない。
  - permission lost、restricted page、tab change、injection failure、invalid payload、price unavailableを永続化なしのtyped failureにする。
  - context menu activation一回で抽出からsuccess/failure表示まで進み、別の実行gestureを要求しないことを完了条件とする。
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.5, 3.6, 5.5_
  - _Boundary: SourcePriceRefreshService, SourcePriceRefreshState_
  - _Depends: 2.2, 3.1_

- [x] 3.3 一過性featureのUI contributionとReact lifecycleを構築する
  - featureをcanonical `TransientApplicationFeatureRegistration`として登録し、`presentation: "transient"`を明示してnavigation propertyを持たせず、activationIdとfixed tabIdを境界検証する。
  - mount時にstateの自動workflowを開始し、unmountでReact root、subscription、後着callbackをcleanupする。
  - navigationを持たないUI contribution factoryをfeature-owned公開入口として用意し、side panel専用集約点からだけ取り込める契約にする。worker-safe catalog向けの入口からfeature UI registration、DOM、Reactへ到達するimport経路を作らない。
  - 拡張アイコン通常起動や常設navigationから価格更新を選択できず、不正activationでは実行を開始しない。
  - side panel contract fixtureへ渡したregistrationが単一主表示領域で進行・結果viewを表示し、tab失効または常設選択で上流規則どおり終了することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.5, 1.6, 5.5, 6.5, 6.6_
  - _Boundary: SourcePriceRefreshRegistration_
  - _Depends: 2.2, 2.4, 3.2_

- [x] 4. 確定済み上流portとproduction compositionへ統合する

- [x] 4.1 product-capture公開のprice extraction portへ接続する
  - `product-page-capture` で定義済みの `ProductCapturePublicApi.pagePriceExtraction` が固定tabだけを解決し、既存extractor、ranker、normalizerでprice一件を選ぶことをcontract testで固定する。
  - page URLを注入先tabの推測値ではなくpage-derived payloadから返し、target URLと不一致ならtab-changedとしてfail closedにする。
  - price original、confirmed money、capturedAtだけを返し、他fieldをsource-price-refreshへ公開しない。
  - source-price-refreshがproduct-capture内部へdeep importせず、既存商品取り込みと同じ架空price fixtureで同じ結果を得ることを完了条件とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 6.4, 6.7_
  - _Boundary: PagePriceExtractionPortIntegration_
  - _Depends: product-page-capture 6.3_

- [x] 4.2 candidate source catalogとmutationへ接続する
  - `candidate-source-bookmarks` で定義済みの `sources.catalog` から全sourceまたは候補内sourceの限定参照だけを取得し、同じsource facetの `sources.mutations` を更新に利用する。
  - match targetをcandidate/source IDでmutation portへ渡し、public consumerからrevision contextを隠したまま一回のroot mutationへ接続する。
  - source更新後のcandidate queryでprimary/non-primary projectionとcompatibility入力の非回帰を確認する。
  - catalog、mutation、queryのintegration testで対象sourceだけのprice/capturedAtが変わり、失敗時はroot revisionを含む保存状態が不変であることを完了条件とする。
  - _Requirements: 2.5, 2.6, 2.7, 2.8, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: CandidateSourcePortIntegration_
  - _Depends: 3.1, candidate-source-bookmarks 3.4_

- [x] 4.3 context menu sourceを上流gesture lifecycleとworker compositionへ接続する
  - feature-owned sourceのmenu worker registrationだけをworker-safe catalogへ登録し、`transient-feature-surface` で定義済みの同期 `TransientGestureRegistrationPort` へ接続する。
  - click emitが既存schedulerのsequence割当、activation store、watch-ready、side panel open、tab墓標へ一度だけ流れるようcompositionする。
  - worker bootstrapの開始・停止でmenu listenerとgesture登録を対称cleanupし、worker再生成時もitem重複を残さない。
  - `production-worker-composition.ts` とworker-safe catalogが `side-panel-contributions.ts`、feature UI、DOM、Reactをimportせず、context menu clickから正しいsurfaceId/tabIdのactivation recordが既存経路に作られることを完了条件とする。
  - _Requirements: 1.1, 1.4, 1.5, 5.5, 6.1, 6.2, 6.6_
  - _Boundary: PriceRefreshContextMenuSource, TransientGestureComposition_
  - _Depends: 2.3, transient-feature-surface 6.3_

- [x] 4.4 side panel contribution、message catalog、隣接consumerを統合する
  - application shell所有の `side-panel-contributions.ts` へUI contribution factoryを登録し、root runtimeをfeature内部から直接編集しない。
  - 4.3で登録済みのworker-safe catalogにmenu worker registrationだけが存在し、UI registration、React root、view、CSSが混入しないことを統合検証する。
  - context menu label、running、success、各failure、回復案内のmessage keyを日本語・英語で同時追加する。
  - duplicate-product-merge consumer fixtureがcandidate scopeで同一URLをmatchし、新規source追加ではなく `refreshCapturedPrice` へ渡す。
  - side panel contribution parity、worker bundle境界、typed message resolution、public consumer typecheckが通り、常設navigationに価格更新itemが増えないことを完了条件とする。
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 6.3, 6.4_
  - _Boundary: SidePanelContributionIntegration, MessageCatalog, SourcePriceRefreshPublicApi_
  - _Depends: 3.3, 4.1, 4.2, 4.3_

- [x] 5. critical pathと非回帰を検証する

- [x] 5.1 URL、照合、更新、stateのunit/contract coverageを完成させる
  - 全URL規則、0/1/複数一致、retail制約、price欠損、stale target、management errorを架空dataで検証する。
  - stateの新旧activation競合、unmount、抽出・mutationの後着順序を決定的なdeferred portで検証する。
  - 公開port contract kitでcatalog scopeとcandidate scopeが同じURL identityとatomic updateを利用することを確認する。
  - 関連unit/contract suiteが全38受入基準のcore分岐を失敗なしで実行することを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.3, 6.4_
  - _Boundary: SourcePriceRefreshTestKit_

- [x] 5.2 context menu、permission、worker境界のruntime coverageを完成させる
  - item冪等登録、有効click、別item、不正tab、restricted URL、cleanup、worker再生成をChrome stubで検証する。
  - manifestがexact 5権限でhost/optional permissionを持たず、許可外permissionがartifact gateで失敗することを検証する。
  - production worker bundleへ `side-panel-contributions.ts`、feature UI、DOM、React、完全URL、商品値を持ち込まず、worker-safe catalogにはmenu registrationだけが載ることを生成物検査で確認する。
  - runtime、boundary、artifactの関連suiteが新permissionとgesture接続を一貫して受理することを完了条件とする。
  - _Requirements: 1.1, 1.4, 1.5, 6.1, 6.2, 6.6_
  - _Boundary: SourcePriceRefreshRuntimeTests_
  - _Depends: 4.3_

- [x] 5.3 transient viewとcandidate integrationのDOM coverageを完成させる
  - running、primary success、non-primary success、各failure案内をtesting-libraryとuser視点DOMで検証する。
  - UI contributionが `side-panel-contributions.ts` 経由でmountされ、raw external stringがHTMLとして解釈されず、再実行buttonや常設navigation itemが存在しないことを確認する。
  - candidate source更新後のsummary projection、normalized attributes、compatibility結果、他sourceが不変であることをintegrationで検証する。
  - DOM/integration suiteが日本語・英語message parityと原子的更新の観測可能な結果を通すことを完了条件とする。
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.6, 6.4_
  - _Boundary: SourcePriceRefreshDomIntegrationTests_
  - _Depends: 4.2, 4.4_

- [x] 5.4 production ingress、Playwright後段、native menu gateを完成させる
  - runtime integrationで実context menu adapterから既存schedulerへの一回配送を固定し、headed Chromiumの手動または承認済みOS-level UI gateで架空HTTPSページから「価格を更新」を一回選択する代表成功smokeを実施する。
  - Playwrightはproduction activation transportへ正規形activationを投入した後段を担当し、架空HTTPS販売ページと複数source候補でprimary価格・capturedAt・代表価格の更新を確認する。この投入をnative menu clickの証拠とは称さない。
  - price欠損、URL不一致、複数一致、manufacturerでは旧価格を維持して型付き失敗案内を表示する。tab遷移、対象tab失効、常設navigationでは一過性面を終了して保存を変更しないことをPlaywrightで確認する。旧世代の遅延完了がstateを変更しないことはdeterministicなstate/runtime integrationで確認する。
  - fixture validator、型検査、lint、unit、integration、build、artifact、Playwright、およびheaded native menu smokeを含む分割検証が通ることを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.5, 2.6, 2.7, 2.8, 3.5, 3.6, 4.1, 4.2, 4.3, 5.1, 5.2, 5.5, 6.1, 6.2, 6.4, 6.5, 6.6, 6.7_
  - _Boundary: SourcePriceRefreshE2E_
  - _Depends: 5.1, 5.2, 5.3_

- [x] 6. validation remediationで競合・世代・設計同期を閉じる

- [x] 6.1 上流の条件付き価格patchへ切り替える
  - `getCandidateDraft` 由来の古い完全entry置換を廃止し、`candidate-source-bookmarks` 8.1の条件付きprice-only patchを利用する。
  - match後からcommitまでにsiteNameが並行更新されても後発値を保持し、URL・kind・識別子変更はstale-target、revision競合はconflictとして提示する。
  - 実foundation stackで並行更新、1回commit、primary/non-primary projection、compatibility非回帰を検証する。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2_
  - _Boundary: SourcePriceRefreshService, CandidateSourcePortIntegration_
  - _Depends: candidate-source-bookmarks 8.1_

- [x] 6.2 明示的readinessで自動実行し要件・設計を同期する
  - `transient-feature-surface` 7.1のone-shot readinessを利用し、`setTimeout(0)` とshell内部macrotask順序への依存を除去する。
  - 要件5.5を「確定前の旧世代結果は保存しない／確定後の有効commitは表示を抑止して補償更新しない」へ明確化し、抽出後staleとmutation後staleの双方を固定する。
  - activationの`surfaceId`、worker-safe公開入口、実ファイル構成、依存方向をdesignへ同期し、親rollup taskを実状態へ合わせる。
  - _Requirements: 1.1, 1.5, 5.5, 6.6_
  - _Boundary: SourcePriceRefreshRegistration, SourcePriceRefreshRequirements, SourcePriceRefreshDesign_
  - _Depends: transient-feature-surface 7.1, 6.1_

- [x] 6.3 remediation後の完全検証とnative menu gateを実施する
  - candidate-source-bookmarks、transient-feature-surface、source-price-refresh、duplicate-product-mergeの関連contractを再検証する。
  - `pnpm validate` とheaded native context menu smokeを実施し、実行日時・環境・結果をvalidation記録へ残す。
  - 全機械gate、browser動線、境界監査が成功し、残存NO-GO所見がないことを完了条件とする。
  - _Requirements: 5.2, 5.5, 6.3, 6.5_
  - _Boundary: ValidationGates, NativeMenuSmokeRecord_
  - _Depends: 6.1, 6.2_

- [ ] 7. canonical source/error consumer境界へ移行する

- [x] 7.1 source match/conditional patchと共有errorのconsumer contractを固定する
  - **実装開始条件**: `candidate-source-bookmarks` 10.4のcanonical match/conditional price patch public entryと`local-data-foundation` 11.1の`AppDataError`公開入口が利用可能であること。いずれか未完了なら旧ownerを先行削除せず待機する。
  - source ownerの公開match portへcatalog/candidate scopeとpage URLを渡し、unique target、ambiguity、eligibility、opaque preconditionを受け取るpositive consumer fixtureを追加する。
  - conditional patchへtarget、precondition、price、capturedAtだけを渡し、primary projectionと非対象field保持をsource ownerへ委譲する契約を固定する。
  - foundation公開入口の`AppDataError`をexhaustiveに扱い、旧`ManagementError`、candidate-management source proxy、URL identity/locator、内部source mutation、FoundationError mapperへのimportをnegative gateで拒否する。
  - _Depends: local-data-foundation 11.1, candidate-source-bookmarks 10.4_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.1, 4.5, 6.3, 6.4, 7.1, 7.2, 7.5, 7.7_
  - _Boundary: SourcePublicPortAdapter, SourcePriceRefreshPublicApi consumer contract_

- [ ] 7.2 price refresh workflow/state/UIをcanonical portへ接続する
  - fixed-tab extraction後にsource public match→conditional patchを一度だけ呼び、旧URL normalization、catalog走査、source再読込、candidate mutationをfeature内から撤去する。
  - `AppDataError`のvalidation、conflict、maintenance、storage、quota、unsupported-dataを既存`SourcePriceRefreshError`、recoverability、messageへ意味・粒度を変えず写像する。
  - explicit context menu action、activeTab、世代gate、price-only patch、失敗時の旧price/capturedAt保持、primary/non-primary projection、unexpected throw containmentを維持する。
  - feature contributionとworker-safe menu registrationだけを公開し、application-shell composition file、source owner、candidate-management、foundation実装を変更しない。
  - _Depends: 7.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.6, 7.2, 7.3, 7.4, 7.5, 7.6_
  - _Boundary: SourcePriceRefreshService, State, View, FeatureContribution, WorkerPublic_

- [ ] 7.3 contract・runtime・UI・E2Eとownership gateを完了する
  - source match/patch consumer contract、全`AppDataError` mapping、fixed-tab extraction、generation fence、context menu runtime、state/DOM、primary/non-primary、no-match/ambiguous/ineligible/conflict/storage failureを架空fixtureで回帰する。
  - production activation transport後段のPlaywrightと既存native menu証跡を再検証し、価格workflow移行後も明示操作からtransient結果までの利用者結果が一致することを確認する。
  - source owner、Foundation error owner、application-shell composition owner、本specのprice workflow/UI ownerが重複せず、循環proxy、deep import、旧`ManagementError`、production shell file変更がないことを監査する。
  - 45件のAcceptance Criteria、Change Brief In/Out、file/dependency boundaryが自動testまたは明示検証へtraceされ、blocked taskがなければ完了とする。
  - _Depends: 7.2; project-candidate-management 14.5_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - _Boundary: Source price refresh final ownership and regression validation_

## Implementation Notes

- `v0.5.0-boundary-reconciliation`以後、canonical URL identity/matcher/ambiguity/patchはsource owner、`AppDataError`はFoundation、production compositionはapplication-shellが所有し、本specはprice extraction workflow、state/UI、feature/worker public contributionだけを所有する。
- **Fresh task-graph sanity review (2026-08-12)**: 独立reviewer dispatchを試みたが共有thread上限で作成できなかったため、update-batch fallbackに従ってRequirements/Designから独立した観点でtask 7を再監査した。7.1→7.2→7.3は一方向で循環せず、上流依存はFoundation共有errorと確定candidate/source public seamだけである。各taskはconsumer contract、workflow統合、最終回帰へ分離され、source core、canonical error、candidate mutation、shell compositionを変更対象に含めない。45 ACとChange Brief In/Out、explicit action・activeTab・固定世代・price-only・failure preservation・transient UIのtraceに欠落はなく、修正指摘なしでPASSとした。

- 6.3: 2026-08-02 15:45 JST、Windows 11 Home（NT 10.0.26200.0）・Playwright 1.61.1のheaded Chromiumで `SOURCE_PRICE_REFRESH_NATIVE_SMOKE=1 pnpm exec playwright test e2e/source-price-refresh.native-smoke.spec.ts --workers=1` を実行し、利用者がbrowser-native「価格を更新」を選択して1 passed（23.6秒、exit 0）。続けて `pnpm validate` はexit 0（Node 1,429/1,429、Playwright 26 passed・native gate 1 skipped）で、native選択証拠は前者、production activation transport後段と全機械gateは後者として分離記録した。要件38件は37件の自動証拠と要件6.5のheaded実選択証拠で全件充足し、関連contract・設計・境界の独立再監査に新たなNO-GO所見はない。

- 6.2: `transient-feature-surface` 7.1の`waitUntilCurrent`をmountから非同期に待ち、trueかつ未unmountの場合だけ自動実行する。timer/microtask順序依存を削除し、false・reject・unmount後late trueをwarningなしでno-opに固定した。要件5.5は確定前の旧世代結果を保存しない一方、原子的確定後の有効commitは表示だけ抑止して補償更新しないと明確化した。activation shape、worker-safe入口、実ファイル計画、承認metadataも2026-08-02の利用者承認へ同期済み。

- 6.1: `candidate-source-bookmarks` 8.1の `patchSourcePrice` へ移行し、`CandidateQuery.getCandidateDraft` と古い完全entry置換を廃止した。commit直前の公開referenceからraw URL・retail kindをpreconditionとして渡し、`precondition-failed`だけを`stale-target`へ写像する。実foundation contractと破壊decoratorで、後発`siteName`保持、price/capturedAt限定1commit、不一致・競合0 patch commit、primary/non-primary・compatibility非回帰を固定した。

- 5.4: 利用者承認（2026-08-01）により検証責務を三分割した。native menu ingressはproduction runtime integration、業務critical pathはproduction activation transport投入後のPlaywright、browser-native item選択はheaded manual/OS UI gateで証明し、いずれか一つを単独のend-to-end証拠とは称さない。test-only message/storage/env/backdoorは追加しない。
- 5.3: `unexpected` はmutation着地後の上流throwも含み保存結果へ帰属できないため、「旧価格を維持した」と断言する `preservedNotice` を表示しない。他19 failure kindは同noticeを必須DOMとして固定する。non-primary successも確定金額・通貨・capturedAt・代表価格不変を同一DOMで同時assertする。
- 5.2: worker catalogからfeature通常 `public.ts` をruntime importすると、公開APIが所有するmanufacturer mapや完全URLまでservice-worker bundleへ到達し得る。worker registrationはproducer-owned `worker-public.ts` へ分離し、feature sourceのapplication-shell依存は `public` / `worker-public` だけを再帰boundary scanで許可する。cleanup冪等性は同じ現行leaseの2回目で `contextMenus.remove` 回数が増えないことを直接spyする。
- 5.1: source-price-refresh公開port contract kitはcatalog/candidate両scopeで同じ正規化target、candidate隔離、scopeごと1commit、price/capturedAt限定置換、他source不変を検査し、二重mutation decoratorを両scopeで拒否する。contract driverのsource更新fakeはmergeではなくcomplete-entry置換にする。
- 4.4: side panel compositionはcandidate managementの実 `query` / `sources.catalog` / `sources.mutations`、product captureの実 `pagePriceExtraction`、shellの同一transient lifecycleをfeature contributionへ注入する。隣接duplicate-product-merge fixtureは公開APIだけでcandidate scope照合から `refreshCapturedPrice` へ渡し、source追加能力を持たせない。
- 4.3: stable context menu itemの世代交代は `contextMenus` API instance単位のleaseとmutation queueで直列化する。旧世代cleanup・遅延callbackは現行leaseのitemを削除せず、callback型create失敗はlistenerを解除してfail closedにする。production workerのlabel解決はReact非依存の `ui-messages/worker-public.ts` を使う。

- 1.1: 公開型exportは公開consumer fixtureから実際に参照させないと回帰検知が成立しない。type-onlyのexportは削除してもtypecheckが通るため、error unionは `switch` + `const exhaustive: never` で網羅性を固定し、値の往復（match → refresh → receipt）をfixtureで組み立てること。
- 1.1: `NormalizedSourcePageUrl` などのbrand型はdesign.mdのstring property brand記法ではなく、既存 `src/domain/identifiers.ts` と同じ `unique symbol` brand方式に揃える。
- 1.1: 新しい公開consumer fixtureを追加したら `package.json` の `validate:boundaries` 引数と `tsconfig.public-consumer.json` の include の両方へ登録する。
- 1.1: feature source から application-shell 非公開moduleへのimportを止めるrule（`settings-public-dependencies-only` 相当）が `scripts/validate-boundaries.mjs` に未整備。task 5.2 のboundary coverageで対応する。
- 1.2: URL正規化は標準 `URL` / `URLSearchParams` のserializationだけを使う。帰結として `?q=a+b` と `?q=a%20b`、`?sale` と `?sale=` は同一keyになる（form-urlencodedで同一値のためvalue損失も過剰一致もない）。末尾slashは1つだけ除去するので `/p/1//` は `/p/1` と一致しない（過小一致方向で誤更新は起きない）。
- 1.3: manifest permissionを変更したら `.kiro/steering/security.md` の権限固定記述も同時に更新する（本タスクで4→5権限へ反映済み）。
- 1.3: `scripts/validate-artifacts.mjs` 末尾のmain-module guard（`import.meta.url === new URL(process.argv[1], "file:").href`）はWindowsでドライブレターをURL schemeと解釈するため発火せず、`pnpm validate:artifacts` の第1スクリプトがローカルWindowsでno-op化する既存バグがある。強制力は `validate-final-gate.mjs`（`pathToFileURL` 使用、関数を直接import）経由で維持されているため、Windowsローカルでのpermission検証は `pnpm validate:final-build` を根拠にすること。
- 2.1: 一意性判定はretail制約より先に行う。複数一致のうち1件だけがretailでも `ambiguous-match` を返す（kindで先に絞ると要件2.7が禁じる暗黙選択規則になるため）。要件2.8の「一致したソース」は単数形で一意性解決後を前提としている。
- 2.1: `ManagementError` の `not-found` は `SourcePriceRefreshError` に含まれないため `no-match` へ写像している。design.md 344行「catalog errorは既存 ManagementError を保持する」はunionが表現できる範囲をやや超えた記述で、task 1.1 の contracts から引き継いだ設計上の隙間。task 3.1 の再検証実装はこの写像と整合させること。
- 2.2: `recoverable` 判定の唯一の典拠は design.md のエラー表とし、規則は「利用者の次の一手が同一context menu gestureの再実行で終わるか」に一本化する。表に無い kind（`invalid-url`、`restricted-page` は再実行可、`validation`、`unsupported-data` は保存データ修復が先で再実行不可）はこの規則からの演繹であり、task 2.4 の回復案内文言を書くときに再確認すること。
- 2.2: state層は例外をerror kindへ翻訳しない。`SourcePriceRefreshError` union に unexpected 相当のメンバが無いため、既存kind（`injection-failed` など）を汎用fallbackに流用すると原因を偽装し、`recoverable: true` で無限再実行を招く。`runRefresh` は typed `Result` で必ず settle する契約とし、例外→typed failureの変換は task 3.2 の service が負う。
- 2.2: task 3.3 で `state.activate(...)` を呼ぶときは rejection handler を必ず付ける。未処理rejectionは例外objectをdumpし、要件5.6とdesign.mdのsecurity方針（例外dumpを扱わない）に反する。
- 2.2: 判別共用体の網羅性は「switch + `const exhaustive: never`」だけでなく、テスト側の期待表を `Record<Union["kind"], T>` で持つと union へのメンバ追加がtypecheckで落ちる。分類ロジックの回帰検知に有効。
- 2.3: menu itemの冪等登録は `removeAll()` ではなく `remove(id)` → `create(...)` にする。`removeAll()` は他featureのitemまで消す。remove失敗（item不在）は正常系なので `readLastError` で消費し、Chromeのunchecked lastError警告を出さない。
- 2.3: `scripts/validate-boundaries.mjs` の `isForbiddenApplicationShellFeatureImport`（127-134行）は application-shell → feature のimportを `public` と `feature-contribution` だけに限定する。task 4.3 は `context-menu-source.ts` をdeep importできないため、`feature-contribution-catalog.ts` が `product-capture/public.js` から worker contribution を取る既存precedentに倣い、worker-safeな公開exportを 4.3 で追加すること（2.3 時点では未使用exportになるためあえて公開していない）。
- 2.3: 例外を握る `catch` はbindingを書かない（`catch {`）。例外objectを変数に取れないようにすることで、要件5.6の「例外dumpを扱わない」をコード形状で担保する。
- 2.3: cleanup の二重呼び出しガード（`active` flag）はテストで未カバー。`readLastError` が両分岐でerrorを消費するため `uncheckedErrors() === 0` の assertion が空振りする。ガードを外すと「stale な2回目teardownが新世代のmenu itemを消す」実害があるので、task 5.2 の worker再生成coverageで `remove` の呼び出し回数を直接spyして固定すること。
- 2.4: message namespaceを追加したら `tests/ui-messages/catalog-parity.test.ts` の `assert.deepEqual(Object.keys(MESSAGES), [...])`（v0.3 gate）へも追記が要る。追記は加算のみで、gateを緩めないこと。追記後は既存のplaceholder/selector parity機構が新namespaceを自動で覆う。
- 2.4: money/日時のlocale対応formatterはコードベースに存在しない（`Intl.` / `toLocale*` の使用箇所ゼロ）。確定金額は message catalog の placeholder `"{amount} {currency}"`、`capturedAt` は canonical ISO文字列をそのまま描画する（`candidate-management/view.tsx` と同じ前例）。design.md も表示形式を規定していない。将来formatterを導入するなら view 側を差し替える。
- 2.4: design.md のエラー表に無い8 kind（`invalid-url` / `restricted-page` → 対象ページで再実行、`validation` / `unsupported-data` → 保存データ修復が先、など）の回復案内は 2.2 の単一規則からの演繹。viewの案内keyとstateの `isRecoverableSourcePriceRefreshError` が乖離しないよう、全kindを `Record<SourcePriceRefreshError["kind"], …>` で突き合わせるテストで固定してある。union にメンバを足すと両方のtypecheckが落ちる。
- 2.4（5.3で解消済み）: 失敗表示の `preservedNotice` は、保存結果へ帰属できる19 failure kindを走査するDOMテストで固定した。mutation着地後の上流throwも含み得る `unexpected` だけは「旧価格を維持した」と断言しないことも専用assertionで固定済み。
- 3.1（6.1で解消済み）: 初期実装は`getCandidateDraft`から完全entryを再構築して`updateSource`へ渡したため、並行`siteName`更新を巻き戻すTOCTOUがあった。2026-08-02の利用者承認を受け、`candidate-source-bookmarks` 8.1が所有する条件付き`patchSourcePrice`へ移行し、最新entryのprice/capturedAtだけをcommit時precondition付きで更新する。旧`CandidateQuery/getCandidateDraft/updateSource`経路と置換fakeは削除済み。
- 3.2: 世代gateは3点。抽出**前**（現行でなければ `extractPrice` を一度も呼ばない）、抽出**後**（`extracted.ok` を見る**前**に判定する。旧世代は自分の失敗すら提示してはならない＝要件1.5）、mutation**後**（commit済みの更新は巻き戻さず表示だけ抑止する＝design.md「commit済みの有効な更新は巻き戻さない」）。補償mutationを足すと要件違反になる。
- 3.2: `price-unavailable` は design の command 順どおり `matchSource` の**後**（`refreshCapturedPrice` 内）で判定される。よって「価格も取れず一致sourceも無い」ページは `no-match` になる。保持すべき既存価格も報告対象も存在しないため、より具体的な `no-match` が正しい。
- 3.2: `product-capture/public.ts` の `unavailablePriceExtraction` fallback は `tab-unavailable`（union正規メンバ）を返す。永続化なしのtyped failureとして素通しでよい。
- 3.2: 上流portが例外を投げた場合の member が無く、`state` が永久に `running` になる設計gapがあった。利用者承認のうえ（2026-08-01）`SourcePriceRefreshError` へ `{ kind: "unexpected" }` を追加して解消済み。意味は「上流portが `Result` 契約に違反して throw した」のみで、page条件もstorage結果も主張しない。payloadは持たない（例外objectを捕まえない＝要件5.6）。決定的defectなので `recoverable: false`、回復案内は再実行で終わらない。design.md の union・エラー方針・エラー表も追記済み。
- 3.2: 例外の封じ込めは workflow 本体**全体**を `try { … } catch {` で包む（bindingなし）。`isCurrent` も含めるのは、それがshell注入callbackであり、port3つだけを包むと同じstuck-spinner defectが残るため。世代gate3点の順序と「補償書き込みをしない」性質は封じ込めで変えないこと。
- 3.2: `isRecoverableSourcePriceRefreshError` の規則文は「保存データの修復が先」に加えて「同じgestureを繰り返しても成功しない」を選言として追加した厳密な一般化。既存15 kindの `true` / 4 kindの `false` の分類は不変。
- 3.2（5.3で解消済み）: `FailureSummary` は `unexpected` のときだけ `preservedNotice` を表示せず、他19 failure kindでは表示する。これにより、mutation着地後の上流throwを保存結果へ誤帰属せず、atomicなtyped failureでは既存価格維持を明示する。両分岐はview DOMテストで固定済み。
- 4.2: integration driver は上流をfakeせず実stackを組む。`createInMemoryStorageAdapter` → `createLocalDataRepository` → `createRootTransactionRunner` → `createMutationPipeline` → `createWriteAuthority` → `createScopedDataPort` → 各feature の contribution factory。fakeは 4.1 の seam（page price extraction）と 4.3/4.4 の seam（transient surface）だけに留める。実 `candidateSourcePolicy.update` が経路に入るので Note 3.1 の merge fake 事故は構造的に再発しない。
- 4.2: 「一回のroot mutationで確定する」は storage adapter の成功write回数（`rootCommits()`）と root revision の増分で観測する。二重mutationも失敗後の再書き込みも同じ counter が捕まえる。
- 4.2: compatibility 非回帰は `listBuildEligible` の projection だけでなく、実judgeの verdict（`cpu-motherboard-socket` → `compatible`）を専用テストで固定してから前後比較すること。そうしないと `unknown` 同士の比較になって空振りする。
- 4.2（5.1/5.2で解消済み）: (a) driver contextは `FeatureCompositionContext` へ直接代入して必須member追加をtypecheckで検知する。(b) primary経路は実production portのcontract kitでprice/capturedAt更新と、それ以外のsiteName/pageUrlを含むsource field不変を固定する。(c) 公開入口scanは `collectSources` でsubdirectoryを再帰走査する。初期レビューで挙がった三つの検証穴はいずれも回帰テストまたはboundary gateへ反映済み。
- 4.1: cross-feature contract kit は `tests/contracts/` に kit（`*-contract-kit.ts`）と driver（`*.test.ts`）を分けて置く（`application-shell-contract-kit` が前例）。kit 自身は上流の `public.ts` だけをimportし、driver が実production portを組み立てる。fakeはChrome API seam（`tabs` / `scripting`）にだけ置き、coordinator / extractor / ranker / normalizer は本物を通す。
- 4.1: 「固定tabだけを解決する」は返り値では観測できない。fixture の `observedTabsGet` / `observedInjectionTabs` を probe の `resolvedTabs()` に流して Chrome境界で観測する。`ChromeCaptureRuntimeDependencies` は `tabs.get` と `scripting.executeScript` しか公開しないため、他経路の取りこぼしは無い。
- 4.1: kit の `extract.unrelatedTab` は、fixture が未pin tabに `url` を与えないため実際には `permission-lost` を観測しており、「portが他tabを拒む」ことの証明にはなっていない。保証を担っているのは `resolvedTabs().includes(tabId)` の方。kit のコメントは assertion より強い主張をしているので、5.x で触るときに文言を実態へ合わせること。
- 4.1: design.md 572行は contract kit の関心事に `invalid payload`（要件3.6）も挙げているが、kit は未カバー。4.1 のタスク項目外なので保留。5.1 か 5.2 で kit を拡張するときに追加すること。
- 3.3（6.2で同期済み）: canonical transient activationは`activationId`・`surfaceId`・`tabId`を保持する。初期実装の`setTimeout(0)`はshell内部のmicrotask/macrotask順序へ隠れて依存していたため、`transient-feature-surface` 7.1の`waitUntilCurrent`へ移行した。mountは待機で塞がず、active publish後のone-shot trueかつ未unmountの場合だけ自動実行し、false・reject・late completionはno-opにする。
- 3.3: shellがfeatureからimportできる入口名は `public` と `feature-contribution` の2つだけ（`scripts/validate-boundaries.mjs` 126-134行）。UI contribution factoryは `feature-contribution.ts` に置く。
- 3.3: registration test で手動 `act` を使うのは可。steering testing.md の禁止は `render` 前提のcomponent testに向けたもので、ここはReact rootをproduction code側が作る。前例は `tests/contracts/application-shell-contract-kit.ts`。
- 3.3（6.2で解消済み）: timer/`clearTimeout`は廃止した。unmount後のreadiness完了はmounted guardで抑止し、late trueでも`state.activate`を呼ばないことをregistration testで固定する。
- 2.1: locator は `public.ts` から公開しない。公開surfaceは task 3.1 の service が所有する `SourcePriceRefreshPort.matchSource`。locator は feature 内部の協調者に留める。
