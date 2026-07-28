# Implementation Plan

- [x] 1. 一過性表示面を受け入れるshell契約を整える
- [x] 1.1 表示区分と最小ライフサイクル契約を公開する
  - mount、availability、public API、任意のtyped activationを共通baseに置き、`presentation: "persistent"`と型付きnavigationを必須にする常設branch、および`presentation: "transient"`とnavigation不在を必須にする一過性branchをcanonical registration判別共用体として公開する。
  - 既存consumerは`presentation: "persistent"`を明示して移行し、一過性consumerはnavigation propertyを持たず、`isPersistent`が常設branchへ型を絞り込む状態にする。
  - 起動世代、固定対象タブ、未信頼tab IDのbrand変換、起動要求、終了理由、最小の下流ライフサイクルportとgesture registration portをcanonical shell契約として追加する。
  - gesture source、同期emit、cleanup、登録失敗を閉じた型で表し、公開consumerがcontroller、scheduler、store、Chrome型を参照しないことを確認できる。
  - 欠損・0・負数・小数を固定tabへ昇格せず、公開consumer compile fixtureが常設navigation必須・一過性navigation禁止を証明し、lifecycleとgestureの適合consumerがstrict型検査を通る。
  - _Requirements: 1.1, 1.3, 1.6, 2.4, 2.5, 4.1, 4.4_
  - _Boundary: CoreContracts, PublicAPI_

- [x] 1.2 登録区分を検証し不正登録を隔離する
  - explicit presentationとnavigation有無の相関をregistration境界で検証し、未知／欠損presentation、常設navigation欠損、一過性navigation混入をregistryから隔離する。
  - snapshot複製がdiscriminantとbranch固有fieldを保ち、一過性registrationへnavigationを合成しないようにする。
  - 隔離された登録が他の常設featureのavailability、登録順、利用可否へ影響しないようにする。
  - 明示的な常設登録、正常な一過性登録、各branch矛盾を持つ不正登録のcontract testが決定的に通る。
  - _Requirements: 1.1, 1.3, 1.6, 4.4_
  - _Boundary: FeatureRegistry_

- [x] 1.3 常設限定のnavigationと選択規則をshellへ統合する
  - registry snapshotとfeature contribution catalogをbranch-safeな決定順へ合わせ、navigation catalog構築、初期選択、availability fallback、通常選択を常設branchへ絞り込む単一の型述語へ統一する。
  - 一過性featureは登録・主表示可能だがnavigationへ現れず、未起動時は常設featureだけが表示される。
  - 常設／一過性を混在登録してもnavigation metadataを読むconsumerが常設branchだけを受け、常設featureだけがnavigation・初期表示・fallbackの候補になるintegration testを通す。
  - _Requirements: 1.2, 1.4, 1.5, 4.4_
  - _Boundary: ApplicationComposition, SidePanelHost_

- [x] 1.4 (P) 常設面と併存する一過性起動noticeを追加する
  - ready／maintenance stateへ任意noticeを追加し、選択中featureやnavigationから独立したbannerとして安全なtextで描画する。
  - session read成功または有効activation受理だけでnoticeをclearし、global errorへ遷移させない。
  - 媒体障害中も常設featureが表示・操作可能で、日英の安定した再操作案内が見えるDOM testを通す。
  - _Depends: 1.1_
  - _Requirements: 2.7, 3.5, 4.4_
  - _Boundary: TransientSurfaceNotice, ShellPresentation, ShellView, MessageCatalog_

- [x] 2. 一過性surface controllerを実装する
- [x] 2.1 起動世代と単一主表示を管理する
  - commandを直列化し、起動要求の表示区分・availability・世代を検証して、固定tabと直前の常設featureを保持する。
  - 新しい同一tabジェスチャーを別世代として受理し、旧世代callbackを現行stateへ作用させない。
  - 有効要求だけが一過性featureをmountし、snapshot購読からactive／inactive状態を観測できるunit testを通す。
  - _Requirements: 1.4, 2.3, 2.4, 2.6, 3.6, 3.7, 3.10, 4.1_
  - _Boundary: TransientSurfaceController_

- [x] 2.2 正常終了と安全な常設fallbackを実装する
  - navigation、更新・遷移、tab閉鎖の終了理由を受理し、一過性面をunmountして記録した常設featureへ戻す。
  - 戻り先不存在・利用不可時は利用可能な常設featureと理由を提示し、業務永続状態を変更しない。
  - 3終了理由とfallbackで一過性面が消え、同時に一つの常設featureだけが表示されるintegration testを通す。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.10, 4.2_
  - _Boundary: TransientSurfaceController, SidePanelHost_

- [x] 2.3 終了失敗をfail-safe stateへ閉じて再試行可能にする
  - unmountまたは常設復帰の失敗を、実行操作を隠したdismiss-failedとして同じ世代に保持する。
  - dismiss-failed中は常設面と同時表示せず、旧世代callbackを無視して同一世代の終了だけを再試行可能にする。
  - 失敗、再試行成功、stale再試行の各testで永続状態が変更されず単一主表示が維持される。
  - _Depends: 2.2_
  - _Requirements: 3.6, 3.7, 3.8, 3.10, 4.2_
  - _Boundary: TransientSurfaceController_

- [x] 2.4 型付き引き渡しを既存host transitionへ接続する
  - 現行世代の引き渡しだけを一回のtyped activationとして実行し、成功時は戻り先へ復帰せず引き渡し先を保持する。
  - activation失敗時は既存rollbackで一過性面を維持し、旧世代の完了通知はno-opにする。
  - 成功・失敗・staleの各経路で同時に一つのfeatureだけがmountされるintegration testを通す。
  - _Requirements: 1.4, 3.8, 3.9, 3.10, 4.2_
  - _Boundary: TransientSurfaceController, ActivationRouter, SidePanelHost_

- [x] 2.5 late-bound lifecycleをcompositionへ導入する
  - feature contribution生成前にfail-closed proxyを用意し、host構築後・start前にcontrollerへbindする。
  - cleanupではcontroller停止後にunbindし、bind前・unbind後のcallbackがnot-startedとして失敗する。
  - 同じport参照が下流factoryへ注入され、production catalogへテスト専用featureを追加せず起動順と逆順cleanupを検証できる。
  - _Requirements: 1.4, 2.1, 3.10, 4.1, 4.4, 4.5_
  - _Boundary: ApplicationComposition, LateBoundLifecycle_

- [x] 3. 起動要求を順序保証付きsession storeへ保存する
- [x] 3.1 envelopeとstage遷移を境界検証する
  - 起動record、最終sequence、tab別墓標をsession媒体へ保存し、unknown入力をversion／shape／stageで検証する。
  - panelをread／subscribe専用、runtimeをmutation ownerとし、商品値・URL・HTMLを保存しない。
  - 正常record、破損envelope、不正stage遷移がtyped resultになるunit testを通す。
  - _Requirements: 2.2, 2.4, 2.7, 4.1, 4.6_
  - _Boundary: TransientActivationStore_

- [x] 3.2 単一schedulerでsequenceとworker再生成を線形化する
  - 組み込みactionと登録済みfeature gesture、失効、stage前進、watch-readyを単一入口で受信時点にenqueueし、単調sequence順にmutationを直列適用する。
  - worker再生成時はsession envelopeの最大sequenceから次値を復元し、memoryだけを順序根拠にしない。
  - 保留writeを後発commandが追い越さず、再生成後も新sequenceが単調増加するtestを通す。
  - _Requirements: 2.2, 2.6, 3.10, 4.1, 4.2_
  - _Boundary: TransientActivationScheduler, TransientActivationStore_

- [x] 3.3 record不在でも失効を残す墓標規則を実装する
  - tabごとに最新墓標を保持し、墓標より古い後着recordをinvalidated終端へ着地させる。
  - invalidatedをstage前進やactivation許可で上書きせず、新ジェスチャーは大きいsequenceで開始できる。
  - put保留中の失効、失効後のlate put、同一tab再起動を決定的に再現するtestを通す。
  - _Requirements: 2.2, 2.6, 3.1, 3.2, 3.10, 4.1, 4.2_
  - _Boundary: TransientActivationStore_

- [x] 3.4 checkpoint付き墓標上限をfail-closedで実装する
  - 全先行command commit済みのcheckpointでだけ、支配中でない古い墓標を全体128件以内へ剪定する。
  - 支配墓標を保持したまま安全に剪定不能なら強制evictせずcapacity-exceededで新規起動を拒否する。
  - tabごと最新1件、上限、支配墓標保持、破損状態拒否をunit testで観測できる。
  - _Requirements: 2.7, 3.10, 4.1, 4.2_
  - _Boundary: TransientActivationStore, TransientActivationScheduler_

- [x] 4. Chrome runtimeとの配送・監視adapterを構築する
- [x] 4.1 watch-readyをversioned typed transportで配送する
  - panel requestとworker responseをunknownから検証し、authorized／invalidated／typed errorをbooleanへ縮退させない。
  - worker側は自拡張panel senderだけを受理し、top-levelでlistenerを同期登録する。
  - 不正sender、未知version、不正payload、store unavailable、capacity exceededを安定codeで返すruntime testを通す。
  - _Requirements: 2.2, 2.7, 4.1, 4.3_
  - _Boundary: TransientActivationPort, RuntimeTransport_

- [x] 4.2 (P) URL非依存のtab寿命監視を追加する
  - 固定tabの更新開始とcloseだけを終了eventへ変換し、他tab eventを無視する。
  - callbackはactivationIdを保持して最大1回通知し、解除後eventを伝播させない。
  - URL参照や追加権限なしでnavigation／reload／closeを再現するadapter testを通す。
  - _Depends: 2.1_
  - _Requirements: 3.1, 3.2, 3.10, 4.1, 4.2_
  - _Boundary: TabLifecycleRules, TabLifecycleAdapter_

- [x] 4.3 (P) storage非依存の起動失敗signalを追加する
  - durable put失敗時にglobal action badgeと安定titleを設定し、通常titleの復元値をmanifestから解決する。
  - 次のdurable put成功後だけclearし、read成功、notice表示、panel open、worker再生成ではclearしない。
  - publish／clear失敗を安定codeで診断し、後発成功時にclearを再試行するtestを通す。
  - _Depends: 3.2_
  - _Requirements: 2.7, 4.1, 4.2_
  - _Boundary: ActivationFailureSignal_

- [x] 4.4 workerのgesture・store・失効listenerを単一schedulerへ統合する
  - generic gesture ingressとtab lifecycle eventの受信時にsequenceを同期割当してenqueueし、その受信順を線形化点にする。
  - side panel openは登録済みgesture sourceの同じevent callback内でstore完了を待たず同期開始し、top-level tab listenerはrecord有無に関係なく失効をenqueueする。
  - failure signalのpublish／clearも同じscheduler順序へ載せ、panel閉／開、put失敗、worker再生成のruntime integration testを通す。
  - _Depends: 3.4, 4.1, 4.2, 4.3_
  - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 3.1, 3.2, 4.3, 4.4_
  - _Boundary: ServiceWorkerComposition, TransientActivationScheduler_

- [x] 4.5 (P) panel watch-ready authorization adapterを実装する
  - recordをread／subscribeしてもmountせず、固定tab watchを設置した後だけtyped authorizationを要求する。
  - authorized、invalidated、typed errorを保持して返し、invalidatedまたはerror時はcontrollerを起動しない。
  - panel購読とtab watchを一度だけ解除でき、watch-ready前失効を拒否するadapter testを通す。
  - _Depends: 3.4, 4.1, 4.2_
  - _Requirements: 2.2, 2.3, 2.4, 2.7, 3.1, 3.2, 4.3_
  - _Boundary: PanelActivationAdapter, TransientActivationPort, TabLifecyclePort_

- [x] 4.6 authorizationをcontroller起動とstage前進へ統合する
  - workerの同一schedulerで先行mutationを適用してrecordと墓標を最終照合し、authorized時だけcontrollerへ起動要求を渡す。
  - feature mount成功後だけrecordをactivatedへ進め、mount前失効またはinvalidated応答では一過性面を立てない。
  - watch-ready前後のnavigation／close、mount中失効、stage前進失敗を再現し、監視空白がないintegration testを通す。
  - _Depends: 2.1, 4.4, 4.5_
  - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.7, 3.1, 3.2, 3.10, 4.2, 4.3_
  - _Boundary: ProductionMonitoringIntegration_

- [x] 4.7 feature-owned gesture sourceをcanonical ingressへ登録する
  - source ID、surface ID、同期start／emit、対称cleanupを検証し、invalid、duplicate、source start失敗、runtime未開始を閉じた登録errorへ変換する。
  - `emit(TargetTabId)`を既存のactivation ID・sequence割当、scheduler、session store、failure signal、同一callback内panel openへ一度だけ接続し、sourceへwriterやsequence allocatorを公開しない。
  - 組み込みactionも同じregistrarへ移し、全sourceを解除してからschedulerを停止して、解除後callbackをno-opにする。
  - action sourceと架空context-menu sourceのcontract testで同じactivation recordとwatch-ready経路が生成され、別store writerが存在しないことを完了条件とする。
  - _Depends: 3.2, 4.4_
  - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 4.1, 4.3, 4.4_
  - _Boundary: TransientGestureRegistration, CanonicalGestureIngress, ActionGestureSource_

- [x] 5. shellとruntimeをproduction compositionへ統合する
- [x] 5.1 shellとcontrollerの起動停止をcompositionへ統合する
  - host start前にlate-bound lifecycleをcontrollerへbindし、host start成功後だけcontrollerをstartする。
  - cleanupはcontrollerをstopしてからproxyをunbindし、部分起動失敗でも逆順にresourceを解放する。
  - start失敗、正常stop、二重stop、再startでcontrollerとproxyが一貫した状態になるintegration testを通す。
  - _Depends: 2.5_
  - _Requirements: 1.4, 2.1, 3.6, 3.8, 3.10, 4.1, 4.4_
  - _Boundary: ApplicationComposition, TransientSurfaceController_

- [x] 5.2 runtimeとpanelの購読をproductionへ統合する
  - store read／subscribe、panel watch、watch-ready、controller requestと登録済みgesture sourcesをproduction side panel／worker起動へ接続する。
  - 各resourceの取得済み範囲だけを逆順cleanupし、gesture sourceをscheduler停止前に解除して、部分失敗後の再startでも購読・listenerを一度だけ生成する。
  - store障害、watch失敗、authorization失敗、正常再startで常設featureへ安全に退避するintegration testを通す。
  - _Depends: 4.6, 4.7, 5.1_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 3.1, 3.2, 3.6, 3.8, 3.10, 4.1, 4.3, 4.4_
  - _Boundary: RuntimeComposition, PanelIntegration_

- [x] 5.3 公開境界とproduction artifactの制約を固定する
  - 下流へはregistration判別共用体とそのbranch型、`isPersistent`型述語、最小lifecycle port、gesture registration portと必要型だけを公開し、controller、proxy bind、gesture registrar concrete、Chrome message、store concreteを公開しない。
  - session storage到達点をruntime storeだけへ限定し、worker bundleをDOM／React非依存に保つ境界検査を更新する。
  - 4権限固定、実データfixture不使用、production catalogへのsynthetic feature非混入を機械gateで観測できる。
  - _Requirements: 3.7, 4.4, 4.5, 4.6_
  - _Boundary: PublicAPI, StorageAccessGuard, ArtifactValidation_

- [ ] 6. 決定的検証と下流handoff seamを完成させる
- [x] 6.1 shell controllerと常設feature非回帰を検証する
  - explicit persistent producerへの移行、常設navigation欠損／一過性navigation混入の型・runtime拒否、不正隔離、navigation除外、初期選択、fallback、単一mountをpublic consumer／contract／integration testで覆う。
  - controllerの新世代、3終了理由、dismiss失敗、conclude成功・rollback、stale callbackをin-memory fixtureで覆う。
  - 全shell検証で既存persistent featureのnavigation・availability・typed activationが回帰しない。
  - _Depends: 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2, 4.4_
  - _Boundary: ShellContractTests, ControllerIntegrationTests_

- [x] 6.2 (P) runtimeの競合・障害・再生成を検証する
  - put保留中失効、watch-ready前後失効、worker再生成、墓標上限をin-memory Chrome fixtureで再現する。
  - put失敗signal、clear競合、read失敗notice、sender／message拒否を再現し、常設面が維持されることを確認する。
  - actionとfeature-owned sourceのpanel closed／open双方で同じ要求が一度だけ許可または拒否され、duplicate登録、cleanup、worker再生成を含む全runtime testが決定的に通る。
  - _Depends: 5.2_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.10, 4.1, 4.2, 4.3_
  - _Boundary: RuntimeIntegrationTests, StoreRaceTests_

- [x] 6.3 下流production E2Eへ引き渡すcontract fixtureを整える
  - 実featureをproductionへ追加せず、in-memory transient registrationで起動から終了・引き渡しまでを検証する。
  - 下流consumerが同じlifecycle port参照を受け取れ、別consumerがfeature-owned gesture sourceを公開registration portへ登録できるcontract fixtureを追加する。
  - product-capture E2Eがshell 4.5を閉じ、source-price-refreshがcontext menu sourceを同じschedulerへ接続できるseamを固定する。
  - production buildへsynthetic featureが混入せず、public consumer contract testが通る。
  - _Depends: 5.3, 6.1, 6.2_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - _Boundary: ContractFixtures_

- [x] 6.4 最終validation gateを通す
  - typecheck、public consumer、lint、unit／integration testを実行して全件成功させる。
  - boundary、fixture、artifact、final buildの機械検査を実行し、権限・公開境界・synthetic資産の違反がないことを確認する。
  - 本spec所有の全gateが成功し、`source-price-refresh`のgesture consumer contractを再検証済み、production E2Eだけが承認済み下流specの責務として残る状態にする。
  - _Depends: 6.3_
  - _Requirements: 4.4, 4.5, 4.6_
  - _Boundary: ValidationGates_

- [x] 6.5 一過性registrationのmount前起動受理契約を公開する
  - 一過性registrationに起動要求の検証・受理と冪等な解放leaseを必須化し、cross-feature引き渡し契約とは分離して公開する。
  - registryは専用adapter欠損を不正登録として隔離し、snapshotでも一過性branchのadapterを保持する。
  - public consumerとregistry contract testで、正しいregistrationがstrict型検査を通り、adapter欠損・branch矛盾が他featureへ影響せず拒否される。
  - _Depends: 6.4_
  - _Requirements: 1.1, 1.6, 2.8, 2.9, 2.10, 4.1, 4.4_
  - _Boundary: TransientActivationContract, FeatureRegistry_

- [x] 6.6 起動受理とmountをshell transactionへ統合する
  - controllerは起動要求全体をhostへ渡し、hostは対象・区分・availability・要求を検証して受理に成功するまで現在のfeatureをunmountしない。
  - 受理後のstale化、current unmount失敗、target mount失敗、通常終了でleaseを最大一回解放し、host成功後だけcontrollerがactive世代を公開する。
  - controller／host integration testで配送順、失敗時の常設維持、単一mount、lease解放一回性が決定的に通る。
  - _Depends: 6.5_
  - _Requirements: 1.4, 2.1, 2.4, 2.6, 2.8, 2.9, 2.10, 3.6, 3.10, 4.1, 4.4_
  - _Boundary: TransientSurfaceController, SidePanelHost_

- [x] 6.7 product-capture registrationをmount前起動配送へ適合させる
  - 実registration adapterが起動世代と固定tabを検証・受理してleaseを返し、初回mount時点で既存の実行状態を利用できるようにする。
  - 業務状態・UI・抽出処理は変更せず、React mount handleと起動状態の解放責務だけをhost所有leaseへ適合させる。
  - production consumer fixtureで未activation mountによる`feature-mount-failed`が起きず、検証・受理失敗時は一過性面を表示せず常設featureを維持する。
  - _Depends: 6.6_
  - _Requirements: 2.1, 2.3, 2.4, 2.8, 2.9, 2.10, 3.6, 3.10, 4.1, 4.5, 4.6_
  - _Boundary: ProductCaptureRegistration, ProductionIntegration_

- [x] 6.8 修復後の本spec validation gateを再実行する
  - typecheck、public consumer、lint、unit／integration、boundary、fixture、artifact、final buildを実行する。
  - 全gateが成功し、production catalog／artifactへsynthetic featureが混入しないことを機械検査で確認する。
  - _Depends: 6.7_
  - _Requirements: 2.8, 2.9, 2.10, 4.4, 4.5, 4.6_
  - _Boundary: ValidationGates_

- [ ] 6.9 下流production起動経路を再検証する
  - `product-capture-transient-migration` 6.6／6.7の検証を再実行し、production buildで起動状態受理後に初回mountされることを確認する。
  - 起動から終了まで`feature-mount-failed`や旧世代状態残留がなく、下流のproduction gateが成功することを完了条件とする。
  - _Blocked: 下流`product-capture-transient-migration` 6.6／6.7のdurable activation・失効復帰production E2Eが未実装で、既存product-capture／英語UI E2Eも移行前の常設navigation経路を待ってtimeoutする。下流specでE2Eを移行してproduction gateを成功させた後に再検証する必要がある。_
  - _Depends: 6.8_
  - _Requirements: 2.1, 2.8, 2.9, 2.10, 4.5_
  - _Boundary: CrossSpecProductionValidation_

## Implementation Notes

- final validation再監査で、requestのavailability／表示失敗時にpending activationを解放し、dismiss失敗のrecoverable error中はfeature slotを隠して実DOMのretry操作だけを提示する回帰を追加した。
- validation remediation retry 2で、start前requestがaccepted activationを残すghost claimを除去した。stale conclude失敗後のnavigation／新世代、stop／restart時のclaim reset、重複dismissのsingle restoreを決定的controller testで固定した。
- validation remediation retryで`conclude`受付時のactivation単位single-owner claimを追加し、同世代の重複handoffを抑止した。最新handoffの失敗時だけclaimを解放し、rollbackされたtransientから再試行できる。
- final validation remediationで常設navigationをcontroller-aware commandへ統合し、closing gate、target/reason保持retry、application-shell境界scanを追加した。
- watch-readyは`received`まで進め、`activated`への前進はcontroller mount成功後に限定する。panel側のasync処理はstart epochを各await後にも照合し、stop／restart後の旧世代完了をno-opにする。
- gesture sourceは同期registrarからcanonical ingressへ接続し、sourceにはstore writer、sequence allocator、panel openerを公開しない。
- panelはsession storeをread／subscribe専用で利用し、`activated`前進はtyped runtime messageでworkerの単一schedulerへ委譲する。session read障害noticeは成功通知までcompositionのready／maintenance表示へ再投影する。
- worker cleanupは個別source／listenerの失敗を隔離して全resourceを解除し、schedulerをcloseして受理済みtailをdrainする。停止後commandは拒否し、旧compositionのsession writeを残さない。
