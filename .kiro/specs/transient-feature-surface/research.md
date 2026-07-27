# Research: transient-feature-surface

## 分割メモ

2026-07-27、旧specがshell/runtime基盤とproduct-capture移行を同時に所有しdesignが約900行へ拡大したため、責務を分割した。本書はshell/runtime側の調査だけを保持する。capture/candidate側は `../product-capture-transient-migration/research.md` を参照する。

## Existing Assets

- `src/application-shell/contracts.ts`: `ApplicationFeatureRegistration`、typed activation、`SidePanelHost`契約
- `src/application-shell/application-composition.ts`: 全登録featureをナビ項目へ変換
- `src/application-shell/side-panel-host.ts`: select/activateの直列transition、activation失敗時rollback
- `src/application-shell/feature-registry.ts`: 登録shape検証とavailability障害分離
- `src/runtime/service-worker.ts`: `action.onClicked`から`sidePanel.open()`を同期開始
- `src/runtime/open-side-panel.ts`: ユーザージェスチャー内の同期呼び出し制約
- `scripts/validate-artifacts.mjs`: 4権限固定
- `scripts/validate-boundaries.mjs`: `chrome.storage`到達点allowlist

## Key Findings

1. 登録済みfeatureと常設ナビ項目が1:1であり、一過性区分を表現できない。
2. `sidePanel.open()`は有効なジェスチャー内で同期開始する必要がある。
3. MV3 workerのメモリや長命portの存在だけを配送保証にできない。
4. `chrome.tabs.onUpdated` / `onRemoved`はURLを読まなければ追加`tabs`権限なしで利用できる。
5. hostの既存activation rollbackは汎用`conclude`の実装基盤として利用できる。
6. worker監視からpanel監視への移管には空白を作らないhandshakeが必要である。
7. `source-price-refresh`はfeature-owned context menu clickを起点にするが、現行設計は`chrome.action`をservice workerへ直接配線しており、別gesture sourceが同じsequence/store/open経路へ参加する公開seamを持たない。

## Selected Boundary

- shell: registration、navigation filtering、controller、return target、generic handoff
- runtime: activation delivery、tab lifecycle event mapping
- downstream feature: business payload、UI、実行状態
- downstream gesture source: source固有のChrome event登録とtab ID検証だけ。activation ID、sequence、store、panel openはshell/runtimeが所有する

## Design Decisions

### Session媒体障害は起動契機を識別せずshell障害として提示する

- `read()`が`err`なら「セッション領域が利用不能」という再操作可能な理由を提示する。
- noticeは常設featureを置換するglobal errorではなく、常設面と併存する一過性起動bannerとして表示する。
- `put()`が`err`なら同じ媒体へ失敗recordを書かず、storage非依存のChrome action badge/titleで理由を残す。
- action signalはglobal状態とし、同じscheduler上の次のdurable保存成功後だけclearする。panel read/notice完了は後発signalを消し得るためclear条件にしない。
- 2.7は安全に成立しない理由の提示を要求し、ジェスチャー起因かどうかの識別を要求しない。
- Chrome UIからの直接openと媒体障害が重なると不要な障害表示が出る残余リスクを受容する。

### 起動と失効は単調増加seqと墓標で順序付ける

- workerの単一スケジューラがイベント受信時に`seq`を割り当て、session envelopeへ順序状態を保持する。
- `invalidate`はrecord不在でも墓標を残し、後から適用される古いrecordを`invalidated`へ着地させる。
- Promise chain内で後発commandが先発writeを追い越すとは仮定しない。watch-ready後の最終許可を同じschedulerへ通し、panel監視との重複期間で監視空白を閉じる。
- 墓標はtabごとに最新1件・全体128件へ制限し、全先行commandのcommitを確認したscheduler checkpointでだけ、支配中でない古い墓標を剪定する。安全に上限内へ収められない破損状態は`capacity-exceeded`でfail closedにする。

### production E2Eは最初の実featureへ委譲する

- shell specはproduction bundleへテスト専用featureを混入させず、in-memory fixtureのcontract/runtime integrationを所有する。
- Chrome 116以降の主要動線は`product-capture-transient-migration`の実product-capture登録と5.5 E2Eで、shell 4.5も合わせて検証する。

### composition循環とwatch-ready transportはshell内部portで閉じる

- feature factoryへは既存`ShellNavigator`と同型のlate-bound lifecycle proxyを渡し、host構築後にcontrollerへbindする。
- watch-readyはpayloadなしの既存worker registrationを流用せず、versioned request/responseとsender検証を持つ専用runtime adapterで配送する。
- controller concrete class、proxyのbind操作、Chrome message payloadは下流へ公開しない。

### feature-owned gestureは同期registration portからcanonical ingressへ合流させる

- **Context**: `source-price-refresh`のcontext menuは`activeTab`を与えるevent callback内でpanel openを開始する必要があるが、既存action経路を複製するとsequence、store writer、failure signal、墓標規則が分岐する。
- **Alternatives Considered**:
  1. 各featureがservice workerでstoreと`sidePanel.open`を直接呼ぶ — lifecycleを重複実装し公開境界を破る。
  2. runtime messageでgestureを後送する — user activationの同期性を失い、panel openが拒否され得る。
  3. source登録と同期emitだけを公開し、既存gesture ingressへ合流させる — 採用。
- **Selected Approach**: `TransientGestureSource.start(emit)`、`TransientGestureRegistrationPort.register(source)`、未信頼なChrome tab IDをbrand化する`parseTargetTabId`を`application-shell/public.ts`から公開する。`emit(TargetTabId)`はevent callback内で同期実行され、内部registrarが既存のactivation ID/sequence割当、scheduler enqueue、failure signal、panel openへ一度だけ渡す。
- **Rationale**: source-price-refreshはmenu itemとclick検証だけを所有でき、worker-safeなcanonical pathと`activeTab`の有効期間を維持できる。組み込みactionも同じsource形へ寄せるため2経路の挙動差を防げる。
- **Trade-offs**: `emit`は非同期store failureをsourceへ返せない。既存のaction failure signalとshell noticeが利用者向け回復を担い、registration時の同期失敗だけを閉じたerror unionで返す。
- **Revalidation**: port shape、同期emit、cleanup順、worker composition ownerを変える場合は`source-price-refresh`のgesture integrationとE2Eを再検証する。

## Validation Focus

- persistent featureの非回帰
- panel closed/open双方の配送
- worker再生成
- watch-ready前後の遷移・閉鎖
- `put()`保留中の失効墓標と最終許可拒否
- stale generation
- conclude成功/rollback
- storage errorの可視化
- late-bound lifecycleのbind前・unbind後fail-closed
- watch-ready runtime messageのsender/payload/response検証
- production artifactへテスト専用featureが混入しないこと
- actionとcontext-menu相当の架空sourceが同じscheduler/store/open経路へ入り、source側がwriterやsequenceを持たないこと
- invalid/duplicate/start failure、cleanup一回性、停止後emitのno-op、worker再生成時の冪等再登録
