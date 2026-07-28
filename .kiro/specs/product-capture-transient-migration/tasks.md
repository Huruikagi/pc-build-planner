# Implementation Plan

- [ ] 1. 公開契約と候補引き渡しの基礎を整える
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

- [ ] 2. candidate-managementへpre-edit状態を統合する
- [x] 2.1 activation境界でdraftを再検証し既存projectを解決する
  - candidate editor activation adapterで`unknown` payloadを再検証し、不正入力を既存の`invalid_activation`へ写像する。
  - projectが存在する場合は既定の解決規則でProjectIdを確定し、既存editor stateへdraftを配置する。
  - 有効・不正activationと既存project有無の各経路がtyped resultとなり、保存処理を先行させないintegration testを通す。
  - _Requirements: 1.2, 1.4, 4.2, 4.3, 4.5_
  - _Boundary: CandidateManagementActivation, CandidateManagementState_

- [x] 2.2 project不存在時にpending pre-editを保持する
  - projectが一件もないactivationを成功として受理し、解決前draftを既存management stateへの追加フィールドに保持する。
  - 新しいpre-edit activation、明示取消、project作成成功だけを同一panel session内の破棄条件にする。
  - capture surface終了後もpending draftが残り、再抽出なしでproject作成へ進めるstate testを通す。
  - _Requirements: 1.3, 1.4, 1.6, 4.6_
  - _Boundary: CandidateManagementState, PendingPreEdit_

- [x] 2.3 project作成結果でpending draftをeditorへ移す
  - project作成serviceが返したProjectIdをそのままpending draftへ適用し、再一覧取得や名前照合を行わずeditor stateへ遷移する。
  - 作成失敗時はdraftと入力を保持して再試行可能にし、成功時だけpending stateをclearする。
  - 成功、失敗、再試行、新しいactivationとの競合を決定的に検証するintegration testを通す。
  - _Requirements: 1.4, 1.7, 4.2, 4.6, 5.4_
  - _Boundary: ProjectCreationService, CandidateManagementState_

- [x] 2.4 project-required UIと回復操作を実装する
  - pending pre-edit時にproject作成が必要な理由、作成操作、取消操作を表示し、抽出済み内容を確認可能にする。
  - 作成失敗を同じ画面へ安全な文言で表示し、再試行または取消ができ、成功後はeditorへ切り替える。
  - prompt、error、cancel、成功後editorのDOM testを日英message catalog込みで通す。
  - _Requirements: 1.4, 4.2, 4.6, 5.4_
  - _Boundary: CandidateManagementView, MessageCatalog_

- [ ] 2.5 pending pre-editのpanel session寿命をcompositionへ接続する
  - candidate-management registrationとmount lifecycleへpending stateを接続し、capture unmountでは破棄しない。
  - panel document破棄後は復元しないsession限定の寿命とし、cleanup時に購読・一時状態を確実に解放する。
  - capture終了、feature切替、panel document破棄のintegration testで保持・破棄条件を観測できるようにする。
  - _Depends: 2.2, 2.4_
  - _Requirements: 1.4, 4.6, 5.4_
  - _Boundary: CandidateManagementRegistration, SidePanelSessionLifecycle_

- [ ] 3. product-captureを固定tabの一過性featureへ移行する
- [ ] 3.1 (P) transient contributionとactivationを登録する
  - product-captureをcanonical persistent／transient registration unionの一過性memberとして登録し、`presentation: "transient"`とactivationを申告して`navigation` metadataと`nav.productCapture`を持たせず、上流portから起動世代と固定TargetTabIdを受け取る。
  - activationごとに新しい実行contextを構築し、未起動時や常設navigationから直接mountされないようにする。
  - exact-shape型検査と正常activation、不正activation、再activationのregistration testを通し、mount/unmount、世代照合、handoff lifecycleが維持されることを確認する。
  - _Depends: 1.1_
  - _Requirements: 2.1, 2.2, 2.7, 3.1, 3.2, 3.3, 5.1_
  - _Boundary: ProductCaptureRegistration, TransientFeatureContribution_

- [ ] 3.2 (P) 固定tab runtimeとfail-closed coordinatorを実装する
  - active tab再解決を廃止し、全実行をactivationで固定されたTargetTabIdへの`getTab`とscript injectionへ統一する。
  - 現行世代の権限付与中だけtab情報を読み、URL欠落・取得失敗・出所不一致を実行不能として閉じ、`pageUrl`比較を迂回しない。
  - 制限URL、権限喪失、tab更新・閉鎖、URL欠落、stale世代のunit testを通し、診断ログへページ由来URL・HTML・抽出値を出さない。
  - _Depends: 1.1_
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.4, 3.5, 5.2, 5.4_
  - _Boundary: CaptureRuntimePort, ProductCaptureCoordinator, SecurityLogging_

- [ ] 3.3 capture stateを抽出と再試行へ縮小する
  - `review`、`submitting`、`saved`と保存責務を削除し、idle／extracting／failedと現行世代だけを表すstateへ置き換える。
  - 失敗時は検証済みretained intentを同一世代に保持し、新activation・成功・一過性面終了で破棄する。
  - 抽出成功、失敗、同一世代再試行、stale callback、新activationのstate testを通す。
  - _Depends: 3.1, 3.2_
  - _Requirements: 1.1, 1.6, 2.1, 2.2, 2.5, 2.7, 3.1, 3.2, 5.1, 5.2_
  - _Boundary: ProductCaptureState, CaptureGenerationGuard_

- [ ] 3.4 capture viewから編集・保存UIを除去する
  - 抽出開始中と失敗・再試行だけを描画し、project selector、候補編集、保存完了、常設navigation相当のUIを削除する。
  - 制限ページ、権限喪失、対象tab失効を安全な説明と回復操作へ写像し、実行不能時の操作を隠す。
  - idle、extracting、各失敗、retryのDOM testで旧statusや保存操作が存在しないことを確認する。
  - _Depends: 3.3_
  - _Requirements: 1.1, 1.5, 1.6, 2.3, 2.4, 2.6, 3.2, 5.1_
  - _Boundary: ProductCaptureView, ProductCaptureMessages_

- [ ] 4. 抽出結果をcandidate editorへ引き渡す
- [ ] 4.1 抽出payloadをproject未解決draftへ写像する
  - extractorのunknown出力を既存schemaで検証し、projectを選ばずpre-edit draftへ正規化するmapperを追加する。
  - 商品名の空値はpre-editで保持し、URLやHTMLなど不要なページ由来値をintentへ含めない。
  - 正常、空名、構造不正、余分な値のmapper unit testを通す。
  - _Depends: 1.2, 3.2_
  - _Requirements: 1.2, 1.5, 4.1, 4.3, 4.5_
  - _Boundary: CaptureDraftMapper, CandidateDraftContracts_

- [ ] 4.2 現行世代の抽出成功だけをtyped concludeする
  - mapperと純粋intent factoryを用い、現行世代の成功結果だけを一回の`conclude`として上流portへ渡す。
  - conclude成功後はcapture stateを終了し、失敗時はretained intentを保持して同一世代の再試行だけを許可する。
  - 成功、activation失敗、retry、二重完了、stale完了のintegration testを通す。
  - _Depends: 1.3, 2.2, 3.3, 4.1_
  - _Requirements: 1.3, 1.6, 2.5, 5.2, 5.3_
  - _Boundary: ProductCaptureCoordinator, TransientSurfaceLifecyclePort_

- [ ] 4.3 manual入力とproject不存在のhandoffを閉じる
  - manual入力を抽出結果と同じproject未解決draft契約へ載せ、候補なしの場合だけ安全にcaptureへ留める。
  - project不存在でもcandidate-management activationを成功させ、capture終了後はpending pre-edit側から回復する。
  - manual、候補なし、project不存在、明示取消のintegration testで結果の寿命と終了責務を確認する。
  - _Depends: 2.2, 3.4, 4.1, 4.2_
  - _Requirements: 1.5, 4.3, 4.4, 4.6, 5.3_
  - _Boundary: ProductCaptureCoordinator, CandidateManagementActivation_

- [ ] 5. production compositionと公開境界を移行する
- [ ] 5.1 capture contributionを3依存だけで構成する
  - production compositionをruntime、TransientSurfaceLifecyclePort、candidate editor intent factoryの3依存へ切り替える。
  - capture／candidate-managementの登録順をlate-bound shell契約へ合わせ、起動前・cleanup後はfail closedにする。
  - production factoryが正確に3依存だけを受け、テスト専用featureなしで型検査を通るcomposition testが成功することを完了条件とする。
  - _Depends: 2.5, 3.4, 4.2_
  - _Requirements: 1.2, 1.3, 1.7, 3.3, 5.4_
  - _Boundary: ApplicationComposition, ProductCaptureDependencies_

- [ ] 5.2 product-captureの旧実行・保存経路を削除する
  - `submit-draft`、worker registration、active-tab再解決、direct editor navigation、保存statusと旧UI依存をproduct-captureから除去する。
  - 旧callbackやdead stateを参照するconsumerを新しいlifecycle／intent経路へ移し、未使用moduleを削除する。
  - product-capture境界で旧API名・保存処理・navigation callbackが残らない型検査と検索gateを通す。
  - _Depends: 5.1_
  - _Requirements: 1.1, 1.7, 3.2, 3.3, 3.4, 5.1, 5.4_
  - _Boundary: ProductCaptureFeature, ProductCaptureLegacyRemoval_

- [ ] 5.3 candidate-managementのcanonical公開APIを保全する
  - capture専用の`CaptureCandidatePort`、`listProjects`、direct open callbackを公開面から外し、保存serviceをcandidate-management内部へ戻す。
  - 公開面をcanonical `query`、純粋`createCandidateEditorIntent`、`sources: { catalog, mutations }`のexact shapeへ統一し、captureにはintent factory facetだけを配線する。
  - 全consumerのtypecheckと公開API contract testで全facetのparity、削除済みsymbol不在、同名縮小interface不在、deep import不在を確認する。
  - _Depends: 5.1_
  - _Requirements: 1.2, 1.7, 4.1, 5.4_
  - _Boundary: CandidateManagementPublicAPI, CandidateManagementInternalServices_

- [ ] 5.4 (P) message catalogとE2E locatorを移行する
  - captureの抽出・失敗・再試行、candidate-managementのproject-required・取消・作成失敗に安定した日英message keyを割り当てる。
  - transient product-captureはnavigation keyを申告せず、consumer移行後に`nav.productCapture`がcatalog、fixture、locatorへ残らない状態にする。
  - icon起動、editor到達、project-required、常設復帰、navigation終了をrole／label／test idで観測できるlocatorへ揃える。
  - legacy保存statusや不安定な文言依存がfixtureとE2Eから消えるcatalog／locator testを通す。
  - _Depends: 2.4, 3.4_
  - _Requirements: 1.1, 1.5, 1.6, 2.3, 2.4, 2.6, 3.3, 5.4, 5.5_
  - _Boundary: MessageCatalog, E2ELocators_

- [ ] 5.5 公開境界とdeep-import gateを更新する
  - shell、capture、candidate-management間の許可依存をboundary validatorへ反映し、公開entry point以外の横断importを拒否する。
  - 削除したcapture専用portと旧navigation callbackをfixture・test doubleを含む全consumerから除去する。
  - transient registrationの`navigation`／`nav.productCapture`と、不完全な`CandidateManagementPublicApi`再定義を拒否する検索gateを加え、`validate-boundaries`、exact public API contract、snapshotが新しい依存方向だけで通る状態にする。
  - _Depends: 5.2, 5.3_
  - _Requirements: 1.7, 3.5, 5.4, 5.6_
  - _Boundary: BoundaryValidation, PublicAPIArtifacts_

- [ ] 5.6 permission・fixture・production artifact gateを更新する
  - 固定tabの`activeTab`付与、`tabs.get` URL欠落、script injectionをproduction同等fixtureで再現し、追加権限を要求しない。
  - production bundleにsynthetic transient featureや旧worker entryが混入せず、ページ由来URL・HTML・抽出値が診断ログへ出ない検査を追加する。
  - `validate-artifacts`、permission検査、production-only fixture gateを新しい起動経路で通す。
  - _Depends: 5.2, 5.4, 5.5_
  - _Requirements: 2.4, 3.4, 3.5, 4.5, 5.4, 5.6_
  - _Boundary: ExtensionPermissions, ProductionFixtures, ArtifactValidation, SecurityLogging_

- [ ] 6. 移行後の動線と非回帰を検証する
- [ ] 6.1 candidate pre-editとproject回復のunit・integration testを完成する
  - unknown activation、pre-edit検証、既存project解決、project不存在pending、作成成功・失敗・取消を網羅する。
  - capture終了ではdraftが残りpanel document破棄後は復元されない寿命を実際のregistration構成で確認する。
  - candidate-management test suiteが保存時validatorとの段階差を含めて決定的に通る。
  - _Depends: 2.5, 5.3_
  - _Requirements: 1.2, 1.4, 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.4_
  - _Boundary: CandidateManagementTests_

- [ ] 6.2 固定tab runtimeのfail-closed testを完成する
  - activation固定tab、制限URL、URL欠落、権限喪失、tab更新・閉鎖、出所不一致をruntime adapterとcoordinatorで検証する。
  - 失敗時に別tabを再解決せずscriptを注入せず、機密的なページ由来値をログへ残さないことをassertする。
  - runtime／coordinator test suiteがChrome mockの権限差を含めて通る。
  - _Depends: 4.3, 5.2_
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.4, 3.5, 5.2, 5.4_
  - _Boundary: CaptureRuntimeTests, CaptureSecurityTests_

- [ ] 6.3 capture stateとhandoff世代のtestを完成する
  - idle／extracting／failed、retained intent、retry、manual、候補なし、conclude成功・失敗を網羅する。
  - stale callback、二重完了、新activationが現行世代やcandidate stateを変更しないことを確認する。
  - product-capture unit／integration suiteから旧review／submitting／saved期待値が消えた状態で通す。
  - _Depends: 4.3, 5.2_
  - _Requirements: 1.1, 1.3, 1.5, 1.6, 2.1, 2.2, 2.5, 2.7, 3.1, 3.2, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: ProductCaptureStateTests, CaptureHandoffTests_

- [ ] 6.4 production compositionと公開契約のtestを完成する
  - capture factoryの依存が正確に3つで、transient registrationにnavigation metadataがなく、shell lifecycleとcandidate intentの公開entry pointだけを使うことを検証する。
  - start前、正常起動、cleanup後のlifecycleと全consumer typecheckをproduction compositionで確認する。
  - candidate-management公開APIの`query`、intent factory、`sources: { catalog, mutations }` exact parityを確認し、boundary／public API regression suiteが削除symbolと`nav.productCapture`なしで通る。
  - _Depends: 5.5, 5.6, 6.1, 6.2, 6.3_
  - _Requirements: 1.7, 3.3, 3.5, 5.4, 5.6_
  - _Boundary: ApplicationCompositionTests, PublicContractTests_

- [ ] 6.5 extractor・保存・navigationの非回帰testを完成する
  - 既存extractorの検証、candidate-management内部の保存、常設feature navigationが移行後も単独で動作することを確認する。
  - product-captureから保存serviceを直接呼ばず、candidate editor保存時だけ既存validatorと永続化が実行されることをassertする。
  - 関連unit／integration suiteとlegacy fixture除去後の回帰testを通す。
  - _Depends: 6.4_
  - _Requirements: 1.7, 3.3, 4.2, 4.5, 5.4, 5.6_
  - _Boundary: ExtractorRegression, CandidateSaveRegression, NavigationRegression_

- [ ] 6.6 production icon起動からcandidate editorまでのE2Eを通す
  - 未パッケージMV3拡張でaction iconから固定tab captureを起動し、抽出結果をcandidate editorへ引き渡す。
  - project存在時と不存在時の双方で、後者は作成後に再抽出せずeditorへ到達することを確認する。
  - synthetic production featureなしで主要動線とproduction artifactが成立するE2Eを通す。
  - _Depends: 6.5_
  - _Requirements: 1.2, 1.3, 3.1, 3.2, 3.3, 4.6, 5.5, 5.6_
  - _Boundary: ExtensionE2E, ProductionBuild_

- [ ] 6.7 失効復帰と常設navigation終了のE2Eを通す
  - capture中の対象tab更新・閉鎖で一過性面が終了し、安全な理由を示して常設面へ復帰することを確認する。
  - capture中に常設navigationを選択すると一過性面が終了し、選択した常設featureだけが表示されることを確認する。
  - 上流要件4.5を委譲されたproduction E2Eとして終了まで閉じる。
  - _Depends: 6.6_
  - _Requirements: 1.4, 2.5, 3.3, 5.5_
  - _Boundary: ExtensionE2E, TransientSurfaceLifecycle_

- [ ] 6.8 全検証gateを実行し移行完了を確認する
  - lint、typecheck、unit、integration、E2E、boundary、artifact、permissionの全gateをproduction構成で実行する。
  - requirements 1.1〜5.6のtraceabilityと削除対象・受容リスクを再確認し、未検証項目を残さない。
  - 全gateのfresh evidenceを記録し、上流・下流specとsteeringの整合を最終確認する。
  - _Depends: 6.7_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - _Boundary: QualityGates, SpecTraceability_
