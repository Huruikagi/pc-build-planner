# Research & Design Decisions

## Summary
- **Feature**: `local-data-foundation`
- **Discovery Scope**: Complex Integration（full discovery、Task 4.1 blocker再設計）
- **Key Findings**:
  - domain、validator、migration、reference repair、Storage adapter、capacity policyまで実装済みであり、maintenance以降の設計境界を既存コードへ統合する必要がある。
  - `chrome.storage.local` はChrome 114以降10MBだが既定ではcontent scriptからも利用できるため、起動時に`TRUSTED_CONTEXTS`へ制限する必要がある。
  - Storage APIは比較交換トランザクションを提供しない。commit前再読込やworker内Promise queueだけではread-check-write競合を閉じられない。
  - Web Locks APIはWorker contextへexclusiveな協調排他を提供する。永続root内のgeneration/owner fenceと組み合わせることで、同時writerの線形化とworker再生成後のfail-closed認可を分離できる。
  - foundationはmanifestとデータruntime登録契約を所有し、共有service worker composition入口は後続`application-shell`へ委譲する。

## Research Log

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

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| Ports and adapters + single write authority | domain契約をChrome APIから分離し、mutationを一つのauthorityへ集約 | 型安全、テスト容易、整合性境界が明確 | worker message contractが必要 | 採用 |
| Web Lock + durable fence | 同名exclusive lockで協調writerを線形化し、ownershipはrootへ永続化 | StoragePortを純粋に保ち、worker再生成後もfail-closed | lock迂回writerを技術的には防げない | 採用 |
| Adapter内Promise/WeakMap queue | Storage adapterごとにread-check-writeを直列化 | 同一realmでは簡単 | worker再生成、別API facadeで消失しtest doubleが過剰保証 | 不採用 |
| IndexedDB transaction | readwrite transactionで厳密なatomicityを得る | 複数realmでもtransactional | chrome.storage.local単一root、容量・backup設計を変更 | MVPでは不採用、crash durability必須時に再検討 |
| 各featureからStorage API直接利用 | featureごとにread-modify-write | 初期コードが少ない | lost update、検証・排他の分散 | 不採用 |
| エンティティ別キー | project/part/buildを分割保存 | 小さい部分更新 | Chrome Storageに複数キーtransactionがなく参照整合性が複雑 | MVPでは不採用 |
| 外部schema library | 宣言的runtime validation | 型と検証の重複を削減可能 | 未導入toolchainへの依存追加 | 実装開始時に最新版適合性を再評価。設計はlibrary非依存 |

## Design Decisions

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
- **Context**: 候補削除・カテゴリ変更とCurrentBuild修復を別writeにするとinvalidな中間rootが生じる。
- **Selected Approach**: generic `mutateRoot` pipeline内でfoundation-owned `ReferenceRepairPolicy`を適用し、全体検証後に一度だけcommitする。
- **Rationale**: foundationは業務選択規則を持たず、保存参照の構造的不変条件だけを維持できる。

### Decision: canonical Resultを自作し、実装は最小化する
- **Context**: 全featureで同じ失敗契約が必要である。
- **Selected Approach**: `Result<T, E>`とfoundation error unionを`src/domain/result.ts`で所有する。Chrome以外のadapter、同期、export I/Oは実装しない。
- **Rationale**: 小さい安定契約で追加runtime依存を避ける。

## Risks & Mitigations
- authorityを迂回した直接write — `TRUSTED_CONTEXTS`、公開port限定、import境界test、禁止API scanで抑止する。
- Web Lock callback中のworker終了 — lockは解放されるが成功を返さず、永続active fenceを次workerが再読込してfail-closedにする。
- `chrome.storage.local.set`のcrash consistencyは公式保証外 — MVPは協調writer間の論理的一括commitに限定し、厳密durabilityが必要になればIndexedDBへ再設計する。
- commit直前のstale maintenance owner — 永続cursor再読込とgeneration/owner/revision一致を必須にする。
- 容量見積り差 — `getBytesInUse`と直列化見積りに加え、実write rejectを正規化し既存rootを保持する。
- root全体書換性能 — 10MB近傍でread/validate/repair/writeを計測し、閾値超過時だけstorage設計を再検討する。
- migration/validation失敗による上書き — source値を変更せず、current root検証成功後だけ明示mutationで保存する。

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
