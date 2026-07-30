# Implementation Plan

- [x] 1. 交換契約とFoundation消費境界を確立する
- [x] 1.1 バージョン付き交換契約と判別可能な結果を定義する
  - 製品識別子、形式版、作成日時、全プロジェクト・候補・現在構成、preview、artifact、復元ticket（candidateとpreview）を型安全に表現する
  - ファイル、形式、参照、非対応版、容量、保存、stale確認の失敗を値を含まないcodeとpathで区別し、Foundationの結果をfeature codeへ写像する形を用意する
  - 現行・旧・将来版fixtureが型検査でき、保存スキーマ版が公開交換契約へ混入しない
  - _Requirements: 1.1, 1.2, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.6, 5.3, 6.5_

- [x] 1.2 Foundationの置換・保守契約を本機能consumerへ公開する
  - 既存Foundationデータportの置換・保守・参照capabilityを本機能から型付きで利用できるよう、public入口へ必要型（保守fence、保守owner識別子）を再公開する
  - write経路・保存ロジック・容量判定は変更せず、public再公開だけを行う
  - 本機能から置換・保守呼び出しとfence受け渡しが型検査を通り、公開consumer型検査が緑になる
  - _Requirements: 3.4, 4.3, 5.1, 5.2, 5.4_
  - _Boundary: Foundation public surface_

- [x] 2. 交換データの検証・移行・変換を実装する
- [x] 2.1 (P) 現行交換形式の実行時検証を実装する
  - JSON解析結果をunknownとして、必須構造、JSON互換性、ID・日時・カテゴリ、禁止内容を検証する
  - 候補所属、構成の同一プロジェクト候補参照、正整数数量、ID一意性をpath付きで検証する
  - 不正構造、孤立候補、別プロジェクト参照、危険な余剰内容が永続化前に拒否される
  - _Depends: 1.1_
  - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3, 6.5_
  - _Boundary: ExchangeValidator_

- [x] 2.2 (P) 交換形式のバージョン移行を実装する
  - 現行版をそのまま受け、対応旧版を連続する純粋変換で現行版へ移行する
  - 各移行段階を再検証し、未知・将来・経路欠落版を内容変更なしで拒否する
  - 旧版fixtureは現行形式へ到達し、将来版fixtureは非対応結果になる
  - _Depends: 1.1_
  - _Requirements: 2.1, 2.4, 2.5, 5.3_
  - _Boundary: ExchangeMigration_

- [x] 2.3 (P) 保存root候補と交換形式の相互変換を実装する
  - プロジェクト、候補の確認値・出典・正規化属性、現在構成の参照・数量を欠落なく写像する
  - 交換データから現行保存スキーマ版の保存root候補を構築し、保存版を入力から信頼しない
  - 候補は`unknown`としてFoundation検証へ渡す前提とし、feature側でschema検証・容量判定を重複実行しない
  - 空データと全カテゴリを含む架空データの往復結果が元の業務データと一致する
  - _Depends: 1.1_
  - _Requirements: 1.1, 1.2, 1.4, 1.6, 2.1, 2.2, 2.3_
  - _Boundary: ExchangeMapper_

- [x] 3. バックアップ作成と復元preflight・commitを実装する
- [x] 3.1 (P) バックアップartifact生成サービスを実装する
  - read-only参照から検証済み全ルートを読み、作成日時付きEnvelopeをJSONへ直列化する
  - 製品接頭辞と作成日を含むファイル名、MIME type、UTF-8バイト数を返す
  - 空データでも復元可能なartifactが生成され、読取・検証失敗時はartifactが返らない
  - _Depends: 2.3_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - _Boundary: BackupService_

- [x] 3.2 復元preflightとpreview生成を実装する
  - 読取前サイズ、JSON解析、交換形式移行、交換検証、保存root候補への変換を交換層で順に行う
  - 変換済み候補をFoundationの置換評価へ渡し、保存schema検証・参照整合性・容量見積り・digest付きassessment生成をFoundationへ委譲する
  - 成功時だけ件数、作成日時、形式版、見積り容量と非永続ticket（candidateとpreview）を返し、preflight assessment自体は保持しない
  - 不正形式、参照不整合、非対応版、容量超過の各fixtureがwriteなしで拒否される
  - _Depends: 1.2, 2.1, 2.2, 2.3_
  - _Requirements: 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.3, 6.5_
  - _Boundary: RestoreService preflight_

- [x] 3.3 検証済みticketの復元commitを実装する
  - 復元セッションのUUID owner識別子でFoundationの保守acquireを呼び、返却fenceを取得する
  - maintenance acquire後にcandidateを再評価し、candidate・最新assessment・fenceをFoundationの置換へ渡して、stale検出・容量再判定・単一writeをFoundation内部に委譲する
  - 成功時はrelease、取消・stale・検証・容量・write失敗時はabortして既存データを保持する
  - acquire前の置換、owner外fence、期限切れfenceがFoundationで拒否され、各失敗点で部分データとactive maintenanceが残らず再試行できる
  - _Depends: 3.2_
  - _Requirements: 4.2, 4.3, 4.4, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: RestoreService commit, FoundationDataPort integration_

- [x] 4. extension pageのファイルI/Oと画面状態を実装する
- [x] 4.1 (P) ブラウザ標準APIによるファイルgatewayを実装する
  - 単一JSON Fileのサイズを本文読取前に確認し、textと実バイト数を返す
  - artifactをBlobとしてダウンロードし、操作後にobject URLを破棄する
  - 読取不能・サイズ超過が分類され、生成ファイル名とJSON本文が変更されずダウンロードへ渡る
  - _Depends: 3.1_
  - _Requirements: 1.3, 3.1, 3.2, 3.4_
  - _Boundary: FileGateway_

- [x] 4.2 バックアップ・検証・確認・復元の状態遷移を実装する
  - idle、exporting、validating、awaiting-confirmation、restoring、succeeded、failedを判別可能に管理する
  - 成功したpreflightだけがticketを保持し、取消、再選択、画面再生成で破棄する
  - 処理中の重複要求と競合操作が抑止され、失敗後は既存表示を維持して再試行できる
  - _Depends: 3.1, 3.2, 3.3, 4.1_
  - _Requirements: 1.5, 3.5, 3.6, 4.1, 4.2, 4.4, 4.5, 5.5, 6.4, 6.6_
  - _Boundary: BackupRestoreState_

- [x] 4.3 管理画面の操作、preview、警告、確認表示をReactで実装する
  - バックアップ作成と復元を分離し、拡張削除時の消失可能性、利用者の保管責任、自動・クラウド・同期なしを表示する
  - framework非依存のBackupRestoreStateをpropsとして受け、検証後の件数・日時・形式版と全体置換確認、成功summary、分類済みエラーを通常のJSX childで描画する
  - `dangerouslySetInnerHTML`と`innerHTML`を使用せず、安全な描画をDOM testで確認できる
  - 未検証時と処理中は不適切な操作が無効で、商品名・URL・価格・本文が診断表示へ露出しない
  - _Depends: 4.2_
  - _Requirements: 3.2, 3.5, 3.6, 4.1, 4.2, 4.4, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: BackupRestoreView_

- [x] 4.4 React root adapterと初期の独立feature registrationを実装する（task 6でsection境界へ移行）
  - `view`をframework非依存のBackupRestoreState/Service/FileGateway portへ接続し、`public`入口とregistration moduleをfeature内で所有する
  - registration契約が置換・保守可能なscoped portを受け取れる形にし、application shellの`FeatureMountContext`へReact rootをmountする
  - 切替・停止時に`root.unmount()`と購読解除を一度だけ行い、shell contract test kitで登録、operation policy、公開API、cleanupが適合する
  - _Depends: application-shell 1.1, 1.3, 1.4; local tasks 4.1, 4.2, 4.3_
  - _Requirements: 1.3, 3.1, 3.6, 4.1, 4.2, 4.4, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: BackupRestoreFeatureRegistration, ReactRootAdapter_

- [x] 5. side panel統合と全体回帰を完成する
- [x] 5.1 初期の独立画面をFoundation portへ統合する（task 6でsettings配下へ移行）
  - application shellがfeatureの`registration`と`public`をcompositionし、置換・保守capabilityを含むscoped portを本機能へ供給する（既定の最小権限portは置換・保守を外すため専用供給とする）
  - 共有runtime入口、HTML host、root barrelをfeature側から編集せず、RestoreServiceの保守acquire/renew/release/abortと置換をFoundationへ接続する
  - shellのread-only maintenance projectionとMutationGateが復元中の全feature mutationを抑止し、read-only navigationを維持したまま成功・失敗・取消後に現行generation終了でmutationを復帰する
  - restoring中は候補・構成管理の競合操作を停止し、成功後は管理画面の照会を復元後スナップショットへ更新する
  - 管理画面からexport、ファイル選択、preview、取消または確認、完了後のデータ利用まで一連操作が完了する
  - _Depends: application-shell 3.3, 4.1; local tasks 3.3, 4.4_
  - _Requirements: 1.1, 1.3, 3.1, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.5, 6.1, 6.4, 6.6_
  - _Boundary: Side panel integration_

- [x] 5.2 全データ往復、原子的失敗、上流契約の回帰テストを完成する
  - 架空の全カテゴリ候補と現在構成をexportし、既存変更後のimportで元の所属・確認値・参照・数量へ完全復元する
  - 不正JSON、旧・将来版、孤立参照、容量境界、保存不能、取消の各経路で復元前データが保持されることを検証する
  - 再起動後にCandidateQueryとCurrentBuildQueryが復元値を返し、通常CRUDと再バックアップが成功する
  - Foundation経由の保守acquire競合、renew、成功release、失敗abort、stale終了通知を検証し、復元中だけ全feature mutationが拒否されread-only操作は継続する
  - _Depends: 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: Backup restore acceptance and regression tests_

- [x] 6. バックアップ・復元をsettings-owned section境界へ移行する
- [x] 6.1 埋め込み可能な公開section mountを追加する
  - 既存のbackup service、restore service、state、file gateway、React rootを再利用し、完全data portをfactory依存として受けるsection adapterを追加する
  - `FeatureMountContext`を受けて`FeatureMountHandle`を返す正確な公開mount契約と、data・任意stateを受けるfactoryだけを公開入口へ加える
  - operation policyをそのまま利用し、mount失敗時は取得済みresourceを解放し、正常終了と二重終了では購読とDOMを一度だけcleanupする
  - 完了時、任意containerで既存のexport、preflight、確認、復元、分類済みerrorを実行でき、mount失敗・正常cleanup・二重cleanupのcontract testが成功する
  - _Requirements: 1.1, 1.5, 3.1, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - _Boundary: BackupRestoreSectionMount, ReactRootAdapter_

- [x] 6.2 settings composition切替後に独立registrationを撤去する
  - settings側が公開section mountだけを利用する状態になった後、独立feature registration、feature contribution、feature ID、navigation metadata、空public APIの公開を削除する
  - backup内部のservice、state、交換形式、maintenance generation、atomic restore、分類済みerrorは変更せず、settingsやshellの内部実装をbackup側へ取り込まない
  - 完了時、production catalogとbackup公開入口に独立`backupRestore` navigation/registrationが残らず、公開consumer型検査とboundary検査が成功する
  - _Depends: 6.1, settings-screen 3.2_
  - _Requirements: 4.3, 5.1, 5.2, 6.1, 6.7_
  - _Boundary: BackupRestore public surface, legacy registration removal_

- [x] 6.3 section lifecycleと利用者操作の回帰を固定する
  - 架空データをsectionへmountし、export、ファイル検証、preview、取消、確認、成功・失敗後の再試行を既存state/view契約のまま検証する
  - operation policyによる処理中抑止と安全な診断表示を確認し、商品値・完全URL・ファイル本文がsectionの表示やログへ出ないことを固定する
  - unmount後の再mountでは一時選択とticketが未選択状態へ戻り、同じcontainerへ購読やReact rootが重複しないことを確認する
  - 完了時、section lifecycleとDOM操作の対象testが連続成功し、設定画面へ埋め込んでも既存の操作状態と案内が維持される
  - _Depends: 6.1_
  - _Requirements: 1.1, 1.3, 1.5, 3.1, 3.2, 3.5, 3.6, 4.1, 4.2, 4.4, 4.5, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - _Boundary: BackupRestoreSectionMount acceptance, BackupRestoreView_

- [x] 6.4 交換形式・原子的復元・maintenanceのdomain回帰を固定する
  - 10MB上限、非対応版、参照不整合、stale assessment、容量・保存失敗で書込前データが保持され、部分置換や交換形式の差分がないことを既存Foundation port統合で確認する
  - 30秒leaseのacquireから再評価・置換・releaseまたはabortまでを検証し、cleanup失敗時もread-only操作を維持してlease失効後に通常mutationと再試行が回復することを確認する
  - 復元後も通常query・CRUD・再backupが成功し、候補所属、確認値、現在構成参照、数量が配置変更前と一致することを確認する
  - 完了時、exchange、service、domain integration、公開境界の対象testが連続成功し、section化による交換形式・atomic restore・error ownershipの回帰がない
  - _Depends: 6.1, 6.2_
  - _Requirements: 1.1, 1.2, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.3, 3.4, 4.3, 4.4, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 6.5, 6.7_
  - _Boundary: Exchange and restore acceptance, FoundationDataPort integration_

## Implementation Notes

- 1.1: 現行交換形式版は1が初出のため、対応対象の旧版fixtureは存在しない。`tests/fixtures/backup.ts`は現行版・空データ・将来版(2)のfixtureのみを提供する。旧版fixtureは形式版2以降を追加する時点で用意する。
- 1.2: `MaintenanceOwnerId`は既に`domain/public.ts`経由で公開済みだったため追加不要。`MaintenanceFence`のみ`persistence/public.ts`へ追加公開した。`tests/tooling/public-boundaries.test.ts`のFoundation非公開境界guardは`MaintenanceFence`だけを許可するよう意図的に更新済み（他の内部型は引き続き禁止）。
- 2.1: `tests/fixtures/`配下は`scripts/validate-fixture-assets.mjs`のraw-html等asset policyでスキャンされる（`.test.ts`ファイルはスキャン対象外）。生HTML文字列を含む不正値fixtureは`tests/fixtures/`に置かず、対象の`.test.ts`内へ直接記述する。
- 全task共通: このBash環境はデフォルトで`globstar`が無効なため、`tests/**/*.test.ts`のような2階層以上深いglobはshellが部分展開してしまい`tests/features/<feature>/*.test.ts`を静かに取りこぼす。全件回帰確認は`shopt -s globstar`を同一コマンド内で有効にしてから実行する。
- 3.3: design.mdのData Modelsに`RestoreSummary`の明示的な型定義がなかったため、`RestoreService.commit`の戻り値として`contracts.ts`へ追加した（`RestorePreview`と同じ件数フィールドの確定値）。release/abort呼び出し自体の成否はcommitの戻り値へ反映せず、replaceRootの成否だけを最終結果として返す（release/abort失敗はFoundation側のmaintenance lease自然失効に委ねる設計判断）。
- 4.2: `BackupRestoreStateValue`はphaseに加え、succeeded/failedへ`operation: "backup"|"restore"`を持たせた（design.mdは7 phase名だけを列挙していたが、backup作成とrestore復元を同じstate machineで扱うため、どちらの操作が終端したかを型で判別可能にした）。cancel()はawaiting-confirmation/failed/succeededからidleへ戻すが、busy phase（exporting/validating/restoring）中は無視する。
- 4.3: `styles.css`は本taskで一度作成したが、`tests/tooling/build-smoke.test.ts`が「`src/features/<feature>/styles.css`は`application-shell/side-panel.css`へ`@import`されている前提」を検査するため、shell側の`@import`追加（4.4のregistration/mount、または5.1のside panel統合の責務）と対にしないと回帰する。View単体のtaskではCSSファイルを作らず、実際にfeatureをmount・登録するtaskで追加する。React testでは非同期action（`state.exportBackup()`等をfire-and-forgetで呼ぶonClickハンドラ）の検証に`act(async () => element.click())`を使い、mid-flightの状態（busy中のdisabled確認等）を見たい場合は`act(() => { pending = state.xxx(); })`のように同期actでstate呼び出し自体をラップしてPromiseを外へ保持する。
- 5.2: `current-build/service.ts`の`select`/`set-quantity`は`category-policy.ts`の`SelectionMode`("single"|"multiple"|"ineligible")に厳密で、single-modeカテゴリへの`set-quantity`呼び出しやineligibleカテゴリへの`select`呼び出しは常に`validation`失敗となる。全カテゴリ横断の回帰testでは、ineligible（uncategorized）をbuild選択から除外し、single-modeは`select`のみ（数量は暗黙に1）、multiple-modeのみ`set-quantity`を呼ぶ必要がある。保存不能（storage-unavailable）と取消（cancel）経路は本taskで実Foundationを使った再テストをせず、既存の`service.test.ts`/`state.test.ts`単体テストのカバレッジに委ねた（実Foundation版で再現するには追加のstorage-adapter故障注入が必要になり、既存の単体テストで観測可能な契約と重複するため）。同様に、Foundation保守の`renew`は`RestoreService`がacquire→release/abortしか呼ばないため本feature層ではテスト対象にせず、renew自体の正しさはlocal-data-foundation側の既存test suiteが担保する。
- 4.4: `FeatureMountContext`に`data`は含まれない。`FoundationDataPort`（または`FoundationScopedDataPort`）はregistration factory自身のconstructor依存として渡し、`mount()`内のclosureで使う（candidate-management/current-buildと同じ既存パターン）。styles.cssをまだ`side-panel.css`へ@importしていないため（4.3のnote参照）、実際のside panel mount配線・stylesheet追加は5.1で行う。backup-restoreは`captureState`/`activation`を一切公開せず、画面再生成のたびに新しいidle状態のBackupRestoreStateから始まる（Requirement 6.6）。
- feature validation後の追補: design.mdのTesting Strategyが挙げるE2Eを`e2e/backup-restore.spec.ts`として追加した（export→ファイル保存→データ改変→取消→確認→復元→reload→復元後CRUDと再backup）。またvalidation中に上流`application-shell`の実バグを1件検出・修正した: `MaintenanceProjection`の初期cursor`{generation:0, revision:0}`は「未受信」を表す暫定値なのに実snapshotと`compareCursor`で比較されており、空ストレージ起動時（実snapshotも`{0,0}`）は初回観測が構造的に必ず`stale_ignored`となって起動のたびに診断エラーを出していた。projectionへ未受信フラグを持たせ最初のacceptだけ比較をスキップするよう修正済み。
- 5.1: `FeatureCompositionContext`/`ProductionFoundationHandle`へ`fullDataPort`を追加した（既定の`data`は引き続きscoped port）。real Foundationを使う統合testで初めて判明した実バグ2件を修正: (1) `RestoreService.commit`はacquire自体がrevisionを進めるため、preflight時のassessmentをそのままreplaceRootへ渡すと必ずstale-assessmentになる — acquire後にassessReplacementを再実行してから渡すよう修正。(2) replaceRoot自体もrevisionを進めるため、releaseにacquire時のfenceをそのまま渡すとstale-fenceで黙って失敗し保守が解放されないまま残る — replaceRootが返す新revisionをfenceへ反映してからreleaseするよう修正。単体testのfake portだけでは検出できない類のバグで、実Foundationを使う結合testの価値を示す例。
- 6.1–6.4: task 4.4と5.1で完成した独立feature registrationは移行元としてのみ残る。section contractを先に加算し、`settings-screen`のcomposition切替後にだけ旧registration/contributionを削除する。これにより移行途中の実装可能性を保ちながら、最終状態では独立navigationと二重mountを残さない。
- validation remediation: Requirement 6.5に合わせ、検証pathは内部の分類・テストにだけ保持し、UIとログへは出さず固定code文言だけを表示する。`RestoreTicket`はcandidateとpreviewだけを保持し、preflight assessmentは見積りへ使用後に破棄する。commitはacquire後の再assessmentを唯一の置換assessmentとし、preview後の現行root変更はcommit時の再検証とfenceで安全性を判定する。
