# 調査・設計判断

## サマリー
- **Feature**: `application-shell`
- **Discovery Scope**: Extension（実装済みlocal data foundationへの統合境界中心）
- **主な所見**:
  - local data foundation、MV3 manifest、build/test基盤は実装済みで、application shellとUI runtimeが未実装である。
  - foundationは永続`MaintenanceState`に加え、完了済みtask 5.5で検証済みread-only `MaintenanceSnapshotSource`を公開している。
  - shellは永続化やmaintenance leaseを所有せず、foundationの世代付きread-only状態だけを投影する必要がある。
  - 一覧、フォーム、確認、失敗回復を横断するUI規模を踏まえ、React 19系を宣言的な表示adapterとして採用する。
  - React DOMの`createRoot`と`root.unmount()`は既存のcontainerベースmount/unmount契約を変更せず統合できる。
  - MV3のCSPを維持するため、React runtimeとUI codeはproduction bundleへ同梱し、runtime JSX変換やremote codeを使用しない。
  - 現行実装は全registrationへnavigationを必須化して全件をnavigationへ投影し、`ShellView`がheaderへ`LanguageSelectControl`を直置きしている。常設／一過性をnavigation有無まで相関させる判別共用体、常設判定の単一化、settingsへの配置移行が必要である。
  - `source-price-refresh`が依存するworker-safe catalogとUI contributionの分離は、shell更新後も維持する必要がある。
  - 現行runtime baselineは同じDOM containerをshell React rootとfeature mountへ割り当て、仮のinactive maintenance sourceを共有entryで生成しているためproduction compositionへ進めない。空feature catalog自体は下流feature実装前の正規状態として扱える。
  - `project-context`は`ready | empty | unavailable` snapshot、選択transaction、共通selector、read/command portを所有する。application shellはその意味やfallbackを再実装せず、共通slotとsingleton composition、project依存featureへの絞り込み能力注入だけを所有する。
  - 回復必須状態では既存の二値`read | mutation`だけでは復元操作を安全に例外化できないため、shellの操作分類を`read | mutation | recovery`へ閉じ、`recovery-required`時はreadと明示的recoveryだけを許可する。

## 調査ログ

### Change Brief mvp-local-data-simplification のintegration-focused discovery
- **背景**: package-backed product runtime全面移行を延期し、application-shellのMVP完了条件を現行product-local runtime contributionと既存backup専用capabilityのcompositionへ戻す。
- **参照元**: 全steering、roadmap、`application-shell`全spec文書、承認済み`local-data-library-boundaries`・`local-data-foundation`・`backup-restore`のrequirements/design/tasks/spec metadata。
- **所見**: packageは抽出済みgeneric primitiveと3公開entryの検証を所有する一方、local-data-foundationが現行product-local runtimeと用途別capabilityを、backup-restoreが製品restore workflowとbackup section contributionを所有する。shellがpackage factory、storage/lock、consumer固有fence、generic recovery/finalization resumptionを知る必要はない。
- **影響**: `application-composition.ts`は現行foundation contributionを一度だけ初期化し、通常consumerへ通常用途capability、backup sectionへbackup専用capabilityだけを注入する。既存navigation、startup/degraded startup、maintenance/recovery-required、settings到達、project selector、feature lifecycle、cleanup順を変更しない。
- **Synthesis**: 第二consumerの実証前に新しいgeneric seamを一般化しない。既存のproduction contribution interfaceを維持し、MVP taskはcapability identityと非漏洩を検証する最小composition差分へ限定する。

### 既存構造と統合点
- **背景**: 共有runtime入口の所有権競合を解消する必要がある。
- **参照元**: `brief.md`、`.kiro/steering/roadmap.md`、リポジトリのファイル構造。
- **所見**: `src/domain/`、`src/persistence/`と対応testは実装済みである。下流featureはregistration moduleと`public.ts`を供給し、shellだけが`side-panel.html`、`src/runtime/side-panel.ts`、`src/index.ts`を所有する。
- **影響**: canonical `Result<T, E>`とfoundation公開型を再利用し、既存foundation build/testを壊さずshell entryを追加する。統合fixtureでは下流featureを模擬する。

### Foundation maintenance公開境界
- **背景**: shellはmaintenance開始・終了と順序を観測する必要がある一方、Storageやleaseを所有してはならない。
- **参照元**: `src/domain/model.ts`、`src/persistence/write-authority.ts`、`src/persistence/maintenance.ts`、`src/persistence/public.ts`。
- **所見**: `local-data-foundation` task 5.5は完了済みで、`src/persistence/public.ts`から`MaintenanceSnapshot`、`MaintenanceSnapshotSource`、factoryを公開している。sourceは検証済みrootからgeneration・revision・activeだけを返し、Storage変更をRepository経由で再検証する。
- **影響**: shellはcanonical sourceをcomposition rootへ注入し、`chrome.storage.onChanged`、owner、lease APIへ直接依存しない。shell側の重複portは作成しない。

### Platform適合性
- **背景**: Chrome 116以降のManifest V3 side panelを対象とする。
- **参照元**: roadmapとbriefの確定制約。
- **所見**: `sidePanel.open()`のユーザージェスチャー制約をcomposition後の非同期処理へ移さない。実行コードはすべて同梱する。
- **影響**: gesture entryは薄いruntime adapterとし、host初期化とは契約を分離する。

### Project context統合境界
- **背景**: 主要画面で現在projectを一貫して表示しつつ、選択authorityやfallbackをshellへ重複させてはならない。
- **参照元**: `.kiro/specs/project-context/{brief,requirements,design}.md`、`.kiro/steering/structure.md`。
- **所見**: project-contextは`ProjectContextReadPort`、`ProjectContextCommandPort`、共通selectorのpresentation contributionを分離して公開する計画である。`unavailable`ではcurrent projectを公開せず、settingsとbackup recoveryの起動を妨げない契約を持つ。
- **影響**: shell presentationにproject-context専用slotを一つ設け、production compositionだけがread/command portとpresentation contributionを合成する。shellはsnapshotを表示用adapterへ転送するだけで、project IDの選択、fallback、CRUD、未保存編集判断を行わない。project依存featureには必要能力だけを注入し、project-context失敗時もsettingsとbackup recoveryを起動する。

### 回復操作の明示分類
- **背景**: 破損または未対応versionのrootから復元するには、通常mutationを抑止したまま復元commitだけを許可する必要がある。
- **参照元**: application-shell要件5・10、backup-restore公開operation分類、local-data-foundationのtyped startup failure。
- **所見**: 操作種別を二値のままにしてsettingsやbackupを例外扱いすると、任意mutationが回復経路を名乗れる曖昧な権限境界になる。
- **影響**: canonical `OperationKind`を`read | mutation | recovery`の閉じたunionとする。shellは登録された分類だけを判定し、復元protocolや成功可否を解釈しない。未知分類と通常mutationからの回復要求はfail closedで拒否する。

### Runtime composition blocker
- **背景**: task 4.1で、shell navigation/state、feature mount container、canonical maintenance source、下流registrationの接続責任が設計上未確定だった。
- **参照元**: `src/runtime/side-panel.ts`、`src/application-shell/react-shell-root.tsx`、`src/application-shell/composition-root.ts`、`src/application-shell/side-panel-host.ts`、`side-panel.html`。
- **所見**:
  - `ReactShellRoot`はshell host全体へReact rootを作るが、feature専用containerを返す契約を持たない。
  - `SidePanelHost`は注入されたcontainerへfeatureをmountするため、shell rootと同じcontainerを渡すとReact所有DOMとの所有権が衝突する。
  - runtime entryは仮のinactive `MaintenanceSnapshotSource`と空feature配列を直接構築しており、foundationおよび下流featureのproduction registrationを合成していない。
- **影響**: shell presentationのmount結果としてfeature専用containerとstate/navigation sinkを返す`ShellPresentationHandle`を設ける。具体feature、worker、public API、foundation初期化はapplication-shell所有の専用composition moduleだけで合成し、薄いruntime entryはそのfactoryだけを開始する。

## アーキテクチャパターン評価

| 選択肢 | 強み | 制約 | 判断 |
|---|---|---|---|
| Registry + Composition Root | 共有入口を単独所有しfeatureを独立化 | 登録契約の安定性が必要 | 採用 |
| 各featureがrootを編集 | 初期実装が単純 | 競合と逆依存を再発 | 不採用 |
| React 19系 + feature単位UI adapter | 宣言的描画、複雑なフォームと状態表示、成熟したTypeScript支援 | bundle増加、root cleanup規約が必要 | 採用 |
| Preact互換層 | 小さいruntime、Reactに近いAPI | 互換差分と周辺情報の確認コスト | 不採用 |
| 標準DOM/CSS | 依存最小 | 手動描画・イベント・cleanupがUI規模に対して複雑化 | 不採用 |

## 設計判断

### 判断: 宣言的registrationとlifecycle port
- **背景**: ナビゲーション、mount、利用可能性、mutation抑止を同じ参加方式で扱う。
- **選択**: 一意なid、表示metadata、availability購読、mount/unmountを持つ型付き契約を定義する。
- **理由**: interfaceを一般化しつつ、実装は現在必要なside panel lifecycleだけに限定できる。
- **トレードオフ**: feature側にadapterが必要だが共有ファイル競合を除去できる。

### 判断: Maintenanceは世代・revision cursor付きの単調projection
- **背景**: 通知の遅延やworker再生成で古い状態が到着し得る。
- **選択**: shellは`(generation, revision)`の最大cursorを保持し、それ以下の通知を無視するread-only projectionとする。
- **理由**: lease所有をfoundationに残しながらUIの状態後退を防ぐ。
- **Follow-up**: `local-data-foundation` task 5.5と公開境界contract testの成功をapplication-shell実装開始時の前提確認とする。

### 判断: Reactを表示adapterとして採用
- **背景**: shell自体は薄いが、下流featureは一覧、複数フォーム、確認、非同期失敗回復を持ち、標準DOMの手動更新では見通しが悪化する。
- **選択**: React 19系とReact DOMをproduction bundleへ同梱し、function componentとJSXでUIを実装する。
- **理由**: 宣言的描画とTypeScript支援を利用しつつ、既存の`FeatureMountContext`とmount/unmount契約を維持できる。
- **トレードオフ**: bundleは増えるが、MV3 extension pageではローカル同梱できる。ReactはUI adapterに限定し、state、service、portはframework非依存に保つ。

### 判断: React root lifecycleを既存feature契約へ閉じ込める
- **背景**: shellとfeatureの所有権を崩さずReactを導入する必要がある。
- **選択**: shellはshell rootを、各feature registrationは自身のfeature rootを生成し、公開mountが返すunmountで`root.unmount()`を一度だけ呼ぶ。
- **理由**: componentをfeature境界越しに共有せず、既存contract test kitでcleanupを検証できる。

### 判断: UIとworkerのregistrationをshellで合成する
- **背景**: product captureはaction handlerを必要とするが、featureによる共有service worker入口の直接編集は禁止される。
- **選択**: side panel用`ApplicationFeatureRegistration`とは別に型付きworker registrationを定義し、composition rootだけが共有workerへ登録する。
- **理由**: UI lifecycleとworker event lifecycleを混同せず、共有runtimeの単一所有権を維持できる。

### 判断: Runtime entryとproduction compositionを分離する
- **背景**: 共有entryへ下流feature一覧、foundation生成、DOM所有権判断を直接埋め込むと、task 4.1の境界が再び曖昧になる。
- **代替案**:
  1. `src/runtime/side-panel.ts`で全依存を直接importする — entryが変更集中点となりtest差し替えも難しい。
  2. 下流featureが共有entryへ自己登録する — 単一所有権と依存方向を破る。
  3. application-shell所有のproduction composition moduleへ集約する — entryを薄く保ち、具体依存を一箇所で監査できる。
- **選択**: `application-composition.ts`がcanonical foundation factory、feature contributions、worker contributions、shell presentationを合成し、`src/runtime/side-panel.ts`はDOM documentとlifecycle targetを渡してbootstrapするだけとする。
- **理由**: 下流featureは自身の`public.ts`とregistration factoryだけを所有し、共有entryを編集しない。composition moduleはapplication-shellの既存責務内で具体依存を一度だけ知る。
- **トレードオフ**: feature追加時にcomposition moduleの明示変更は必要だが、変更所有者とcontract test対象が一意になる。

### 判断: Shell presentation handleがDOM所有権を分割する
- **背景**: shell React rootとfeature React rootが同じcontainerを所有できない。
- **選択**: presentation adapterはshell containerへrootをmountし、Reactが生成した専用feature slotを`ShellPresentationHandle.featureContainer`として公開する。hostはそのslotだけをfeatureへ渡す。
- **理由**: navigation、共通状態、feature表示領域のDOM所有権が衝突せず、既存`FeatureMountContext`を変更しない。
- **Follow-up**: runtime integration testでshell containerとfeature containerが別要素であること、停止時にfeature unmount後にshell rootをunmountすることを検証する。

## リスクと緩和策
- 下流featureの契約解釈ずれ — contract test kitと型検査で検出する。
- mount失敗によるhost停止 — feature単位のerror boundaryと確実なunmountで分離する。
- maintenance通知の逆転 — 世代比較を状態更新の前提にする。
- gesture消失 — `sidePanel.open()`を同期的なユーザー操作adapter内で呼ぶ統合試験を設ける。
- React rootまたは購読の残存 — feature切替、mount失敗、shell停止のcontract/integration testでcleanupを検証する。
- React開発buildやremote codeの混入 — production conditionでbundleし、artifact検査でremote script、eval、runtime JSX変換を拒否する。
- foundation通知契約のdrift — task 5.5の公開consumer型検査をapplication-shell統合前に実行し、shell側の重複定義とStorage直接購読を境界検査で禁止する。
- shell/feature DOM所有権の衝突 — presentation handleが返す専用slot以外へのfeature mountを禁止し、統合testで要素同一性とcleanup順序を検査する。
- production dependencyの仮実装残存 — artifact/boundary testでinactive maintenance stubと共有entryからの下流deep importを拒否する。空feature catalogはempty stateとして検証する。

### 2026-08-12 v0.5.0 boundary reconciliation light discovery

- **Change Brief**: `v0.5.0-boundary-reconciliation`
- **Context**: project lifecycle、candidate source、product identity、共有error、product adaptersのowner移管後も、production shellにはlate-bound proxyと旧public portが残り、最終API fallout ownerが必要になった。
- **Sources Consulted**: 全steering、`application-shell`全spec文書、ready済み`product-page-capture`を含むlatest Change Brief記載upstream specs、各public contribution/task metadata。
- **Findings**: ui-messagesはconfigured resolver、Foundationは`ProductLocalDataAdapter`/`AppDataError`、backupは`ProductBackupAdapter`、project-contextはlifecycle descriptor/catalogを所有する。source/identity/candidate/current-build/compatibility/price/duplicate/captureは各ownerの公開port/contributionを確定し、shellだけがside-panel/worker/root APIの最終compositionを所有する。
- **Selected Approach**: production compositionで各owner public entryを一度だけ初期化・直接注入し、旧project/source/identity/manufacturer/refresh proxyと旧root APIを撤去する。AppDataErrorやfeature payloadを解釈せず、worker-safe registrationとUI graphを分離する。
- **Alternatives Rejected**: proxyをaliasとして残す案はowner移管を完結しない。各featureにproduction wiringを戻す案は共有entryの単一所有を破る。shellがcore/domain behaviorを再実装する案は責務逆転になる。
- **Out of scope**: canonical error/message/catalog/data policy、feature business logic/state/UI、data mutation、backup codec、identity/source/project/candidate/build/compatibility/capture semantics。
- **Validation implication**: one-shot composition identity、旧proxy negative gate、root API consumer、worker/UI artifact分離、startup/recovery/settings/lifecycleと横断E2Eをtaskへ追加する。

### 判断: Shellはfeature-neutralなactivation envelopeだけを配送する
- **背景**: 商品取り込みから候補編集へ検証済みprefillを渡す必要がある一方、shellへ候補固有型を所有させると依存方向が逆転する。
- **代替案**:
  1. shellが全feature payloadの判別共用体を所有する — 下流追加のたびに上流shell変更が必要になる。
  2. feature公開APIがDOMやhostを直接操作する — navigationの単一所有権を破る。
  3. shellは`unknown` payloadの汎用intentを配送し、対象featureが検証する — shell境界とfeature型安全性を両立できる。
- **選択**: shellはfeature ID、target、`unknown` payloadからなるintentと配送順序を所有し、各registrationが検証・適用adapterを提供する。呼出側は対象featureの`public.ts`が公開する型付きintent builderを使用する。
- **理由**: runtime信頼境界を明示しつつ、feature固有契約をshellから分離できる。
- **Follow-up**: 未登録feature、未知target、不正payload、mount失敗、適用失敗、同一feature再activationをcontract test kitで検証する。

### 判断: 入力元stateはopaque snapshotとしてfeature自身が復元する
- **背景**: activation先のmountまたは適用に失敗した場合、shellが入力元featureをunmount済みなら、React stateを自力で再構築できない。
- **選択**: mounted handleが任意の`captureState`を提供し、shellはsnapshotを解釈せずrollback時の`FeatureMountContext.restoredState`として同じfeatureへ返す。snapshotを提供できないsourceからのcross-feature activationは表示変更前に拒否する。
- **理由**: feature固有stateをshellへ漏らさず、Requirement 7.4の状態保持とsingle feature ownershipを両立できる。
- **失敗規則**: target cleanup失敗時はtarget handleを保持してsourceをmountしない。epoch、停止、availabilityによりstale化したtargetもcleanup後にのみsourceをrestoreする。

### 判断: 下流feature未実装時の空shell compositionを許可する
- **背景**: application-shellは下流featureの前提specであり、最初から非空catalogを要求すると未実装registrationを待つ循環が生じる。
- **代替案**:
  1. 最初の下流feature実装までproduction compositionを失敗させる — shellの独立実装と検証ができない。
  2. placeholder featureを登録する — production契約へ仮実装が残る。
  3. 空catalogを正規状態として起動する — shell境界を先に完成し、後続featureを公開registrationだけで追加できる。
- **選択**: canonical foundation sourceが利用可能なら空catalogでもproduction shellを起動し、navigationなしのempty stateと型付き空root APIを提供する。
- **理由**: 要件は登録済みfeatureの表示を求めており、未登録featureの存在を要求しない。既存のempty state設計とも一致する。
- **トレードオフ**: application-shell単独では業務機能を提供しないが、後続specの依存循環を解消し、placeholderを不要にする。

### 判断: 常設判定をregistration presentationへ一本化する
- **背景**: transient featureは同じ主表示領域とtyped activationを利用するが、navigation、通常選択、初期選択、fallbackへ現れてはならない。
- **代替案**:
  1. 全registrationへnavigationを必須のまま残し、一過性側で未使用値を埋める — 型上は一過性をnavigation catalogへ誤投入できるため不採用。
  2. navigationを全体でoptionalにする — 常設側の欠損まで許し、consumerごとのnon-null判定へ責務が分散するため不採用。
  3. `presentation`を必須discriminantとし、常設branchだけnavigationを必須、一過性branchではproperty自体を禁止する — 採用。
- **選択**: `PersistentApplicationFeatureRegistration | TransientApplicationFeatureRegistration`をcanonical `ApplicationFeatureRegistration`とする。共通baseには既存のpublic API、availability、mount、任意の`FeatureActivationAdapter`を保持する。`isPersistent`は常設branchへ絞り込むtype predicateとし、navigation catalog生成、通常選択、初期選択、fallbackで共用する。
- **理由**: navigation metadataの存在条件をcompile timeとruntime validationの両方で一意にし、typed activation／一過性lifecycleを失わず業務feature IDをshellへ持ち込まない。
- **移行**: 既存feature registrationは`presentation: "persistent"`を明示する。一過性featureは`presentation: "transient"`を明示しnavigation propertyを持たない。presentationの暗黙default互換分岐は残さない。
- **Follow-up**: public consumer型検査で一過性navigation混入と常設navigation欠損をcompile failure fixtureへ固定し、runtime unknown入力でも同じ相関を拒否する。persistent／transient混在fixtureでnavigation、初期選択、fallback、typed activationを一括検証する。

### 判断: 言語controlはsettingsへ委ね、shellは到達と回復案内だけを合成する
- **背景**: shell headerを撤去しても、loading／startup errorではsettings navigationへ到達できない。
- **選択**: ready／maintenance／feature-local failureではpersistent settings navigationを維持し、loading／global errorでは二言語案内と既存retryだけをstatusへ描画する。
- **理由**: 言語の意味・保存・control配置を`ui-internationalization`／`settings-screen`に残し、shellはhost責務だけを持つ。
- **トレードオフ**: startup error中は言語変更を利用可能と偽らず、二言語で回復経路を示す。

### 判断: UI contributionとworker-safe contributionの分離を維持する
- **背景**: `source-price-refresh`はcontext menu gestureをworkerへ追加する一方、settingsや一過性viewはReact UIを含む。
- **選択**: `side-panel-contributions.ts`だけがUI registrationを、`feature-contribution-catalog.ts`はworker registrationとworker-safe metadataだけを合成する。
- **理由**: service worker bundleのDOM／React非依存を維持し、gesture sourceをcanonical `TransientGestureRegistrationPort`へ接続するownerを変えない。
- **Follow-up**: module graphとproduction worker bundleのboundary testでsettings／feature UI importを拒否する。

### 判断: 保存root異常はrecovery-requiredとしてdegraded startupする
- **背景**: maintenance初期snapshotの全失敗をglobal startup errorへ変換すると、破損・未対応rootを正常backupで回復するsettings区画へ到達できない。
- **代替案**:
  1. startup errorのまま案内だけを表示する — 復元操作へ到達できないため不採用。
  2. inactive snapshotへfallbackする — 保存状態を正常と偽りmutationを許可するため不採用。
  3. typed anomalyだけを`recovery-required`へ写像する — 採用。
- **選択**: `corrupt-data | unsupported-version`ではhostとsettingsを起動し、`read`と`recovery`だけを許可する。通常`mutation`はfail closedで拒否する。購読後の最初の正常snapshotで通常projectionへ復帰する。
- **理由**: shellがStorageや復元protocolを所有せず、保存状態を捏造せずに回復面だけを利用可能にできる。
- **Follow-up**: corrupt/future root起動、settings mount、通常mutation拒否、正常snapshot後のready復帰をproduction-shaped testで固定する。

### 追加リスクと緩和
- transient registrationのnavigation漏れ／persistent registrationのnavigation欠損 — 判別共用体、runtime相関検証、`isPersistent`型述語、混在contract testで防ぐ。
- header撤去後の回復経路喪失 — loading／startup errorの二言語案内と状態別DOM testで固定する。
- corrupt/unsupported rootでbackup区画へ到達不能 — recovery-required projectionと`recovery` operation gateでsettingsだけを回復可能にする。
- worker bundleへのUI混入 — UI／worker catalog分離とartifact boundary gateで拒否する。

### 判断: Project selectorはproject-context所有のpresentation contributionとして合成する
- **背景**: shellの全主要画面に現在projectを表示する一方、選択authorityと表示実装はproject-contextに定義されている。
- **選択**: shellはproject selector slotとlifecycleだけを所有し、project-contextのpresentation contributionを一度だけmountする。production compositionはread/command portを必要なconsumerへ能力別に注入する。
- **理由**: 共通表示をshell layoutへ統合しつつ、catalog解釈、fallback、選択transaction、文言をcanonical ownerへ残せる。
- **トレードオフ**: project-contextはapplication-shellより後に実装されるため、shell単独ではslotのempty/unavailable状態をcontract fixtureで検証し、production wiringは下流specとの統合gateで再検証する。

### 判断: Project context障害はshell全体のstartup failureへ昇格させない
- **背景**: project catalogまたはpreferenceが利用不能でもsettingsとbackup recoveryは利用可能でなければならない。
- **選択**: project-context初期化失敗または`unavailable` snapshotではproject依存featureだけをunavailableにし、shell、settings、backup recoveryを継続する。
- **理由**: projectを推測せずfail closedにしながら、回復経路を保持できる。
- **Follow-up**: unavailableからrefresh成功への復帰、project依存featureの再評価、settings継続をintegration testで固定する。

## 参照
- `.kiro/steering/roadmap.md`
- `.kiro/specs/application-shell/brief.md`
- `src/persistence/public.ts`
- `src/persistence/write-authority.ts`
- `src/persistence/maintenance.ts`
- `src/persistence/maintenance-snapshot-source.ts`
- `.kiro/specs/local-data-foundation/tasks.md` task 5.5
- [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [ReactでTypeScriptを使用する](https://react.dev/learn/typescript)
- [Chrome Extensions Content Security Policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Manifest V3 security migration](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
