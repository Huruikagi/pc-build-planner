# 実装計画

- [ ] 1. 公開境界と実行前提を確立する

- [ ] 1.1 上流portを消費する価格更新の公開契約を確立する
  - 各producer specで定義・承認済みの `CandidateSourceCatalogPort`、`CandidateSourceMutationPort`、`PagePriceExtractionPort`、`TransientGestureRegistrationPort` だけを依存として受け入れる。
  - candidate-managementの `sources.catalog` / `sources.mutations`、product-captureの `pagePriceExtraction`、application shellの同期gesture registrationという確定済み公開入口をconsumer contractへ固定する。
  - URL照合scope、matched target、price observation、receipt、判別可能なerror unionを型安全に公開する。
  - catalog全体と候補一件のscopeを判別共用体で区別し、foundation root、shell store、product-capture内部への迂回依存を公開consumer型検査で拒否する。
  - 公開consumer fixtureが内部moduleをimportせず全portを組み立て、TypeScript strictで通ることを完了条件とする。
  - _Requirements: 2.5, 4.1, 4.5, 6.3, 6.4_
  - _Boundary: SourcePriceRefreshPublicApi_

- [ ] 1.2 保守的なsource URL同一性を実装する
  - HTTP/HTTPSだけを受理し、scheme、host、pathと未知queryを比較keyへ保持する。
  - host case、既定port、fragment、root以外の末尾slash、既知tracking keyを規則どおり正規化する。
  - 残るquery pairをvalue損失なく安定sortし、重複keyとpercent encodingを標準URL serializationで維持する。
  - exact normalizationとboolean同一性の両APIが、tracking差を一致、商品query差を不一致として返すことを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.3_
  - _Boundary: SourceUrlIdentity_

- [ ] 1.3 context menu permissionを最小権限gateへ追加する
  - manifestの既存permission集合へ `contextMenus` だけを追加する。
  - artifact validatorのexact allowlistと診断を5権限へ更新し、host、optional、tabs、alarms permissionは引き続き拒否する。
  - production manifestと生成物検査が `contextMenus` を受理し、許可外permissionのfixtureを失敗させることを完了条件とする。
  - _Requirements: 6.1, 6.2, 6.6_
  - _Boundary: ManifestPermissionGate_

- [ ] 2. 独立したcoreコンポーネントを構築する

- [ ] 2.1 (P) scope内の保存済みsourceを一意に特定する
  - catalog scopeとcandidate scopeを上流read-only portへ写像する。
  - 欠損URLを除外し、正規化URLの0件・1件・複数件を `no-match`、matched target、`ambiguous-match` に分ける。
  - 一件一致後もkindが明示 `retail` でないsourceを `ineligible-source` とし、配列順やprimaryで暗黙選択しない。
  - matched targetがcandidate ID、source ID、正規化URL、primary flagを保持し、source順に依存しないことを完了条件とする。
  - _Requirements: 2.5, 2.6, 2.7, 2.8, 4.5, 6.3_
  - _Boundary: StoredSourceLocator_
  - _Depends: 1.1, 1.2_

- [ ] 2.2 (P) activation世代ごとの価格更新stateを構築する
  - activation受理時に固定tabを保持したrunning状態から自動実行する。
  - succeeded receiptとrecoverable判定付きfailed errorを判別可能なsnapshotとして公開する。
  - 新世代で旧stateを置換し、旧抽出・旧mutation完了とunmount後callbackを無視する。
  - running、succeeded、failed以外の実行button待機状態が存在せず、新activationで自動開始することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 5.5_
  - _Boundary: SourcePriceRefreshState_
  - _Depends: 1.1_

- [ ] 2.3 (P) feature固有のcontext menu gesture sourceを構築する
  - stable item ID、page context、HTTP/HTTPS document patternでmenu itemを冪等登録する。
  - click eventのitem IDと数値tab IDだけを検証し、上流gesture callbackへ固定tabを同期emitする。
  - URL、selection、link、frame dataをstoreやlogへ渡さず、別itemと不正tabを無視する。
  - 一つの有効clickが一つの同期emitになり、adapter自身がactivation store、sequence、side panel openを作らないことを完了条件とする。
  - _Requirements: 1.1, 1.4, 6.1, 6.2, 6.6_
  - _Boundary: PriceRefreshContextMenuSource_
  - _Depends: 1.1, 1.3_

- [ ] 2.4 価格更新の進行・成功・失敗viewを構築する
  - running時は進行、success時はconfirmed money、取得日時、primary反映有無を表示する。
  - failure kindごとにcontext menu再実行、source整理、保守終了、保存領域確認の回復案内を表示する。
  - panel内の再実行button、完全URL、raw HTML、商品値、例外dumpを表示しない。
  - 架空の外部文字列を渡してもHTML要素として解釈されず、3状態が既存message resolverで日本語・英語表示されることを完了条件とする。
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 3.5, 5.1, 5.2, 5.3, 5.4, 5.6_
  - _Boundary: SourcePriceRefreshView_

- [ ] 3. 価格更新use caseと一過性featureを完成させる

- [ ] 3.1 price observationを現行sourceへ原子的に反映する
  - price欠損またはconfirmed money欠損をmutation前に拒否し、旧priceとcapturedAtを保持する。
  - target sourceを更新直前に再読込し、observed URL同一性、retail kind、candidate/source IDを再検証する。
  - 既存sourceのpriceとcapturedAtだけを置換して上流mutation portへ渡し、URL、siteName、kind、他source、product、normalized attributesを維持する。
  - validation、conflict、maintenance、quota、storageを既存management errorから安定mappingし、失敗時に部分更新を残さない。
  - primary更新receiptでは代表projectionが新価格へ追従し、non-primary更新では代表価格が変わらないことを完了条件とする。
  - _Requirements: 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.6, 6.3_
  - _Boundary: SourcePriceRefreshService_
  - _Depends: 2.1_

- [ ] 3.2 固定tab抽出と世代gateを価格更新workflowへ接続する
  - 現行activationだけが上流price extraction portへ固定tab IDを渡す。
  - page-derived URL、capturedAt、既存rank/normalizer由来price provenanceを受け取り、catalog scopeの照合と原子的更新へ進める。
  - extraction完了後とmutation完了後に世代を照合し、旧世代の結果でstateを変更しない。
  - permission lost、restricted page、tab change、injection failure、invalid payload、price unavailableを永続化なしのtyped failureにする。
  - context menu activation一回で抽出からsuccess/failure表示まで進み、別の実行gestureを要求しないことを完了条件とする。
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.5, 3.6, 5.5_
  - _Boundary: SourcePriceRefreshService, SourcePriceRefreshState_
  - _Depends: 2.2, 3.1_

- [ ] 3.3 一過性featureのUI contributionとReact lifecycleを構築する
  - featureを `source-price-refresh` のtransient presentationとして登録し、activationIdとfixed tabIdを境界検証する。
  - mount時にstateの自動workflowを開始し、unmountでReact root、subscription、後着callbackをcleanupする。
  - UI contribution factoryをfeature-owned公開入口として用意し、side panel専用集約点からだけ取り込める契約にする。worker-safe catalog向けの入口からfeature UI、DOM、Reactへ到達するimport経路を作らない。
  - 拡張アイコン通常起動や常設navigationから価格更新を選択できず、不正activationでは実行を開始しない。
  - side panel contract fixtureへ渡したregistrationが単一主表示領域で進行・結果viewを表示し、tab失効または常設選択で上流規則どおり終了することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.5, 1.6, 5.5, 6.5, 6.6_
  - _Boundary: SourcePriceRefreshRegistration_
  - _Depends: 2.2, 2.4, 3.2_

- [ ] 4. 確定済み上流portとproduction compositionへ統合する

- [ ] 4.1 product-capture公開のprice extraction portへ接続する
  - `product-page-capture` で定義済みの `ProductCapturePublicApi.pagePriceExtraction` が固定tabだけを解決し、既存extractor、ranker、normalizerでprice一件を選ぶことをcontract testで固定する。
  - page URLを注入先tabの推測値ではなくpage-derived payloadから返し、target URLと不一致ならtab-changedとしてfail closedにする。
  - price original、confirmed money、capturedAtだけを返し、他fieldをsource-price-refreshへ公開しない。
  - source-price-refreshがproduct-capture内部へdeep importせず、既存商品取り込みと同じ架空price fixtureで同じ結果を得ることを完了条件とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 6.4, 6.7_
  - _Boundary: PagePriceExtractionPortIntegration_
  - _Depends: product-page-capture 8.2_

- [ ] 4.2 candidate source catalogとmutationへ接続する
  - `candidate-source-bookmarks` で定義済みの `sources.catalog` から全sourceまたは候補内sourceの限定参照だけを取得し、同じsource facetの `sources.mutations` を更新に利用する。
  - match targetをcandidate/source IDでmutation portへ渡し、public consumerからrevision contextを隠したまま一回のroot mutationへ接続する。
  - source更新後のcandidate queryでprimary/non-primary projectionとcompatibility入力の非回帰を確認する。
  - catalog、mutation、queryのintegration testで対象sourceだけのprice/capturedAtが変わり、失敗時はroot revisionを含む保存状態が不変であることを完了条件とする。
  - _Requirements: 2.5, 2.6, 2.7, 2.8, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: CandidateSourcePortIntegration_
  - _Depends: 3.1, candidate-source-bookmarks 3.4_

- [ ] 4.3 context menu sourceを上流gesture lifecycleとworker compositionへ接続する
  - feature-owned sourceのmenu worker registrationだけをworker-safe catalogへ登録し、`transient-feature-surface` で定義済みの同期 `TransientGestureRegistrationPort` へ接続する。
  - click emitが既存schedulerのsequence割当、activation store、watch-ready、side panel open、tab墓標へ一度だけ流れるようcompositionする。
  - worker bootstrapの開始・停止でmenu listenerとgesture登録を対称cleanupし、worker再生成時もitem重複を残さない。
  - `production-worker-composition.ts` とworker-safe catalogが `side-panel-contributions.ts`、feature UI、DOM、Reactをimportせず、context menu clickから正しいsurfaceId/tabIdのactivation recordが既存経路に作られることを完了条件とする。
  - _Requirements: 1.1, 1.4, 1.5, 5.5, 6.1, 6.2, 6.6_
  - _Boundary: PriceRefreshContextMenuSource, TransientGestureComposition_
  - _Depends: 2.3, transient-feature-surface 6.3_

- [ ] 4.4 side panel contribution、message catalog、隣接consumerを統合する
  - application shell所有の `side-panel-contributions.ts` へUI contribution factoryを登録し、root runtimeをfeature内部から直接編集しない。
  - 4.3で登録済みのworker-safe catalogにmenu worker registrationだけが存在し、UI registration、React root、view、CSSが混入しないことを統合検証する。
  - context menu label、running、success、各failure、回復案内のmessage keyを日本語・英語で同時追加する。
  - duplicate-product-merge consumer fixtureがcandidate scopeで同一URLをmatchし、新規source追加ではなく `refreshCapturedPrice` へ渡す。
  - side panel contribution parity、worker bundle境界、typed message resolution、public consumer typecheckが通り、常設navigationに価格更新itemが増えないことを完了条件とする。
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 6.3, 6.4_
  - _Boundary: SidePanelContributionIntegration, MessageCatalog, SourcePriceRefreshPublicApi_
  - _Depends: 3.3, 4.1, 4.2, 4.3_

- [ ] 5. critical pathと非回帰を検証する

- [ ] 5.1 URL、照合、更新、stateのunit/contract coverageを完成させる
  - 全URL規則、0/1/複数一致、retail制約、price欠損、stale target、management errorを架空dataで検証する。
  - stateの新旧activation競合、unmount、抽出・mutationの後着順序を決定的なdeferred portで検証する。
  - 公開port contract kitでcatalog scopeとcandidate scopeが同じURL identityとatomic updateを利用することを確認する。
  - 関連unit/contract suiteが全38受入基準のcore分岐を失敗なしで実行することを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.3, 6.4_
  - _Boundary: SourcePriceRefreshTestKit_

- [ ] 5.2 context menu、permission、worker境界のruntime coverageを完成させる
  - item冪等登録、有効click、別item、不正tab、restricted URL、cleanup、worker再生成をChrome stubで検証する。
  - manifestがexact 5権限でhost/optional permissionを持たず、許可外permissionがartifact gateで失敗することを検証する。
  - production worker bundleへ `side-panel-contributions.ts`、feature UI、DOM、React、完全URL、商品値を持ち込まず、worker-safe catalogにはmenu registrationだけが載ることを生成物検査で確認する。
  - runtime、boundary、artifactの関連suiteが新permissionとgesture接続を一貫して受理することを完了条件とする。
  - _Requirements: 1.1, 1.4, 1.5, 6.1, 6.2, 6.6_
  - _Boundary: SourcePriceRefreshRuntimeTests_
  - _Depends: 4.3_

- [ ] 5.3 transient viewとcandidate integrationのDOM coverageを完成させる
  - running、primary success、non-primary success、各failure案内をtesting-libraryとuser視点DOMで検証する。
  - UI contributionが `side-panel-contributions.ts` 経由でmountされ、raw external stringがHTMLとして解釈されず、再実行buttonや常設navigation itemが存在しないことを確認する。
  - candidate source更新後のsummary projection、normalized attributes、compatibility結果、他sourceが不変であることをintegrationで検証する。
  - DOM/integration suiteが日本語・英語message parityと原子的更新の観測可能な結果を通すことを完了条件とする。
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.6, 6.4_
  - _Boundary: SourcePriceRefreshDomIntegrationTests_
  - _Depends: 4.2, 4.4_

- [ ] 5.4 production extensionのcontext menu E2Eを完成させる
  - 架空HTTPS販売ページと複数source候補をproduction buildへ用意し、menu click一回からprimary価格・capturedAt・代表価格の更新を確認する。
  - price欠損、URL不一致、複数一致、manufacturer、tab遷移では旧価格が残り、型付き失敗案内が表示されることを確認する。
  - 対象tab失効と常設navigation選択で一過性面が終了し、旧世代完了が表示・保存を変更しないことを確認する。
  - fixture validator、型検査、lint、unit、integration、build、artifact、Playwrightを含む完全検証が通ることを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.5, 2.6, 2.7, 2.8, 3.5, 3.6, 4.1, 4.2, 4.3, 5.1, 5.2, 5.5, 6.1, 6.2, 6.4, 6.5, 6.6, 6.7_
  - _Boundary: SourcePriceRefreshE2E_
  - _Depends: 5.1, 5.2, 5.3_
