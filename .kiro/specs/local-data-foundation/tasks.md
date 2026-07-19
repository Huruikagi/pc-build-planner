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
  - _Requirements: 2.1, 2.4, 2.5, 2.6, 3.2, 3.3, 3.4, 5.4, 6.2, 7.1_

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

## Implementation Notes

- `chrome.storage.local` のread/writeだけではcross-worker CASを構成できず、module-level queueはMV3 worker再生成で失われる。
- `StoragePort.runExclusive`は採用せず、固定名Web Lockを協調writerの線形化点、永続rootのgeneration・owner・lease・revisionをworker再生成後の認可根拠とする。
