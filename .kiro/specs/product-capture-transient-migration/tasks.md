# Implementation Plan

- [x] 1. 公開契約と候補引き渡しの基礎を整える
- [x] 1.1 上流の一過性surfaceライフサイクル契約をconsumerへ導入する
  - `application-shell/public.ts`の最小ライフサイクルport、固定対象tab、起動世代、終了理由をcapture側のcanonical依存として接続する。
  - controller実体やChrome型をfeature境界へ漏らさず、上流未実装時には型検査で失敗する明示的なconsumer契約にする。
  - capture contributionから上流portを参照でき、既存の常設feature登録が変化しないcontract testを通す。
  - _Depends: transient-feature-surface 6.4_
  - _Requirements: 1.3, 2.1, 2.2, 4.1, 5.4_
  - _Boundary: ApplicationShellPublicAPI, ProductCaptureConsumerContract_

- [x] 1.2 project未解決draftとpre-edit検証契約を定義する
  - 抽出済み商品情報をproject未解決のまま表現するdraft型と、境界で`unknown`を受ける構造検証をcandidate-managementへ追加する。
  - pre-editで許容する空名と、構造不正を表す閉じたerror集合を定義し、保存時の既存validatorとは段階を分ける。
  - 正常draft、欠落・不正型、保存時だけ拒否される値を区別するunit testを通す。
  - _Requirements: 4.1, 4.3, 4.4, 4.5, 5.4_
  - _Boundary: CandidateDraftContracts, CandidatePreEditValidation_

- [x] 1.3 副作用のないcandidate editor intent factoryを公開する
  - project未解決draftからtyped activation intentを生成する純粋factoryをcandidate-managementのpublic APIへ追加する。
  - factoryはnavigation、state mutation、project照会、保存を開始せず、payload生成だけを担当する。
  - canonical公開APIの`query`と`sources: { catalog, mutations }`を維持し、captureは同名の縮小interfaceを再定義せず`createCandidateEditorIntent` facetだけを型参照する。
  - 同じ入力から同じintentが生成され、全facetを含む公開型とcapture consumerの双方が非公開実装へのdeep importなしで型検査を通るcontract testが成功することを完了条件とする。
  - _Requirements: 1.2, 1.7, 4.1, 5.4_
  - _Boundary: CandidateManagementPublicAPI, CandidateEditorIntentFactory_

- [x] 2. candidate-managementへpre-edit状態を統合する
- [x] 2.1 activation境界でdraftを再検証し既存projectを解決する
  - candidate editor activation adapterで`unknown` payloadを再検証し、不正入力を既存の`invalid_activation`へ写像する。
  - project-contextが`ready`の場合だけ検証済みcurrent ProjectIdを確定し、既存editor stateへdraftを配置する。
  - 有効・不正activationと既存project有無の各経路がtyped resultとなり、保存処理を先行させないintegration testを通す。
  - _Requirements: 1.2, 1.4, 4.2, 4.3, 4.5_
  - _Boundary: CandidateManagementActivation, CandidateManagementState_

- [x] 2.2 project不存在時にpending pre-editを保持する
  - current contextが未選択または利用不能なactivationを成功として受理し、解決前draftを既存management stateへの追加フィールドに保持する。
  - 新しいpre-edit activation、明示取消、またはrefresh後の検証済みcurrent projectへのbinding成功だけを同一panel session内の破棄条件にする。
  - capture surface終了後もpending draftが残り、再抽出なしでproject作成へ進めるstate testを通す。
  - _Requirements: 1.3, 1.4, 1.6, 4.6_
  - _Boundary: CandidateManagementState, PendingPreEdit_

- [x] 2.3 project作成後のcontext再検証でpending draftをeditorへ移す
  - project作成serviceが返したProjectIdを保存先へ使用せず、続くrefreshが返した検証済みcurrent ProjectIdだけをpending draftへ適用してeditor stateへ遷移する。
  - 作成失敗またはrefresh失敗時はdraftと入力を保持して再試行可能にし、検証済みcurrent projectへのbinding成功時だけpending stateをclearする。
  - 成功、失敗、再試行、新しいactivationとの競合を決定的に検証するintegration testを通す。
  - _Requirements: 1.4, 1.7, 4.2, 4.6, 5.4_
  - _Boundary: ProjectCreationService, CandidateManagementState_

- [x] 2.4 project-required UIと回復操作を実装する
  - pending pre-edit時にproject作成が必要な理由、作成操作、取消操作を表示し、抽出済み内容を確認可能にする。
  - 作成失敗を同じ画面へ安全な文言で表示し、再試行または取消ができ、成功後はeditorへ切り替える。
  - prompt、error、cancel、成功後editorのDOM testを日英message catalog込みで通す。
  - _Requirements: 1.4, 4.2, 4.6, 5.4_
  - _Boundary: CandidateManagementView, MessageCatalog_

- [x] 2.5 pending pre-editのpanel session寿命をcompositionへ接続する
  - candidate-management registrationとmount lifecycleへpending stateを接続し、capture unmountでは破棄しない。
  - panel document破棄後は復元しないsession限定の寿命とし、cleanup時に購読・一時状態を確実に解放する。
  - capture終了、feature切替、panel document破棄のintegration testで保持・破棄条件を観測できるようにする。
  - _Depends: 2.2, 2.4_
  - _Requirements: 1.4, 4.6, 5.4_
  - _Boundary: CandidateManagementRegistration, SidePanelSessionLifecycle_

- [x] 3. product-captureを固定tabの一過性featureへ移行する
- [x] 3.1 (P) transient contributionとactivationを登録する
  - product-captureをcanonical persistent／transient registration unionの一過性memberとして登録し、`presentation: "transient"`とactivationを申告して`navigation` metadataと`nav.productCapture`を持たせず、上流portから起動世代と固定TargetTabIdを受け取る。
  - activationごとに新しい実行contextを構築し、未起動時や常設navigationから直接mountされないようにする。
  - exact-shape型検査と正常activation、不正activation、再activationのregistration testを通し、mount/unmount、世代照合、handoff lifecycleが維持されることを確認する。
  - _Depends: 1.1_
  - _Requirements: 2.1, 2.2, 2.7, 3.1, 3.2, 3.3, 5.1_
  - _Boundary: ProductCaptureRegistration, TransientFeatureContribution_

- [x] 3.2 (P) 固定tab runtimeとfail-closed coordinatorを実装する
  - active tab再解決を廃止し、全実行をactivationで固定されたTargetTabIdへの`getTab`とscript injectionへ統一する。
  - 現行世代の権限付与中だけtab情報を読み、URL欠落・取得失敗・出所不一致を実行不能として閉じ、`pageUrl`比較を迂回しない。
  - 制限URL、権限喪失、tab更新・閉鎖、URL欠落、stale世代のunit testを通し、診断ログへページ由来URL・HTML・抽出値を出さない。
  - _Depends: 1.1_
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.4, 3.5, 5.2, 5.4_
  - _Boundary: CaptureRuntimePort, ProductCaptureCoordinator, SecurityLogging_

- [x] 3.3 capture stateを抽出と再試行へ縮小する
  - `review`、`submitting`、`saved`と保存責務を削除し、idle／extracting／failedと現行世代だけを表すstateへ置き換える。
  - 失敗時は検証済みretained intentを同一世代に保持し、新activation・成功・一過性面終了で破棄する。
  - 抽出成功、失敗、同一世代再試行、stale callback、新activationのstate testを通す。
  - _Depends: 3.1, 3.2_
  - _Requirements: 1.1, 1.6, 2.1, 2.2, 2.5, 2.7, 3.1, 3.2, 5.1, 5.2_
  - _Boundary: ProductCaptureState, CaptureGenerationGuard_

- [x] 3.4 capture viewから編集・保存UIを除去する
  - 抽出開始中と失敗・再試行だけを描画し、project selector、候補編集、保存完了、常設navigation相当のUIを削除する。
  - 制限ページ、権限喪失、対象tab失効を安全な説明と回復操作へ写像し、実行不能時の操作を隠す。
  - idle、extracting、各失敗、retryのDOM testで旧statusや保存操作が存在しないことを確認する。
  - _Depends: 3.3_
  - _Requirements: 1.1, 1.5, 1.6, 2.3, 2.4, 2.6, 3.2, 5.1_
  - _Boundary: ProductCaptureView, ProductCaptureMessages_

- [x] 4. 抽出結果をcandidate editorへ引き渡す
- [x] 4.1 抽出payloadをproject未解決draftへ写像する
  - extractorのunknown出力を既存schemaで検証し、projectを選ばずpre-edit draftへ正規化するmapperを追加する。
  - 商品名の空値はpre-editで保持し、URLやHTMLなど不要なページ由来値をintentへ含めない。
  - 正常、空名、構造不正、余分な値のmapper unit testを通す。
  - _Depends: 1.2, 3.2_
  - _Requirements: 1.2, 1.5, 4.1, 4.3, 4.5_
  - _Boundary: CaptureDraftMapper, CandidateDraftContracts_

- [x] 4.2 現行世代の抽出成功だけをtyped concludeする
  - mapperと純粋intent factoryを用い、現行世代の成功結果だけを一回の`conclude`として上流portへ渡す。
  - conclude成功後はcapture stateを終了し、失敗時はretained intentを保持して同一世代の再試行だけを許可する。
  - 成功、activation失敗、retry、二重完了、stale完了のintegration testを通す。
  - _Depends: 1.3, 2.2, 3.3, 4.1_
  - _Requirements: 1.3, 1.6, 2.5, 5.2, 5.3_
  - _Boundary: ProductCaptureCoordinator, TransientSurfaceLifecyclePort_

- [x] 4.3 manual入力とproject不存在のhandoffを閉じる
  - manual入力を抽出結果と同じproject未解決draft契約へ載せ、候補なしの場合だけ安全にcaptureへ留める。
  - project不存在でもcandidate-management activationを成功させ、capture終了後はpending pre-edit側から回復する。
  - manual、候補なし、project不存在、明示取消のintegration testで結果の寿命と終了責務を確認する。
  - _Depends: 2.2, 3.4, 4.1, 4.2_
  - _Requirements: 1.5, 4.3, 4.4, 4.6, 5.3_
  - _Boundary: ProductCaptureCoordinator, CandidateManagementActivation_

- [x] 5. production compositionと公開境界を移行する
- [x] 5.1 capture contributionを3依存だけで構成する
  - production compositionをruntime、TransientSurfaceLifecyclePort、candidate editor intent factoryの3依存へ切り替える。
  - capture／candidate-managementの登録順をlate-bound shell契約へ合わせ、起動前・cleanup後はfail closedにする。
  - production factoryが正確に3依存だけを受け、テスト専用featureなしで型検査を通るcomposition testが成功することを完了条件とする。
  - _Depends: 2.5, 3.4, 4.2_
  - _Requirements: 1.2, 1.3, 1.7, 3.3, 5.4_
  - _Boundary: ApplicationComposition, ProductCaptureDependencies_

- [x] 5.2 product-captureの旧実行・保存経路を削除する
  - `submit-draft`、worker registration、active-tab再解決、direct editor navigation、保存statusと旧UI依存をproduct-captureから除去する。
  - 旧callbackやdead stateを参照するconsumerを新しいlifecycle／intent経路へ移し、未使用moduleを削除する。
  - product-capture境界で旧API名・保存処理・navigation callbackが残らない型検査と検索gateを通す。
  - _Depends: 5.1_
  - _Requirements: 1.1, 1.7, 3.2, 3.3, 3.4, 5.1, 5.4_
  - _Boundary: ProductCaptureFeature, ProductCaptureLegacyRemoval_

- [x] 5.3 candidate-managementのcanonical公開APIを保全する
  - capture専用の`CaptureCandidatePort`、`listProjects`、direct open callbackを公開面から外し、保存serviceをcandidate-management内部へ戻す。
  - 公開面をcanonical `query`、純粋`createCandidateEditorIntent`、`sources: { catalog, mutations }`のexact shapeへ統一し、captureにはintent factory facetだけを配線する。
  - 全consumerのtypecheckと公開API contract testで全facetのparity、削除済みsymbol不在、同名縮小interface不在、deep import不在を確認する。
  - _Depends: 5.1_
  - _Requirements: 1.2, 1.7, 4.1, 5.4_
  - _Boundary: CandidateManagementPublicAPI, CandidateManagementInternalServices_

- [x] 5.4 (P) message catalogとE2E locatorを移行する
  - captureの抽出・失敗・再試行、candidate-managementのproject-required・取消・作成失敗に安定した日英message keyを割り当てる。
  - transient product-captureはnavigation keyを申告せず、consumer移行後に`nav.productCapture`がcatalog、fixture、locatorへ残らない状態にする。
  - icon起動、editor到達、project-required、常設復帰、navigation終了をrole／label／test idで観測できるlocatorへ揃える。
  - legacy保存statusや不安定な文言依存がfixtureとE2Eから消えるcatalog／locator testを通す。
  - _Depends: 2.4, 3.4_
  - _Requirements: 1.1, 1.5, 1.6, 2.3, 2.4, 2.6, 3.3, 5.4, 5.5_
  - _Boundary: MessageCatalog, E2ELocators_

- [x] 5.5 公開境界とdeep-import gateを更新する
  - shell、capture、candidate-management間の許可依存をboundary validatorへ反映し、公開entry point以外の横断importを拒否する。
  - 削除したcapture専用portと旧navigation callbackをfixture・test doubleを含む全consumerから除去する。
  - transient registrationの`navigation`／`nav.productCapture`と、不完全な`CandidateManagementPublicApi`再定義を拒否する検索gateを加え、`validate-boundaries`、exact public API contract、snapshotが新しい依存方向だけで通る状態にする。
  - _Depends: 5.2, 5.3_
  - _Requirements: 1.7, 3.5, 5.4, 5.6_
  - _Boundary: BoundaryValidation, PublicAPIArtifacts_

- [x] 5.6 permission・fixture・production artifact gateを更新する
  - 固定tabの`activeTab`付与、`tabs.get` URL欠落、script injectionをproduction同等fixtureで再現し、追加権限を要求しない。
  - production bundleにsynthetic transient featureや旧worker entryが混入せず、ページ由来URL・HTML・抽出値が診断ログへ出ない検査を追加する。
  - `validate-artifacts`、permission検査、production-only fixture gateを新しい起動経路で通す。
  - _Depends: 5.2, 5.4, 5.5_
  - _Requirements: 2.4, 3.4, 3.5, 4.5, 5.4, 5.6_
  - _Boundary: ExtensionPermissions, ProductionFixtures, ArtifactValidation, SecurityLogging_

- [x] 6. 移行後の動線と非回帰を検証する
- [x] 6.1 candidate pre-editとproject回復のunit・integration testを完成する
  - unknown activation、pre-edit検証、既存project解決、project不存在pending、作成成功・失敗・取消を網羅する。
  - capture終了ではdraftが残りpanel document破棄後は復元されない寿命を実際のregistration構成で確認する。
  - candidate-management test suiteが保存時validatorとの段階差を含めて決定的に通る。
  - _Depends: 2.5, 5.3_
  - _Requirements: 1.2, 1.4, 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.4_
  - _Boundary: CandidateManagementTests_

- [x] 6.2 固定tab runtimeのfail-closed testを完成する
  - activation固定tab、制限URL、URL欠落、権限喪失、tab更新・閉鎖、出所不一致をruntime adapterとcoordinatorで検証する。
  - 失敗時に別tabを再解決せずscriptを注入せず、機密的なページ由来値をログへ残さないことをassertする。
  - runtime／coordinator test suiteがChrome mockの権限差を含めて通る。
  - _Depends: 4.3, 5.2_
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.4, 3.5, 5.2, 5.4_
  - _Boundary: CaptureRuntimeTests, CaptureSecurityTests_

- [x] 6.3 capture stateとhandoff世代のtestを完成する
  - idle／extracting／failed、retained intent、retry、manual、候補なし、conclude成功・失敗を網羅する。
  - stale callback、二重完了、新activationが現行世代やcandidate stateを変更しないことを確認する。
  - product-capture unit／integration suiteから旧review／submitting／saved期待値が消えた状態で通す。
  - _Depends: 4.3, 5.2_
  - _Requirements: 1.1, 1.3, 1.5, 1.6, 2.1, 2.2, 2.5, 2.7, 3.1, 3.2, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: ProductCaptureStateTests, CaptureHandoffTests_

- [x] 6.4 production compositionと公開契約のtestを完成する
  - capture factoryの依存が正確に3つで、transient registrationにnavigation metadataがなく、shell lifecycleとcandidate intentの公開entry pointだけを使うことを検証する。
  - start前、正常起動、cleanup後のlifecycleと全consumer typecheckをproduction compositionで確認する。
  - candidate-management公開APIの`query`、intent factory、`sources: { catalog, mutations }` exact parityを確認し、boundary／public API regression suiteが削除symbolと`nav.productCapture`なしで通る。
  - _Depends: 5.5, 5.6, 6.1, 6.2, 6.3_
  - _Requirements: 1.7, 3.3, 3.5, 5.4, 5.6_
  - _Boundary: ApplicationCompositionTests, PublicContractTests_

- [x] 6.5 extractor・保存・navigationの非回帰testを完成する
  - 既存extractorの検証、candidate-management内部の保存、常設feature navigationが移行後も単独で動作することを確認する。
  - product-captureから保存serviceを直接呼ばず、candidate editor保存時だけ既存validatorと永続化が実行されることをassertする。
  - 関連unit／integration suiteとlegacy fixture除去後の回帰testを通す。
  - _Depends: 6.4_
  - _Requirements: 1.7, 3.3, 4.2, 4.5, 5.4, 5.6_
  - _Boundary: ExtractorRegression, CandidateSaveRegression, NavigationRegression_

- [x] 6.6 durable activationのproduction E2Eと固定tab handoffのintegrationを通す
  - action後と同形のdurable activationをproduction session transportへ投入し、synthetic production featureなしで実product-capture登録が固定tab・起動世代を受理してcapture面を提示することをproduction E2Eで確認する。
  - Chrome-shaped integrationで固定tabだけへの抽出とcandidate editorへのtyped handoffを検証し、project存在時と不存在時の双方で、後者は作成後に再抽出せずeditorへ到達することを確認する。
  - fixture投入をicon起動、`activeTab`付与、実script注入の証明とは扱わず、これらと実candidate editor到達は6.8の同一build manual smokeへ一本化する。
  - _Depends: 6.5, transient-feature-surface 6.5_
  - _Requirements: 1.2, 1.3, 3.1, 3.2, 3.3, 4.6, 5.5, 5.6_
  - _Boundary: ExtensionE2E, ProductionBuild_

- [x] 6.7 失効復帰と常設navigation終了のE2Eを通す
  - capture中の対象tab更新・閉鎖で一過性面が終了し、安全な理由を示して常設面へ復帰することを確認する。
  - capture中に常設navigationを選択すると一過性面が終了し、選択した常設featureだけが表示されることを確認する。
  - durable activation以降のproduction E2Eとしてdismissal／常設復帰を自動検証し、上流要件4.5の最終closureは6.8のmanual smoke gateへ委譲する。
  - _Depends: 6.6_
  - _Requirements: 1.4, 2.5, 3.3, 5.5_
  - _Boundary: ExtensionE2E, TransientSurfaceLifecycle_

- [x] 6.8 全検証gateを実行し移行完了を確認する
  - lint、typecheck、unit、integration、E2E、boundary、artifact、permissionの全gateをproduction構成で実行する。
  - 同じcommitのproduction buildをChrome 116以降へ未パッケージロードし、実toolbar icon click、`activeTab`付与、固定tabへの実script注入・抽出、candidate editor到達をmanual smokeで確認する。
  - manual smoke未実施または失敗時は`MANUAL_VERIFY_REQUIRED`とし、fixture投入だけでfeature GOを主張しない。
  - requirements 1.1〜5.6のtraceabilityと削除対象・受容リスクを再確認し、未検証項目を残さない。
  - 全gateのfresh evidenceを記録し、上流・下流specとsteeringの整合を最終確認する。
  - _Depends: 6.7_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - _Boundary: QualityGates, SpecTraceability_

- [ ] 7. current context authorityとrollback境界を追補する
- [x] 7.1 candidate activationを検証済みcurrent contextへ統一する
  - 編集開始payloadを境界で再検証し、保存先はproject-contextが返す検証済みcurrent projectだけから解決する。
  - payload、画面snapshot、legacy handoffに含まれるstaleまたは無効なproject情報を保存先へ使わず、current contextも変更しない。
  - current contextが未選択または利用不能な場合は失敗や先頭projectへのfallbackにせず、project未解決pre-editとして受理する。
  - current projectへのbinding、未解決保持、stale project入力の各経路が判別可能な受理結果となり、受理済みprojectが置換されないcontract testが通ることを完了条件とする。
  - _Requirements: 1.3, 1.6, 4.1, 4.2, 4.5, 4.7, 4.8_
  - _Boundary: Candidate Pre-edit Boundary, Candidate Activation_

- [x] 7.2 pending pre-editを明示操作とcontext回復から再開する
  - 共通selectorによるprojectの明示選択、project作成後のrefresh、またはcurrent contextの回復を受けて、検証済み`ready.selectedProjectId`へ保持中の同じpre-editを再抽出せずeditor stateへ移す。
  - binding済みprojectをその後のfallbackや再解決で置換せず、payload、一覧先頭、project作成serviceの返却IDを保存先authorityとして使用しない。
  - pending stateは受理成功、明示取消、新しいpre-edit activation、panel session終了という設計済み条件だけで破棄する。
  - 未選択、利用不能、選択回復、作成成功・失敗、取消、session cleanupのstate／integration testで保持と破棄を観測できることを完了条件とする。
  - _Depends: 7.1_
  - _Requirements: 1.4, 1.6, 1.8, 4.2, 4.6, 4.7, 4.8_
  - _Boundary: Pending Pre-edit State_

- [x] 7.3 candidate側のproject回復UIをcurrent context契約へ合わせる
  - pending pre-editを保持したまま、projectの選択、作成、取消、context回復の利用可能な操作と理由を候補管理画面へ提示する。
  - 作成またはcontext回復の失敗は安全な文言で同じ画面に表示し、draftを失わず再試行できるようにする。
  - 回復成功後は同じpre-editのeditorへ切り替わり、capture面へ戻らず再抽出も要求しない。
  - 日英message catalogを含むDOM testでpending、失敗、取消、回復後editorの各表示と操作が確認できることを完了条件とする。
  - _Depends: 7.2_
  - _Requirements: 1.4, 1.6, 1.8, 4.6, 5.3_
  - _Boundary: Candidate View, Message Catalog_

- [x] 7.4 (P) capture registrationのrollback snapshotを実行identityだけへ限定する
  - rollback snapshotにはactivation、固定tab、request generation、handoff中generationだけを保持し、URL、HTML、抽出値、project情報を含めない。
  - source復元時は保存されたgenerationを再構築し、別世代のcallbackやintentを現行結果として受理しない。
  - mount失敗、target受理失敗、restore成功・失敗のregistration contractを上流lifecycle規約に沿って検証する。
  - snapshot exact-shapeと復元後の世代照合testが通り、機密的なページ由来値がstateやlogへ残らないことを完了条件とする。
  - _Depends: 3.1_
  - _Requirements: 1.9, 2.5, 5.2, 5.7_
  - _Boundary: Product Capture Registration_

- [x] 7.5 candidate受理と原子的終了をretained intentへ統合する
  - candidate activationの安定した受理結果を利用し、current projectへのbindingまたはpending pre-edit保持が成功した場合だけ一過性面を終了する。
  - candidate受理失敗と原子的conclude失敗を区別し、どちらもcaptureを終了済みにせず検証済みintentを現行rollback世代へ保持する。
  - retryは保持intentだけを再利用し、ページ再抽出を行わず、stale世代、二重完了、新activation後の旧retryを無効化する。
  - 受理成功、受理失敗、conclude失敗、rollback復元、retry成功、stale retryのintegration testで終了条件と保持状態を観測できることを完了条件とする。
  - _Depends: 7.1, 7.4_
  - _Requirements: 1.3, 1.9, 2.5, 5.2, 5.3, 5.7_
  - _Boundary: Capture State, Draft Mapper and Handoff, Shell Lifecycle Integration_

- [ ] 7.6 current-context handoffをproduction compositionへ統合する
  - product-captureのruntime、transient lifecycle、candidate intent factoryという3依存を維持したまま、current-context awareなcandidate受理結果を配線する。
  - current projectへbindした場合とpending保持した場合はcapture終了後も同じpre-editを継続し、受理または終了失敗時はcaptureをrollback世代で復元する。
  - stale project入力がcurrent contextを変更せず、context回復後に同じdraftへ戻ることをproduction同形のcompositionで確認する。
  - Chrome-shaped integration testがbinding、pending、明示回復、受理失敗、atomic rollback retryの全経路で通ることを完了条件とする。
  - _Depends: 7.2, 7.3, 7.5_
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 1.8, 1.9, 4.2, 4.6, 4.7, 4.8, 5.3, 5.5, 5.7_
  - _Boundary: Application Composition, Candidate Activation, Product Capture Handoff Integration_

- [ ] 7.7 更新仕様の回帰gateと同一build smokeを完了する
  - state、runtime、candidate activation、pending recovery、atomic handoffのunit／integration／DOM testを実行し、全36要件のtraceabilityを確認する。
  - typecheck、lint、E2E、公開境界、permission、fixture、artifact、production buildの各gateを実行し、実サイト由来assetや旧capture保存・navigation経路がないことを確認する。
  - 同じcommitの更新production buildをChrome 116以降へ未パッケージロードし、toolbar icon、activeTab付与、固定tabへの実script注入、candidate editor到達をmanual smokeする。
  - `pnpm validate`と全補助gateがfresh evidenceで通り、manual smoke未実施または失敗時は`MANUAL_VERIFY_REQUIRED`としてGOを保留することを完了条件とする。
  - _Depends: 7.6_
  - _Requirements: 3.3, 3.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: Quality Gates, Spec Traceability_

## Implementation Notes

- 2026-07-31 `ui-message-catalog` validation remediationで、handoff失敗時の保持結果、新しい起動による置換、同activationでのhandoff再試行を3つのcanonical message keyへ接続した。viewは既存`failure.kind`だけで分岐し、state machineとretained intent再試行契約は変更せず、DOM／state／integration、完全`pnpm validate`、production E2Eを再検証した。
- production workerのfeature catalogはDOM/React境界を保つため空なので、toolbar gestureはcanonical `productCaptureFeatureId`をcomposition rootから明示注入する。
- cross-feature handoff前にshellがrollback snapshotを要求するため、product-captureのmount handleはページ内容を含めず`activationId`・固定`tabId`・内部世代だけをcapture/restoreする。shellはsource leaseをtarget mount前に解放し、handoff失敗時は保存した内部世代で進行中結果を受理できるsourceを復元する。復元不能時はcontrollerもinactiveへ倒し、非表示のcaptureをactiveとして残さない。
- 2026-08-11 task 7.1〜7.3の保存先authorityを再同期し、`UnresolvedCandidateEditorPrefill`から`projectId`を外したまま、legacy payloadとproject作成service返却IDを保存先へ使用しない契約へ統一した。current context未選択・利用不能はerrorではなくpending受理とし、共通selector、作成後refresh、context回復の三経路が検証済みcurrent projectで同一pre-editをeditorへ移す。
- 2026-08-10 project-contextのcatalogはcandidate-managementのproject作成では再読込されないため、同一panel session内はcurrent contextが`empty`のまま残りcaptureがpending pre-editへ落ちる（DEF-020）。production compositionでcurrent contextを新鮮に保つ配線はtask 7.6で行う。
- 2026-07-30、同一production buildをChromeへ再読み込みし、AMD Ryzen 7 9700Xの商品ページで実toolbar iconから「取り込みを開始」を実行してcandidate詳細編集画面への到達をmanual smoke確認した。
