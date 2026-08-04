# Research & Design Decisions

## Summary

2026-08-04のfull discoveryでは、追加要件4.6–4.7と7.9–7.17を既存実装へ統合する境界を、現行コードとChrome公式契約に照らして再検証した。通常Repositoryは破損・未対応版を既にfail-closedに分類できるが、既存の置換評価・maintenance取得・置換commitはいずれも最初にcurrent rootの正常decodeを要求するため、異常rootからの回復には到達できない。現行schema値を変えず、公開正規値の一元化、raw fingerprint、root外の最小RecoveryControlを追加し、正常置換と異常回復だけを束ねる用途別`BackupRestoreDataPort`をproduction handleから公開する設計を採用する。
- **Feature**: `local-data-foundation`
- **Discovery Scope**: Complex Integration（full discovery、Task 4.1 blocker再設計）
- **Key Findings**:
  - domain、validator、migration、reference repair、Storage adapter、capacity policyまで実装済みであり、maintenance以降の設計境界を既存コードへ統合する必要がある。
  - `chrome.storage.local` はChrome 114以降10MBだが既定ではcontent scriptからも利用できるため、起動時に`TRUSTED_CONTEXTS`へ制限する必要がある。
  - Storage APIは比較交換トランザクションを提供しない。commit前再読込やworker内Promise queueだけではread-check-write競合を閉じられない。
  - Web Locks APIはWorker contextへexclusiveな協調排他を提供する。永続root内のgeneration/owner fenceと組み合わせることで、同時writerの線形化とworker再生成後のfail-closed認可を分離できる。
  - foundationはmanifestとデータruntime登録契約を所有し、共有service worker composition入口は後続`application-shell`へ委譲する。
  - backup-restoreへ完全`FoundationDataPort`を渡さず、正常置換3操作と異常回復3操作だけを一つのfrozen facadeへ限定できる。

## Research Log

### 2026-08-04 platform契約の再検証

- **Context**: `BackupRestoreDataPort`を既存の単一write authorityへ統合する前提として、容量、信頼済みcontext制限、worker再生成、協調排他のplatform制約が現行仕様でも成立するかを確認した。
- **Sources Consulted**: Chrome Storage API、Chrome Extension service worker lifecycle、Web Locks API仕様とWorker利用契約、既存`src/persistence/`実装、`package.json`。
- **Findings**: `storage.local`は10MB上限、`getBytesInUse()`、`setAccessLevel(TRUSTED_CONTEXTS)`を提供する一方、複数contextをまたぐCAS transactionは提供しない。MV3 service workerのglobal stateは停止時に失われる。Web Locksは同一originのtab/worker間で名前付きexclusive lockを協調取得でき、callback完了時に解放される。
- **Implications**: Storage adapterは永続化と容量・access restrictionだけを所有し、比較交換を仮定しない。固定名Web Lockをread-check-writeの線形化点、root revisionと永続maintenance/recovery controlを再生成後の認可根拠とする既存判断を維持する。backup専用facadeは同じrunnerへ委譲し、独自queue・lock・Storage adapterを追加しない。
- **Synthesis**: Build vs. AdoptではChrome StorageとWeb Locksを採用し、transaction protocolだけを既存foundation内で構成する。Generalizationは正常置換と異常回復の公開commit/finalize形状に限定し、保存algorithmを統合し直さない。Simplificationとして新authority、第二のrepository、backup固有adapterを作らない。

### 候補取得元契約の下流整合性
- **Context**: `project-candidate-management` task 2.3のレビューで、取得元がない手入力候補をcanonical `CandidatePart`へ変換できず、元表記snapshotも永続化できないことが判明した。
- **Sources Consulted**: `local-data-foundation`、`project-candidate-management`、`product-page-capture` のrequirements/designと現行domain validator。
- **Findings**: 現行型は`sourceInfo.pageUrl`と`capturedAt`を必須にする一方、下流要求は両方の欠損を許容する。設計済みの`sourceSnapshot`も実装契約に存在せず、下流が架空URL・日時を生成するか元表記を捨てるしかない。
- **Implications**: schema versionを変えずにoptional fieldとして契約を拡張し、欠損をそのまま保持する。`SourceSnapshot`は元表記だけのread-only mapとし、確認値・取得元とは独立して検証する。

### 現行コードベースと所有境界
- **Context**: greenfieldの実装範囲とroadmap更新後のcanonical ownerを確認した。
- **Sources Consulted**: `package.json`、`.kiro/steering/{product,tech,structure,roadmap}.md`、対象specのrequirements/design/tasks
- **Findings**: application sourceは未実装である。最新roadmapはroot runtime、side panel、feature compositionをapplication shellへ、共通`Result<T, E>`、保存primitive、write authority、参照修復をfoundationへ割り当てている。
- **Implications**: foundationは`src/runtime/service-worker.ts`やroot `src/index.ts`を作らず、worker registration portとadapterを公開する。manifestは背景workerなしでも読み込める最小MV3骨格としてfoundationが所有し、application shellが後続でcomposition設定を追加する。

### Chrome Storage APIと容量
- **Context**: 容量、アクセス制御、書込失敗の契約を確定する必要がある。
- **Sources Consulted**: Chrome Storage API公式資料（2026-05-05更新）
- **Findings**: `storage.local.QUOTA_BYTES`は10,485,760 bytesで、キー長とJSON直列化後の値を含めて計測される。超過更新はPromiseをrejectする。`getBytesInUse()`で使用量を取得できる。既定ではcontent scriptにも公開されるが、Chrome 102以降は`setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})`で制限できる。
- **Implications**: 固定値だけでなく実行時`QUOTA_BYTES`を上限根拠にし、警告閾値は設定可能な比率として扱う。事前見積りと書込rejectの両方を`CapacityStatus`/`quota-exceeded`へ正規化する。

### MV3 service workerと排他
- **Context**: 書込直列化と保守leaseをworkerメモリだけへ置けるか確認した。
- **Sources Consulted**: Extension service worker lifecycle、About extension service workers、Web Locks API仕様、Chrome StorageArea公式資料
- **Findings**: workerは必要時に起動・休止し、global変数は停止時に失われる。`chrome.storage.local`はCAS、transaction、条件付きsetを提供せず、二度のreadもTOCTOUを閉じない。Web LocksはWorker context間の同名exclusive lockを提供し、callback完了・throw・worker終了で解放されるが永続lockではない。
- **Implications**: 固定名Web Lockをroot read-check-writeの線形化点とし、rootの`revision`、処理済みrequest ID、maintenance generation/owner/leaseを再生成後のsource of truthにする。Promise queueは任意の負荷制御に限定し、Storage adapterへ排他責務を追加しない。

### Task 4.1 blockerと既存実装境界
- **Context**: 別coordinatorの同時`acquire`が双方成功し、adapter内WeakMap queueによる修正もworker再生成に耐えなかった。
- **Sources Consulted**: `src/persistence/{repository,chrome-storage-adapter,in-memory-storage-adapter,maintenance}.ts`、Task 4.1 review/debug report、Chrome/Web Locks公式資料
- **Findings**: `StoragePort.runExclusive`は承認済みI/O portから逸脱し、Chrome adapterのWeakMapは同一realmと同一API objectにしか効かない。in-memory adapterの共有tailは本番より強い偽の保証を作る。一方、maintenanceの純粋なgeneration/owner/lease state transitionとstale fence規則は再利用できる。
- **Implications**: `StoragePort`をI/Oだけへ戻し、`RootWriteLock`と`RootTransactionRunner`を独立境界として追加する。Task 4.1はpure `MaintenancePolicy`とlock付きtransaction統合を実装し、後続WriteAuthorityはそのrunnerへ全commandをdispatchする。

### タスクグラフレビューによる責務明確化
- **Context**: 初回タスク再生成レビューでrunnerとpipelineのStorage ownership、Repository facadeの完成時点、replacement digest、最終検証粒度に矛盾または不足が見つかった。
- **Sources Consulted**: `design.md`の通常mutation・replacement flow、Components and Interfaces、Testing Strategy、task graph sanity review
- **Findings**: sequence diagramに旧pipeline-owned reread/writeが残り、runner契約と矛盾していた。公開Repositoryと内部read/query portも同じinterfaceへ混在し、digest canonicalizationが未定義だった。
- **Implications**: runnerをlock/read/migration/validation/revision/single-writeの唯一owner、pipelineをcandidate builder、WriteAuthority実装の`FoundationDataPort`を公開facadeとする。replacementはcanonical JSON UTF-8とSHA-256を固定し、fixture、public-port regression、performance/concurrency、final artifact gateを独立検証境界へ分割する。

### 設計参照の最終正規化
- **Context**: タスク再生成前のcontext reviewで、本文修正後もarchitecture図、testing ownership、traceability、未生成task番号参照に旧表現が残っていた。
- **Sources Consulted**: `design.md` Architecture Pattern、Requirements Traceability、Components and Interfaces、Testing Strategy
- **Findings**: 図の`MutationPipeline -> StorageAdapter`と統合testのretry/storage責務がrunner・authority契約に反し、設計内task番号は再生成前のgraphを不必要に固定していた。
- **Implications**: 図とtest ownershipをRunner/Pipeline/Authority境界へ統一し、3.1をwrite path全体へtraceし、設計本文からtask番号を除去する。以後task graphはcomponent boundaryだけから生成する。

### Ownership監査の最終修復
- **Context**: 独立設計監査でMutationPipelineのcoverage、CapacityPolicy依存、replacement図、検証file分割に旧責務が残っていた。
- **Sources Consulted**: design review gate、`design.md`のFile Structure Plan、traceability、component summary、flows、Testing Strategy
- **Findings**: candidate builderの表にread/write競合要件が混在し、CapacityPolicyがStoragePortへ依存していた。performanceとconcurrencyも一つのtest fileへ併合され、final gateの物理境界が不足していた。
- **Implications**: runnerがcapacity inputを取得し、CapacityPolicyとPipelineは純粋化する。performance、concurrency/restart、fixture policy、final validationを別fileへ分割し、replacement図にもrunner内のmigration・token/fence検証・revision増分を明示する。

### MV3コードとCSP
- **Context**: 未パッケージ拡張の実行制約を確認した。
- **Sources Consulted**: Manifest V3、extension security、manifest CSP公式資料
- **Findings**: MV3は同梱コードを前提とし、remote hosted codeと任意文字列実行を制限する。minimum Chrome versionをmanifestで宣言できる。
- **Implications**: `minimum_chrome_version: "116"`を設定し、remote code、`eval`、`new Function`、inline JavaScriptをbuild検査で拒否する。

### 検証・移行・置換
- **Context**: unknownな保存値とバックアップ候補を安全に扱う必要がある。
- **Sources Consulted**: 要件、TypeScript型消去、単一root方式の制約
- **Findings**: compile-time型だけではstorage/JSONを検証できない。10MB以内の単一rootは参照整合性の全体検証と一括`set`に適する。
- **Implications**: boundary inputは`unknown`として検証し、`assessReplacement`は副作用なし、`replaceRoot`は評価tokenとmaintenance fenceを要求する。移行は純粋な`N -> N+1`連鎖とする。

### 異常rootからの回復境界
- **Context**: 7.9–7.14は、current rootが破損または未対応版でも候補評価と明示的回復を要求する。
- **Sources Consulted**: `src/persistence/{repository,root-transaction-runner,replacement,maintenance,runtime-contribution,schema}.ts`、関連contract/integration tests、Chrome StorageとWeb Locksの既存調査結果
- **Findings**: Repositoryの通常readは異常種別を返せるが、runnerの評価・maintenance・置換は検証済みrootのrevisionとroot内maintenanceを前提とする。異常root内へ新しいowner stateを書けば元データ保持に反し、worker memoryだけでは再生成耐性を満たさない。`schema.ts`の正規値がpublic entryから未公開で、`replacement.ts`に同値のローカル定義もある。
- **Implications**: raw rootを公開せずcanonical fingerprintだけをcursorへ束縛する。回復owner/generation/leaseは別keyの最小RecoveryControlへ永続化し、全writerが固定Web Lock内で確認する。回復root write後にcontrolをreleaseする二段階とし、中断時はactiveのまま安全側に停止する。schema版は`CURRENT_SCHEMA_VERSION`だけを公開・参照する。

### 候補draftとruntime portの既存統合点
- **Context**: 3.10、3.11の設計反映と変更範囲を確認した。
- **Sources Consulted**: `src/domain/validation.ts`、`src/domain/public.ts`、`src/persistence/{write-authority,runtime-contribution,public}.ts`、関連tests
- **Findings**: ID・日時なし候補内容のcanonical validatorとfield path error、query/mutateだけのfrozen scoped portは実装済みである。一方、runtime contributionには広いfull data portも存在するため、通常UIと復元機能の注入境界を設計上明示する必要がある。
- **Implications**: validatorは新規規則を作らず既存canonical契約を公開・回帰する。通常UIは`FoundationScopedDataPort`、backup-restoreは最小`RecoveryDataPort`を受け取り、汎用full capabilityのconsumer注入を禁止する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| Ports and adapters + single write authority | domain契約をChrome APIから分離し、mutationを一つのauthorityへ集約 | 型安全、テスト容易、整合性境界が明確 | worker message contractが必要 | 採用 |
| Web Lock + durable fence | 同名exclusive lockで協調writerを線形化し、ownershipはrootへ永続化 | StoragePortを純粋に保ち、worker再生成後もfail-closed | lock迂回writerを技術的には防げない | 採用 |
| raw fingerprint + sidecar RecoveryControl | 異常rootをdecodeせず状態を束縛し、回復ownerを別keyへ永続化 | 元rootを変更せずbootstrapでき、worker再生成に耐える | root writeとcontrol releaseは二段階 | 異常root回復に限定して採用 |
| Adapter内Promise/WeakMap queue | Storage adapterごとにread-check-writeを直列化 | 同一realmでは簡単 | worker再生成、別API facadeで消失しtest doubleが過剰保証 | 不採用 |
| IndexedDB transaction | readwrite transactionで厳密なatomicityを得る | 複数realmでもtransactional | chrome.storage.local単一root、容量・backup設計を変更 | MVPでは不採用、crash durability必須時に再検討 |
| 各featureからStorage API直接利用 | featureごとにread-modify-write | 初期コードが少ない | lost update、検証・排他の分散 | 不採用 |
| エンティティ別キー | project/part/buildを分割保存 | 小さい部分更新 | Chrome Storageに複数キーtransactionがなく参照整合性が複雑 | MVPでは不採用 |
| 外部schema library | 宣言的runtime validation | 型と検証の重複を削減可能 | 未導入toolchainへの依存追加 | 実装開始時に最新版適合性を再評価。設計はlibrary非依存 |

## Design Decisions

### Decision: 取得元と元表記snapshotを独立したoptional契約にする
- **Context**: 手入力候補と部分的なページ取得結果を同じcanonical modelで表現し、存在しない値の捏造を防ぐ必要がある。
- **Selected Approach**: `CandidatePart.sourceInfo`を任意化し、`SourceInfo`のURL・日時も個別に任意化する。`sourceSnapshot`は`Record<string, string | null>`として任意に保持する。
- **Rationale**: 既存schema 1の有効値を壊さず、完全欠損・部分欠損・取得済みを区別できる最小の後方互換拡張になる。
- **Follow-up**: domain型、validator、fixture回帰を更新し、候補管理task 2.3を再レビューする。

### Decision: production runtime contributionをfoundation公開no-arg factoryへ集約する
- **Context**: application-shellがcanonical maintenance sourceとworker registrationを必要とする一方、現行公開面だけではRepository、Storage adapter、runner、authorityをdeep importせずproduction graphを構築できない。
- **Alternatives Considered**:
  1. application-shellがpersistence内部constructorを直接組み立てる — foundation所有権と公開import境界を破る。
  2. foundationが共有service worker入口を所有する — application-shellの単一composition ownerと競合する。
  3. foundationが最小runtime contribution initializerを公開する — 内部graphを隠しながらshellへ必要portだけを渡せる。
- **Selected Approach**: 公開factoryは引数を取らずChrome Storage・change event・Web Locksをfoundation内で解決する。caller classificationはshellが所有し、foundationは分類済みcallerの`trusted-extension`固定policy、canonical UTC clock、安全なerror-code reporterを所有する。解決後は非公開のplatform DI seamがcanonical persistence graphを一度だけ生成し、`MaintenanceSnapshotSource`、`DataWorkerRegistration`、冪等`dispose`だけを返す。
- **Rationale**: Storage、Repository、lock、authorityとplatform構築をfoundation所有に維持し、application-shellはruntime sender分類、listener、UI compositionだけを所有できる。初期access restrictionによりside panelとworkerの起動順へ安全性を依存させない。
- **Trade-offs**: production testは`globalThis`のChrome/Web Locks stubを復元可能に差し替える必要がある。既存consumerの型安全な段階移行のためplatform DI initializerの互換exportは維持するが、application-shell boundary gateでproduction利用を拒否し、platform所有権の再流入を防ぐ。
- **Follow-up**: public consumer型検査、global欠落・getter例外、同一root観測、worker再生成、access restriction失敗、cleanup所有権、shellのStorage/lock非依存をcontract testで固定する。

### Decision: 単一バージョン付きrootとrevision
- **Context**: 参照整合性、競合検出、全体置換を同じ境界で扱う。
- **Alternatives Considered**: entity別キー、event store、単一root。
- **Selected Approach**: `LocalDataRoot`を一つのstorage keyに保存し、`schemaVersion`と単調増加`revision`を持たせる。
- **Rationale**: MVP容量内で全体検証、候補変更とCurrentBuild修復、置換を一つのcommitへ閉じられる。
- **Trade-offs**: 全体再直列化コスト。10MB近傍の性能を測定し、分割時は全dependent specを再検証する。

### Decision: Web Lockを線形化点、永続fenceを再生成後の認可根拠にする
- **Context**: Storage APIにCASがなく、複数extension contextからのread-modify-writeはlost updateを起こし得る。
- **Alternatives Considered**: worker内Promise queue、adapter内WeakMap queue、commit前再読込、Web Locks、IndexedDB transaction。
- **Selected Approach**: application shellがcompositionする単一worker authorityへ全mutationを送り、全writeを固定名exclusive Web Lock内の`RootTransactionRunner`で実行する。lock取得後にrootを読み、request ID、expected revision、maintenance generation/ownerを検証し、参照修復後のrootだけを一回の`set`でcommitする。
- **Rationale**: Web Lockは同時協調writerを線形化し、永続fenceはlockやworker memoryが消えた再生成後もstale ownerを拒否する。二つの保証を混同せず、StoragePortをI/O専用に維持できる。
- **Trade-offs**: Web Locksは協調lockであり、直接`chrome.storage.local.set`するtrusted codeを防げない。boundary testと公開port制限が必須で、Chrome crash時のdurable transactionは保証対象外とする。
- **Follow-up**: Chrome実機でworker強制停止・再生成、同時command、callback失敗後のlock解放を検証する。

### Decision: 保守leaseはgenerationとownerでfenceする
- **Context**: 復元中の通常write、worker再生成、stale ownerを拒否する。
- **Selected Approach**: 永続`MaintenanceState`にgeneration、ownerId、lease期限、revisionを保存し、置換を含む全commit直前に再検証する。
- **Rationale**: worker memoryを正とせず、古いownerのwriteを判別可能に拒否できる。
- **Trade-offs**: lease期限切れ回復が必要。時刻だけで所有権を再利用せず、新generation取得を必須にする。

### Decision: maintenance観測portをfoundationが所有する
- **Context**: application shellは保守中の表示とmutation抑止に最新状態を必要とするが、Storage構造やlease操作を所有しない。
- **Alternatives Considered**: shellがStorage変更を直接監視する、foundationがread-only snapshot/subscribe portを公開する。
- **Selected Approach**: foundationが検証済みrootからgeneration・revision・activeだけを公開し、Storage変更値も同じ検証境界を通して通知する。
- **Rationale**: 永続形式と変更検出の知識をfoundationへ閉じ、shellを表示projectionとoperation policyに限定できる。
- **Trade-offs**: foundation公開契約が一つ増える。owner、lease、write capability、Storage primitiveは公開しない。

### Decision: 参照修復policyをfoundationが所有する
- **Context**: 候補削除・カテゴリ変更とCurrentBuild修復を別writeにするとinvalidな中間rootが生じる。またprojectだけを削除すると所属candidateとCurrentBuildが孤立し、root validationに失敗する。
- **Selected Approach**: generic `mutateRoot` pipeline内でfoundation-owned `ReferenceRepairPolicy`を適用し、candidate変更時のbuild参照修復に加えて、project削除時は同じprojectIdのcandidateとCurrentBuildをcandidate rootから除去する。全体検証後に一度だけcommitする。
- **Rationale**: project参照の構造的不変条件をfoundationへ閉じ、下流featureによる複数writeや保存順序依存を防ぐ。別projectのentityは保持し、業務選択規則は持たない。
- **Follow-up**: pure policy、MutationPipeline、FoundationDataPort回帰でproject削除カスケードと単一writeを固定し、`project-candidate-management` 2.2を再検証する。

### Decision: canonical Resultを自作し、実装は最小化する
- **Context**: 全featureで同じ失敗契約が必要である。
- **Selected Approach**: `Result<T, E>`とfoundation error unionを`src/domain/result.ts`で所有する。Chrome以外のadapter、同期、export I/Oは実装しない。
- **Rationale**: 小さい安定契約で追加runtime依存を避ける。

### Decision: 異常root回復はraw fingerprintとRecoveryControlでfenceする
- **Context**: 破損・未対応版rootではrevisionとroot内maintenanceを信頼できないが、候補評価・commit間の保存状態変化とstale ownerを拒否する必要がある。
- **Alternatives Considered**: 異常rootへmaintenance stateを書き込む、worker memory lease、Web Lockだけ、root外の永続control。
- **Selected Approach**: raw rootのcanonical SHA-256 fingerprintを評価cursorへ束縛し、別keyのRecoveryControlへgeneration、owner、lease、activeだけを保存する。commit時は同じ固定Web Lock内でfingerprint、候補digest、schema、capacity、control fenceを再照合する。
- **Rationale**: 異常rootを正常値として公開・変更せず、worker再生成後もstale operationを拒否できる最小の追加境界である。
- **Trade-offs**: root writeとcontrol releaseは複数keyのdurable transactionではない。rootを先にwriteし、controlを後でreleaseすることで中断時は書込を許可せず、ownerのreleaseまたはlease切替で回復する。

## Risks & Mitigations
- authorityを迂回した直接write — `TRUSTED_CONTEXTS`、公開port限定、import境界test、禁止API scanで抑止する。
- Web Lock callback中のworker終了 — lockは解放されるが成功を返さず、永続active fenceを次workerが再読込してfail-closedにする。
- `chrome.storage.local.set`のcrash consistencyは公式保証外 — MVPは協調writer間の論理的一括commitに限定し、厳密durabilityが必要になればIndexedDBへ再設計する。
- commit直前のstale maintenance owner — 永続cursor再読込とgeneration/owner/revision一致を必須にする。
- 容量見積り差 — `getBytesInUse`と直列化見積りに加え、実write rejectを正規化し既存rootを保持する。
- root全体書換性能 — 10MB近傍でread/validate/repair/writeを計測し、閾値超過時だけstorage設計を再検討する。
- migration/validation失敗による上書き — source値を変更せず、current root検証成功後だけ明示mutationで保存する。
- 回復中断でcontrolがactiveのまま残る — 通常writeをfail-closedに保ち、同じgeneration/ownerのreleaseまたは期限後の新generation取得だけを許可する。
- schema正規値の重複 — `schema.ts`の公開`CURRENT_SCHEMA_VERSION`だけを保存・migration・replacement・交換形式からimportし、リテラル重複をboundary testで拒否する。

### 2026-08-03 backup restore capability統合のlight discovery

- **Context**: backup-restoreは正常rootの原子的置換と、破損・未対応rootからの回復を同じfeature内で扱うが、production handleの回復専用portだけでは正常置換を実行できなかった。
- **Sources Consulted**: `.kiro/specs/local-data-foundation/{brief,requirements,design}.md`、`.kiro/specs/backup-restore/requirements.md`、`.kiro/steering/{roadmap,tech,structure,security}.md`。
- **Findings**: 正常置換と異常回復は既に同じWriteAuthority、Web Lock、replacement validationを共有する。新しいalgorithmは不要で、公開facadeの能力集合だけが不足している。完全`FoundationDataPort`をbackupへ渡すとquery/mutateまで漏れ、通常feature向け`FoundationScopedDataPort`へ置換能力を足すと全consumerの権限が広がる。
- **Implications**: 正常/異常rootのassessment、commit point付き置換、finalize-only retryだけを束ねる`BackupRestoreDataPort`を追加し、runtime contributionからbackup compositionだけへ渡す。
- **Synthesis**: 一般化するのは実装ではなく公開interfaceだけとする。既存ReplacementCoordinator、RecoveryCoordinator、maintenance/recovery fenceを採用し、二つ目のauthorityやadapterを作らない。

### Decision: backup専用capability facadeを公開する

- **Context**: 正常復元と異常root回復を最小権限で同じfeatureへ提供する必要がある。
- **Alternatives Considered**: 完全`FoundationDataPort`を公開、`FoundationScopedDataPort`を拡張、正常/回復portを二つ注入、専用統合facade。
- **Selected Approach**: `BackupRestoreDataPort`が`assessReplacement`、`assessRecovery`、`commit`、`finalize`だけを公開する。`commit`はroot write後を通常errorへ変換せず、cleanup未完了ならopaque ticket付き`committed-finalization-required`を返す。
- **Rationale**: backupの両経路を満たしつつ、query、mutate、raw root、Storage、lock、fence、Repository、authority factoryを型とruntime objectの両方から除外し、置換済みrootの二重writeを防げる。
- **Trade-offs**: application-shellとbackup-restoreのdependency propertyを`backupRestoreDataPort`へ更新する必要がある。
- **Follow-up**: public consumer typecheck、runtime key negative test、正常/回復統合contractでcapability集合とfinalize中root write 0件を固定する。

### Decision: pre-commit cleanupは同じassessment ticketで再開する

- **Context**: persistent control取得後かつroot write前の失敗でcleanupも完了しない場合、rootは保持されても通常mutationと同じ復元が停止し続ける可能性がある。
- **Alternatives Considered**: 一般storage errorとして返す、cleanup専用opaque ticketと第三のoutcomeを追加する、同じassessment ticketへ再開能力を限定する。
- **Selected Approach**: `precommit-cleanup-pending`をroot未変更のtyped errorとして返し、同じassessment ticketの次回`commit`だけが一致するowner/generationのcleanupをroot write 0件で再開する。cleanup完了後は最新rootとcandidateを再assessmentしてからcommitへ進む。
- **Rationale**: 新しい公開outcomeやconsumer stateを追加せず、既存ticketのcandidate/mode bindingを再利用して最小権限と冪等性を維持できる。
- **Trade-offs**: assessment ticketはpre-commit control owner/generationも内部的に識別し、worker再生成後に永続controlから再開できる必要がある。
- **Follow-up**: 別ticket拒否、worker再生成、cleanup中root write 0件、cleanup後stale assessment、ticket喪失後のlease失効と新generation取得をcontract testで固定する。

## References
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage/) — 10MB quota、`getBytesInUse`、access level、write failure
- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — worker停止とglobal state消失
- [Migrate to a service worker](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers) — persistent stateの利用
- [About extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers) — worker contextとlifecycle
- [StorageArea](https://developer.chrome.com/docs/extensions/reference/api/storage/StorageArea/) — get/set APIとCAS不在
- [Web Locks API](https://www.w3.org/TR/web-locks/) — Workerでのexclusive lockとtermination semantics
- [IndexedDB transactions](https://www.w3.org/TR/IndexedDB/#transaction-construct) — strict transactionが必要な場合の代替
- [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) — MV3 runtimeと同梱コード
- [Improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security) — remote code、動的評価、CSP制約
