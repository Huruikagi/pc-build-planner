# Implementation Plan

- [ ] 1. 上流公開契約とruntime prerequisiteを固定する
- [x] 1.1 configured runtime schemaの同等性gateを追加する
  - canonical configured Zod Mini入口、strict plain object、JSON safety、owner error/path変換だけを利用できる状態を確認する
  - 交換形式の既存valid/invalid結果、error code、canonical pathが移行前後で一致し、Zod issueや入力値が公開されないことをcontract testで固定する
  - featureからのZod直接import、他feature schemaのdeep import、unknown-key strippingを公開境界gateが拒否すれば完了とする
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 6.5_
  - _Boundary: ExchangeValidator runtime prerequisite_

- [x] 1.2 (P) Foundationのbackup専用公開契約をconsumer側で固定する
  - 上流ownerが提供するassessment結果からmode、必要bytes、current anomaly、opaque ticketだけを利用し、revision、fingerprint、digest、fence、通常CRUDへ到達しないconsumer fixtureを追加する
  - commit commandがcandidate、expected mode、assessment ticketを必須とし、commit point付き結果とfinalize-only ticketを判別できる契約を固定する
  - control取得後かつroot write前のcleanup失敗が同じassessment ticketだけで冪等再開でき、別ticketでは再開できないことを検証する
  - 公開型とruntime keyのnegative contractがraw root、Storage、lock、Repository、authority factoryを拒否すれば完了とする
  - _Requirements: 3.4, 4.3, 4.5, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7_
  - _Boundary: BackupRestoreDataPort consumer contract_

- [x] 1.3 (P) project-contextの置換guardとrefresh契約をconsumer側で固定する
  - 上流ownerが提供するreplacement preparation、confirmation、permit begin/completeと、ready/empty/unavailableを返すrefreshだけを利用するconsumer fixtureを追加する
  - guard registry、draft内容、preference、selection fallbackへのdeep importが公開境界gateで拒否されることを確認する
  - context unavailableでもprepareでき、stale confirmation/permitを型付き結果として扱える契約testが成功すれば完了とする
  - _Requirements: 4.7, 4.8, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: ProjectContext public port consumer contract_

- [x] 1.4 (P) application-shellのrecovery prerequisiteをconsumer側で固定する
  - 上流ownerが提供するcanonical operation分類、recovery-required projection、operation policy購読契約をcompile/runtime fixtureで検証する
  - corrupt-dataとunsupported-versionだけがsettingsをmount可能なdegraded stateとなり、通常mutationはfail closed、readとrecoveryだけが許可されることを確認する
  - 正常snapshot通知で通常projectionへ復帰し、本specからshell compositionを変更せずにconsumer contract gateが成功すれば完了とする
  - _Requirements: 4.5, 5.6, 5.7, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: Application shell recovery consumer contract_

- [ ] 2. 交換形式、容量ポリシー、ファイル入出力を実装する
- [x] 2.1 owner-local交換schemaをruntime schema基盤へ移行する
  - strict Envelope、全交換entity、日時・ID・カテゴリ・数量をconfigured schema primitiveで検証する
  - 禁止payload、未知key、非JSON値、ID重複、孤立参照、別project参照を値非露出のfeature errorへ写像する
  - 現行・空・将来・不正fixtureの検証結果とcanonical pathが決定的に一致すれば完了とする
  - _Depends: 1.1_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 6.5_
  - _Boundary: ExchangeValidator_

- [x] 2.2 交換形式migrationを現行検証へ接続する
  - format versionの将来版を変換せず拒否し、移行経路のない旧版を非対応として扱う
  - 対応旧版を連続する純粋変換で現行shapeへ移し、各段階に同じstrict検証を適用する
  - 旧版・将来版・各移行段階のfixtureが期待する現行Envelopeまたは分類済みerrorを返せば完了とする
  - _Depends: 2.1_
  - _Requirements: 2.4, 2.5, 5.3, 6.5_
  - _Boundary: ExchangeMigration_

- [x] 2.3 交換形式と保存rootのMapperを更新する
  - 全project、partの確認値・source・正規化属性、current build参照と数量を欠落なく双方向写像する
  - 保存schema version、revision、request dedupe、互換性派生値、生HTML、画像を交換形式へ含めず、入力の保存versionを信頼しない
  - 空データと全カテゴリの架空fixtureがFoundation検証後に往復同値となれば完了とする
  - _Depends: 2.1_
  - _Requirements: 1.1, 1.2, 1.4, 1.6, 2.1, 2.2, 2.3, 3.1, 3.3_
  - _Boundary: ExchangeMapper_

- [x] 2.4 復元ファイル容量ポリシーと自己復元可能性gateを実装する
  - 復元入力の16 MiB上限と、変換後rootに対するFoundationの10 MiB保存上限を別の判定として固定する
  - 保存側と交換側の全entity variant、固定overhead、property名とdelimiter差分から、保存上限内rootの最大Envelope UTF-8サイズ上界を決定的に導出する
  - Mapperのfield追加、重複写像、名称変更が差分表で未分類ならbuild gateを失敗させ、入力上限や形式版の暗黙変更を防ぐ
  - 導出上界が16 MiB以下であり、16 MiBちょうどを許可して1 byte超過を拒否する自動testが成功すれば完了とする
  - _Depends: 2.3_
  - _Requirements: 1.7, 3.4_
  - _Boundary: RestoreFileCapacityPolicy_

- [x] 2.5 File gatewayへ16 MiB境界と安全なI/Oを実装する
  - UTF-8で16 MiBを1 byteでも超えるFileを本文読取前に拒否し、単一ファイルだけを受け付ける
  - Blob download後のobject URLと一時resourceを成功・失敗の両経路で確実に解放する
  - 境界値、複数選択、読取不能、download失敗、cleanup再試行をWeb API stubで決定的に検証できれば完了とする
  - _Depends: 2.4_
  - _Requirements: 1.3, 3.1, 3.2, 3.4, 6.4, 6.5_
  - _Boundary: FileGateway_

- [x] 2.6 バックアップartifact生成を現行交換契約へ接続する
  - frozen read-only portから検証済み全rootを読み、作成日時、形式版、決定的JSON、UTF-8 byte lengthを持つartifactを生成する
  - 製品接頭辞と作成日を含むfilenameを生成し、空rootも復元可能なファイルとして出力する
  - artifactをdownload前に容量ポリシーへ通し、同版のfile preflightを通過できない出力は生成しない
  - 読取、検証、mapping、serialization、容量不変条件の失敗時にdownloadを開始せず、分類済み再試行案内を返せば完了とする
  - _Depends: 2.3, 2.4, 2.5_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 6.4, 6.5_
  - _Boundary: BackupService_

- [ ] 3. assessment ticket付き復元serviceを実装する
- [x] 3.1 normal/recovery preflightとpreviewを実装する
  - file入力を交換検証・migration・mapping後にFoundation assessmentへ渡し、正常rootとcorrupt/unsupported rootだけを正しくmode分岐する
  - candidate拒否、容量超過、storage failureをcurrent anomalyと混同せず、opaque assessment ticketを成功時だけRestoreTicketへ保持する
  - 件数、作成日時、形式版、必要bytes、modeをpreviewへ写し、検証中はcommit不能であることを状態契約から確認できれば完了とする
  - _Depends: 1.2, 2.2, 2.3, 2.4, 2.5_
  - _Requirements: 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.3, 5.6, 5.7, 6.5_
  - _Boundary: RestoreService preflight_

- [x] 3.2 root write前のcommit protocolとcleanup再開を実装する
  - candidate、expected mode、assessment ticketをFoundation commitへ渡し、write前errorとcommitted outcomeを区別する
  - stale assessment、mode変化、capacity、storage、maintenance/recovery競合では既存rootを保持し、policyに応じてticket保持または再assessmentへ戻す
  - pre-commit cleanup未完了では元ticketを保持し、新しいguard permitから同じticketだけを再送してcleanupを先に再開する
  - cleanup中のroot writeが0件で、別ticketが拒否され、cleanup後の再assessmentがstaleなら新ticketを要求する統合testが成功すれば完了とする
  - _Depends: 3.1_
  - _Requirements: 4.3, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: RestoreService pre-commit protocol_

- [x] 3.3 committed outcomeとfinalize-only lifecycleを実装する
  - root write後cleanup失敗では成功summaryとopaque finalization ticketだけを返し、commit前errorへ戻さない
  - 永続controlからpost-commit ticketだけを再発見し、section再mount後もfinalize-only処理を再開できるようにする
  - finalizeはcleanupと通常query確認だけを行い、root write、assessment、置換確認を再実行しない
  - finalize成功時にsummaryが失われていても検証済みsnapshotから件数を再構築し、root writeが0件のtestが成功すれば完了とする
  - _Depends: 3.2_
  - _Requirements: 4.4, 4.5, 5.1, 5.2, 5.4, 5.5_
  - _Boundary: RestoreService finalization lifecycle_

- [x] 3.4 Foundationとの競合・原子性統合を固定する
  - preflight後に先行mutationが確定した場合、assessment ticketがstale拒否され先行変更が保持されることを検証する
  - commit線形化後の後続mutationがpersistent maintenance/recovery controlで拒否され、read-only queryは継続できることを検証する
  - write前の全失敗でroot不変、write後cleanup失敗で一回だけwrite、finalize retryでwrite 0件となる
  - worker再生成後も同じowner/generationだけがcleanupを再開でき、別ticketを拒否する統合testが成功すれば完了とする
  - _Depends: 3.2, 3.3_
  - _Requirements: 3.4, 4.3, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: BackupRestoreDataPort integration_

- [ ] 4. project-context lifecycle、状態、表示を実装する
- [x] 4.1 replacement guard lifecycleをcommit前に順序付ける
  - prepare、confirmation、cancel、begin、completeをpermit lifecycleどおり呼び、begin成功前のFoundation commitを禁止する
  - guard拒否、取消、stale confirmation/permitではfailedまたはcancelledとしてpermitを閉じ、ticketと現在選択を保持する
  - commit前失敗と取消のcommand列が期待順に一致し、新しいpermitで再試行できる統合testが成功すれば完了とする
  - _Depends: 1.3, 3.2_
  - _Requirements: 4.2, 4.7, 4.8, 5.5_
  - _Boundary: RestoreContextLifecycle guard_

- [x] 4.2 post-commit completion、finalization、context refreshを順序付ける
  - committed outcomeだけをsucceededとして一回通知し、notification失敗でも復元成功を取り消さない
  - finalization完了後にだけcontextをrefreshし、ready、empty、unavailableを復元後状態へ写像する
  - finalizationまたはrefresh失敗ではFoundation commitやguard prepareを再実行せず、対応する単独retryだけが呼ばれれば完了とする
  - _Depends: 3.3, 4.1_
  - _Requirements: 4.4, 5.5, 6.9, 6.10, 6.11_
  - _Boundary: RestoreContextLifecycle post-commit_

- [x] 4.3 commit前のバックアップ・復元状態機械を実装する
  - export、validation、置換確認、draft確認、restoring、failedの判別状態と許可actionを定義する
  - 取消、guard拒否、commit前失敗ではfile ticketとpreviewを保持し、section unmountまたはfile再選択で未commit ticketを破棄する
  - stale assessmentは再assessmentだけ、pre-commit cleanup未完了は同じticketと新permitのretryだけを許可する
  - 容量超過をunsupportedとして同一入力の再実行を禁止し、選択状態を保持した別file選択だけを許可する状態testが成功すれば完了とする
  - _Depends: 2.6, 3.2, 4.1_
  - _Requirements: 1.5, 3.5, 3.6, 4.1, 4.2, 4.3, 4.5, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.4, 6.6_
  - _Boundary: BackupRestoreState pre-commit_

- [x] 4.4 commit後の状態再水和と単独retryを実装する
  - committed後は復元retryを公開せず、summaryを保持したfinalize-onlyまたはrefresh-only状態へ固定する
  - section mount時にpending finalizationを照会し、存在時は通常idleより先にfinalize-only状態を再水和する
  - finalize-only成功後だけrefreshへ進み、refresh-only retryではroot writeとguard lifecycleが0回となる状態testが成功すれば完了とする
  - _Depends: 3.3, 4.2_
  - _Requirements: 4.4, 4.5, 5.5, 6.6, 6.9, 6.10, 6.11_
  - _Boundary: BackupRestoreState post-commit_

- [x] 4.5 project-context lifecycleとstateの統合を固定する
  - guard拒否、取消、staleでselection、root、ticketが保持され、新しいprepareから再試行できることを検証する
  - committed outcomeではcomplete succeededを一回だけ呼び、finalization中にrefreshせず、refresh失敗後もFoundation commitを再実行しない
  - finalize-only、refresh-only retryのcommand列と最終ready/empty/unavailable表示が期待順に一致すれば完了とする
  - _Depends: 4.3, 4.4_
  - _Requirements: 4.2, 4.7, 4.8, 5.5, 6.9, 6.10, 6.11_
  - _Boundary: RestoreContextLifecycle and State integration_

- [x] 4.6 利用者向け区画表示を新状態へ対応させる
  - backupとrestoreをsettings配下の別h4領域にし、消失リスク、自動保存・同期なし、全置換、件数preview、再試行方針を安全な固定文言で表示する
  - 日本語・英語で回復、finalization、context refresh、error policyのkeyとplaceholderを一致させ、言語切替時にも同じ状態を表示する
  - draft確認、recovery mode、finalization required、context unavailable、refresh-only retryを状態に応じて操作可能にする
  - 商品名、完全URL、価格、本文、validation path、fingerprintがDOMやログへ出ず、未信頼文字列がHTMLとして解釈されないDOM testが成功すれば完了とする
  - _Depends: 2.5, 4.5_
  - _Requirements: 3.2, 3.5, 3.6, 4.1, 4.2, 4.4, 4.5, 4.7, 4.8, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: BackupRestoreView, ui-messages catalog_

- [ ] 5. section公開境界とdegraded recoveryを統合する
- [x] 5.1 capability分離したsection mountとaction policyを実装する
  - read-only snapshot、backup restore capability、replacement guard、refresh capabilityだけをfactoryへ注入し、settingsにはsection mountだけを渡す
  - export、file選択、preflightはread、commitはrecoveryとしてpolicy変更を別々に購読し、normal maintenance中はcommitを拒否する
  - contextまたはroot unavailableでもmountとrecovery preflightを利用できる状態を保つ
  - mount失敗rollback、冪等unmount、cleanup失敗再試行、再表示時の未選択状態をcontract testが通れば完了とする
  - _Depends: 1.4, 2.6, 4.6_
  - _Requirements: 1.1, 1.5, 3.1, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.4, 5.5, 5.6, 6.1, 6.4, 6.6, 6.7, 6.8_
  - _Boundary: BackupRestoreSectionMount_

- [x] 5.2 degraded shellからの回復flowをproduction-shaped契約で固定する
  - corrupt/unsupported初期snapshotだけがrecovery-requiredでsettingsをmountし、read/recoveryを許可して通常mutationを拒否することを検証する
  - recovery commitとfinalization完了後の最初の正常snapshotで通常projectionへ復帰し、context refresh後に管理featureを再開できることを検証する
  - backup内部からshell compositionやstorageへdeep importせず、上流contract gateと完成済みsection mountだけでflowが成立する
  - production-shaped integration testが正常・回復両経路で同じ公開境界を使用すれば完了とする
  - _Depends: 1.4, 3.4, 4.5, 5.1_
  - _Requirements: 4.5, 5.6, 5.7, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: Application shell recovery integration contract_

- [ ] 6. E2Eと最終検証を完了する
- [x] 6.1 settingsからの通常バックアップ・復元E2Eを更新する
  - 全カテゴリの架空データをexportし、既存変更後に同じfileを確認付きで復元して再起動する
  - 生成artifactが16 MiB file preflightを通り、project、part、source、normalized attributes、current build参照・数量が復元後に一致することを確認する
  - 通常CRUDと再backupが成功し、空rootのbackupも復元可能であるE2Eが成功すれば完了とする
  - _Depends: 3.4, 4.5, 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.3, 4.4, 4.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_
  - _Boundary: Backup restore normal E2E_

- [x] 6.2 cleanup、競合、finalization失敗のE2Eを追加する
  - 取消、guard拒否、commit前失敗、容量超過で既存rootと選択が保持され、容量超過時は別file選択だけが可能なことを検証する
  - control取得後のwrite前cleanup失敗から同じticketでcleanupを再開し、cleanup中のroot write 0件と別ticket拒否を確認する
  - write後cleanup失敗はfinalize-only、context refresh失敗はrefresh-onlyを実行し、どちらもFoundation commitを再実行しない
  - 競合mutation、worker再生成、各retryを含むE2Eでroot write回数と最終状態が期待どおりなら完了とする
  - _Depends: 3.4, 4.5, 5.1_
  - _Requirements: 3.4, 4.2, 4.5, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 6.4, 6.9, 6.10, 6.11_
  - _Boundary: Backup restore failure recovery E2E_

- [x] 6.3 破損・未対応rootからの回復E2Eを追加する
  - corrupt rootとfuture version rootからdegraded settingsを起動し、正常backupのpreflight、明示確認、recovery commitを完了する
  - 回復fileの検証失敗、取消、commit前失敗では元の異常rootと現在選択が変わらず、回復成功を表示しないことを確認する
  - 正常snapshot復帰後に現在projectがreadyまたはemptyへ再検証され、候補管理が利用可能になる
  - finalizationまたはrefreshの単独retryを含む回復E2Eでroot writeが一回だけなら完了とする
  - _Depends: 5.2, 6.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: Backup restore recovery E2E_

- [x] 6.4 公開境界・security・完全検証gateを通す
  - typecheck、lint、runtime schema boundary、public consumer、fixture、final build、unit、integration、E2Eを共通検証flowで実行する
  - 44件のAcceptance Criteriaがtaskと自動testに対応し、未解決placeholder、旧maintenance fence経路、独立navigation、通常CRUD capability漏出がないことを監査する
  - 入力16 MiBと保存root 10 MiBの境界、自己復元可能性上界、分類済み診断、架空fixtureだけが成果物とtestに残ることを確認する
  - 完全検証とproduction artifactのsecurity検査が成功し、blocked taskがなければ完了とする
  - _Depends: 6.1, 6.2, 6.3_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: Backup restore final validation_

## Implementation Notes

- 実装順はruntime schema gate → 上流公開portのconsumer gate → 交換・容量・I/O → restore service → context/state/view → section/degraded integration → E2Eとする。上流契約が未提供の状態で暫定port、deep import、inactive stubを追加しない。
- application-shellのproduction compositionは下流owner taskで扱い、本specでは提供済みrecovery契約のconsumer gateとproduction-shaped integration contractだけを所有する。
- 16 MiBは復元入力ファイルの安全上限、10 MiBは変換後rootのFoundation保存上限として別々に判定する。容量超過した同一入力の復元再実行を許可しない。
- fixtureは架空データだけを使用し、商品値、完全URL、file本文、raw root、fingerprintを診断出力しない。
- guard lifecycleは`context-lifecycle.ts`のowner-local adapterが所有し、permitのbegin成功かつ未closeだけをFoundation commitの前提とする。commit後のsucceeded通知は同adapterが一度だけに閉じ、notification失敗で復元成功を取り消さない。
- project-context公開portはtask 5.1でproduction wiringへ差し替え済み（DEF-011解消）。application-compositionがlate-boundなreplacement guard / refreshを合成し、未bind時だけprepare=permitted・refresh=context-unavailableとして振る舞う。feature側の暫定入口`createUnattachedProjectContextPorts`は削除した。
- section factoryは`read`（`BackupSnapshotReadPort`）、`restore`（`BackupRestoreDataPort`）、`replacementGuard`、`projectContext.refresh`の四capabilityだけを受け取る。`FoundationScopedDataPort`をfeatureへ渡さない。design.mdは`side-panel-contributions.ts`/`application-composition.ts`のwiringをdownstream ownerへ委譲しているが、DEF-011の解消に必要なためtask 5.1で実施した。
- operation policyは`read`（区画表示・export・file選択・preflight・再assessment）と`recovery`（commitとcommit後cleanup）を別々に購読する。exportは以前`mutation`だったが、root writeを伴わないため`read`へ移した。
- `recovery.integration.test.ts`は`createSidePanelFeatureContributions` + `createFeatureRegistry` + `createApplicationShellIntegration`だけでshellを組み立て、正常・回復の両経路で同じsection公開境界を通す。degraded startupはmaintenance sourceの初期`corrupt-data` / `unsupported-version`から作り、shell compositionをtestから改変しない。
- commit前失敗の許可actionは`contracts.ts`の`backupRetryPolicy` / `restoreRetryPolicy` / `restoreContextRetryPolicy`だけが決め、stateとViewは判定を重複させない。
- commit後の`restored-finalization-required`はsummaryを持たない場合がある。section再mountで`findPendingFinalization`から再水和した状態がそれであり、`finalize`成功後に`BackupSnapshotReadPort`の件数照会でsummaryを再構築する（root writeは0件）。
- Viewの再試行方針表示と許可actionは`contracts.ts`のretry policyだけから引く。未保存draft（`action-required` / `resolve-draft`）は解消後に同じticketで`retry-restore`できる唯一のaction-requiredであり、stateの`#retryableFailure`がこの一件だけを例外的に許可する。
- E2Eは三層に分ける。通常経路（`e2e/backup-restore.spec.ts`）と回復経路（`e2e/backup-restore-recovery.spec.ts`）は実拡張のsettings区画とchrome.storageで駆動し、cleanup・競合・finalization失敗（`e2e/backup-restore-failure-recovery.spec.ts`）はesbuildでbundleしたbrowser harnessで駆動する。
- degraded startupは`chrome.storage.local.set({localDataRoot: <破損値>})`+reloadで再現できる。表示言語は`uiLanguage`キーへ別保存されるため、破損前に`selectLanguage`で固定すれば回復後も日本語assertionが成立する。
- fault injectionはstorage boundaryだけで行う。normal commitのcontrol write順は acquire(1) → bindCommit(2) → release(3) であり、[2,3]を失敗させると`precommit-cleanup-pending`、[3]だけなら`committed-finalization-required`になる。root write回数を数えれば「既存データ保持」を観測可能な不変条件として固定できる。
- E2E specは生の`.locator()`を書けない（`tests/tooling/e2e-locator-boundary.test.ts`）。新しい要素は`e2e/models/`のヘルパーへ寄せる。
- `pnpm validate:ci`に`validate:runtime-schema`が入っていなかったため6.4で追加した。共通検証flowはこれでtypecheck・public consumer・lint・boundary・runtime schema・fixture・final build（artifact security検査を含む）・ui-text・unit/integrationを網羅する。
