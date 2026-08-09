# Implementation Plan

- [x] 1. TypeScript拡張プロジェクトと検証基盤を整える
- [x] 1.1 厳密な型検査、ビルド、テストを実行できる開発環境を構成する
  - Node.js 26とpnpm 11で再現可能なTypeScript、ESMバンドル、テスト、Biomeの設定と共通検証コマンドを追加する
  - `any`を許さないstrict型検査と、未パッケージ拡張成果物を生成するbuild契約を確立する
  - typecheck、lint、空でないsmoke test、buildを連続実行する検証コマンドが成功することを完了条件とする
  - _Requirements: 1.1, 1.2, 8.2_

- [x] 1.2 最小Manifest V3契約と生成物検査を構成する
  - Chrome 116以降、storage権限、最小CSPだけを宣言し、application shell所有のservice worker compositionは追加しない
  - 全サイト権限、unlimitedStorage、remote code、動的評価、inline JavaScriptを検出して失敗する検査を追加する
  - 生成物がChromeで読み込み可能な最小MV3拡張となり、禁止権限・禁止コード検査に合格することを完了条件とする
  - _Requirements: 1.1, 1.2, 1.4, 5.5_

- [x] 2. 共有ドメイン契約と信頼境界の検証を実装する
- [x] 2.1 識別子、日時、schema、結果型の基礎契約を実装する
  - UUID、UTC ISO 8601日時、現行schema version、revision、request IDの生成・検証規約を提供する
  - 検証、破損、移行、修復、競合、保守、容量、アクセス、保存失敗を判別できるcanonical Result契約を定義する
  - 有効値と各失敗が型安全に判別され、初期rootがschemaVersion 1・revision 0で生成されるテストが成功することを完了条件とする
  - _Requirements: 2.5, 3.4, 4.1_

- [x] 2.2 全カテゴリの正規化属性と取得値の共有モデルを実装する
  - 全12カテゴリ、欠損可能な商品情報、出典、元表記、確認値、カテゴリ別正規化属性をJSON直列化可能に表現する
  - 元表記と確認値を別に保持し、生HTML、画像binary、data URL用の保存フィールドを契約へ含めない
  - 架空の全カテゴリ値が型検査とJSON往復を通ることを完了条件とする
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.4_

- [x] 2.3 aggregate rootと永続制御stateの共有モデルを実装する
  - プロジェクト、候補、現在構成、同一プロジェクト内参照、正整数数量を一つの保存rootとして表現する
  - 単調増加revision、有界request dedupe記録、generation・owner・leaseを持つ永続maintenance stateをJSON直列化可能にする
  - 架空rootと初期rootが型検査とJSON往復を通り、参照・制御stateがworkerメモリを必要としないことを完了条件とする
  - _Requirements: 1.3, 2.1, 2.6, 4.1, 7.6_

- [x] 2.4 unknown入力を現行契約へ絞る実行時validatorを実装する
  - 保存root、runtime command、置換候補をunknownから検証し、問題pathと機械判別可能な原因を返す
  - UUID、UTC日時、URL、ID一意性、project内参照、正整数数量、禁止payloadをroot全体で検証する
  - 入力を変更せず、架空の有効値だけを受理し、破損値を正常値として返さないテストが成功することを完了条件とする
  - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.8, 3.2, 3.3, 3.4, 5.4, 6.2, 7.1_

- [x] 2.5 候補の取得元欠損と元表記snapshotを共有モデルへ追加する
  - 取得URL・取得日時を個別に欠損可能にし、取得元全体がない手入力候補も代替値なしで表現する
  - 元表記snapshotをfield名から元表記または明示的な欠損（null）へのread-only mapとして、取得元・確認値と独立して保持する
  - 既存schema 1の型利用を壊さず、完全欠損・部分欠損・key不在・明示的なnullを区別できる公開型になることを完了条件とする
  - _Requirements: 2.1, 2.3, 2.4, 2.7_
  - _Boundary: DomainModel_

- [x] 2.6 取得元欠損と元表記snapshotを保存境界で検証する
  - optionalな取得元全体とURL・日時を検証し、存在する値だけへURL・UTC規約を適用する
  - sourceSnapshotの文字列・nullを受理し、生HTML・画像・data URLとJSON非互換値を拒否する
  - 完全欠損・部分欠損・明示的なnullが入力どおり返り、不正snapshotがpath付き失敗になることを完了条件とする
  - _Requirements: 2.1, 2.4, 2.7, 3.2, 5.4_
  - _Boundary: SchemaValidator_

- [x] 3. 永続化の純粋な方針とChrome adapterを実装する
- [x] 3.1 (P) 連続schema移行レジストリを実装する
  - NからN+1だけを許す移行stepと、現行版まで順序適用する契約を提供する
  - 各stepと最終rootを検証し、将来版、経路欠落、検証失敗を区別してsourceを変更しない
  - 連続移行、将来版拒否、step失敗、source非変更のテストが成功することを完了条件とする
  - _Depends: 2.4_
  - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - _Boundary: MigrationRegistry_

- [x] 3.2 (P) 候補変更に対する参照修復方針を実装する
  - 候補削除とカテゴリ変更で無効になるCurrentBuild itemを除去し、無関係な参照を保持する
  - feature固有の選択数・互換性判断を持たず、修復後rootを同じ保存pipelineで再検証できる形にする
  - 削除、カテゴリ変更、無関係変更の架空rootテストで参照不整合が残らないことを完了条件とする
  - _Depends: 2.4_
  - _Requirements: 2.6, 3.7_
  - _Boundary: ReferenceRepairPolicy_

- [x] 3.3 保存port契約と決定的なin-memory adapterを実装する
  - 単一キーのroot読取・書込、使用量、実行時quota、信頼済みアクセス制限をplatform非依存のtyped portとして定義する
  - worker再生成を模した別instanceから同じ永続rootと制御stateを読めるin-memory adapterを提供する
  - 読取・書込・bytes・quota・アクセス制限の成功失敗を決定的に再現できるcontract testが成功することを完了条件とする
  - _Depends: 2.4_
  - _Requirements: 1.3, 3.5, 5.1, 6.1, 7.6_

- [x] 3.4 (P) 容量評価方針を実装する
  - 実行時quota、設定可能な警告比率、直列化後の必要bytesから保存前後の状態を算出する
  - 既定80%警告を成功metadataとして扱い、10MB超過見込みを識別可能な拒否へ変換する
  - 通常、警告、超過境界の決定的テストが成功することを完了条件とする
  - _Depends: 3.3_
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: CapacityPolicy_

- [x] 3.5 (P) Chrome Storage adapterと信頼済みアクセス制限を実装する
  - 単一キーのroot読取・書込、使用量、実行時quota、TRUSTED_CONTEXTS制限をtyped portとして提供する
  - Chrome APIのquota、アクセス、一般例外を正規化し、失敗時に成功を報告しない
  - in-memory Chrome stubで読取・書込・bytes取得・アクセス制限と既存root保持を確認できることを完了条件とする
  - _Depends: 3.3_
  - _Requirements: 1.3, 3.5, 5.1, 5.3, 6.1_
  - _Boundary: ChromeStorageAdapter_

- [x] 4. 単一root transactionと保守・置換を実装する
- [x] 4.1 (P) 協調writerを直列化するroot write lockを実装する
  - 全writerが共有する固定lock名でexclusive実行し、Storage portへ排他責務を追加しない
  - Web Locks実装と決定的なin-memory実装が同じ協調排他契約を満たすようにする
  - 複数clientの同時要求が順番に実行され、callbackの失敗後も次の要求が進むcontract testが成功することを完了条件とする
  - _Depends: 3.3, 3.5_
  - _Requirements: 1.3, 3.8, 7.4, 7.5, 7.6_
  - _Boundary: RootWriteLock_

- [x] 4.2 (P) generation・owner・leaseによる純粋な保守policyを実装する
  - acquire、renew、release、abort、write認可を永続rootの入力と遷移候補だけで判定する
  - owner外write、期限切れlease、stale generation・owner・revision、破損stateをfail closedに拒否する
  - validなreleaseまたはabort後だけ通常writeが再開可能となる純粋state transition testが成功することを完了条件とする
  - _Depends: 2.4_
  - _Requirements: 1.3, 7.4, 7.5, 7.6, 7.7_
  - _Boundary: MaintenancePolicy_

- [x] 4.3 (P) 検証済みsnapshotだけを返すRepository読取境界を実装する
  - 未保存時は現行版の初期rootを返し、保存値はmigrationと全体validationを通してから公開する
  - 破損、未知の将来版、移行失敗ではsourceを上書きせずtyped failureを返す
  - Repository instanceを再生成しても同じrootを読み、queryが検証済みsnapshotだけを返す統合テストが成功することを完了条件とする
  - _Depends: 3.1, 3.3, 3.5_
  - _Requirements: 1.3, 3.3, 3.4, 4.2, 4.3, 4.4_
  - _Boundary: LocalDataRepository_

- [x] 4.4 (P) mutationのcommit候補を構築する純粋pipelineを実装する
  - 検証済みsnapshotへCRUDを適用し、候補変更時の参照修復と候補root全体の再検証を行う
  - runnerから値で渡された現在bytesとruntime quotaから容量warningまたは拒否を判定する
  - Storage、lock、migration、revision、request dedupeへ依存せず、有効候補と各拒否を決定的に返すテストが成功することを完了条件とする
  - _Depends: 3.2, 3.4_
  - _Requirements: 3.1, 3.2, 3.7, 5.1, 5.2, 5.3_
  - _Boundary: MutationPipeline_

- [x] 4.5 (P) 置換候補の副作用なし評価と決定的tokenを実装する
  - 置換候補をmigration、全体validation、容量評価し、保存値を変更せずassessmentを返す
  - object keyを再帰的に並べたcanonical JSONをUTF-8化し、SHA-256 digestを生成する
  - 同じ候補とcursorではtokenが安定し、候補値・schema・required bytes・revisionの変化でtokenが変わるテストが成功することを完了条件とする
  - _Depends: 3.1, 3.4_
  - _Requirements: 4.2, 5.1, 5.3, 7.1, 7.3_
  - _Boundary: ReplacementCoordinator_

- [x] 4.6 lock内で単一root transactionを完了するrunnerを実装する
  - lock取得後に最新root、現在bytes、runtime quotaを読み、migrationと全体validation後のsnapshotをoperationへ渡す
  - operation候補へmaintenance fence、expected revision、最終root validationを適用し、revisionを一度だけ増やして一回のwriteを行う
  - commit resultが確定するまでlockを保持し、lock・storage失敗では成功を返さず既存rootが保持されるcontract testを完了条件とする
  - _Depends: 4.1, 4.2, 4.3_
  - _Requirements: 1.3, 3.3, 3.4, 3.5, 3.8, 7.2, 7.4, 7.5, 7.6_

- [x] 4.7 mutation候補生成とroot transactionを統合する
  - runnerからpipelineへ検証済みsnapshotとcapacity inputを渡し、CRUD候補を同一transactionでcommitする
  - expected revision競合、参照修復、容量超過、storage失敗をtyped resultへ変換し、中間不整合rootを公開しない
  - 並行mutationでlost updateがなく、候補変更とCurrentBuild参照修復が一つのcommitで観測される統合テストを完了条件とする
  - _Depends: 4.4, 4.6_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 5.1, 5.2, 5.3_

- [x] 4.8 保守policyとroot transactionを統合する
  - lock内の最新rootへ保守遷移とwrite認可を適用し、同時acquireでは一件だけを成功させる
  - ownerなしwrite、stale generation・owner・revisionを保存前に拒否し、永続rootを変更しない
  - 新しいauthorityとlock adapterで再生成してもactive fenceが維持され、releaseまたはabort後に再開する統合テストを完了条件とする
  - _Depends: 4.2, 4.6, 4.7_
  - _Requirements: 1.3, 3.8, 7.4, 7.5, 7.6, 7.7_

- [x] 4.9 評価済みroot置換を単一transactionへ統合する
  - lock内でtoken、候補digest、schema、required bytes、maintenance fence、current revisionを再照合する
  - 一致した候補だけをrevision増分付きの一回のwriteで置換し、成功または失敗を一つの結果として返す
  - token・候補・fence・revision不一致、容量不足、storage失敗のすべてで旧rootが保持される統合テストを完了条件とする
  - _Depends: 4.5, 4.6, 4.8_
  - _Requirements: 4.2, 5.1, 5.3, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 5. 単一write authorityと公開runtime境界を統合する
- [x] 5.1 request ID再試行とrevision競合をroot transactionへ統合する
  - 同じrequest IDとpayloadの再試行へ保存済みreceiptを返し、異なるpayloadの再利用をrequest conflictへ変換する
  - request記録を固定上限でevictし、保持期間外の再送はexpected revisionで判定する
  - runnerのlock内でrequest記録とroot変更が同じcommitになり、instance再生成後も再試行結果が安定するcontract testを完了条件とする
  - _Depends: 4.9_
  - _Requirements: 1.3, 3.1, 3.6, 3.8, 7.6_

- [x] 5.2 下流向けfacadeを実装する単一write authorityを統合する
  - queryを検証済みRepositoryへ、mutation・maintenance・replacementをroot transaction runnerへdispatchする
  - 同一worker内queueは待ち順と負荷制御だけに使い、排他はWeb Lock、再生成後の正しさは永続cursorへ委ねる
  - 公開facadeだけで全commandを実行でき、並行writeでも変更を取りこぼさないcontract testが成功することを完了条件とする
  - _Depends: 5.1_
  - _Requirements: 1.3, 3.1, 3.6, 3.8, 7.4, 7.6_

- [x] 5.3 shell向けworker registrationとfail-closedなcaller境界を実装する
  - unknown messageとcaller classificationを検証し、shell提供の認可を通ったcommandだけをauthorityへ渡す
  - trusted-context access restrictionが成功する前はhandlerを登録せず、失敗時は永続状態を変更しない
  - 不正payload、不許可caller、access restriction失敗を拒否し、具体service worker入口を作らないcontract testを完了条件とする
  - _Depends: 5.2_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 5.4 下流feature向け公開portとimport境界を完成する
  - domain契約、canonical Result、公開facade、worker登録factoryだけを公開する
  - Storage、root lock、Chrome adapter、未検証write、shell具体実装を公開境界から除外する
  - 模擬consumerが公開APIだけで型検査でき、deep import、直接chrome.storage、固定lock迂回を境界検査が拒否することを完了条件とする
  - _Depends: 5.3_
  - _Requirements: 2.1, 3.1, 3.8, 6.3_

- [x] 5.5 信頼済みconsumer向けmaintenance状態通知portを公開する
  - Repositoryの検証済みrootからgeneration・revision・activeだけを返すread-only snapshotを提供する
  - Storage変更通知を同じ検証境界へ通し、開始・終了を購読者へ配信し、解除を冪等にする
  - owner、lease操作、write capability、Storage primitiveを公開せず、破損変更値を正常通知として扱わない
  - 完了時、初期snapshot、開始・終了通知、購読解除、破損拒否のcontract testと公開境界検査が成功する
  - _Depends: 5.4_
  - _Requirements: 7.8_
  - _Boundary: MaintenanceSnapshotSource_

- [x] 5.6 Production runtime contribution initializerを統合する
  - platform必須依存を副作用前に検証し、既存のStorage、migration、Repository、lock、transaction、authority、maintenance通知、worker登録を一つのcanonical graphとして生成する
  - 信頼済みcontextへの初期access restrictionが成功するまでcontributionを返さず、その成功結果をworker登録のfail-closed制限へ再利用する
  - read-only maintenance source、未登録のworker registration、冪等なcleanupだけを返し、Repository、Storage、lock、authority、共有runtime入口を公開しない
  - 完了時、正常なplatformから最小handleを取得でき、不正platformまたはaccess restriction失敗ではtyped failureとなり、部分的なhandleやhandlerが一切公開されない
  - _Depends: 3.5, 4.9, 5.3, 5.5_
  - _Requirements: 1.1, 1.3, 3.1, 6.1, 7.8_
  - _Boundary: RuntimeContributionFactory_

- [x] 5.7 Production contributionの公開・cleanup境界を完成する
  - foundation公開入口へplatform契約、contribution契約、initializerだけを追加し、application shellがdeep importなしで利用できるようにする
  - Repository、Storage、root lock、runner、pipeline、authority、maintenance owner・lease capabilityを公開面から除外したまま維持する
  - initializer所有resourceだけを冪等にcleanupし、consumerが開始したmaintenance購読解除とworker登録解除の所有権を奪わない
  - 完了時、模擬application shellがfoundation公開入口だけで型検査でき、禁止capabilityとdeep importを公開境界検査が拒否する
  - _Depends: 5.6_
  - _Requirements: 3.1, 6.3, 7.8_
  - _Boundary: Foundation Public Runtime Contract_

- [x] 5.8 Foundation所有の引数なしproduction factoryを公開する
  - Chrome Storage、Storage change event、Web Locks、canonical UTC clock、安全なerror reporter、`trusted-extension`固定policyをfoundation内で解決し、既存のcanonical runtime graphを一度だけ初期化する
  - platform DI initializerとplatform契約は既存consumer用の互換seamとして維持し、production consumerが引数なしfactoryと最小contribution handleだけを利用できるようにする
  - global欠落またはgetter例外は`invalid-platform`へ正規化し、access restriction、購読、handler、Repository graphを部分的に開始しない
  - 完了時、公開入口から引数なしで最小handleを取得でき、旧DI consumerの型互換を保ったまま、欠落globalは副作用0件のtyped failureとなり、cleanupが冪等である
  - _Depends: 5.7_
  - _Requirements: 1.1, 1.3, 3.1, 6.1, 6.3, 7.8_
  - _Boundary: ProductionRuntimeContributionFactory_

- [x] 6. 架空データによる回帰・性能・生成物検証を完成する
- [x] 6.1 架空fixtureとasset policyを完成する
  - 全12カテゴリ、欠損値、元表記・確認値、参照整合root、各種破損rootを架空値だけで生成する
  - 生HTML、画像、data URL、実サイト商品値をfixtureへ混入させない検査を追加する
  - 全builderがJSON往復とvalidatorを通り、fixture policy testが成功することを完了条件とする
  - _Depends: 5.4_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.4, 8.1, 8.3_

- [x] 6.2 公開facade経由の基盤回帰を完成する
  - CRUD、破損読取、容量不足、移行成功・失敗、access拒否、参照修復、request conflictを公開facadeだけで検証する
  - maintenance acquire・stale fence・release・abortとroot評価・置換の成功失敗を公開facadeだけで検証する
  - 架空fixtureだけで主要な成功・失敗契約を通す回帰suiteが成功することを完了条件とする
  - _Depends: 6.1_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.2_

- [x] 6.3 (P) 10MB近傍の処理計測を統合する
  - 架空rootでread、migration、validation、repair、canonical serialization、single writeの時間とbytesを個別計測する
  - 実行時間を固定閾値で失敗させず、環境差を含む測定値をtest reportへ残す
  - 10MB近傍の処理がtimeoutせず、全測定項目がreportへ記録されることを完了条件とする
  - _Depends: 6.1_
  - _Requirements: 5.1, 5.3, 8.1, 8.2_
  - _Boundary: Performance Validation_

- [x] 6.4 (P) 並行要求とworker再生成の回帰を統合する
  - 複数clientのlock待機、同時mutationのrevision単調増加、lost update不在を検証する
  - メモリqueueを共有しない新authorityと新lock adapterでactive fenceとrequest retryを再読込する
  - worker再生成後もowner外writeが拒否され、releaseまたはabort後だけ再開する回帰suiteが成功することを完了条件とする
  - _Depends: 5.2, 6.1_
  - _Requirements: 1.3, 3.8, 7.4, 7.5, 7.6, 8.2_
  - _Boundary: Concurrency and Restart Validation_

- [x] 6.5 MV3・公開境界・生成物の最終gateを統合する
  - manifest、Chrome 116、最小権限、CSP、remote import、動的評価、inline JavaScriptを検査する
  - 公開import境界、直接Storage利用、固定lock迂回、fixture assetを生成物とsourceの両方で検査する
  - typecheck、Biome、全test、build、artifact scanが共通検証commandで連続成功することを完了条件とする
  - _Depends: 6.2, 6.3, 6.4_
  - _Requirements: 1.1, 1.2, 1.4, 5.4, 5.5, 6.3, 8.1, 8.2, 8.3_

- [x] 6.6 Production runtime contributionの統合回帰を追加する
  - canonical graphから生成したmaintenance sourceとworker registrationが、同じroot revisionとmaintenance stateを観測することを検証する
  - 同じ永続Storageへgraphを再生成し、active fenceとrevisionを再読込してowner外writeを拒否することを確認する
  - 不正platform、初期access restriction失敗、冪等cleanup、購読解除とworker解除の所有権を架空stubだけで検証する
  - 完了時、production-shaped contract/integration suiteが成功し、worker memoryへ依存しない同一root観測を決定的に再現できる
  - _Depends: 5.7, 6.1_
  - _Requirements: 1.3, 3.1, 6.1, 6.2, 6.3, 6.4, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3_
  - _Boundary: Runtime Contribution Integration Validation_

- [x] 6.7 Runtime contributionを最終validation gateへ統合する
  - production contributionの公開shape、application-shell所有runtime入口の非所有、直接Storage・lock・authorityの非公開をboundaryとartifact検査へ追加する
  - remote code、動的評価、inline JavaScript、過剰権限を含まない既存MV3生成物契約を維持する
  - 完了時、typecheck、Biome、全test、build、artifact scanが共通検証commandで連続成功する
  - _Depends: 6.6_
  - _Requirements: 1.1, 1.2, 1.4, 5.4, 5.5, 6.3, 8.1, 8.2, 8.3_
  - _Boundary: Runtime Contribution Final Validation_

- [x] 6.8 引数なしproduction factoryの統合・公開境界回帰を完成する
  - production-shaped global stubでStorage access restriction、maintenance source、worker registration、固定caller policy、cleanupを検証し、欠落global・getter例外・access restriction失敗をfail closedで回帰する
  - 模擬production shell consumerが引数なしfactoryと最小handleだけで型検査でき、application-shell boundaryがplatform契約、DI initializer、Storage、lock、authorityのproduction利用を拒否することを確認する
  - 旧platform公開shapeのartifact expectationを置き換え、foundationの公開bundle・source boundary・final gateが新契約を連続検査する
  - 完了時、公開contract、production-shaped統合、typecheck、test、build、artifact/boundary scanが成功し、実application-shellの変更はapplication-shell task 4.8に留まる
  - _Depends: 5.8, 6.7_
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 5.4, 5.5, 6.1, 6.3, 7.8, 8.1, 8.2, 8.3_
  - _Boundary: Production Runtime Public Validation_

- [x] 6.9 project削除の構造的カスケードをroot mutationへ統合する
  - project削除を参照修復changeとして識別し、同じprojectIdの候補パーツと現在構成をcommit候補から除去する
  - 別projectのproject・候補・現在構成を保持し、削除後rootを同じpipelineで検証して一回だけcommitする
  - pure policy、MutationPipeline、FoundationDataPort回帰でカスケード結果、既存root保持、単一revision増分を確認できることを完了条件とする
  - _Depends: 6.2_
  - _Requirements: 3.1, 3.2, 3.5, 3.9, 8.2_
  - _Boundary: ReferenceRepairPolicy, MutationPipeline, FoundationDataPort Regression_

- [x] 6.10 候補取得元の後方互換fixture回帰を追加する
  - 既存の取得元付きschema 1 fixtureを受理したまま、取得元なし・部分取得元・元表記snapshot付きの架空候補を追加する
  - sourceSnapshotのkey不在と明示的なnullがJSON往復およびroot検証後も区別され、代替URL・日時が生成されないことを確認する
  - 完了時、架空fixtureだけを使うdomain回帰が新旧両方の有効候補と禁止payload拒否を確認できる
  - _Depends: 2.6_
  - _Requirements: 2.7, 8.1, 8.2, 8.3_
  - _Boundary: FoundationFixtures_

- [x] 6.11 信頼済みUI contextへ絞り込みdata portを公開する
  - production runtime contributionのhandleへ、queryと原子的root mutationだけを転送するfrozenな`FoundationScopedDataPort`を追加する。
  - 同じhandleから`assessReplacement`、`replaceRoot`、`runMaintenance`、Repository、StoragePort、RootWriteLock、runner、pipelineを到達不能に保つ。
  - 別contextで初期化した二つのcontributionが同一固定lockと永続revisionで直列化され、片方の再初期化後も既存rootとmaintenance fenceを認可根拠にすることを回帰する。
  - access restriction失敗時にportを含む全contributionを公開しないことをfail-closedに確認する。
  - _Depends: 6.8_
  - _Requirements: 3.1, 3.8, 3.10, 6.1, 6.4, 7.6, 8.2_
  - _Boundary: FoundationRuntimeContribution, FoundationScopedDataPort_

- [x] 6.12 候補パーツ内容のcanonical validatorを公開する
  - 識別子と日時を除いた候補パーツ内容を検証する`validateCandidatePartContent`をdomainへ実装し、`validateCandidatePartValue`をその委譲へ置き換える。
  - 公開入口から利用でき、`$.product.name`のようなfield単位pathを返すことを架空データで確認する。
  - root、CurrentBuild、maintenance、requestDedupeを偽造せずにdraftを検証できること、および既存root検証の挙動が変わらないことを回帰する。
  - _Depends: 2.6_
  - _Requirements: 2.1, 2.2, 2.4, 2.7, 3.2, 3.11, 8.1, 8.2_
  - _Boundary: SchemaValidator, DomainPublicApi_

- [x] 6.13 信頼済みUI context向けに完全なFoundationDataPortを公開する
  - production runtime contributionのhandleへ、query・mutate・assessReplacement・replaceRoot・runMaintenanceのすべてを転送する完全な`FoundationDataPort`を追加する。既定の`FoundationScopedDataPort`（6.11）は変更せず併存させる。
  - 完全portは同じ固定名Web Lockと永続root revision・maintenance fenceで絞り込みportと直列化され、単一write authorityの不変条件を維持することを回帰で確認する。
  - Storage access restriction失敗時は完全portを含む全contributionを公開しないことをfail-closedに確認する。
  - 完了時、模擬trusted-extension consumerが完全portだけでassessReplacement→replaceRoot→runMaintenanceの一連呼び出しを型検査でき、既存の絞り込みport契約・consumerには挙動変化がないことを確認できる。
  - _Depends: 6.11_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 3.1, 3.8, 3.10, 6.1, 6.4, 8.2_
  - _Boundary: FoundationRuntimeContribution, FoundationDataPort_

- [ ] 7. 現行schema契約と異常root回復の基礎を追加する
- [x] 7.1 現行schema versionの正規契約を一元化する
  - 既存のruntime schema基盤を利用し、初期root、migration、通常置換、回復候補評価が同じ公開正規値を参照する
  - 保存schemaの数値を別moduleやconsumerで重複定義せず、schemaの値と保存構造自体は変更しない
  - 公開consumerが唯一の正規値を参照でき、各保存経路と交換形式向け写像で一致することを検証できる状態を完了条件とする
  - _Requirements: 4.6, 4.7_
  - _Boundary: SchemaContract_

- [x] 7.2 保存rootの固定形状をcanonical検証へ統合する
  - 業務rootの固定keyだけを受理し、表示言語などroot外の利用者設定を予期しないfieldとして拒否する
  - root外の回復controlをdomain rootと交換形式へ含めず、既存の有効な保存root形状を維持する
  - root外設定または回復controlが混入した入力をfield位置付きで拒否し、正規rootだけが保存経路へ進めることを完了条件とする
  - _Requirements: 2.8, 3.2, 4.7_
  - _Boundary: SchemaValidator_

- [x] 7.3 (P) 異常rootと回復制御を扱う保存adapter契約を追加する
  - 正常decodeを前提にせずraw rootを読み、root外の最小回復controlを独立keyで読み書きできる保存契約を提供する
  - 容量計測はrootと回復controlの両keyを含み、Storage例外を機械判別可能な失敗へ変換する
  - raw rootや回復owner・leaseを公開portへ露出せず、正常・破損・未対応rootとcontrol欠損を架空adapterで再現できる状態を完了条件とする
  - _Depends: 7.1_
  - _Requirements: 5.1, 5.3, 6.1, 7.9, 7.10, 7.12_
  - _Boundary: ChromeStorageAdapter_

- [x] 7.4 (P) root外の回復generation・owner・lease方針を実装する
  - control欠損をinactive generation 0として扱い、取得・更新・終了・中止を純粋な状態遷移として判定する
  - stale generation、owner、leaseを拒否し、通常writerがactive回復中を識別できる認可結果を返す
  - worker memoryを共有しない再生成後も永続controlだけから同じactive判定と次generationを得られることを完了条件とする
  - _Depends: 7.1_
  - _Requirements: 1.3, 7.12, 7.13_
  - _Boundary: RecoveryControlPolicy_

- [x] 7.5 異常root分類と回復候補評価を統合する
  - raw rootを正常値として公開せず、canonical fingerprint付きの破損または未対応versionへ分類する
  - 既存の置換評価を回復境界へ接続し、候補をmigration、全体検証、容量判定してcurrent anomalyと候補拒否理由を別fieldで返す
  - 同じraw rootと候補ではcursorが安定し、raw値・候補digest・schema・必要bytes・control generationの変化を検出でき、評価中に保存値が変わらないことを完了条件とする
  - _Depends: 7.2, 7.3, 7.4_
  - _Requirements: 4.2, 4.3, 4.7, 5.1, 5.3, 7.9, 7.10, 7.11, 7.13_
  - _Boundary: RecoveryCoordinator, ReplacementCoordinator_

- [x] 8. 回復fencing・原子的置換・用途別公開portを統合する
- [x] 8.1 すべてのwriterへactive回復controlのfencingを統合する
  - 通常mutation、通常置換、root内保守操作、回復操作が同じ固定Web Lock内で最新controlを確認する
  - active回復中はownerを持たない通常writerを一貫して拒否し、worker再生成や並行要求でもrootを変更しない
  - 回復controlの読取失敗や不正値ではfail closedとなり、既存rootを保持する統合結果を完了条件とする
  - _Depends: 7.3, 7.4_
  - _Requirements: 1.3, 3.5, 3.8, 7.4, 7.5, 7.6, 7.12, 7.13_
  - _Boundary: RootTransactionRunner_

- [x] 8.2 回復保守操作をlock付きtransactionへ統合する
  - 異常rootをdecodeせず、同じ固定Web Lock内で回復controlの取得・更新・終了・中止を直列化する
  - 同時取得は一件だけ成功させ、stale owner・generation・leaseと再生成前ownerの操作を拒否する
  - 正常終了または明示中止後だけ後続writerが再開し、中断時はactive controlが残ることを完了条件とする
  - root write前のcleanup中断はassessment ticketとowner/generationを結び付け、同じticketだけがworker再生成後もcleanupをroot write 0件で冪等再開できることを固定する
  - _Depends: 7.5, 8.1_
  - _Requirements: 7.4, 7.5, 7.6, 7.7, 7.12, 7.13_
  - _Boundary: RootTransactionRunner, RecoveryControlPolicy_

- [x] 8.3 評価済み候補による回復root置換を完成する
  - commit直前にraw fingerprint、candidate digest、target schema、required bytes、control generation・owner・leaseを再照合する
  - 一致した候補だけをroot keyへ一回writeし、各stale条件、容量不足、保存失敗では異常rootを変更しない
  - 成功後は検証済み通常queryとmutationが利用可能になるまでcontrolをactiveに保ち、確認後のreleaseで通常利用へ復帰できることを完了条件とする
  - _Depends: 8.2_
  - _Requirements: 3.3, 3.5, 4.7, 5.3, 7.12, 7.13, 7.14_
  - _Boundary: RootTransactionRunner, RecoveryCoordinator_

- [x] 8.4 commit後finalizationを再開可能な用途限定処理として完成する
  - root write後のcontrol cleanup失敗を、commit済みrootを再書込せず再開できる識別可能なfinalization要求として返す
  - opaque ticketを永続状態から再発見し、別consumerまたはworker再生成後もowner・generation・commit結果を照合してfinalizeだけを冪等に再試行する
  - finalize再試行でroot writeが0件となり、完了後はticketが再発見されず通常操作が再開可能になることを完了条件とする
  - _Depends: 8.3_
  - _Requirements: 7.14, 7.15, 7.17_
  - _Boundary: RecoveryCoordinator, RecoveryControlPolicy_

- [x] 8.5 通常UIとbackup-restoreの用途別公開portを統合する
  - 通常UI handleはqueryと原子的mutationだけを維持し、置換・保守・回復・Storage・lockへ到達不能にする
  - backup-restore専用handleへ正常rootの評価・保守・全体置換と、異常rootの候補評価・回復保守・評価済み全体置換・finalization再開だけを一つの用途限定契約として公開する
  - backup専用contractから通常CRUD、未検証root、保存adapter、排他制御、内部write authorityへ到達できず、opaque ticketからroot writeを開始できないようにする
  - production factoryのaccess restriction失敗時は両portを含むhandleを公開せず、composition ownerがbackup専用能力をbackup-restoreだけへ提供できる状態を完了条件とする
  - _Depends: 8.4_
  - _Requirements: 3.10, 6.1, 6.3, 7.1, 7.2, 7.3, 7.10, 7.12, 7.14, 7.15, 7.16, 7.17_
  - _Boundary: RuntimeContributionFactory, FoundationScopedDataPort, BackupRestoreDataPort_

- [ ] 9. 架空データによる回復回帰と最終gateを完成する
- [x] 9.1 異常root・回復control・候補評価の決定的回帰を追加する
  - 架空の破損rootと将来version rootだけで分類、fingerprint、候補不正・未対応・容量超過、二重診断を検証する
  - control遷移、stale generation・owner・lease、worker再生成、raw非露出と評価時非変更を検証する
  - unit・contract suiteが実サイト由来assetなしで全拒否理由を安定して再現できることを完了条件とする
  - _Depends: 7.5, 8.2_
  - _Requirements: 7.9, 7.10, 7.11, 7.12, 7.13, 8.1, 8.2, 8.3_
  - _Boundary: Recovery Validation_

- [x] 9.2 回復transactionと公開runtime境界の統合回帰を追加する
  - 各stale cursor、並行writer、worker再生成、root write失敗、中断後active controlを公開port経由で検証する
  - control取得後かつroot write前のcleanup失敗から同じassessment ticketで再開し、cleanup中のroot write 0件、別ticket拒否、cleanup後の再assessmentを検証する
  - root write後のcleanup失敗を新しいconsumerがopaque ticketとして再発見し、finalize-only retryが追加root write 0件で完了することとticketからwrite capabilityへ到達できないことを検証する
  - 回復成功後の通常query・mutation復帰と、通常UI・回復portの相互capability非露出を検証する
  - production-shaped graphと架空Storageで単一root write、旧root保持、fail-closed初期化が観測できることを完了条件とする
  - _Depends: 8.5, 9.1_
  - _Requirements: 1.3, 3.3, 3.5, 3.8, 6.1, 6.3, 7.12, 7.13, 7.14, 7.15, 7.17, 8.1, 8.2_
  - _Boundary: Recovery Transaction and Runtime Contract Validation_

- [x] 9.3 schema正規値・回復境界・生成物の最終gateを統合する
  - schema正規値の重複、root外設定の混入、raw root・回復control・旧完全portの公開、Storage・lock迂回をsourceとartifactで拒否する
  - fixture資産、MV3権限、CSP、remote code、動的評価、inline JavaScriptの既存検査を維持する
  - typecheck、Biome、全test、build、boundary・fixture・artifact scanが共通検証commandで連続成功することを完了条件とする
  - _Depends: 9.2_
  - _Requirements: 1.1, 1.2, 1.4, 2.8, 4.6, 4.7, 5.4, 5.5, 6.3, 7.9, 7.10, 7.12, 7.14, 8.1, 8.2, 8.3_
  - _Boundary: Recovery and Schema Final Validation_

## Implementation Notes

- 候補取得元の欠損や元表記snapshotは下流で補完せず、Foundationのoptional canonical契約へそのまま保存する。

- 絞り込みdata portはwrite authorityのfrozen viewであり、単一write authorityの根拠はJSインスタンス数ではなく固定名Web Lockと永続rootのrevision・maintenance fenceである。

- project削除はReferenceRepairPolicyで同じprojectIdのcandidateとCurrentBuildを除去し、MutationPipelineの全体検証と単一commitへ閉じる。

- production公開factoryはplatform primitiveをconsumerから受け取らず、foundation内部でglobal解決と固定policyを完了してから非公開DI seamへ委譲する。

- `chrome.storage.local` のread/writeだけではcross-worker CASを構成できず、module-level queueはMV3 worker再生成で失われる。
- `StoragePort.runExclusive`は採用せず、固定名Web Lockを協調writerの線形化点、永続rootのgeneration・owner・lease・revisionをworker再生成後の認可根拠とする。

- 7.1: 保存schema versionの正規値は`src/persistence/schema.ts`が所有し、`persistence/public.ts`経由でconsumerへ公開する。`src/domain/`側の型literal（`model.ts`の`schemaVersion: 1`、`foundation-schema.ts`の`z.literal(1)`）はdomain→persistenceの依存反転になるため、この一元化の対象外とする。

- 6.13: `FoundationRuntimeContribution`へ`fullDataPort`を追加する過程で、`tests/persistence/runtime-contribution.test.ts`の`platform()` fixtureが`storageLocal.set()`を no-op のまま実装しており、write-then-read（acquire→assessReplacement→replaceRoot）を検証する新testで初めて顕在化した。fixtureの`get`/`set`を実際に永続化するmutable変数へ修正した。既存の`FoundationScopedDataPort`とconsumer（backup-restore以外の全feature）は無変更。
