# Research & Design Decisions

## Summary
- **Feature**: `backup-restore`
- **Discovery Scope**: Extension / Light Integration Update
- **Key Findings**:
  - Foundationは全データを単一の`LocalDataRoot`として検証・保存し、候補所属と現在構成参照の整合性を既に保証する。
  - バックアップ交換形式は保存スキーマと別版にし、復元時だけ現行`LocalDataRoot`へ変換すれば内部変更をファイルへ直接露出せずに済む。
  - `BackupRestoreDataPort`は正常置換と異常root回復を最小権限で提供し、`ProjectContextReplacementGuardPort`は全置換前のdraft確認を一元調停する。
  - Foundation commit成功とproject-context refresh成功は別commit pointであり、refresh失敗時は置換を再実行せずrefreshだけを再試行する。
  - 交換形式のshape検証はruntime-schema-validationのconfigured Zod Miniと共有primitiveを採用し、参照整合性と交換形式の意味はbackup ownerに残す。
  - preflight後の先行mutationはopaque assessment ticketをstale化し、commit線形化後の後続mutationはFoundationのpersistent maintenance/recovery controlで拒否する。
  - 回復必須状態ではread操作とrestore commitを別分類にし、容量超過は同一入力の再試行を提供しない。16 MiB入力上限は交換形式の構造差から導出する機械的上界gateで保証する。

## Research Log

### 上流保存契約と参照整合性
- **Context**: 全データの範囲と安全な置換単位を確定した。
- **Sources Consulted**: `local-data-foundation`、`project-candidate-management`、`current-build-management`のrequirements、design、tasks、research、およびroadmap。
- **Findings**: `LocalDataRoot`は`schemaVersion`、`projects`、`parts`、`currentBuilds`を持つ。Repositoryは読取検証、直列更新、容量判定を所有し、候補と構成は同じプロジェクト内だけを参照する。
- **Implications**: 復元は個別CRUDの繰り返しではなく、Foundationが既に公開する`assessReplacement`、`replaceRoot`、`runMaintenance`を消費する。Repositoryへ新しい書込経路を追加せず、候補・構成の業務規則を再実装しない。

### extension pageでのファイル処理
- **Context**: MV3 service workerの寿命へ依存しない入出力方法を確認した。
- **Sources Consulted**: roadmapとbriefのランタイム制約、既存side panel設計、Web標準File/Blob API。
- **Findings**: side panelはDOMとユーザー操作を保持でき、Fileを`text()`で読み、Blobとobject URLでダウンロードを開始できる。交換データをservice workerメモリへ保持する必要はない。
- **Implications**: FileGatewayはUI境界に限定し、永続化や検証を担当させない。処理中のドラフトは非永続のstateだけに置く。

### 容量と原子的置換
- **Context**: 事前容量判定と失敗時の既存データ保持を両立する。
- **Sources Consulted**: Foundationの`StoragePort`、Repository容量契約、10MB制約。
- **Findings**: 保存ルートは単一キーであり、一回の書込へ集約できる。JSON UTF-8バイト数を事前算出し、基盤の容量判定と書込エラー正規化を再利用できる。
- **Implications**: `replaceRoot`は直列化区間で再検証、容量判定、一回のwriteを行う。個別エンティティを先に削除・追加しない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 交換形式Mapper + RestoreService | ファイル形式変換と復元調整を分離 | 保存モデルを非公開化し検証可能 | 変換契約の版管理が必要 | 採用 |
| 保存ルートをそのままJSON化 | 内部値を直接入出力 | 実装が短い | 保存スキーマ変更が交換互換性を破る | 不採用 |
| 個別CRUDで復元 | エンティティを順次追加 | 既存APIだけを利用可能 | 部分復元と順序依存が生じる | 不採用 |
| configured Zod Mini + owner refinement | 共通strict shapeとJSON safetyを採用し、交換形式の意味をownerで検証 | canonical入口、型推論、error/path同等性 | CSP gateと移行順が前提 | 採用 |

## Design Decisions

### Decision: 交換形式版と保存スキーマ版を分離する
- **Context**: 内部保存の移行周期と、利用者が保管するファイルの互換性期間は異なる。
- **Alternatives Considered**: 保存ルート直列化、独立した交換Envelope。
- **Selected Approach**: `BackupEnvelope`へ`formatVersion`、`createdAt`、`data`を置き、Mapperが現行保存ルートと相互変換する。
- **Rationale**: ファイル契約を安定させ、旧交換形式の移行を保存移行と独立して扱える。
- **Trade-offs**: 形式変更時に交換Migrationが必要になる。
- **Follow-up**: fixtureで往復同値性と旧形式変換を検証する。

### Decision: Foundationの既存原子的置換契約を消費する
- **Context**: 個別CRUDでは途中失敗時に混在状態が残る。
- **Alternatives Considered**: UIでロールバック、個別CRUD、単一ルート置換。
- **Selected Approach**: 保存root候補を`unknown`として既存`FoundationDataPort.assessReplacement`へ渡し、maintenance fence取得後に既存`replaceRoot`で一括置換する。
- **Rationale**: 保存所有境界内の既存実装で直列化、容量、検証、失敗正規化を一貫させられる。
- **Trade-offs**: Foundationのassessment token、revision、maintenance generationへ正確に追従する必要がある。
- **Follow-up**: 書込失敗前後の保存値同一性を統合テストする。

### Decision: configured Zod Miniを交換shape検証へ採用する
- **Context**: runtime-schema-validationがZod MiniのCSP gate、canonical入口、strict object、JSON safety、error/path変換を共有基盤として確立する。
- **Alternatives Considered**: 手書きValidatorの継続、Zod packageのfeature直接import、configured runtime-schema primitiveの採用。
- **Selected Approach**: `JSON.parse`の結果を`unknown`としてowner-local schemaへ渡し、shape・JSON safetyは共有primitive、format version・禁止payload・参照整合性はbackup refinementで検証する。File、Blob、TextEncoderは引き続きWeb標準APIを使う。
- **Rationale**: 交換形式の意味をbackup ownerに保ちながら、CSP設定、strict object、canonical pathを重複実装せずに済む。
- **Trade-offs**: runtime schema feasibility gateとschema同等性タスクがbackup着手の前提になる。
- **Follow-up**: 移行前後のvalid/invalid、error code、canonical pathのsnapshot同等性を固定する。

### Decision: 正常復元と異常root回復を一つのRestoreServiceでmode分岐する

- **Context**: 同じ交換候補を、現在rootの正常性に応じて二つのFoundation protocolへ渡す必要がある。
- **Alternatives Considered**: serviceを二つに分割、backup側でraw rootを判定、ticketのmode分岐。
- **Selected Approach**: 正常assessmentを先に行い、current anomalyの場合だけrecovery assessmentへ切り替え、`RestoreTicket.mode`を`normal | recovery`にする。
- **Rationale**: raw rootを公開せず、交換検証・preview・UI stateを重複させない最小構成になる。
- **Trade-offs**: Foundation error mappingでcurrent anomalyとcandidate rejectionを厳密に区別する必要がある。
- **Follow-up**: 両modeのpreflight/commit matrixをservice contract testで固定する。

### Decision: guard、commit、refreshを不可逆commit pointで分離する

- **Context**: 未保存draftを保護しつつ、root write成功後のcontext refresh失敗を復元失敗として扱わない必要がある。
- **Alternatives Considered**: backup独自guard、select command流用、一つの巨大transaction、project-context replacement guard利用。
- **Selected Approach**: `prepare/confirm/begin → Foundation commit → complete succeeded → refresh`とし、refresh-only retryを別commandにする。
- **Rationale**: guard authorityをproject-context、原子的data writeをFoundation、利用者向け調整をbackupに維持できる。
- **Trade-offs**: stateに`restored-context-unavailable`が増えるが、成功済み置換の意味を正確に表示できる。
- **Follow-up**: refresh失敗後にFoundation method callが0件であることを統合testで確認する。

### 2026-08-03 upstream contract light discovery

- **Context**: 新要件4.7–4.8、5.6–5.7、6.8–6.11を既存設計へ統合した。
- **Sources Consulted**: `.kiro/specs/project-context/design.md`、`.kiro/specs/local-data-foundation/design.md`、roadmap、既存backup実装とtest配置。
- **Findings**: `ProjectContextReplacementGuardPort`はcontext unavailableでも`from:null`でprepareでき、`BackupRestoreDataPort`は通常CRUDを公開せず両復元protocolを提供する。settingsのsection mount契約は変更不要である。
- **Implications**: 新規外部依存やbackup独自registryは不要。feature内では`context-lifecycle.ts`と状態遷移を追加し、production capability injectionはapplication-shell ownerへ残す。
- **Synthesis**: 既存Exchange/Mapper/FileGateway/section mountを維持し、RestoreServiceのmodeとRestoreContextLifecycleだけを新しい責務として追加する。

### 2026-08-03 design validation remediation

- **Context**: 設計検証で、破損root時のsettings未到達、export read capability欠落、root write後cleanup失敗のcommit point不明瞭さが判明した。
- **Sources Consulted**: `backup-restore` requirements/design、`application-shell` designと`application-shell-integration.ts`、`local-data-foundation` design、現行backup service/section mount。
- **Findings**:
  - shellはmaintenance初期snapshotの全失敗をstartup failureへ変換するため、`corrupt-data | unsupported-version`ではbackup sectionをmountできなかった。
  - `BackupRestoreDataPort`はqueryを意図的に持たず、section factoryへ同portだけを渡す案では`BackupService`を構成できなかった。
  - 正常置換のroot writeとmaintenance release、回復置換のroot writeとcontrol releaseには不可逆なcommit pointがあり、後半失敗を通常errorへ潰すと再置換を誘発し得た。
- **Implications**:
  - application shellは二つのtyped anomalyだけを`recovery-required`へ写像し、通常mutationを抑止しながらsettingsと`recovery`操作を維持する。
  - exportは`FoundationScopedDataPort.query`を最小の`BackupSnapshotReadPort`へ狭め、restore capabilityと別入力にする。
  - Foundationだけがcommit pointを判定し、write後cleanup失敗を`committed-finalization-required`とopaque ticketで返す。backupはfinalize-only retryを提供し、root writeを繰り返さない。

### Decision: 回復可能なdegraded shell startupを上流契約にする
- **Context**: 回復UIは正常root queryやproject-context readinessより先に到達可能でなければならない。
- **Alternatives Considered**: 全snapshot失敗をstartup errorのまま維持、inactive snapshotを捏造、typed recovery-required state。
- **Selected Approach**: `corrupt-data | unsupported-version`だけをshellの`recovery-required`へ変換し、`read`と`recovery`を許可、通常`mutation`を拒否する。
- **Rationale**: 保存状態を正常と偽らず、Storageへ直接到達せず、回復面だけを起動できる。
- **Trade-offs**: `OperationKind`とshell projectionに一つの状態を追加する。
- **Follow-up**: corrupt/future root起動から正常snapshot通知によるready復帰をproduction-shaped testで固定する。

### Decision: commit後cleanupをfinalize-only lifecycleとして表す
- **Context**: root write後のrelease失敗は、データ置換失敗ではない。
- **Alternatives Considered**: release結果を無視、通常RestoreErrorへ変換、Foundation commit outcomeでcommit pointを公開。
- **Selected Approach**: `committed | committed-finalization-required`を返し、後者だけがopaque finalization ticketを持つ。retryはcleanupと通常query確認だけを行う。
- **Rationale**: 置換済みデータの二重writeを型とcapabilityの両方で防げる。
- **Trade-offs**: UI stateに`restored-finalization-required`が増える。
- **Follow-up**: finalize retry中のroot writeが0件であることをFoundation/backup統合testで検証する。

### 2026-08-03 design validation findings remediation

- **Context**: design validationで、復元確定後からFoundation maintenance取得までの競合mutation、runtime schema方針の欠落、application-shellとの実装順循環が指摘された。
- **Sources Consulted**: `backup-restore` requirements/design/tasks、`local-data-foundation` design、`project-context` design、`runtime-schema-validation` design、`application-shell` design、roadmap、現行backup実装。
- **Findings**:
  - UI stateとshell gateだけでは認可を保証できず、preflight後に確定したmutationをcommitが上書きし得る。
  - Foundationがroot revisionまたはraw fingerprintとcandidate digestへ結び付くopaque assessment ticketを発行すれば、内部cursorを公開せずstale拒否できる。
  - runtime-schema-validationは`exchange.ts`をowner-local migration対象として明示しており、手書きValidator継続はroadmapと不整合だった。
  - shellのcontract/gateとproduction wiringを一つのwaveにすると、backupとの依存が循環する。
- **Implications**:
  - `RestoreTicket`はopaque assessment ticketを保持し、commitは同じ固定名Web Lock内でticket再照合とpersistent maintenance/recovery control activationを線形化する。
  - 先行mutationはticketをstale化して保持され、線形化後の後続mutationはFoundationで拒否される。shell gateは表示・早期抑止のprojectionに限定する。
  - schema検証はconfigured Zod Mini入口を利用し、Zod issueを公開しない。
  - 実装順はruntime schema → Foundation/project-context → shell contract gate → backup → shell production wiringへ分割する。
- **Synthesis**: 新しい横断coordinatorは追加せず、既存のFoundation commit protocolへopaque assessment ticketを加える。これがデータ損失経路を閉じつつ、backup featureへrevision、fingerprint、fenceを漏らさない最小の修正である。

## Risks & Mitigations

### 2026-08-05 design validation remediation: operation gate・容量拒否・交換上界

- **Context**: `kiro-validate-design backup-restore`で、現行UIの単一mutation gateではdegraded recovery中のfile選択が閉じること、quota失敗時に存在しないticketのretryを要求していること、16 MiB上限を単一fixtureだけでは保証できないことが判明した。
- **Sources Consulted**: `backup-restore` requirements/design、現行`operation-kind.ts`・`react-root.tsx`・`view.tsx`、Foundation容量計算、application-shellのcanonical `OperationKind`契約。
- **Findings**:
  - 現行React rootは一つの`mutationAllowed`をViewへ渡し、export、file選択、restore確定を同時に無効化するため、`recovery-required`で回復入力へ到達できない。
  - assessmentで容量超過した場合は`RestoreTicket`が生成されず、復元後root自体が10 MiBを超える入力は空き容量確保でも成功しない。
  - 交換Envelopeの上限は保存rootの直列化上限だけでなく、固定overheadとentityごとのproperty-name差分を含めて評価する必要がある。
- **Selected Approach**: React rootはcanonical `read`と`recovery`を別々に購読し、export・file選択・preflightとrestore commitの可否を分離する。容量超過は選択状態を保持した`unsupported`とし、同一入力retryを公開せず別file選択だけを許可する。16 MiBは全entity variantの保存側／交換側差分と最小直列化長から決定的に導出し、未分類fieldや上界超過で検証を失敗させる。
- **Trade-offs**: 容量超過からの同一入力retryは提供しない。capacity policyは交換Mapper変更時に差分表を更新する必要があるが、正常exportの自己復元可能性をfixture依存なしで維持できる。
- **Follow-up**: recovery-requiredでread操作が有効かつcommitだけがrecovery gateに従うDOM/contract test、容量超過時のticket再送0回、全entity variantを網羅する上界gateを固定する。

### 2026-08-04 design validation remediation: retry・finalization再開・容量不変条件

- **Context**: `kiro-validate-design backup-restore`で、stale assessmentの同ticket再送、section unmount後のfinalization ticket喪失、10 MiB付近でのexport artifact自己復元不能が指摘された。
- **Sources Consulted**: `backup-restore` requirements/design、`local-data-foundation` design、`project-context` permit lifecycle、FileGatewayとBackupServiceの現行実装、容量steering。
- **Findings**:
  - `stale-assessment`は評価時rootとの不一致を確定するため、同じticketの再送では成功しない。candidateを再assessmentして新ticketとpreviewを発行し、置換確認もやり直す必要がある。
  - post-commit controlは永続する一方、finalization ticketをUI stateだけに置くとunmountで再開能力を失う。Foundationがcandidate digestと期待commit revisionをcontrolへroot write前から保持し、現在rootとの一致でpost-commitを判定して用途限定ticketを再構築する必要がある。
  - 保存rootの10 MiB上限と交換Envelopeの安全な読取上限を同値にすると、Envelope overheadにより正常exportがrestore preflightで拒否され得る。
- **Selected Approach**: stale時は`reassess-restore`へ分離し、`precommit-cleanup-pending`だけが同ticket再送を使用する。Foundationへ`findPendingFinalization`を追加し、mount時にfinalize-only stateを再水和する。ファイル入力上限は保存上限と分離した`RestoreFileCapacityPolicy`が16 MiBとして所有し、現行Mapperの全entity variantについて保存側／交換側の直列化差分から上界を導出する機械検査で固定する。
- **Trade-offs**: state初期化にpending finalization照会が一つ増え、容量policyにentity variantごとの差分表の保守が必要になる。一方でroot再置換能力やraw control情報は公開しない。
- **Follow-up**: stale ticket再送0回、新ticket発行、unmount/remount後のfinalize-only、保存上限rootのexport→file preflightをcontract/integration/E2Eで固定する。

### 2026-08-04 design review remediation

- **Context**: `kiro-validate-design backup-restore`で、shellの`OperationKind`重複定義、日英UI契約の設計欠落、error codeから再試行可能性への一意な写像不足が指摘された。
- **Sources Consulted**: `backup-restore` requirements/design/tasks、`application-shell` design、`ui-messages/public.ts`、日英backup catalog、roadmapの日英UI制約、現行backup view。
- **Findings**:
  - `FeatureMountContext`consumerが参照する`OperationKind`は一つのcanonical unionでなければrecovery gateをcompile-timeに固定できない。
  - 現行Viewは既に`useMessages()`を利用するため、新しいrecovery/finalization/refresh文言も日英catalogの同一key・placeholderとして追加するのが最小の統合である。
  - `BackupError`とcommit前`RestoreError`は表示codeだけでは1.5の再試行可能性を決定できず、state所有の判別可能なpolicyが必要である。
- **Selected Approach**: shellは`read | mutation | recovery`を単一定義とし、backup Viewは`ui-messages` public resolverだけに依存する。commit前errorは`retryable | action-required | unsupported`と具体actionへ単一箇所で写像し、commit後の専用retryと分離する。
- **Implications**: application-shell contract fixture、backup state/DOM test、日英catalog parity testをtaskの完了条件に追加する。新規runtime依存やカタログownerの移転は発生しない。

- 交換形式と保存契約のドリフト — Mapperの往復テストと全カテゴリfixtureで検出する。
- 大きなファイルによるメモリ圧迫 — 保存上限に基づくファイルサイズ上限を読取前に確認し、処理中操作を抑止する。
- 復元と管理操作の競合 — preflightのopaque assessment ticketで先行変更をstale拒否し、commit線形化後はFoundationのpersistent maintenance/recovery controlで後続mutationを拒否する。
- guard permitのstale化 — commit直前の`begin`でgenerationとregistry revisionを再検証し、拒否時はticketを保持する。
- 回復control release前のcontext refresh — Foundationが通常query確認とreleaseを完了した成功結果の後にだけrefreshする。
- refresh失敗後の二重置換 — stateとcommand surfaceをrefresh-only retryへ限定し、Foundation呼出し0件をtestする。
- cleanup失敗後の二重置換 — committed outcomeとopaque ticketを保持し、finalize-only retry中のroot write 0件をtestする。
- corrupt/unsupported rootでshellが起動不能 — typed anomalyだけをrecovery-requiredへ写像し、settings到達と正常snapshot復帰を統合testする。
- 機密的な商品情報の露出 — エラーはpathと分類だけを返し、値をログ・画面へ含めない。

## References
- `.kiro/steering/roadmap.md` — 依存順、10MB制約、共有シーム。
- `.kiro/specs/local-data-foundation/design.md` — 保存ルート、Validator、Repository、StoragePort契約。
- `.kiro/specs/project-candidate-management/design.md` — プロジェクト・候補所有境界。
- `.kiro/specs/current-build-management/design.md` — 現在構成と候補参照契約。

### 2026-08-12 v0.5.0 boundary reconciliation light discovery

- **Change Brief**: `v0.5.0-boundary-reconciliation`
- **Context**: 汎用backup orchestrationを`local-data-library-boundaries`へ抽出した後も、本specが製品adapterと汎用protocolの双方を所有するように読め、application-shell compositionの過去例外もcanonical境界と競合していた。
- **Sources Consulted**: 全steering、`backup-restore`全spec文書、承認済み`local-data-library-boundaries`、`local-data-foundation`、`project-context`、latest Change Brief。
- **Findings**: packageの`./backup`はcodec注入型`BackupOrchestrator`とfactoryを所有する一方、PC交換形式・mapping・capacity/error policy、Foundationの限定置換能力への接続、file UI、確認、guard/refreshは明示的に除外している。FoundationはPC rootとbackup専用のassessment/replacement/recovery/finalization能力を所有し、project-contextはreplacement guardとrefresh portを所有する。application-shellだけが最終compositionを行う。
- **Selected Approach**: 本specは`ProductBackupAdapter`を単一製品所有境界として追加し、package backup public portへPC codec/mapping/policyとFoundation capabilityを設定する。既存`BackupService`/`RestoreService`はUI facadeとしてadapterへ委譲し、明示確認とguard/refresh lifecycleはgeneric orchestrator外の製品stateに維持する。
- **Alternatives Rejected**: 汎用orchestratorをfeature内へ複製する案はlibrary boundaryの二重所有になる。FoundationにPC exchange codecを持たせる案は保存rootと交換形式を再結合する。backup-restoreがshell wiringを継続所有する案はcomposition ownerを再び曖昧にするため採用しない。
- **Out of scope**: generic public contractの再定義、PC root/schema/replacement semanticsの変更、application-shell実装、交換形式・atomicity・fencing・failure preservation・recovery・UI layoutの意味変更。
- **Validation implication**: package/foundation public contractのconsumer fixture、deep-import/ownership negative gate、adapter contract、既存UI/E2E全安全シナリオを更新対象とする。

### 2026-07-27 settings-screen統合のlight discovery
- **Context**: GitHub issue #19に対応し、独立ナビゲーションから設定画面内区画へ配置だけを変更する既存仕様更新。
- **Sources Consulted**: `.kiro/specs/settings-screen/{brief,requirements,design,tasks}.md`、更新済み`.kiro/specs/application-shell/{requirements,design,tasks}.md`、`ui-internationalization`、`ui-message-catalog`、既存`src/features/backup-restore/`、全steering。
- **Findings**: `settings-screen`は正確な公開境界として`BackupRestoreSectionMount.mount(context: FeatureMountContext): Promise<FeatureMountHandle>`を定義し、composition ownerだけがfactoryへ完全`FoundationDataPort`を渡す。settingsはsection handleだけを保持し、backup state、service、maintenance capabilityを所有しない。現行実装の`registration.ts`と`feature-contribution.ts`、`nav.backupRestore`は移行対象である一方、exchange、service、state、file gateway、React viewは再利用できる。
- **Decision**: `backup-restore`は独立feature registration/contributionを廃止し、`section-mount.ts`と`public.ts`から正確な`BackupRestoreSectionMount`とfactoryだけを公開する。設定layout、navigation、言語区画、shell compositionは`settings-screen`/`application-shell`へ委ねる。
- **Risks & Mitigations**: composition切替中の二重表示は旧registrationと新sectionを同時にproduction catalogへ載せない統合gateで防ぐ。部分mount失敗と二重cleanupはsection contract testで固定する。言語変更による不要な再mountとbackup state喪失はsettings側のstable host contractで検証し、backup側は通常のhandle lifecycleだけを提供する。
- **Synthesis**: 新しい抽象化や依存は不要で、既存feature mount lifecycleをsection境界として再利用するのが最小変更である。交換形式、maintenance generation、atomic restore、分類済みerror、公開操作の意味は一切変更しない。

### 2026-07-19 React UI方針更新
- **背景**: export、file選択、preview、置換確認、処理中lock、結果表示を一貫した画面状態として扱う必要がある。
- **判断**: `view.tsx`をReact function componentとし、feature固有の`react-root.tsx`で既存`FeatureMountContext`へ接続する。
- **境界**: BackupRestoreState、service、交換契約、FileGatewayはframework非依存を維持する。表示値は通常のJSX childとし、`dangerouslySetInnerHTML`と`innerHTML`を禁止する。
- **統合**: featureは`public.ts`と`section-mount.ts`から埋め込み可能なmount契約だけを公開し、独立registration/contributionはsettings composition切替後に削除する。共有side panel runtime、settings registration、HTML host、root barrelは編集しない。復元時はFoundationの永続maintenance fenceを取得し、shellは同じ状態のread-only projectionから全feature mutationを抑止する。
- **検証**: React DOM表示、確認操作、Blob URLとReact rootのcleanupを統合testで確認する。
- **参照**: [React createRoot](https://react.dev/reference/react-dom/client/createRoot)、[Chrome MV3 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)

### 2026-08-04 pre-commit cleanup再開契約のlight discovery
- **Context**: design validationで、persistent maintenance/recovery control取得後かつroot write前に失敗し、そのcleanupも完了しない場合の再試行契約が未定義と判定された。
- **Sources Consulted**: `backup-restore` requirements/design/tasks、`local-data-foundation` design/tasks、`project-context` replacement guard契約、steeringの原子的置換・worker再生成規約。
- **Findings**:
  - root write前なので復元成功やpost-commit finalizationとして扱えない一方、active controlを通常errorだけで失うと同じ復元と通常mutationが継続的に拒否される。
  - cleanup専用の新しい公開ticketを追加すると、stateへ第三のcommit outcomeとassessment更新経路が必要になり、既存の`RestoreTicket`保持規則より複雑になる。
  - assessment ticketはcandidate、mode、pre-commit control owner/generationへ結び付けられるため、同じticketの再送をcleanup再開能力として限定できる。
- **Selected Approach**: Foundationは`precommit-cleanup-pending`をroot未変更のtyped errorとして返す。同じassessment ticketの次回`commit`だけが一致controlのcleanupをroot write 0件で冪等再開し、cleanup後に最新rootとcandidateを再assessmentしてからcommitへ進む。backup stateは元ticketを保持し、新しいguard permitから`retry-restore`を実行する。
- **Alternatives Considered**: pre-commit cleanup専用opaque ticketと専用stateを追加する案、cleanup失敗を一般storage errorへ潰す案。前者は不要な公開状態を増やし、後者は回復可能性を表現できないため不採用とした。
- **Risks & Mitigations**: 別ticketによるcontrol奪取はowner/generation照合で拒否する。worker再生成後も永続controlだけを根拠に再開する。ticket喪失時はlease失効後に新しいassessmentとgenerationを要求し、古いownerを暗黙再利用しない。
- **Synthesis**: 新しいcommit outcomeやUI phaseを増やさず、既存の未commit ticket保持とretry policyを拡張するのが最小の安全な設計である。
