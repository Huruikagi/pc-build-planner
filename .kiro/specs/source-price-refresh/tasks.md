# 実装計画

- [ ] 1. 公開境界と実行前提を確立する

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

- [ ] 2. 独立したcoreコンポーネントを構築する

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

- [ ] 3. 価格更新use caseと一過性featureを完成させる

- [x] 3.1 price observationを現行sourceへ原子的に反映する
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
  - featureをcanonical `TransientApplicationFeatureRegistration`として登録し、`presentation: "transient"`を明示してnavigation propertyを持たせず、activationIdとfixed tabIdを境界検証する。
  - mount時にstateの自動workflowを開始し、unmountでReact root、subscription、後着callbackをcleanupする。
  - navigationを持たないUI contribution factoryをfeature-owned公開入口として用意し、side panel専用集約点からだけ取り込める契約にする。worker-safe catalog向けの入口からfeature UI registration、DOM、Reactへ到達するimport経路を作らない。
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
  - _Depends: product-page-capture 6.3_

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

## Implementation Notes

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
- 2.4: 失敗表示の `preservedNotice`（既存価格を維持した旨、要件5.1/5.4の唯一の可観測面）はテストで未固定。要素を消しても view.test.tsx は緑のまま。task 5.3 の failure-view DOM coverage で失敗kindのloopへ `preservedNotice` のassertionを1行足すこと。
- 3.1: `CandidateSourceReference` は `siteName` / `price` / `capturedAt` を射影せず、`CandidateSourceMutationPort.updateSource` は entry を丸ごと**置換**する（`source-collection.ts` の `candidateSourcePolicy.update`）。よって catalog の射影だけで update inputを組むと siteName が消える。保持field全体は同じ `candidate-management/public.ts` の `query.getCandidateDraft(candidateId)` → `CandidateDraft.sources` から読み、`{ ...stored, price, capturedAt }` のspreadで組むこと。上流契約は一切変更しない（射影拡大・merge semantics・price patch mutation はいずれも candidate-source-bookmarks の再検証triggerを発火させ波及が大きい）。
- 3.1: 上記に伴い design.md の「許可する依存」へ `query: CandidateQuery`（`getCandidateDraft` のみ）を追記済み（利用者承認済み、2026-08-01）。Outbound依存リストと `contracts.ts` の `SourcePriceRefreshUpstreamPorts` doc も整合済み。task 4.2 の配線では `CandidateManagementPublicApi.query` を必ず注入すること。
- 3.1: 上流fakeを書くときは production の**置換**意味論を再現すること。mergeするfakeを書くとfield欠落が観測できず、データ損失を緑で追認してしまう（round 1 で実際に発生した）。
- 3.1: `getCandidateDraft` は production では `candidate-management/feature-contribution.ts` の `publicQuery: service` で本物が配線される。`registration.ts` の fallback stub は `publicQuery` 省略時のみ到達するテスト専用で、`unsupported-data` を返して fail closed になるため lossy write は起きない。
- 3.1: TOCTOU（既知・未クローズ）: draft読み出し → `getSourceReference` → `updateSource` の間に、referenceが射影しないfield（特に `siteName`）が並行更新されると、全entry置換で巻き戻る。`expectedRevision` はmutation時点で計算されるためoptimistic concurrencyでは塞げない。要件4.5が列挙するURL・種別・候補・識別子は再検証済みで規定違反ではない。塞ぐには上流契約変更が要るため、task 5.4 で許容範囲か再確認すること。
- 2.1: locator は `public.ts` から公開しない。公開surfaceは task 3.1 の service が所有する `SourcePriceRefreshPort.matchSource`。locator は feature 内部の協調者に留める。
