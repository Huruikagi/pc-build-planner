# Implementation Plan

- [x] 1. 固定タブ取り込みの型付き境界と汎用抽出基盤を確立する
  - 明示操作で選ばれた単一タブだけを対象にし、request、tab、page-derived URL、payloadを未信頼境界で検証する。
  - JSON-LD、meta、見出し、パンくず、表、定義リストから根拠付き候補を収集し、生HTMLや画像を境界外へ返さない。
  - 権限失効、制限ページ、tab変化、注入失敗、payload不正が判別可能な結果として観測できる状態を完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.3, 2.4, 2.5, 2.6, 3.3, 3.4, 6.2, 6.5, 7.1, 7.4_
  - _Boundary: ProductCaptureContracts, GenericExtractor, CaptureRuntimePort, CaptureCoordinator_

- [x] 2. 抽出候補の正規化・固定順位・取得根拠を実装する
  - 空白・制御文字、URL、価格、カテゴリ、属性を検証し、元表記と正規化値を分離する。
  - source priorityと文書順で候補を決定的に選び、欠損と棄却理由を部分結果へ保持する。
  - 同じsynthetic候補集合から常に同じ採用値とprovenanceが得られるunit testを完了条件とする。
  - _Requirements: 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.1, 7.4_
  - _Boundary: CaptureNormalizer, CandidateRanker_

- [x] 3. React表示・registration・安全性の既存基盤を接続する
  - feature stateをReact外に保持し、React rootのmount/unmountと購読解除をfeature registrationへ接続する。
  - ページ由来文字列を通常のJSX childとして描画し、HTML注入、remote code、恒久的host permissionを導入しない。
  - synthetic fixture、公開境界、artifact gateで既存取り込み基盤が再現可能に検証できる状態を完了条件とする。
  - _Requirements: 1.2, 1.3, 2.5, 3.3, 6.5, 7.1, 7.2, 7.4_
  - _Boundary: ProductCaptureReactAdapter, ProductCaptureRegistration, SecurityValidation_

- [x] 4. メーカーdomain mapを最下位抽出sourceとして追加する

- [x] 4.1 domain map entryとeTLD+1照合を隔離する
  - メーカー公式eTLD+1、メーカー名、公開根拠、review日、ownerを持つローカルentryを専用moduleへ定義し、不正・重複entryを拒否する。
  - page URLのhostnameを正規化し、entryとの完全一致またはdot-boundary subdomain一致だけを許可して、未知domain、販売代理店、suffix類似domainを候補なしにする。
  - exact、subdomain、未知、誤suffix、不正URLのsynthetic unit testが決定的に通ることを完了条件とする。
  - _Requirements: 2.7, 2.9, 7.1, 7.3, 7.4_
  - _Boundary: ManufacturerDomainMap_

- [x] 4.2 (P) domain-map provenanceを抽出closed unionへ追加する
  - `domain-map`を抽出source、runtime payload validation、取得元message mappingへ追加し、manufacturer以外のfieldでは拒否する。
  - 元表記、source label、normalized valueが既存候補と同じcontractを通り、ページ由来sourceへ偽装されないようにする。
  - synthetic payloadがruntime境界を通過し、不正field/source組合せが`invalid-payload`になるcontract testを完了条件とする。
  - _Requirements: 2.3, 2.10, 3.1, 3.4, 7.1, 7.3_
  - _Boundary: ProductCaptureContracts, CapturePayloadValidation, CaptureMessages_

- [x] 4.3 domain候補を既存extractorとrankerへ統合する
  - 汎用collectorでmanufacturerが欠損する場合だけdomain候補を加え、ページ明示候補がある場合は生成または採用しない。
  - rankerでも`domain-map`を全sourceの後へ置き、collector合成順が変わっても既存manufacturerを上書きしない。
  - 欠損補完、非上書き、未知domain、最下位順位がextractor/ranker testで観測できることを完了条件とする。
  - _Depends: 4.1, 4.2_
  - _Requirements: 2.2, 2.4, 2.7, 2.8, 2.9, 2.10, 3.5, 7.1, 7.3, 7.4_
  - _Boundary: GenericExtractor, CandidateRanker_

- [x] 5. 一過性surfaceからcandidate pre-editへの即時handoffへ移行する

- [x] 5.1 activation固定tabと世代gateを取り込みcoordinatorへ適用する
  - active tabの再検索を廃止し、activationで配送された固定tabだけを抽出runtimeへ渡す。
  - 抽出前と完了後に現行activationを照合し、tab遷移・更新・閉鎖または世代置換後の結果をhandoffしない。
  - stale時にruntimeまたはcandidate-managementへ後続副作用がなく、新gestureで新しい固定tabのidle状態へ戻るintegration testを完了条件とする。
  - _Depends: product-capture-transient-migration 3.2, 3.3_
  - _Requirements: 1.1, 1.4, 1.5, 4.3, 6.1, 6.2, 6.4, 7.2_
  - _Boundary: ProductCaptureTransientActivation, CaptureCoordinator_

- [x] 5.2 抽出結果をproject未解決pre-editへ写像する
  - 検証済み商品情報、元表記、provenance、取得日時、カテゴリ参考値を、project IDを作らずcandidate-management公開pre-editへ写像する。
  - 候補ゼロでは空の商品名を許容して手入力を開始し、保存可能性やproject存在をcapture側で判定しない。
  - 通常結果、空名、カテゴリ参考値、余剰値除外がcandidate public contract testで観測できることを完了条件とする。
  - _Depends: product-capture-transient-migration 1.2, 4.1_
  - _Requirements: 3.5, 3.6, 4.1, 4.4, 4.6, 5.1, 5.2, 5.3, 5.4, 5.6, 7.2_
  - _Boundary: CaptureDraftMapper, CandidatePreEditConsumerContract_

- [x] 5.3 typed intentを原子的にhandoffし現行世代だけで再試行する
  - candidate-management公開factoryでintentを生成し、直接navigationではなく一過性lifecycleの`conclude`へ渡す。
  - 成功時はsurfaceを終了し、失敗時は検証済みintentを現行activation内だけで保持して再試行可能にする。
  - success、rejected、retry、new-generation replacement、no-project受理がintegration testで観測できることを完了条件とする。
  - _Depends: 5.1, 5.2, product-capture-transient-migration 4.2, 4.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 5.1, 5.2, 5.3, 5.5, 5.6, 6.3, 6.4, 7.2_
  - _Boundary: CandidateEditorHandoff, TransientSurfaceLifecyclePort_

- [x] 5.4 capture state・view・compositionから旧確認保存責務を除去する
  - stateを`idle | extracting | failed`へ縮小し、review、submitting、saved、project選択、修正、save操作を削除する。
  - viewには実行、実行中、失効・抽出・handoff失敗、同世代handoff再試行だけを残す。
  - `CaptureCandidatePort`、project query、直接editor navigation、save service、feature-owned worker registrationがproduct-captureの公開依存とproduction compositionから消え、DOMに旧formが存在しないことを完了条件とする。
  - _Depends: 5.3, product-capture-transient-migration 5.1, 5.2, 5.3_
  - _Requirements: 1.4, 4.2, 4.5, 4.7, 5.5, 5.6, 6.2, 6.3, 6.4, 7.2_
  - _Boundary: ProductCaptureState, ProductCaptureView, ProductCaptureComposition, LegacyCaptureRemoval_

- [x] 6. 固定tabの価格抽出を公開consumerへ提供する

- [x] 6.1 price observationとtyped failureの公開契約を固定する
  - page-derived URL、canonical取得時点、任意の根拠付き価格を返すread-only portと6種の閉じたfailureを`public.ts`へ公開する。
  - `ProductCapturePublicApi.pagePriceExtraction`だけから組立済みportを受け取り、extractor、normalizer、ranker、runtime concreteを公開しない。
  - source-price-refresh相当consumerがdeep importなしでstrict型検査を通ることを完了条件とする。
  - _Requirements: 1.1, 1.3, 2.3, 3.2, 3.5, 6.5, 7.2, 7.4_
  - _Boundary: ProductCapturePublicAPI, PagePriceExtractionContract_

- [x] 6.2 固定tab runtimeを既存価格pipelineへ接続する
  - 固定tabを解決・注入し、request、tab、page-derived URLを通常取り込みと同じdecoderで検証する。
  - 価格候補だけを既存normalizer/rankerへ通し、元表記とMoneyValueを返し、有効価格なしは成功・価格欠損とする。
  - 通常取り込みとprice portへ同じsynthetic候補集合を渡して同じ価格provenanceが選ばれ、domain map追加が価格へ影響しないことを完了条件とする。
  - _Depends: 4.3, 5.1, 6.1_
  - _Requirements: 1.1, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 7.1, 7.2, 7.4_
  - _Boundary: PagePriceExtractionAdapter, CaptureRuntimePort, ExtractionPipeline_

- [x] 6.3 price portの公開境界と下流再検証を完成する
  - tab不存在、権限失効、制限ページ、tab変化、注入失敗、payload不正をpage URLや商品値を含まないtyped failureへ写像する。
  - 組立済みport instanceをtransient migration後のproduct-capture contributionからproduction consumerへ一度だけ注入する。
  - contract、public consumer、boundary validationが通り、`source-price-refresh`の確定shapeにdriftがないことを完了条件とする。
  - _Depends: 6.2_
  - _Requirements: 1.4, 1.5, 3.2, 3.4, 6.1, 6.2, 6.5, 7.2, 7.4_
  - _Boundary: PagePriceExtractionIntegration, PublicBoundaryValidation_

- [x] 7. 統合・安全性・cross-spec非回帰を検証する

- [x] 7.1 domain mapとhandoffを結ぶ受け入れflowを検証する
  - manufacturer欠損の架空メーカーdomainを抽出し、`domain-map` provenanceを保ったproject未解決pre-editがcandidate-managementへ一度だけ届くことを検証する。
  - ページ明示manufacturer、未知domain、空名manual handoff、project不存在、handoff retryを同じproduction-like compositionで検証する。
  - captureで保存mutationが発生せず、candidate editorへ到達後のtab失効がdraftを破棄しないことを完了条件とする。
  - _Depends: 4.3, 5.4_
  - _Requirements: 2.7, 2.8, 2.9, 2.10, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.3, 7.1, 7.2, 7.3, 7.4_
  - _Boundary: ProductCaptureCandidateIntegration_

- [x] 7.2 (P) synthetic fixture・ログ・permission gateを強化する
  - domain map fixtureを架空domainだけで構成し、実サイトHTML、画像、取得商品データ、非synthetic URLを拒否する。
  - error pathで商品値、完全URL、hostname、生HTML、例外objectがログへ出ず、安定コードだけが観測されることを検証する。
  - permission集合、CSP、remote code、unsafe HTMLのartifact gateが既存基準のまま通ることを完了条件とする。
  - _Requirements: 1.2, 1.3, 2.5, 3.3, 6.5, 7.1, 7.2, 7.3, 7.4_
  - _Boundary: SyntheticFixtures, SecurityLogging, ArtifactValidation_

- [x] 7.3 production E2Eと公開contract driftを閉じる
  - icon起動、明示実行、candidate editor handoff、tab失効によるsurface終了、new generation起動をChrome 116相当のproduction buildで検証する。
  - source-price-refresh consumerがprice portだけを利用し、candidate-source-bookmarks実装が廃止済み`CaptureCandidatePort`を前提にしていないことをcross-spec contract gateで確認する。
  - typecheck、lint、unit、contract、DOM、boundary、fixture、build、E2Eが共通検証flowで通ることを完了条件とする。
  - _Depends: 6.3, 7.1, 7.2, product-capture-transient-migration 6.2_
  - _Requirements: 1.1, 1.4, 1.5, 4.1, 4.2, 4.3, 4.7, 5.5, 5.6, 6.1, 6.2, 6.4, 7.1, 7.2, 7.3, 7.4_
  - _Boundary: ProductCaptureE2E, CrossSpecConsumerContracts, FinalValidation_

## Implementation Notes

- collector横断の文書順は全DOM再走査ではなく、上限200件の収集済み候補nodeだけを`compareDocumentPosition`で比較し、`documentOrder`として未信頼payload境界からrankerまで保持する。
- runtimeが直接検出した`permission-lost | tab-changed`は、shell所有の`capture-invalidated` dismissへ渡し、常設面復帰と新しい明示操作noticeをshellへ委ねる。dismiss失敗・例外・遅延結果はcapture世代内へ閉じる。
