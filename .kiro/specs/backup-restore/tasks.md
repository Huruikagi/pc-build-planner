# Implementation Plan

- [ ] 1. 上流公開契約とruntime prerequisiteを固定する
- [ ] 1.1 configured runtime schemaの同等性gateを追加する
  - canonical configured Zod Mini入口、strict plain object、JSON safety、owner error/path変換だけを利用できる状態を確認する
  - 交換形式の既存valid/invalid結果、error code、canonical pathが移行前後で一致し、Zod issueや入力値が公開されないことをcontract testで固定する
  - featureからの`zod/mini`直接import、他feature schemaのdeep import、unknown-key strippingを公開境界gateで拒否できれば完了とする
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 6.5_
  - _Boundary: ExchangeValidator runtime prerequisite_

- [ ] 1.2 (P) Foundationのbackup専用公開契約をconsumer側で固定する
  - assessment結果がmode、必要bytes、current anomaly、opaque ticketだけを公開し、revision、fingerprint、digest、fence、通常CRUDへ到達できないことを検証する
  - commit commandがcandidate、expected mode、assessment ticketを必須とし、commit point付き結果とfinalize-only ticketを判別できるconsumer fixtureを追加する
  - 公開型とruntime keyのnegative contractが、raw root、Storage、lock、Repository、authority factoryを拒否すれば完了とする
  - _Requirements: 3.4, 4.3, 4.5, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7_
  - _Boundary: BackupRestoreDataPort consumer contract_

- [ ] 1.3 (P) project-contextの置換guardとrefresh契約をconsumer側で固定する
  - replacement preparation、confirmation、permit begin/completeと、ready/empty/unavailableを返すrefreshだけを利用するconsumer fixtureを追加する
  - guard registry、draft内容、preference、selection fallbackへのdeep importが公開境界gateで拒否されることを確認する
  - context unavailableでもprepareでき、stale confirmation/permitを型付き結果として扱える状態になれば完了とする
  - _Requirements: 4.7, 4.8, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: ProjectContext public port consumer contract_

- [ ] 1.4 (P) application-shellのrecovery contract gateをconsumer側で固定する
  - canonical `OperationKind`を`read | mutation | recovery`の単一定義へ統一し、`recovery-required` projection、operation policyの購読契約をcompile/runtime fixtureで固定する
  - corrupt-dataとunsupported-versionだけがsettingsをmount可能なdegraded stateとなり、通常mutationはfail closed、readとrecoveryだけが許可されることを検証する
  - 正常snapshot通知で通常projectionへ復帰し、backup featureをproduction compositionしなくてもcontract/gate単体が成立すれば完了とする
  - _Requirements: 4.5, 5.6, 5.7, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: Application shell recovery contract gate_

- [ ] 2. 交換形式、Mapper、ファイル入出力を更新する
- [ ] 2.1 owner-local交換schemaと形式migrationをruntime schema基盤へ移行する
  - strict Envelope、全交換entity、日時・ID・カテゴリ・数量をconfigured schema primitiveで検証する
  - format versionの将来版を変換せず拒否し、対応旧版は各段階を現行shapeとして再検証する
  - 禁止payload、未知key、非JSON値、ID重複、孤立参照、別project参照を値非露出のfeature errorへ写像する
  - 現行・空・旧・将来・不正fixtureの検証結果とcanonical pathが決定的に一致すれば完了とする
  - _Depends: 1.1_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 6.5_
  - _Boundary: ExchangeValidator, ExchangeMigration_

- [ ] 2.2 交換形式と保存rootのMapperを更新する
  - 全project、partの確認値・source・正規化属性、current build参照と数量を欠落なく双方向写像する
  - 保存schema version、revision、request dedupe、互換性派生値、生HTML、画像を交換形式へ含めず、入力の保存versionを信頼しない
  - 空データと全カテゴリの架空fixtureがFoundation検証後に往復同値となれば完了とする
  - _Depends: 2.1_
  - _Requirements: 1.1, 1.2, 1.4, 1.6, 2.1, 2.2, 2.3, 3.1, 3.3_
  - _Boundary: ExchangeMapper_

- [ ] 2.3 (P) File gatewayへ正確な10 MiB境界と安全なI/Oを実装する
  - UTF-8で`10 * 1024 * 1024` bytesを1 byteでも超えるFileを本文読取前に拒否し、Envelope用の超過許容を設けない
  - 単一ファイルだけを読み、Blob download後のobject URLと一時resourceを確実に解放する
  - 境界値、複数選択、読取不能、download失敗、cleanup再試行をWeb API stubで決定的に検証できれば完了とする
  - _Depends: 1.1_
  - _Requirements: 1.3, 3.1, 3.2, 3.4, 6.4, 6.5_
  - _Boundary: FileGateway_

- [ ] 2.4 バックアップartifact生成を現行交換契約へ接続する
  - frozen read-only portから検証済み全rootを読み、作成日時、形式版、決定的JSON、UTF-8 byte lengthを持つartifactを生成する
  - 製品接頭辞と作成日を含むfilenameを生成し、空rootも復元可能なファイルとして出力する
  - 読取、検証、mapping、serializationの失敗時はartifactとdownloadを生成せず、分類済み再試行案内へ写像できれば完了とする
  - _Depends: 2.2, 2.3_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 6.4, 6.5_
  - _Boundary: BackupService_

- [ ] 3. assessment ticket付き復元serviceを実装する
- [ ] 3.1 normal/recovery preflightとpreviewを実装する
  - file入力を交換検証・migration・mapping後にFoundation assessmentへ渡し、正常rootとcorrupt/unsupported rootだけを正しくmode分岐する
  - candidate拒否、容量超過、storage failureをcurrent anomalyと混同せず、opaque assessment ticketを成功時だけRestoreTicketへ保持する
  - 件数、作成日時、形式版、必要bytes、modeをpreviewへ写し、検証中はcommit不能であることを状態契約から確認できれば完了とする
  - _Depends: 1.2, 2.2, 2.3_
  - _Requirements: 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.3, 5.6, 5.7, 6.5_
  - _Boundary: RestoreService preflight_

- [ ] 3.2 commit pointとfinalize-only retryを実装する
  - candidate、expected mode、assessment ticketをFoundation commitへ渡し、write前errorと二つのcommitted outcomeを区別する
  - stale assessment、mode変化、capacity、storage、maintenance/recovery競合は既存rootを保持し、ticketを再検証可能な状態へ返す
  - write後cleanup失敗では成功summaryとopaque finalization ticketだけを返し、finalize retryがroot writeや再確認を行わないことを証明できれば完了とする
  - _Depends: 3.1_
  - _Requirements: 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: RestoreService commit and finalization_

- [ ] 3.3 Foundationとの競合・原子性統合を固定する
  - preflight後に先行mutationが確定した場合、assessment ticketがstale拒否され先行変更が保持されることを検証する
  - commit線形化後の後続mutationがpersistent maintenance/recovery controlで拒否され、read-only queryは継続できることを検証する
  - write前の全失敗でroot不変、write後cleanup失敗で一回だけwrite、finalize retryでwrite 0件となれば完了とする
  - _Depends: 1.2, 3.2_
  - _Requirements: 3.4, 4.3, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: BackupRestoreDataPort integration_

- [ ] 4. project-context lifecycle、状態、表示を実装する
- [ ] 4.1 replacement guardとpost-commit refreshを順序付ける
  - prepare、confirmation、cancel、begin、completeをpermit lifecycleどおり呼び、begin成功前のFoundation commitを禁止する
  - commit前失敗・取消はfailed/cancelledでpermitを閉じ、committed outcomeだけをsucceededとして一回通知する
  - finalization完了後にだけrefreshし、refresh失敗をrollbackせずrefresh-only retryへ変換できれば完了とする
  - _Depends: 1.3, 3.2_
  - _Requirements: 4.7, 4.8, 5.5, 6.9, 6.10, 6.11_
  - _Boundary: RestoreContextLifecycle_

- [ ] 4.2 バックアップ・復元状態機械を更新する
  - export、validation、置換確認、draft確認、restoring、finalization、context refreshの判別状態と許可actionを定義する
  - 取消、guard拒否、commit前失敗ではfile ticketとpreviewを保持し、section unmountまたはfile再選択だけで未commit ticketを破棄する
  - commit後はrestore retryを公開せず、finalize-onlyまたはrefresh-only actionに固定し、同一区画の重複操作を受理しなければ完了とする
  - commit前errorを`retryable | action-required | unsupported`へ網羅的に写像し、同一入力の再試行、別file選択、draft解決、容量確保、再試行不可をstateの許可actionで区別する
  - _Depends: 2.4, 3.2, 4.1_
  - _Requirements: 1.5, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 6.4, 6.6, 6.9, 6.10, 6.11_
  - _Boundary: BackupRestoreState_

- [ ] 4.3 project-context lifecycleとstateの統合を固定する
  - guard拒否、取消、staleでselection、root、ticketが保持され、新しいprepareから再試行できることを検証する
  - committed outcomeではcomplete succeededを一回だけ呼び、finalization中にrefreshせず、refresh失敗後もFoundation commitを再実行しないことを検証する
  - finalize-only/refresh-only retryのcommand列と最終ready/empty/unavailable表示が期待順に一致すれば完了とする
  - _Depends: 4.2_
  - _Requirements: 4.2, 4.7, 4.8, 5.5, 6.9, 6.10, 6.11_
  - _Boundary: RestoreContextLifecycle and State integration_

- [ ] 4.4 利用者向け区画表示を新状態へ対応させる
  - backupとrestoreをsettings配下の別`h4`領域にし、消失リスク、自動保存・同期なし、全置換、件数preview、再試行方針を`useMessages()`経由の固定安全文言で表示する
  - 日本語・英語で回復、finalization、context refresh、error policyのkeyとplaceholderが一致し、catalog parityと言語切替DOM testが成功することを固定する
  - draft確認、recovery mode、finalization required、context unavailable、refresh-only retryを状態に応じて操作可能にする
  - 商品名、完全URL、価格、本文、validation path、fingerprintがDOMやログへ出ず、未信頼文字列が安全なJSX childとして描画されれば完了とする
  - _Depends: 2.3, 4.2_
  - _Requirements: 3.2, 3.5, 3.6, 4.1, 4.2, 4.4, 4.5, 4.7, 4.8, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: BackupRestoreView_

- [ ] 5. section公開境界とdegraded recoveryを統合する
- [ ] 5.1 capability分離したsection mountとaction policyを実装する
  - read-only snapshot、backup restore capability、replacement guard、refresh capabilityだけをfactoryへ注入し、settingsにはsection mountだけを渡す
  - export/file選択/preflightはread、commitはrecoveryとしてpolicy変更を購読し、normal maintenance中はcommitを拒否する
  - context/root unavailableでもmountとrecovery preflightが利用でき、mount失敗rollback、冪等unmount、cleanup失敗再試行がcontract testを通れば完了とする
  - _Depends: 1.4, 2.4, 4.4_
  - _Requirements: 1.1, 1.5, 3.1, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.4, 5.5, 5.6, 6.1, 6.4, 6.6, 6.7, 6.8_
  - _Boundary: BackupRestoreSectionMount_

- [ ] 5.2 degraded shellからの回復flowをproduction-shaped契約で固定する
  - corrupt/unsupported初期snapshotだけがrecovery-requiredでsettingsをmountし、read/recoveryを許可して通常mutationを拒否することを検証する
  - recovery commitとfinalization完了後の最初の正常snapshotで通常projectionへ復帰し、context refresh後に管理featureを再開できることを検証する
  - backup内部からshell compositionやstorageへdeep importせず、contract gateと完成済みsection mountだけでflowが成立すれば完了とする
  - _Depends: 1.4, 3.3, 4.3, 5.1_
  - _Requirements: 4.5, 5.6, 5.7, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: Application shell recovery integration contract_

- [ ] 6. E2Eと最終検証を完了する
- [ ] 6.1 settingsからの通常バックアップ・復元E2Eを更新する
  - 全カテゴリの架空データをexportし、既存変更後に同じfileを確認付きで復元して再起動する
  - 復元後にproject、part、source、normalized attributes、current build参照・数量が一致し、通常CRUDと再backupが成功することを検証する
  - 取消、invalid file、10 MiB境界、guard拒否、commit前失敗で既存rootと選択が保持されれば完了とする
  - _Depends: 3.3, 4.3, 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - _Boundary: Backup restore normal E2E_

- [ ] 6.2 破損・未対応rootからの回復E2Eを追加する
  - corrupt rootとfuture version rootからdegraded settingsを起動し、正常backupのpreflight、明示確認、recovery commitを完了する
  - cleanup失敗時はfinalize-only、context refresh失敗時はrefresh-onlyを実行し、どちらもroot writeが一回だけであることを検証する
  - 正常snapshot復帰後に現在projectがreadyまたはemptyへ再検証され、候補管理が利用可能になれば完了とする
  - _Depends: 5.2_
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: Backup restore recovery E2E_

- [ ] 6.3 公開境界・security・完全検証gateを通す
  - typecheck、lint、runtime schema boundary、public consumer、fixture、final build、unit/integration/E2Eを共通検証flowで実行する
  - 43件のAcceptance Criteriaがtaskと自動testに対応し、未解決placeholder、旧maintenance fence経路、独立navigation、通常CRUD capability漏出がないことを監査する
  - `pnpm validate`とproduction artifactのsecurity検査が成功し、blocked taskがなければ完了とする
  - _Depends: 6.1, 6.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_
  - _Boundary: Backup restore final validation_

## Implementation Notes

- 実装順はruntime schema gate → Foundation/project-context public ports → application-shell recovery contract gate → backup feature → application-shell production wiringとする。上流契約が未提供の状態で暫定port、deep import、inactive stubを追加しない。
- 旧tasksの`FoundationDataPort`、manual maintenance acquire/renew/release/abort、30秒lease自然失効、独立feature registrationは現設計へ引き継がない。
- fixtureは架空データだけを使用し、商品値、完全URL、file本文、raw root、fingerprintを診断出力しない。
