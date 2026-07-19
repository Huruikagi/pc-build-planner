# 実装計画

- [ ] 1. Shell基盤と型付き契約を整備する
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
  - feature識別子、navigation metadata、availability、mount/unmount、operation policy、型付きerrorを表現する
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

- [ ] 2. Core registryとmaintenance制御を実装する
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

- [ ] 3. Hostとcompositionを統合する
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

- [ ] 4. Runtime入口とend-to-end境界を検証する
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

- [ ] 4.3 Worker contributionを一度だけcompositionする
  - catalogのworker項目だけを共有workerへ登録し、DOM、HTMLElement、Reactへの依存をworker lifecycleへ持ち込まない
  - feature識別子の一意性を検証し、途中失敗時は取得済みhandlerを逆順かつ全件best-effortで解除する
  - 停止と再停止で重複handlerや二重解除を生じない冪等なcleanupを提供する
  - 完了時、複数登録、重複拒否、途中失敗rollback、停止cleanupをworker contract testで決定的に観測できる
  - _Requirements: 2.1, 2.3, 3.1, 3.4, 4.3, 6.4_
  - _Boundary: WorkerComposition_
  - _Depends: 4.2_

- [ ] 4.4 Production application compositionを完成する
  - foundation公開initializer、registry、presentation、feature host、worker contributionを設計順序で一度だけ合成する
  - canonical maintenance sourceだけを利用し、inactive stub、Storage直接監視、foundation内部へのdeep importへfallbackしない
  - 空catalogでは正常にempty shellを開始し、途中失敗と停止ではworker、feature、maintenance購読、presentation、foundationを逆依存順で全件best-effortに解放する
  - foundation初期化失敗時はfeatureをmountせず、失敗表示に必要なpresentationだけを安全に開始して共通startup errorを提示する
  - 完了時、正常起動、空catalog、初期化失敗、途中rollback、二重起動、停止cleanupをproduction-shaped integration testで観測できる
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.3, 6.4_
  - _Boundary: ProductionApplicationComposition_
  - _Depends: 3.4, 4.1, 4.3_

- [ ] 4.5 Side panel・service worker・root公開入口を接続する
  - side panel入口をDOM host解決とproduction factoryのbootstrapだけに限定し、具体featureやfoundation内部を直接組み立てない
  - service worker入口はcatalogのworker contributionだけをcompositionし、root公開入口はcatalogから推論したreadonly APIだけを提供する
  - dummy maintenance source、noop state observer、下流feature deep importを共有入口から除去する
  - 完了時、空catalogのproduction shellとworkerが起動し、後続featureが共有入口を変更せずcatalog経由で参加できる
  - _Requirements: 3.1, 3.2, 3.4, 6.1, 6.3_
  - _Boundary: RuntimeAdapters, RootPublicApi_
  - _Depends: 4.4_

- [ ] 4.6 User gestureを保つside panel open adapterを実装する
  - Side Panel API呼出しを有効なユーザー操作handler内で同期開始し、host準備との責務を分離する
  - API拒否時は安全な診断結果を返し、無関係なfeature stateを変更しない
  - 完了時、adapter spyがgesture handler内の呼出し順序と失敗分離を確認する
  - _Requirements: 6.2_
  - _Boundary: RuntimeAdapters_

- [ ] 4.7 Production runtime統合回帰を完成する
  - 空catalogと複数の模擬featureを同じproduction-shaped fixtureで起動し、shell rootとfeature mount領域が別DOM要素であることを検証する
  - navigation、unmount後の切替、availability変化、mount失敗、worker登録、maintenance開始・終了・stale通知を一連のscenarioで検証する
  - 外部由来文字列の安全なtext表示、他featureの継続、停止時の全resource cleanupを確認する
  - 完了時、UI、worker、maintenance、failure、cleanupを横断するruntime suiteが決定的に成功する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.4_
  - _Boundary: ApplicationShellIntegrationTests_
  - _Depends: 4.5, 4.6_

- [ ] 4.8 生成物・security・import境界の最終gateを完成する
  - production bundleへReactとReact DOMが同梱され、remote code、inline JavaScript、dynamic evaluation、runtime JSX変換、危険なHTML描画APIがないことを検査する
  - worker bundleにDOM・React依存がなく、shellがStorage API、foundation maintenance契約の再定義、foundation内部や下流feature内部へのdeep importを持たないことを検査する
  - dummy maintenance source、noop shell state observer、共有入口への下流feature自己登録をartifactとsourceの両方で拒否する
  - 完了時、typecheck、test、build、CSP・artifact・boundary scanが連続成功し、違反時に所有境界を特定できる
  - _Requirements: 3.4, 4.4, 5.6, 6.1, 6.3, 6.4_
  - _Boundary: ApplicationShellArtifactValidation_
  - _Depends: 4.7_

## Implementation Notes

- Contract test kitでは、下流提供callbackをruntime境界として検証し、例外を安定診断へ正規化したうえで、取得済みresourceを逆順・全件best-effort・冪等にcleanupする。
- 非同期mountはlifecycle epochと完了時availabilityでstale化を検出し、unmountに失敗したhandleはcleanup成功まで所有権を保持して再試行する。
- 未信頼keyからroot契約を合成する辞書はnull prototypeとown property定義を使い、`__proto__`を含む予約名でも重複検出とprototype非汚染を保つ。
- 統合start/stopはsingle-flightとepoch fenceで競合を無効化し、起動rollbackと停止cleanupはresourceごとに成功するまで所有権を保持する。
- Composition rootは注入factoryのthrow・null・cleanup shapeを副作用前に検証し、公開APIをregistrationから一意導出して固定診断と逆順rollbackへ正規化する。
