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

- [ ] 1.3 Feature registrationと共通shell stateの契約を定義する
  - feature識別子、navigation metadata、availability、mount/unmount、operation policy、型付きerrorを表現する
  - featureが共有service worker入口を編集せずaction handler等を提供できるworker registration契約を表現する
  - foundation公開の`MaintenanceSnapshot`と`MaintenanceSnapshotSource`をcanonical契約として利用し、shell内で同等portを再定義しない
  - maintenanceの表示用stateとroot public contract合成の型制約を表現する
  - 完了時、模擬featureとfoundation公開portが`any`や重複maintenance契約なしで型検査できる
  - _Requirements: 2.1, 2.5, 3.2, 5.6_
  - _Boundary: CoreContracts_

- [ ] 1.4 下流feature向けcontract test kitを作る
  - 登録、React rootのmount/unmount、availability通知、購読解除の共通適合testを提供する
  - worker registrationの一意性、登録解除、途中失敗cleanupを同じtest kitで検証できるようにする
  - feature固有データをshellへ渡さなくてもfixtureを検証できるようにする
  - 完了時、適合fixtureは成功し、不正fixtureは契約違反箇所を決定的に報告する
  - _Requirements: 2.1, 2.3, 2.5, 6.4_
  - _Boundary: ContractTestKit_

- [ ] 2. Core registryとmaintenance制御を実装する
- [ ] 2.1 (P) Feature registryを実装する
  - 登録値を検証し、一意なfeature識別子と決定的なnavigation順序を維持する
  - 重複または不正なfeatureを隔離し、正常な登録と購読を継続する
  - availability変更をsnapshotと購読者へ同期し、解除を冪等にする
  - 完了時、重複・不正登録の拒否、順序、状態変更をunit testで観測できる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: FeatureRegistry_
  - _Depends: 1.3_

- [ ] 2.2 (P) 世代付きmaintenance projectionを実装する
  - 完了済み`local-data-foundation` task 5.5の公開contract testとconsumer型検査を確認し、そのread-only portだけを利用する
  - foundationのread-only通知から現在のgeneration・revision cursorとactive状態を投影する
  - cursorを辞書順で比較し、古い世代・同一世代の古いrevision・重複通知を無視して状態後退を防ぐ
  - shell側ではlease取得・更新・解放を一切行わない
  - 完了時、世代前進、現行世代終了、stale通知拒否をunit testで確認できる
  - _Requirements: 5.1, 5.4, 5.5, 5.6_
  - _Boundary: MaintenanceProjection_
  - _Depends: 1.3_

- [ ] 2.3 (P) Mutation gateを実装する
  - readとmutationの操作分類をmaintenance snapshotへ写像する
  - 完了時、active中はmutationだけを拒否し、inactive中とread操作を許可することをunit testで確認できる
  - _Requirements: 5.2, 5.3_
  - _Boundary: MutationGate_
  - _Depends: 1.3_

- [ ] 2.4 (P) 共通shell React viewとerror boundaryを実装する
  - loading、error、maintenance、empty state、navigationをReact function componentとCSSで描画する
  - 外部由来messageを通常のJSX childとして扱い、`dangerouslySetInnerHTML`、`innerHTML`、inline handlerを使用しない
  - featureのrender failureを安全なfallbackへ隔離し、他featureのnavigationを維持する
  - 完了時、各共通状態、安全なテキスト表示、render failure隔離を利用者視点のDOM testで観測できる
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1_
  - _Boundary: ShellView, ShellErrorBoundary_
  - _Depends: 1.1, 1.3_

- [ ] 2.5 (P) React shell root adapterを実装する
  - shell host containerへReact rootを生成し、shell stateの購読と描画を接続する
  - 停止、起動失敗、再mount時に購読解除と`root.unmount()`を一度だけ実行できる冪等なcleanupを提供する
  - 完了時、mount、状態更新、停止、再mountのroot lifecycle testですべてのresource解放を観測できる
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 4.1, 6.4_
  - _Boundary: ReactShellRoot_
  - _Depends: 1.1, 1.3_

- [ ] 3. Hostとcompositionを統合する
- [ ] 3.1 Side panel hostのnavigationとfeature lifecycleを実装する
  - 利用可能featureを表示し、選択変更時に旧viewをunmountしてから新viewをmountする
  - 同時に一つだけを表示し、選択featureが利用不可になった場合は理由と安全な遷移先を示す
  - mount失敗をfeature単位で隔離し、再試行と他featureへの移動を維持する
  - 公開`FeatureMountContext`とmount/unmount契約を変えず、feature側のReact root lifecycleを調停する
  - 完了時、切替順序、単一表示、利用不可遷移、障害分離がhost integration testで確認できる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.4, 4.2, 4.3_
  - _Boundary: SidePanelHost_
  - _Depends: 2.1, 2.3, 2.4, 2.5_

- [ ] 3.2 Public API registryを実装する
  - feature単位の公開契約をreadonlyなroot契約としてまとめる
  - 重複keyまたは不正な公開契約を型検査または明示的な合成errorで拒否する
  - 完了時、模擬featureの公開契約が型を保ったroot contractとして取得できる
  - _Requirements: 3.2, 3.4_
  - _Boundary: PublicApiRegistry_
  - _Depends: 1.3_

- [ ] 3.3 Maintenance状態をhost全体へ統合する
  - projectionの変更を共通表示、operation policy、現在mount中のfeatureへ伝える
  - maintenance中もread-only navigationを保ち、終了時は現行世代に限ってmutation controlを復帰する
  - 完了時、遅延した古い通知を含む統合scenarioで全featureの操作可否が一貫する
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: ApplicationShellIntegration_
  - _Depends: 2.2, 2.3, 2.4, 2.5, 3.1_

- [ ] 3.4 Composition rootを実装する
  - foundation adapter、feature registry、worker registration、maintenance統合、host、public APIを一回だけ合成する
  - 必須依存の初期化失敗時はfeatureをmountせず、途中生成した購読とviewを逆順に解放する
  - 完了時、二重起動を防ぎ、root API、host開始、startup failure cleanupをintegration testで観測できる
  - _Requirements: 3.1, 3.3, 3.4_
  - _Boundary: CompositionRoot_
  - _Depends: 3.2, 3.3_

- [ ] 4. Runtime入口とend-to-end境界を検証する
- [ ] 4.1 Side panel bootstrapとroot公開入口を接続する
  - shellだけが共有side panel runtime、HTML host、root barrelを所有する構成にする
  - side panel registration、worker registration、public contractをcomposition root経由で取り込み、feature側から共有入口を編集しない
  - shell rootとfeature rootをproduction bundleへ同梱し、componentをfeature境界越しに直接importしない
  - 完了時、複数の模擬featureが共有ファイルへの変更なしでnavigationとroot APIへ参加できる
  - _Requirements: 3.1, 3.2, 3.4, 6.1_
  - _Boundary: RuntimeAdapters, RootPublicApi_
  - _Depends: 3.4_

- [ ] 4.2 User gestureを保つside panel open adapterを実装する
  - Side Panel API呼出しを有効なユーザー操作handler内で同期開始し、host準備との責務を分離する
  - API拒否時は安全な診断結果を返し、無関係なfeature stateを変更しない
  - 完了時、adapter spyがgesture handler内の呼出し順序と失敗分離を確認する
  - _Requirements: 6.2_
  - _Boundary: RuntimeAdapters_

- [ ] 4.3 Shell runtime統合回帰testを完成させる
  - 起動loading、navigation、切替、availability変化、mount失敗、worker registration、maintenance開始・終了・stale通知を一連のscenarioで検証する
  - 外部文字列の安全な表示と他feature継続、全resourceのcleanupを検証する
  - build artifactにproduction版React/React DOMが同梱され、remote code、inline JavaScript、dynamic evaluation、runtime JSX変換、`dangerouslySetInnerHTML`がないことを検査する
  - shellによるStorage API直接参照とfoundation maintenance portの重複定義をboundary検査で拒否する
  - 完了時、要件横断のruntime suiteが決定的に成功し、失敗時に境界componentを特定できる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.2, 2.3, 2.4, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.3, 6.4_
  - _Boundary: ApplicationShellIntegrationTests_
  - _Depends: 4.1, 4.2_
