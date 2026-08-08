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

- [x] 8. metadataの明示的な採用境界と取得元表示名を確立する

- [x] 8.1 metadata propertyと取得先のclosed mappingを確定する
  - OpenGraph、Twitter Card、product拡張を別familyとして扱い、明示propertyだけを商品項目または任意site nameへ一意に対応付ける。
  - namespace prefixやsuffix、未知propertyの推測採用を拒否し、site nameを必須商品fieldや欠損集合へ混入させない。
  - 全対応組と代表的な未列挙propertyがsynthetic contract testで観測できることを完了条件とする。
  - _Requirements: 7.5, 7.6, 8.1, 8.5, 8.6_
  - _Boundary: MetadataPropertyMap_

- [x] 8.2 metadata familyのsource契約とpayload検証を移行する
  - 旧generic meta provenanceをOpenGraph、Twitter Card、product拡張へ分割し、site name専用の任意契約を商品fieldから分離する。
  - runtime payloadのclosed source unionを移行し、未列挙sourceとfieldの不正な組み合わせを境界で拒否する。
  - 3 family、任意site name、manufacturer専用domain-mapの有効payloadが通り、不正な組み合わせが`invalid-payload`として観測できるcontract testを完了条件とする。
  - _Depends: 8.1_
  - _Requirements: 2.3, 2.10, 3.4, 7.5, 7.6, 8.2, 8.5, 8.6_
  - _Boundary: ProductCaptureContracts, CapturePayloadValidation_

- [x] 8.3 allowlist対象metadataだけをページ候補として収集する
  - propertyを正規化して完全一致した規則だけを収集し、family別provenance、元表記、文書順を未信頼payload境界まで保持する。
  - `og:site_name`を商品fieldと分離した任意候補として収集し、hostnameやtitleによる代替推測を行わない。
  - 対応property以外が抽出結果へ現れず、有効site nameの有無にかかわらず他の商品候補が維持されるunit・contract testを完了条件とする。
  - _Depends: 8.1, 8.2_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 7.1, 7.5, 7.6, 8.1, 8.5, 8.6, 8.7_
  - _Boundary: GenericExtractor, PageMetadataCollector_

- [x] 8.4 (P) 取得元サイト名を未信頼文字列として正規化する
  - 通常の文字列正規化と上限を適用し、空、制御文字だけ、長すぎる値をsite nameだけの棄却へ閉じる。
  - OpenGraph provenanceと元表記を保ち、商品項目の欠損・棄却結果とは独立させる。
  - 有効・欠損・不正の各入力で、商品抽出を失敗させず任意の正規化済みsite nameだけが観測できるunit testを完了条件とする。
  - _Depends: 8.2_
  - _Requirements: 3.1, 3.3, 3.4, 8.2, 8.4, 8.7_
  - _Boundary: CaptureNormalizer_

- [x] 8.5 metadata familyの順位とsource unionを既存pipelineへ統合する
  - 3 familyを同じページメタ情報優先度へ置き、同順位では文書順で決定する。
  - collector、normalizer、ranker、価格観測を同じclosed source unionへ追従させ、domain-mapの最下位順位を維持する。
  - 同一synthetic候補集合から通常取り込みと価格観測が同じ価格provenanceを選び、domain-mapが価格順位へ影響しないことを完了条件とする。
  - _Depends: 8.3, 8.4_
  - _Requirements: 2.2, 2.3, 2.7, 2.8, 2.10, 3.4, 7.1, 7.3, 7.5, 8.5, 8.6_
  - _Boundary: ExtractionPipelineIntegration_

- [x] 9. 抽出結果を公開境界と候補編集へ統合する

- [x] 9.1 site nameをproject未解決pre-editへ安全に引き渡す
  - 有効なsite nameを任意source表示名と元表記・provenance付きで候補編集開始情報へ写像する。
  - 欠損・不正時もURLと他の商品項目を維持し、site nameをURL同一性、source ID、source kind、ページ種別へ利用しない。
  - 有効・欠損・不正site nameのhandoffと、空名・project未解決の既存経路がcandidate公開test doubleで観測できることを完了条件とする。
  - _Depends: 8.5_
  - _Requirements: 3.5, 4.1, 4.3, 4.4, 4.6, 5.1, 5.2, 5.3, 5.4, 8.3, 8.4, 8.7, 8.8_
  - _Boundary: CaptureDraftMapper, CandidatePreEditIntegration_

- [x] 9.2 (P) manufacturer domain照合をread-only公開契約として提供する
  - map内部やentryを公開せず、照合結果だけをproduct-capture公開APIから利用できるようにする。
  - candidate source classifier相当consumerが公開入口だけで型検査を通り、lookupがDOM抽出、権限判断、利用許可を有効化しないことをcontract testで固定する。
  - source-price-refreshの価格portと並存する組立済み公開APIがproduction-like compositionで一度だけ提供されることを完了条件とする。
  - _Depends: 4.1, 4.3_
  - _Requirements: 2.7, 2.8, 2.9, 2.10, 7.3_
  - _Boundary: ProductCapturePublicAPI, ManufacturerDomainLookup_

- [x] 10. 固定tab runtimeの失効と未応答を有限に閉じる

- [x] 10.1 (P) 注入と結果読取りに有限timeoutを適用する
  - content処理の注入と結果読取りをそれぞれ有限時間で終了させ、未応答を安定したinjection failureへ写像する。
  - timeout後の遅延結果を現行・後発activationへ適用せず、永続状態や商品値をログへ残さない。
  - 両段階の未応答が決定的なruntime testで失敗表示と同世代再試行へ到達することを完了条件とする。
  - _Depends: 5.1, 5.4_
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 7.2_
  - _Boundary: CaptureRuntimePort, CaptureTimeoutPolicy_

- [x] 10.2 権限・tab失効を一過性surfaceの終了理由へ配線する
  - runtimeが直接検出した`permission-lost`と`tab-changed`だけを`capture-invalidated`へ写像し、restricted pageは対象外案内として面に維持する。
  - 通常handoffの`conclude`と失効時の終了経路を混同せず、永続状態を変更しない。
  - permission loss、tab change、restricted pageの各経路がcoordinator・state testで異なる結果として観測できることを完了条件とする。
  - _Depends: 10.1_
  - _Requirements: 1.4, 1.5, 4.2, 4.5, 6.1, 6.2, 7.2_
  - _Boundary: CaptureCoordinator, CaptureState_

- [x] 10.3 lifecycle終了の失敗と世代隔離を固定する
  - 終了失敗・例外を成功扱いせず現行世代の安全な失敗へ閉じ、遅延結果を後発activationへ適用しない。
  - shell側の常設面復帰と新しい明示操作案内をtyped lifecycle seamだけから要求し、capture側でhost表示を再実装しない。
  - surface終了、終了失敗、例外、新世代置換、遅延結果隔離がlifecycle integration testで観測できることを完了条件とする。
  - _Depends: 10.2_
  - _Requirements: 1.4, 4.2, 4.5, 6.1, 6.4, 7.2_
  - _Boundary: TransientSurfaceLifecycleIntegration_

- [x] 11. metadata・handoff・公開consumerの非回帰を閉じる

- [x] 11.1 metadata allowlistからcandidate editorまでの受け入れflowを検証する
  - 3 familyの対応property、任意site name、domain補完、欠損・不正site nameをproduction-like compositionで通す。
  - site nameが表示用任意値として一度だけpre-editへ届き、capture側の保存mutationやidentity判定が発生しないことを確認する。
  - synthetic fixtureだけで全対応mapping、未列挙拒否、空名manual handoff、handoff retryが一つのintegration suiteで観測できることを完了条件とする。
  - _Depends: 9.1, 10.3_
  - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 5.1, 5.4, 5.5, 5.6, 7.1, 7.2, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
  - _Boundary: ProductCaptureCandidateIntegration_

- [x] 11.2 (P) 公開consumerと価格観測のcontract driftを検証する
  - manufacturer lookup consumerとprice refresh consumerが公開入口だけを利用し、deep importなしでstrict型検査を通す。
  - metadata source union移行後も価格欠損、6種failure、page-derived URL、元表記、同一pipeline順位を維持する。
  - boundary validationとconsumer contract suiteが公開APIの2つのread-only能力だけを観測できることを完了条件とする。
  - _Depends: 8.5, 9.2_
  - _Requirements: 1.1, 1.4, 2.2, 2.3, 3.2, 3.5, 6.1, 6.2, 6.5, 7.2, 7.4, 7.5_
  - _Boundary: CrossSpecConsumerContracts, PublicBoundaryValidation_

- [x] 11.3 production UIとsecurity artifact gateを検証する
  - 一過性面が実行、実行中、失敗、handoff再試行だけを表示し、site name確認、project選択、保存操作を持たないことをDOMで確認する。
  - ページ由来文字列が安全なtextとして描画され、unsafe HTML、remote code、恒久的host permissionが追加されていないことを検証する。
  - DOM、permission、CSP、fixture、artifact gateがsynthetic資産だけで通ることを完了条件とする。
  - _Depends: 11.1_
  - _Requirements: 1.2, 1.3, 2.5, 3.3, 4.7, 6.5, 7.1, 7.4, 8.3, 8.4_
  - _Boundary: ProductCaptureDOM, SecurityValidation, ArtifactValidation_

- [x] 11.4 Chrome production E2Eと最終共通検証を完了する
  - icon起動からsite name付きcandidate editor到達、tab失効によるsurface終了、新gestureによる新世代起動をChrome 116相当のproduction buildで検証する。
  - source-price-refreshとcandidate-source-bookmarks相当consumerが公開契約だけを使い、旧save・navigation境界へ回帰していないことを確認する。
  - typecheck、lint、unit、contract、DOM、boundary、fixture、artifact、build、E2Eの共通検証flowが通ることを完了条件とする。
  - _Depends: 11.2, 11.3_
  - _Requirements: 1.1, 1.4, 1.5, 4.2, 4.3, 6.1, 6.2, 6.4, 7.2, 8.3, 8.4_
  - _Boundary: ProductCaptureE2E, FinalValidation_

## Implementation Notes

- collector横断の文書順は全DOM再走査ではなく、上限200件の収集済み候補nodeだけを`compareDocumentPosition`で比較し、`documentOrder`として未信頼payload境界からrankerまで保持する。
- runtimeが直接検出した`permission-lost | tab-changed`は、shell所有の`capture-invalidated` dismissへ渡し、常設面復帰と新しい明示操作noticeをshellへ委ねる。dismiss失敗・例外・遅延結果はcapture世代内へ閉じる。
- content script注入と抽出結果読取りは別々のChrome呼び出しであり、どちらの未応答も同じ有限timeoutと`injection-failed`経路へ閉じる。
- 取得元サイト名は`ExtractionCandidate[]`ではなく`siteName`という別channelでpage payload・`CaptureResult`を流れる。`CaptureField`空間へ入れないため`missingCoreFields`にも`rejectedFields`にも現れず、正規化失敗は黙って欠損になる。
- `MetadataPropertyRule.target`には設計例の`CaptureField | "source-site-name"`に加えて`price-currency`がある。`product:price:currency`を価格の修飾子としてallowlist内に閉じるための区分で、独立した商品項目ではない。
- metadata候補の`sourceLabel`はCSS selector文字列ではなくproperty名（例: `product:brand`）。familyは`source`側が持つ。
- `siteName`は`sources[0].siteName`（表示名）と`sourceSnapshot`の`siteName` / `siteName:source` / `siteName:sourceLabel`（元表記・provenance）へ写像する。`CaptureField`空間外なのでsnapshot keyは他fieldと衝突しない。
- 未応答timeoutは`createCaptureTimeoutPolicy`が1回のChrome呼び出しごとに独立した予算を持ち、timer源を`timeoutScheduler`で差し替えられる。実時間に依存しない決定的runtime testはこの差し替えで書く。
- 10.2・10.3の失効配線と世代隔離は5.1〜5.4の実装で既に満たされていたため、本タスクの追加はlifecycle seamを通した検証（`tests/features/product-capture/lifecycle-integration.test.ts`）だけ。
- candidate-managementはproduct-captureより先にcompositionされるため、classifierへは`productCapture.registration.publicApi.manufacturerDomains`を後から差す遅延lookupを渡す。公開APIの組立ては`createProductCaptureContribution`側の一箇所だけに保つ（既存の`duplicateRefreshPort`と同じ形）。
- metadata allowlistはproperty名だけをkeyにするため、同じ名前は`property`/`name`のどちらのattribute slotにあっても同じruleへ一致する。slotは承認済み`MetadataPropertyRule`契約の一部ではない（`collectMetadata`のcommentはこの点で実装と食い違う。DEF-009）。
- Playwrightの`route.fulfill`で非ASCIIのページ由来文字列を検証する場合、`contentType`に`charset=utf-8`を明示する。省略するとbrowser側の推測decodeで値が化け、抽出の非回帰testが誤検知する。
- 共通検証flowのartifact gateは`validate:final-build`であり、単体の`validate:artifacts` scriptはlicense notice除外が未反映で失敗する（DEF-010）。gate結果は`validate:final-build`で判断する。
