# 実装計画

- [x] 1. Shell基盤と型付き契約を整備する
- [x] 1.1 TypeScript、Reactとruntime test基盤を構成する
  - React 19系、React DOM、対応する型定義、JSX変換、strictな型検査とDOM対応test環境を設定し、対象Node/Chromeとの互換性を検証する
  - production conditionでReactをbundleへ同梱し、CDN、runtime JSX変換、dynamic evaluationを必要としない構成にする
  - 完了時、最小React componentの型検査、production build、baseline DOM testが成功する
  - _Requirements: 6.4_
  - _Boundary: TestInfrastructure_

- [x] 1.2 Manifest V3のside panel runtime fixtureを構成する
  - Chrome 116以降を対象に、同梱scriptだけを読み込むside panel documentとbootstrap入口を作る
  - inline JavaScript、remote script、dynamic evaluationを許可しないfixture検査を追加する
  - 完了時、空のshell fixtureが未パッケージ拡張として読み込め、side panel documentを開始できる
  - _Requirements: 6.1, 6.3_
  - _Boundary: RuntimeAdapters_

- [x] 1.3 Feature registrationと共通shell stateの契約を定義する
  - 当初の常設featureについて、feature識別子、navigation metadata、availability、mount/unmount、operation policy、型付きerrorを表現する。常設／一過性の判別共用体への移行はtask 6.1で扱う
  - featureが共有service worker入口を編集せずaction handler等を提供できるworker registration契約を表現する
  - foundation公開の`MaintenanceSnapshot`と`MaintenanceSnapshotSource`をcanonical契約として利用し、shell内で同等portを再定義しない
  - maintenanceの表示用stateとroot public contract合成の型制約を表現する
  - 完了時、模擬featureとfoundation公開portが`any`や重複maintenance契約なしで型検査できる
  - _Requirements: 2.1, 2.5, 3.2, 5.6_
  - _Boundary: CoreContracts_

- [x] 1.4 下流feature向けcontract test kitを作る
  - 登録、React rootのmount/unmount、availability通知、購読解除の共通適合testを提供する
  - worker registrationの一意性、登録解除、途中失敗cleanupを同じtest kitで検証できるようにする
  - feature固有データをshellへ渡さなくてもfixtureを検証できるようにする
  - 完了時、適合fixtureは成功し、不正fixtureは契約違反箇所を決定的に報告する
  - _Requirements: 2.1, 2.3, 2.5, 6.4_
  - _Boundary: ContractTestKit_

- [x] 2. Core registryとmaintenance制御を実装する
- [x] 2.1 (P) Feature registryを実装する
  - 登録値を検証し、一意なfeature識別子と決定的なnavigation順序を維持する
  - 重複または不正なfeatureを隔離し、正常な登録と購読を継続する
  - availability変更をsnapshotと購読者へ同期し、解除を冪等にする
  - 完了時、重複・不正登録の拒否、順序、状態変更をunit testで観測できる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: FeatureRegistry_
  - _Depends: 1.3_

- [x] 2.2 (P) 世代付きmaintenance projectionを実装する
  - 完了済み`local-data-foundation` task 5.5の公開contract testとconsumer型検査を確認し、そのread-only portだけを利用する
  - foundationのread-only通知から現在のgeneration・revision cursorとactive状態を投影する
  - cursorを辞書順で比較し、古い世代・同一世代の古いrevision・重複通知を無視して状態後退を防ぐ
  - shell側ではlease取得・更新・解放を一切行わない
  - 完了時、世代前進、現行世代終了、stale通知拒否をunit testで確認できる
  - _Requirements: 5.1, 5.4, 5.5, 5.6_
  - _Boundary: MaintenanceProjection_
  - _Depends: 1.3_

- [x] 2.3 (P) Mutation gateを実装する
  - readとmutationの操作分類をmaintenance snapshotへ写像する
  - 完了時、active中はmutationだけを拒否し、inactive中とread操作を許可することをunit testで確認できる
  - _Requirements: 5.2, 5.3_
  - _Boundary: MutationGate_
  - _Depends: 1.3_

- [x] 2.4 (P) 共通shell React viewとerror boundaryを実装する
  - loading、error、maintenance、empty state、navigationをReact function componentとCSSで描画する
  - 外部由来messageを通常のJSX childとして扱い、`dangerouslySetInnerHTML`、`innerHTML`、inline handlerを使用しない
  - featureのrender failureを安全なfallbackへ隔離し、他featureのnavigationを維持する
  - 完了時、各共通状態、安全なテキスト表示、render failure隔離を利用者視点のDOM testで観測できる
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1_
  - _Boundary: ShellView, ShellErrorBoundary_
  - _Depends: 1.1, 1.3_

- [x] 2.5 (P) React shell root adapterを実装する
  - shell host containerへReact rootを生成し、shell stateの購読と描画を接続する
  - 停止、起動失敗、再mount時に購読解除と`root.unmount()`を一度だけ実行できる冪等なcleanupを提供する
  - 完了時、mount、状態更新、停止、再mountのroot lifecycle testですべてのresource解放を観測できる
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 4.1, 6.4_
  - _Boundary: ReactShellRoot_
  - _Depends: 1.1, 1.3_

- [x] 3. Hostとcompositionを統合する
- [x] 3.1 Side panel hostのnavigationとfeature lifecycleを実装する
  - 利用可能featureを表示し、選択変更時に旧viewをunmountしてから新viewをmountする
  - 同時に一つだけを表示し、選択featureが利用不可になった場合は理由と安全な遷移先を示す
  - mount失敗をfeature単位で隔離し、再試行と他featureへの移動を維持する
  - 公開`FeatureMountContext`とmount/unmount契約を変えず、feature側のReact root lifecycleを調停する
  - 完了時、切替順序、単一表示、利用不可遷移、障害分離がhost integration testで確認できる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.4, 4.2, 4.3_
  - _Boundary: SidePanelHost_
  - _Depends: 2.1, 2.3, 2.4, 2.5_

- [x] 3.2 Public API registryを実装する
  - feature単位の公開契約をreadonlyなroot契約としてまとめる
  - 重複keyまたは不正な公開契約を型検査または明示的な合成errorで拒否する
  - 完了時、模擬featureの公開契約が型を保ったroot contractとして取得できる
  - _Requirements: 3.2, 3.4_
  - _Boundary: PublicApiRegistry_
  - _Depends: 1.3_

- [x] 3.3 Maintenance状態をhost全体へ統合する
  - projectionの変更を共通表示、operation policy、現在mount中のfeatureへ伝える
  - maintenance中もread-only navigationを保ち、終了時は現行世代に限ってmutation controlを復帰する
  - 完了時、遅延した古い通知を含む統合scenarioで全featureの操作可否が一貫する
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: ApplicationShellIntegration_
  - _Depends: 2.2, 2.3, 2.4, 2.5, 3.1_

- [x] 3.4 Composition rootを実装する
  - foundation adapter、feature registry、worker registration、maintenance統合、host、public APIを一回だけ合成する
  - 必須依存の初期化失敗時はfeatureをmountせず、途中生成した購読とviewを逆順に解放する
  - 完了時、二重起動を防ぎ、root API、host開始、startup failure cleanupをintegration testで観測できる
  - _Requirements: 3.1, 3.3, 3.4_
  - _Boundary: CompositionRoot_
  - _Depends: 3.2, 3.3_

- [x] 4. Runtime入口とend-to-end境界を検証する
- [x] 4.1 Shell presentationと専用feature表示領域を統合する
  - shell state、navigation、再試行操作をReact rootへ接続し、shell所有container内にfeature専用の安定したmount領域を提供する
  - shellとfeatureのcontainerを別要素として検証し、feature切替時もshell navigationと共通状態を維持する
  - 空feature catalogではnavigationなしのempty stateを表示し、停止時は購読とshell rootを冪等に解放する
  - 完了時、state更新、navigation操作、empty state、専用feature領域、停止cleanupをDOM testで観測できる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_
  - _Boundary: ShellPresentation_
  - _Depends: 2.5, 3.1, 3.3_

- [x] 4.2 Feature contribution catalogを実装する
  - UI registration、public contract、worker registrationを一つのreadonly catalogへ集約し、登録済みcontributionだけを決定的な順序で提供する
  - 下流feature未実装時の空catalogを正常状態として扱い、placeholder featureを要求しない
  - 下流feature内部へのdeep importや共有runtime入口への自己登録を必要としない参加境界を維持する
  - 完了時、空catalogと複数の模擬contributionが型を保ったside panel・worker・public API入力として取得できる
  - _Requirements: 2.1, 2.3, 2.5, 3.2, 3.4_
  - _Boundary: FeatureContributionCatalog_
  - _Depends: 1.3, 3.2_

- [x] 4.3 Worker contributionを一度だけcompositionする
  - catalogのworker項目だけを共有workerへ登録し、DOM、HTMLElement、Reactへの依存をworker lifecycleへ持ち込まない
  - feature識別子の一意性を検証し、途中失敗時は取得済みhandlerを逆順かつ全件best-effortで解除する
  - 停止と再停止で重複handlerや二重解除を生じない冪等なcleanupを提供する
  - 完了時、複数登録、重複拒否、途中失敗rollback、停止cleanupをworker contract testで決定的に観測できる
  - _Requirements: 2.1, 2.3, 3.1, 3.4, 4.3, 6.4_
  - _Boundary: WorkerComposition_
  - _Depends: 4.2_

- [x] 4.4 Production application compositionを完成する
  - foundation公開initializer、registry、presentation、feature host、worker contributionを設計順序で一度だけ合成する
  - canonical maintenance sourceだけを利用し、inactive stub、Storage直接監視、foundation内部へのdeep importへfallbackしない
  - 空catalogでは正常にempty shellを開始し、途中失敗と停止ではworker、feature、maintenance購読、presentation、foundationを逆依存順で全件best-effortに解放する
  - foundation初期化失敗時はfeatureをmountせず、失敗表示に必要なpresentationだけを安全に開始して共通startup errorを提示する
  - 完了時、正常起動、空catalog、初期化失敗、途中rollback、二重起動、停止cleanupをproduction-shaped integration testで観測できる
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.3, 6.4_
  - _Boundary: ProductionApplicationComposition_
  - _Depends: 3.4, 4.1, 4.3_

- [x] 4.5 Side panel・service worker・root公開入口を接続する
  - side panel入口をDOM host解決とproduction factoryのbootstrapだけに限定し、具体featureやfoundation内部を直接組み立てない
  - service worker入口はcatalogのworker contributionだけをcompositionし、root公開入口はcatalogから推論したreadonly APIだけを提供する
  - dummy maintenance source、noop state observer、下流feature deep importを共有入口から除去する
  - 完了時、空catalogのproduction shellとworkerが起動し、後続featureが共有入口を変更せずcatalog経由で参加できる
  - _Requirements: 3.1, 3.2, 3.4, 6.1, 6.3_
  - _Boundary: RuntimeAdapters, RootPublicApi_
  - _Depends: 4.4_

- [x] 4.6 User gestureを保つside panel open adapterを実装する
  - Side Panel API呼出しを有効なユーザー操作handler内で同期開始し、host準備との責務を分離する
  - API拒否時は安全な診断結果を返し、無関係なfeature stateを変更しない
  - 完了時、adapter spyがgesture handler内の呼出し順序と失敗分離を確認する
  - _Requirements: 6.2_
  - _Boundary: RuntimeAdapters_

- [x] 4.7 Production runtime統合回帰を完成する
  - 空catalogと複数の模擬featureを同じproduction-shaped fixtureで起動し、shell rootとfeature mount領域が別DOM要素であることを検証する
  - navigation、unmount後の切替、availability変化、mount失敗、worker登録、maintenance開始・終了・stale通知を一連のscenarioで検証する
  - 外部由来文字列の安全なtext表示、他featureの継続、停止時の全resource cleanupを確認する
  - 完了時、UI、worker、maintenance、failure、cleanupを横断するruntime suiteが決定的に成功する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.4_
  - _Boundary: ApplicationShellIntegrationTests_
  - _Depends: 4.5, 4.6_

- [x] 4.8 生成物・security・import境界の最終gateを完成する
  - production bundleへReactとReact DOMが同梱され、remote code、inline JavaScript、dynamic evaluation、runtime JSX変換、危険なHTML描画APIがないことを検査する
  - worker bundleにDOM・React依存がなく、shellがStorage API、foundation maintenance契約の再定義、foundation内部や下流feature内部へのdeep importを持たないことを検査する
  - dummy maintenance source、noop shell state observer、共有入口への下流feature自己登録をartifactとsourceの両方で拒否する
  - 完了時、typecheck、test、build、CSP・artifact・boundary scanが連続成功し、違反時に所有境界を特定できる
  - _Requirements: 3.4, 4.4, 5.6, 6.1, 6.3, 6.4_
  - _Boundary: ApplicationShellArtifactValidation_
  - _Depends: 4.7_

- [x] 4.9 Chrome message targetとfoundation caller分類adapterを実装する
  - `chrome.runtime.onMessage`をfoundation公開の`WorkerMessageTarget`へ変換し、messageとfail-closedに分類したcallerを非同期handlerへ渡す
  - 既知foundation command kindだけをhandlerへroutingし、catalog actionを含む非foundation messageはhandler・`sendResponse`を呼ばず、応答channelを保持しない
  - handler完了Resultを`sendResponse`へ一度だけ返してlistenerから`true`を返し、rejectionを安定失敗へ正規化し、解除を冪等にする
  - runtime id・extension URL・tabを検査し、同一extension pageだけを`trusted-extension`、同一extension idでtabありを`content-script`、欠落・getter/URL例外・外部senderを`web-page`へ分類する
  - 完了時、trusted/content/web分類、async応答、handler失敗、listener解除、catalog actionとの応答非競合をChrome adapter spyが決定的に検証する
  - _Depends: local-data-foundation 6.8_
  - _Requirements: 3.1, 3.3, 6.1, 6.3, 6.4_
  - _Boundary: RuntimeAdapters_

- [x] 4.10 Foundation worker registrationをproduction service workerへ接続する
  - service worker contextでfoundationの引数なしproduction factoryを初期化し、非同期foundation registrationと同期catalog registrationsを異なる契約のまま順序どおり合成する
  - 各typed failureをworker startup failureへ正規化し、catalog登録失敗と停止でcatalog、foundation handler、foundation handleを逆順・best-effort・冪等に解放する
  - concurrent startをsingle-flight化し、遅延したfoundation registration中のstopで後続catalogを開始せず、完了済みresourceを解放する
  - 完了時、実service worker入口でfoundation query/mutation handlerが登録され、空catalog、途中rollback、start/stop競合、二重停止、worker bundleのDOM/React/Storage非依存がproduction-shaped runtime testとartifact gateで成功する
  - _Depends: 4.9, local-data-foundation 6.8_
  - _Requirements: 3.1, 3.3, 3.4, 6.1, 6.3, 6.4_
  - _Boundary: ProductionWorkerComposition, RuntimeAdapters_

- [x] 5. Feature間の型付きactivationを追加する
- [x] 5.1 Activation契約とroutingを実装する
  - feature ID、target、未信頼payloadを持つ汎用intentと、対象featureが検証・適用するregistration契約を追加する
  - 未登録、利用不可、未知target、不正payloadを表示変更前に判別し、feature固有payloadをshellが解釈しない境界を維持する
  - 完了時、適合する模擬featureだけが検証済みactivationを一度受け取り、不正intentは現在表示を変えずtyped failureになる
  - _Requirements: 2.1, 2.5, 7.1, 7.3, 7.5_
  - _Boundary: CoreContracts, ActivationRouter_

- [x] 5.2 Activationをhost lifecycleへ統合する
  - 対象featureをmountしてからactivationを一度配送し、既に表示中なら不要なunmountを行わない
  - cross-feature activation前に入力元のopaque state snapshotを取得し、target mountまたはactivation適用失敗時は新規resourceを完全に解放してsnapshot付きで入力元を復元する
  - target cleanup失敗時はtarget handleを保持して入力元をmountせず、epoch・停止・availabilityによりstale化したmountもcleanup後にのみrollbackする
  - 完了時、別feature遷移、同一feature再activation、mount失敗、適用失敗、source snapshot拒否、target cleanup失敗、mount中availability変更をhost testで決定的に観測できる
  - _Depends: 5.1_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_
  - _Boundary: SidePanelHost_

- [x] 5.3 Activation contract test kitとproduction-shaped統合回帰を追加する
  - 下流featureのvalidator、適用回数、cleanup、状態回復を共通fixtureで検証できるようにする
  - navigation、maintenance、availability、停止とactivationを同じproduction-shaped scenarioで検証する
  - 完了時、typecheck、contract test、runtime integration、artifact boundary scanがactivation追加後も連続成功する
  - _Depends: 5.1, 5.2_
  - _Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 7.5_
  - _Boundary: ContractTestKit, ApplicationShellIntegrationTests_

- [x] 4.11 実装済みfeatureをproduction compositionへ接続する
  - contributionをfactory化し、foundationの絞り込みdata portと遅延bindしたshell navigatorを`FeatureCompositionContext`として注入する。
  - side panel専用contribution moduleを分離し、service worker entryがそのmodule graphへ到達しないこと、worker bundleがDOM/React非依存のままであることをartifact gateで確認する。
  - `src/index.ts`を`ApplicationApi`型と`composeApplicationApi(context)`へ置き換え、実featureの公開契約がroot入口の型から到達できることを検証する。
  - feature CSSをside panel bundleへ組み込み、`side-panel.html`から参照する。
  - 完了時、production側で候補管理のnavigation表示、画面到達、公開APIの合成、worker bundle境界がproduction-shaped testとE2Eで観測できる。
  - _Depends: 4.5, local-data-foundation 6.11_
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 6.1, 6.3, 6.4_
  - _Boundary: FeatureContributionCatalog, ProductionApplicationComposition, RootPublicApi_

- [x] 4.12 Mutation可否の変更をmount中のfeatureへ通知する
  - `OperationPolicy`へ冪等な`subscribe`を追加し、`MutationGate`がprojection購読を内部に隠して可否が実際に変化したときだけ通知する。
  - 可否が変わらない通知（同一generationのrevision前進、stale拒否）を購読者へ伝播させない。
  - 最初の購読でprojectionへ接続し、最後の解除で切断し、二重解除を安全にする。
  - contract test kitへ、mount中のgate遷移が購読者へ一度だけ届きunmountで解除されることの適合testを追加する。
  - 完了時、maintenance開始・終了がfeatureの再mountなしに購読者へ届くことをshell testで観測できる。
  - _Depends: 2.2, 2.3, 3.3_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7_
  - _Boundary: MutationGate, CoreContracts, ContractTestKit_

- [x] 6. 一過性featureを既存shell契約へ統合する
- [x] 6.1 常設／一過性の登録区分と選択規則を受け入れ検証する
  - `ApplicationFeatureRegistration`を、`presentation: "persistent"`と型付きnavigationを必須にする常設branch、および`presentation: "transient"`とnavigation不在を必須にする一過性branchの判別共用体として公開する。共通baseのmount、availability、public API、任意のtyped activationは維持する。
  - registryのunknown入力検証、snapshot複製、contribution catalog、navigation catalog生成を同じ相関へ合わせ、常設navigation欠損、一過性navigation混入、未知／欠損presentationを隔離する。既存registration producerは常設／一過性を明示して移行する。
  - `isPersistent`を常設branchへ絞り込む型述語として、navigation、通常選択、初期選択、availability fallbackの単一判定にし、一過性featureはtyped activationまたは上流controllerからだけ表示する。
  - 完了時、public consumerのcompile fixtureが常設navigation必須・一過性navigation禁止を証明し、persistent／transient混在fixtureで一過性featureがnavigationとfallbackへ現れず、同じ主表示領域へ一つだけmountされることを観測できる。
  - _Depends: transient-feature-surface 1.2, transient-feature-surface 1.3_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - _Boundary: CoreContracts, FeatureRegistry, FeatureContributionCatalog, ApplicationComposition, SidePanelHost, PublicConsumerContracts_

- [x] 6.2 (P) 一過性noticeの常設面との安全な併存を検証する
  - `transient-feature-surface`がready／maintenance状態へ追加する一過性noticeを、navigationとfeature slotから独立したbannerとしてshell受け入れ回帰へ固定する
  - noticeの外部由来文字列をHTMLとして解釈せず、notice障害時も選択中の常設featureとその操作を維持する
  - 完了時、危険な文字列を含むnoticeがテキストだけで表示され、常設featureのmount identityが変化しないDOM testが成功する
  - _Depends: transient-feature-surface 1.4_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: ShellView, ShellPresentation_

- [x] 6.3 一過性featureのtyped activationと引き渡しを既存rollbackで受け入れ検証する
  - 上流変更後、navigationを持たない一過性featureへの有効なactivationが一度だけ配送され、同一feature再activationでは不要なunmountがないことをcontract testへ固定する
  - 一過性featureから常設featureへの引き渡し成功で引き渡し先だけを保持し、検証・mount・適用・cleanup失敗では既存の状態復元と単一表示保証を維持することを確認する
  - 完了時、成功・失敗・stale completionのcontract testで二重表示や二重配送が発生しないことを観測できる
  - _Depends: 6.1, transient-feature-surface 2.4_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  - _Boundary: ActivationRouter, SidePanelHost_

- [x] 7. Settingsを常設shell表示へ統合する
- [x] 7.1 header撤去と状態別settings回復表示を受け入れ検証する
  - `settings-screen`による変更後、ready、maintenance、feature-local failureでpersistent navigationが維持されsettingsへ到達できることをshell DOM回帰へ固定する
  - loadingとglobal startup errorで操作不能な言語controlがなく、「設定 / Settings」と利用可能なretryが同じstatusへ提示されることを確認する
  - 完了時、全shell状態のDOM testでheader selectが存在せず、navigation利用可否に応じた到達または二言語案内が一意に表示される
  - _Depends: settings-screen 1.2_
  - _Requirements: 4.6, 4.7, 8.1, 8.2, 8.3_
  - _Boundary: ShellView, ReactShellRoot_

- [x] 7.2 Settings contributionと表示言語追随のproduction compositionを受け入れ検証する
  - `settings-screen`が合成するsettingsを常設featureとしてnavigation、初期選択、fallbackへ一度だけ含み、独立backup navigationと一過性product-captureを常設集合へ含めないことを確認する
  - 言語変更時はnavigation labelと状態文言を同じ言語へ更新し、mount中のsettings feature rootを再mountしない
  - 完了時、production-shaped catalogとroot API snapshotでsettingsが一意に存在し、backup独立entryがなく、言語変更前後でsettings mount identityが保持される
  - _Depends: 6.1, 7.1, settings-screen 3.2_
  - _Requirements: 1.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 8.1, 8.2, 8.4_
  - _Boundary: ApplicationComposition, SidePanelFeatureContributions, ReactShellRoot_

- [x] 8. 境界とproduction回帰を完成する
- [x] 8.1 (P) UI contributionとworker-safe catalogの分離を固定する
  - settingsと一過性viewをside panel専用graphへ閉じ、service worker catalogにはworker registrationとworker-safe metadataだけを載せる
  - source-price-refreshのfeature-owned gesture sourceが上流登録portへ接続できる一方、worker bundleからDOM、React、feature UIへ到達できないことを境界検査する
  - 完了時、public consumer型検査とproduction worker bundle検査が成功し、UI moduleの混入を意図的fixtureで拒否できる
  - _Depends: transient-feature-surface 4.7_
  - _Requirements: 3.6, 6.1, 6.3, 6.4_
  - _Boundary: ProductionWorkerComposition, FeatureContributionCatalog_

- [x] 8.2 Shellの状態・navigation・activation回帰を統合検証する
  - persistent／transient混在、settings fallback、safe-text notice、maintenance、feature failure、typed handoffの契約とcleanup順をproduction-shaped fixtureで覆う
  - Chrome 116以降相当で有効なgesture文脈、side panel bootstrap、settings到達、一過性面終了後の常設復帰を表示文言非依存で確認する
  - 完了時、関連unit／contract／DOM／runtime／E2Eと公開境界・型・build gateがすべて成功し、実サイト由来fixtureを必要としない
  - _Depends: 6.2, 6.3, 7.2, 8.1, settings-screen 4.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4_
  - _Boundary: ContractTestKit, RuntimeAdapters, ShellIntegration_

- [ ] 9. 回復必須状態と操作分類をshellへ統合する
- [ ] 9.1 閲覧・通常mutation・回復操作の閉じた分類を実装する
  - 操作登録で受理する分類を閲覧、通常mutation、回復操作に限定し、未知分類を安全に拒否する
  - 通常時、maintenance中、回復必須状態ごとの許可集合を一貫して判定し、domain側の最終的なwrite拒否を代替しない
  - 回復操作の失敗または取消では通常mutationを再許可せず、上流から正常状態を受信するまで抑止を維持する
  - 完了時、各状態と各操作分類の組合せ、および未知分類の拒否を決定的なunit testで観測できる
  - _Requirements: 5.8, 5.9, 5.10, 10.4, 10.5_
  - _Boundary: MutationGate, CoreContracts_

- [ ] 9.2 回復必須snapshot projectionと正常復帰を実装する
  - 保存rootの破損または未対応versionだけを通常の起動失敗と区別し、回復必須状態として安全な共通表示へ投影する
  - 上流の正常snapshotを受信したときだけ最新の操作可否を再評価し、cursorを捏造せず通常projectionへ復帰する
  - stale通知で回復必須状態や復帰後の通常状態を後退させず、購読停止時にresourceを冪等に解放する
  - 回復操作の成否、復元対象、保存データの正常性をshellで独自判定せず、上流の評価済み状態だけを使用する
  - 完了時、破損・未対応version・その他の取得失敗・正常復帰・stale通知をprojection testで識別できる
  - _Depends: local-data-foundation 6.8_
  - _Requirements: 3.3, 5.8, 5.9, 5.10, 10.1, 10.3, 10.4, 10.5_
  - _Boundary: MaintenanceProjection_

- [ ] 9.3 回復必須表示とsettings到達をhost lifecycleへ統合する
  - 回復必須状態ではsettingsを初期選択またはfallbackとして表示し、backup回復操作面への到達とread-only navigationを維持する
  - 正常projectionへの復帰時に最新のfeature availabilityを再評価し、shellを再起動せず通常表示へ戻す
  - 回復操作の失敗または取消では回復必須表示と通常mutation抑止を維持し、他の起動失敗と異なる安全な案内を提示する
  - 完了時、settings到達、正常復帰、回復失敗／取消、通常startup failureの各flowをhostとDOM testで識別できる
  - _Depends: 9.2, backup-restore 5.2, settings-screen 4.2_
  - _Requirements: 5.9, 5.10, 8.5, 10.1, 10.2, 10.3, 10.4, 10.5_
  - _Boundary: SidePanelHost, ShellView_

- [ ] 9.4 Settingsとbackupの回復登録をproduction compositionへ接続する
  - settingsとbackupが公開する回復操作だけを明示的な回復分類で登録し、通常mutationとの分類境界を維持する
  - 起動、途中失敗、停止で回復登録と購読を逆依存順かつbest-effort、冪等に解放する
  - recovery-requiredでもsettingsとbackup回復面を利用可能に保ち、他の通常mutation featureを利用不能として合成する
  - 完了時、production-shaped fixtureで回復操作だけが許可され、未登録操作が拒否され、停止後にresourceが残らないことを観測できる
  - _Depends: backup-restore 6.8, settings-screen 4.2_
  - _Requirements: 3.1, 3.9, 5.8, 5.9, 5.10, 8.5, 10.2, 10.4, 10.5_
  - _Boundary: ApplicationComposition, SidePanelFeatureContributions_

- [ ] 10. 共通の現在project表示をproduction shellへ統合する
- [ ] 10.1 Project selector専用slotとsingleton lifecycleを実装する
  - navigationとfeature主表示領域から分離した共通project selector専用slotをshell presentationに提供する
  - project-context所有のpresentationを一度だけmountし、停止と起動rollbackで購読と表示handleを冪等に解放する
  - 選択操作をproject-contextのcommand能力へそのまま委譲し、project名、catalog順、fallback、guard判断をshellで解釈しない
  - 完了時、selectorとfeature viewが別containerへ同時に表示され、選択要求の一回配送と停止時cleanupをcontract testで観測できる
  - _Depends: project-context 3.3_
  - _Requirements: 9.1, 9.2, 9.5_
  - _Boundary: ShellPresentation, ProjectContextShellAdapter_

- [ ] 10.2 Project snapshotを依存featureのavailabilityへ投影する
  - project-contextの同一snapshotを共通selectorとproject依存featureへ同じgenerationで通知する
  - readyだけをproject依存能力の利用可能条件とし、emptyまたはunavailableから別projectを推測せず理由付き利用不能状態へ投影する
  - snapshot generationを後退させず、project-context障害時もsettingsとbackup回復面、およびproject非依存featureの利用を維持する
  - 完了時、ready、empty、unavailable、stale通知の各scenarioでselectorと依存featureの状態が一致し、非依存featureが継続する
  - _Depends: project-context 2.5, project-context 3.3_
  - _Requirements: 3.8, 3.9, 9.1, 9.3, 9.4, 9.5_
  - _Boundary: ProjectContextShellAdapter, FeatureRegistry_

- [ ] 10.3 能力別project portをproduction featureへ注入する
  - 各project依存featureへ必要なread、command、guard能力だけを合成contextとして渡し、project-context内部へdeep importしない
  - project-contextの初期化失敗をshell全体のstartup failureへ昇格させず、依存featureだけを利用不能として起動を継続する
  - production start、途中rollback、stopでproject-context handle、selector、feature contributionを逆依存順かつbest-effort、冪等に解放する
  - 完了時、public consumer型検査とproduction-shaped testで能力の過剰公開が拒否され、degraded startupとcleanupが成功する
  - _Depends: 10.1, 10.2, project-context 4.3, project-context 4.4_
  - _Requirements: 3.5, 3.8, 3.9, 9.3, 9.4, 9.5_
  - _Boundary: ApplicationComposition, FeatureCompositionContext, RootPublicApi_

- [ ] 11. Project contextと回復flowの横断回帰を完成する
- [ ] 11.1 Contract・DOM・runtime flowを統合検証する
  - current projectのready、empty、unavailableとrecovery-required、maintenance、settings fallbackを同じproduction-shaped scenarioで検証する
  - selector操作、依存feature availability、回復操作分類、正常snapshot後の再評価、全resource cleanupの順序を決定的に観測する
  - 外部由来文字列を安全なtextとして表示し、feature障害時もproject非依存の操作を維持する
  - 完了時、関連unit、contract、DOM、runtime testが連続成功し、状態遷移とcleanupを一つのfixtureで再現できる
  - _Depends: 9.4, 10.3_
  - _Requirements: 3.8, 3.9, 4.4, 5.8, 5.9, 5.10, 6.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5_
  - _Boundary: ContractTestKit, ShellIntegration_

- [ ] 11.2 公開consumer・worker・artifact境界を検証する
  - project-contextの能力別portと回復操作分類が公開入口だけから到達でき、内部実装へのdeep importを拒否する
  - worker bundleへproject selector、DOM、React、feature UI依存を混入させず、side panel専用graphとの分離を維持する
  - remote code、動的評価、inline JavaScript、危険なHTML描画APIを生成物へ含めない
  - 完了時、公開consumer型検査、source boundary、worker bundle、security artifact gateが連続成功する
  - _Depends: 9.4, 10.3_
  - _Requirements: 3.6, 3.8, 3.9, 4.4, 6.3, 6.4, 9.5, 10.5_
  - _Boundary: PublicConsumerContracts, ApplicationShellArtifactValidation_

- [ ] 11.3 Chrome side panelで共通project表示と回復到達を検証する
  - Chrome 116以降相当のproduction buildで共通selector、project切替、project依存featureの状態更新を表示文言に依存せず確認する
  - 回復必須状態からsettingsのbackup回復面へ到達でき、失敗または取消後も通常mutationが抑止されることを確認する
  - project-context利用不能時もsettingsとbackup回復面が利用でき、別projectが暗黙選択されないことを確認する
  - 完了時、架空fixtureだけを使うE2Eと完全validationが成功し、全追加要件のproduction経路を再現できる
  - _Depends: 11.1, 11.2, project-context 4.5_
  - _Requirements: 3.9, 6.1, 6.2, 6.3, 6.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5_
  - _Boundary: ApplicationShellE2E, ApplicationShellArtifactValidation_

## Implementation Notes

- 2026-08-02 validation remediation: worker-safe catalog型からUI registrationを除去してcatalog宣言順へ固定し、side-panelのtransient lifecycleを必須依存化した。未参照`react-runtime.js` entryとbaseline sourceを撤去し、React同梱gateを実`side-panel.js`へ集約した。candidate-management→source-price-refreshのlate-bound公開port seamもdesignへ明記した。
- 2026-08-02 source-price-refresh trigger revalidation: `source-price-refresh` task 6.3のheaded native menu smoke（1 pass、exit 0）と関連4 specの再監査完了後、worker-safe catalog／`TransientGestureRegistrationPort` seamを再確認した。`pnpm validate`はNode 1429/1429、Playwright 26 pass（記録済みnative gate 1 skip）でexit 0、unpacked-extension smokeも同suiteで通過し、要件8/8、cross-task統合、設計・境界、blocked taskなしを再監査してGO。feature公開入口のsteeringは実装とboundary gateに合わせ、通常`public.ts`、worker専用`worker-public.ts`、application shell composition専用`feature-contribution.ts`へ明確化した。
- 2026-08-02 settings-screen validation remediation: 通常のpersistent navigationでtarget mountが失敗した場合に直前persistent featureを新しいhandleで復元する契約は、下流settings固有処理ではなく`SidePanelHost`所有の共通transactionとしてdesignへ明記した。mount完了後にstale化したtargetのcleanup失敗でもhandle ownershipを保持し、queued fallbackが未解放handleのcleanupに成功してからだけ次featureをmountする回帰を追加した。
- 2026-08-02 owner revalidation: persistent rollback／stale cleanup triggerを要件8/8、設計・境界・blocked taskなしで再監査しGO。`pnpm validate`はNode 1429/1429、Playwright 26 pass（別scopeのmanual headed smoke 1 skip）、unpacked-extension smokeをfreshに通過した。

- 2026-07-31 `ui-message-catalog` validation remediationを受け、起動失敗／失効の別`MessageDescriptor`をsteady-state shell noticeとして安全に描画し、session read成功または有効activation受理でclearされることをcomposition境界で受け入れ再検証した。runtime callbackと寿命監視の実装ownershipは`transient-feature-surface`に維持し、shell側では常設面との併存、完全`pnpm validate`、unpacked-extension smokeを確認した。
- Contract test kitでは、下流提供callbackをruntime境界として検証し、例外を安定診断へ正規化したうえで、取得済みresourceを逆順・全件best-effort・冪等にcleanupする。
- 非同期mountはlifecycle epochと完了時availabilityでstale化を検出し、unmountに失敗したhandleはcleanup成功まで所有権を保持して再試行する。
- 未信頼keyからroot契約を合成する辞書はnull prototypeとown property定義を使い、`__proto__`を含む予約名でも重複検出とprototype非汚染を保つ。
- 統合start/stopはsingle-flightとepoch fenceで競合を無効化し、起動rollbackと停止cleanupはresourceごとに成功するまで所有権を保持する。
- Composition rootは注入factoryのthrow・null・cleanup shapeを副作用前に検証し、公開APIをregistrationから一意導出して固定診断と逆順rollbackへ正規化する。
- Production compositionはepoch/stop gateとcleanup成功までの所有権保持が必要で、feature unmount後にmaintenance購読を解除する。foundation failure表示経路もpresentation例外をtyped startup failureへ正規化する必要がある。
- Task 4.8の境界gateで検出したcross-spec矛盾は、foundation所有のno-arg production factoryとshellのStorage/Web Locks非依存へ移行して解消した。
- MV3 context間でfoundation handleを共有せず、side panelはmaintenance source、service workerはcommand registrationを各contextのno-arg factory handleから所有する。
- `FeatureCompositionContext`はscoped data portとnavigatorだけに限定し、backup/restoreの完全data portとtransient lifecycleはside-panel compositionの専用依存として個別featureへ渡す。
- product-captureの一過性surface IDはfeature-owned worker contributionからworker-safe catalogへ載せ、共有service worker入口から具体feature importを除去する。`source-price-refresh-upstream-consumer.ts`はcatalog/mutation/page-price/gestureの4公開portを同時に型検査し、未実装の下流specがこのseamだけを利用できる状態を固定する。
