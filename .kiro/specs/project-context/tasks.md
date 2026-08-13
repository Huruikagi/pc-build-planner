# Implementation Plan

> **実装前提**: 上流 `runtime-schema-validation` の configured runtime schema 公開入口と production gate が実装・検証済みであること。未完了の場合は本 spec 内で代替 schema や direct Zod import を追加せず、Task 1.2 を開始しない。

## Change Brief Integration

- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **In-scope task delta**: Task 6–9 は `v0.5.0` の `ProjectLifecyclePort` / service / state、作成・改名・削除、削除確認、最小 data port、成功後 refresh・失敗時非 refresh、既存表示を保つ presentation、contract / DOM / E2E を維持し、lifecycle message を semantic intent・発火条件・必要 parameter・key 非依存 descriptor と resolver consumer seam に限定する。
- **Preserved boundary**: Task 1–5 の selection preference、fallback、guard、generation、selector、replacement guard、implementation notes を維持する。lifecycle の ja/en 物理 catalog file、具体 key/value、descriptor-to-key mapping、aggregation、parity は `ui-message-catalog` に委譲し、layout・CSS、独立 project 管理画面、candidate 一覧/editor 情報設計、foundation の reference repair algorithm、保存形式、v1.0.0 UI 全面刷新は Task 6–9 に含めない。

- [x] 1. project context の基礎契約と信頼境界を確立する

- [x] 1.1 検証済み snapshot と ordered catalog projection を実装する
  - ready、empty、unavailable の判別可能な snapshot、generation、最小 project item、catalog source の契約を定義する。
  - source 順を維持した全-or-nothing projection とし、duplicate ID、不正 entry、source failure を部分 catalog にせず拒否する。
  - ready の選択一意性、empty の null 選択、unavailable の selection 非公開を unit test で固定する。
  - 同じ catalog fixture から全 consumer が同一 snapshot を取得でき、独自 fallback が不要な状態を完了とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4, 4.2_
  - _Boundary: ProjectCatalogProjection_

- [x] 1.2 専用 project preference の検証と保存を実装する
  - 上流の設定済み runtime schema 入口を使い、version 1 と project ID だけを持つ strict preference を unknown から検証する。
  - missing、valid、invalid、read failure を区別し、write と clear を安定した error union へ閉じる。
  - Chrome local の専用 key adapter と決定的な in-memory adapter を同じ port で提供し、canonical root と backup へ値を混在させない。
  - valid/invalid/unknown version、別 key 非接触、read/write/clear failure の test が通る状態を完了とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.1, 3.6, 8.1, 8.2, 8.3_
  - _Boundary: ProjectPreferenceStore_
  - _Depends: 1.1_

- [x] 1.3 preference storage の key-scoped boundary gate を追加する
  - project-context の保存 adapter について許可 source、local area、専用 key の三条件を同時に検査する。
  - 別 source、session/sync area、別 key、dynamic key、storage alias、専用 key と別 keyの混在を negative fixture で拒否する。
  - project-context が boundary と UI text の必須 scan root に含まれ、root 欠落時に fail closed となることを検証する。
  - 正常 adapter だけが gate を通り、既存 foundation・language・transient storage policy を弱めない状態を完了とする。
  - _Requirements: 8.1, 8.3, 8.4_
  - _Boundary: ProjectContextBoundaryGate_
  - _Depends: 1.2_

- [x] 2. guard 付き context transaction を構築する

- [x] 2.1 (P) project change guard の登録・確認基盤を実装する
  - stable ID による登録、duplicate 拒否、解除、登録順評価、registry revision を実装する。
  - project 選択と catalog 全体置換を判別する intent について allow と confirmation-required だけを集約し、draft 内容や保存・破棄方法、置換候補を受け取らない。
  - confirmation を intent、base generation、registry revision に結び付け、cancel と stale 判定を提供する。
  - 両 intent の登録・評価・取消・stale と forced notifier の例外隔離が test で観測できる状態を完了とする。
  - _Requirements: 3.4, 3.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.13, 6.3, 6.5, 6.7_
  - _Boundary: ProjectChangeGuardCoordinator_
  - _Depends: 1.1_

- [x] 2.2 catalog 全体置換の permit lifecycle を実装する
  - prepare と必要な confirm から、snapshot generation と guard registry revision に結び付いた一時 permit を発行し、それ自体では snapshot、preference、generation を変更しない。
  - begin 時に取消、generation、registry revision、別 transaction による stale を再検証し、無効な permit は置換開始を拒否して再評価可能な結果を返す。
  - complete は outcome にかかわらず permit を先に terminal closed とし、succeeded のときだけ forced replacement を一回通知して、failed または cancel では通知しない。
  - prepare、confirm、cancel、begin、complete の全分岐と通知例外を test で観測でき、refresh は downstream owner が別 transaction として要求できる状態を完了とする。
  - _Requirements: 5.2, 5.3, 5.4, 5.9, 5.10, 5.11, 5.12, 5.13, 6.5, 6.7_
  - _Boundary: ProjectChangeGuardCoordinator Replacement_
  - _Depends: 2.1_

- [x] 2.3 (P) 初期化と catalog refresh の context state machine を実装する
  - 初期化時に catalog と preference を読み、valid preference、先頭 fallback、empty、unavailable の優先規則で一つの snapshot を確定する。
  - invalid / missing preference を repair し、repair 成功前に ready を公開しない。
  - refresh では有効な現在選択を維持し、削除・置換時は先頭 fallback または empty へ移行し、失敗時は unavailable へ閉じる。
  - unavailable からの retry、generation の単調増加、listener 一回通知が integration test で確認できる状態を完了とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.4, 3.5, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - _Boundary: ProjectContextService Lifecycle_
  - _Depends: 1.1, 1.2_

- [x] 2.4 選択・確認 transaction と競合抑止を完成する
  - select、confirm、cancel、refresh を一つの queue へ直列化し、unknown target と同値再選択を state 不変で処理する。
  - guard 評価後に必要なら confirmation を返し、有効な confirm だけが preference write と snapshot commit へ進む。
  - preference write 成功後にだけ selection と generation を更新し、stale completion、write failure、guard failure で以前の snapshot を保持する。
  - rapid selection、refresh 競合、target deletion、stale confirmation の決定的 test で最後に確定した一つの選択だけが公開される状態を完了とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: ProjectContextService Selection_
  - _Depends: 2.1, 2.3_

- [x] 2.5 能力別 public facade と subscription isolation を実装する
  - snapshot 取得・購読、選択・確認・取消・refresh、guard 登録、catalog 全体置換の prepare・確認・取消・完了通知を read / command / guard / replacement port へ分離する。
  - frozen facade から service、catalog source、preference adapter、guard collection、runtime schema を公開しない。
  - unsubscribe 後の非通知、listener 例外隔離、canonical Result、通常 consumer の public 入口を contract test で固定する。
  - downstream owner が shell 具体実装や feature deep import なしに必要な capability だけを受け取れる状態を完了とする。
  - _Requirements: 1.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.5, 8.6, 8.7_
  - _Boundary: ProjectContextPublicApi_
  - _Depends: 2.2, 2.4_

- [x] 3. 共通 selector presentation を提供する

- [x] 3.1 (P) project selector の日英 message と状態表現を追加する
  - ready、empty、unavailable、retry、pending、confirmation、error に必要な message を日本語・英語へ同じ key と placeholder で追加する。
  - project-context namespace を既存 catalog parity と UI text gate に接続する。
  - message resolver の両言語 test で raw key、未翻訳文字列、placeholder drift がない状態を完了とする。
  - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - _Boundary: ProjectSelector Messages_
  - _Depends: 1.1_

- [x] 3.2 共通 project selector component を実装する
  - read port を購読し、ready の native select、empty の disabled state、unavailable の retry、pending status を描画する。
  - confirmation-required を一つの keyboard 操作可能な確認 UI として表示し、confirm/cancel の結果を command port へ渡す。
  - accessible label、live status、focus、Escape cancel、重複操作抑止を実装し、project 名を text child としてのみ描画する。
  - 日本語・英語の切替後も選択が変わらず、markup-like 名から HTML element が生成されない DOM test が通る状態を完了とする。
  - _Requirements: 5.4, 5.5, 5.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  - _Boundary: ProjectSelector_
  - _Depends: 2.5, 3.1_

- [x] 3.3 composition 専用 presentation contribution を実装する
  - shell が渡す exact container に LanguageProvider と selector の一つの React root を mount する。
  - 二重 mount、mount failure、idempotent unmount を扱い、subscription、pending UI、root、container を確実に cleanup する。
  - 通常 public API に React root や runtime adapter を混在させず、slot の作成と singleton composition は downstream shell に残す。
  - mount/unmount contract test で listener と DOM が残らず、再 mount できる状態を完了とする。
  - _Requirements: 6.6, 7.1, 7.3, 7.6, 7.7, 8.5_
  - _Boundary: ProjectContextPresentationContribution_
  - _Depends: 3.2_

- [x] 4. 契約・境界・downstream readiness を検証する

- [x] 4.1 (P) context lifecycle と guard の横断 contract test を完成する
  - side panel 再オープンを表す再初期化、作成、削除、全置換、catalog failure、preference failure、回復を架空 catalog で検証する。
  - consumer を複数購読しても同じ generation と selection を受け取り、stale operation で後退しないことを確認する。
  - guard confirmation、cancel、forced selection、notifier failure と catalog invalidation を一つの transaction harness で検証する。
  - replacement permit の prepare、confirm、cancel、stale begin、failed completion、success 通知を検証し、success 後の refresh が独立 transaction であることを固定する。
  - 全 lifecycle branch で ready/empty/unavailable の不変条件と preference の結果が一致する状態を完了とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.1, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 6.4, 6.5, 6.7_
  - _Boundary: ProjectContext Contract Integration_
  - _Depends: 2.5_

- [x] 4.2 (P) selector の DOM・accessibility contract test を完成する
  - ready/empty/unavailable/pending/confirmation/error の利用者表示を testing-library と user-event で操作する。
  - keyboard、focus、label、live status、disabled state、retry、confirm/cancel、言語切替を利用者視点で検証する。
  - 未信頼な project 名が text のままで、画像・script・HTML node を生成しないことを確認する。
  - mount/unmount を繰り返しても React root と subscription が残らない状態を完了とする。
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  - _Boundary: ProjectSelector Validation_
  - _Depends: 3.3_

- [x] 4.3 public import と legacy authority の negative gate を完成する
  - 通常 consumer、composition owner、runtime owner、replacement owner の許可入口を区別し、内部 deep import と schema instance 公開を拒否する。
  - public consumer typecheck で read-only consumer が command、preference、service instance へ到達できないことを固定する。
  - legacy snapshot ID を context 初期化・fallback の入力へ渡す経路と、context unavailable が settings/backup 起動を阻止する契約を negative fixture で拒否する。
  - storage gate と import gate の全 negative fixture が対応する安定した rule で非 zero になり、正しい consumer が通る状態を完了とする。
  - read、command、guard、replacement の能力分離を positive / negative fixture で固定し、replacement owner が service や別 port へ到達できないことを確認する。
  - _Requirements: 6.1, 6.2, 6.6, 6.7, 8.4, 8.5, 8.6, 8.7_
  - _Boundary: ProjectContextBoundaryGate_
  - _Depends: 1.3, 2.5, 3.3_

- [x] 4.4 (P) downstream adapter と横断 E2E の契約 kit を提供する
  - read port の ready/empty/unavailable、generation、forced change を owner-local adapter が検証できる reusable contract kit にする。
  - selector の stable role、label、status、confirmation を downstream Playwright model から利用できる locator contract として固定する。
  - synthetic replacement owner が prepare、confirm、begin、complete、refresh を順序付け、失敗・取消・stale を再評価できる reusable contract kit を提供する。
  - candidate/current-build/compatibility/backup/handoff/shell の具体実装を kit に取り込まず、各 owner が production wiring 後に同じ期待値を再利用できるようにする。
  - 架空 project fixture だけで reopen persistence、selection consistency、restore recovery の downstream scenario を記述可能な状態を完了とする。
  - _Requirements: 5.9, 5.10, 5.11, 5.12, 5.13, 6.6, 6.7, 8.6, 8.7, 8.8_
  - _Boundary: ProjectContext Downstream Contract Kit_
  - _Depends: 2.5, 3.3_

- [x] 4.5 core service と selector の browser 横断 E2E を実装する
  - 架空 catalog、共有 preference、guard、selector を test-only browser harness で composition し、production manifest と bundle へ含めない。
  - project 選択、確認・取消、再初期化後の preference 復元、選択削除後の fallback、empty、unavailable retry を Playwright で操作する。
  - catalog 全体置換を prepare、confirm、begin、complete succeeded、refresh の順で操作し、failed、cancel、stale では通知せず、success 後の refresh failure は置換を再実行せず retry できることを確認する。
  - DOM locator は downstream contract kit と同じ role・label・status を利用し、日本語・英語、keyboard、markup-like project 名を検証する。
  - core E2E が実 feature や shell の内部を import せず成功し、downstream production wiring 後に同じ期待値を再利用できる状態を完了とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 4.3, 4.4, 4.6, 5.4, 5.5, 5.6, 5.9, 5.10, 5.11, 5.12, 5.13, 6.7, 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 8.8_
  - _Boundary: ProjectContext Core Browser E2E_
  - _Depends: 4.1, 4.2, 4.4_

- [x] 5. focused test と完全 validation で implementation readiness を確定する
  - catalog、preference、selection / replacement guard、service、能力別 public facade、selector、presentation、boundary gate の focused test を先に実行し、失敗 boundary を特定する。
  - typecheck、public consumer typecheck、lint、unit/contract/DOM test、boundary、fixture、UI text、production build の既存 validation flow を通す。
  - downstream E2E の revalidation trigger と未所有 integration を contract kit から確認し、本 spec 内へ shell/feature 実装が混入していないことを差分検査する。
  - fixture、diagnostic、検証出力に実サイト由来 HTML、画像、URL、商品値、保存値 dump がなく、全 gate が成功する状態を完了とする。
  - _Requirements: 3.5, 5.9, 5.10, 5.11, 5.12, 5.13, 6.5, 6.6, 6.7, 7.6, 7.8, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8_
  - _Boundary: ProjectContext Final Validation_
  - _Depends: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 6. canonical project lifecycle の contract と service を追加する

- [x] 6.1 project lifecycle contract と最小 data port を確立する
  - project の作成・更新・削除だけを表す mutation、lookup、最新 revision に結び付く mutation context、安定した lifecycle error、commit result の契約を project-context に定義する。
  - foundation adapter は project mutation だけを一回委譲し、root shape、candidate/current-build collection、reference repair policy、Chrome storage を公開しない。
  - project 削除が foundation の既存 atomic transaction を通り、所属 candidate/current-build 参照を中間状態なしで修復する positive contract と、repair algorithm を project-context が再実装しない boundary test を追加する。
  - create/update/delete、not-found、conflict、maintenance、storage、quota、unsupported data が project 名・ID・保存値を含まない結果へ閉じる状態を完了とする。
  - _Requirements: 9.1, 9.2, 9.6, 9.10_
  - _Boundary: ProjectLifecycleDataPort_

- [x] 6.2 project の作成・改名 service を実装する
  - project 名を trim して空白だけの入力を field validation failure とし、保存と refresh を行わない。
  - 作成時の ID・日時と改名時の更新日時を project-context が決定し、data port へ一回だけ mutation を要求する。
  - 保存成功後に context refresh を一回実行し、empty からの作成では作成 project、改名では同じ project ID が最新名で公開されることを固定する。
  - service 自身を lifecycle single-flight authority とし、public port の直接並行呼出しを含む重複 command を安定した `operation-in-progress` として data mutation 前に拒否する。
  - validation、mutation failure、成功後 refresh failure の各 test で重複 mutation が発生せず、refresh failure 後は refresh だけを再試行できる状態を完了とする。
  - _Requirements: 4.1, 4.2, 4.5, 4.6, 9.1, 9.2, 9.3, 9.7, 9.8, 9.10, 9.11, 9.12_
  - _Boundary: ProjectLifecycleService_
  - _Depends: 6.1_

- [x] 6.3 project 削除と post-commit recovery を実装する
  - 確認済み project ID の delete mutation を data port へ一回だけ要求し、削除 cascade や reference repair の内容を service 内で解釈しない。
  - 保存失敗では context refresh と generation 更新を行わず、保存成功後だけ最新 catalog を再検証する。
  - current project 削除後は残る先頭 project または empty、非 current project 削除後は current selection 維持へ既存 fallback 規則で収束させる。
  - commit 後 refresh failure を mutation failure と区別し、delete を再送せず refresh-only retry で ready/empty へ回復する。retry が別 lifecycle command と重なる場合も lifecycle refresh error の `operation-in-progress` として拒否できる状態を完了とする。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 9.6, 9.9, 9.10, 9.11, 9.12_
  - _Boundary: ProjectLifecycleService Delete and Recovery_
  - _Depends: 6.2_

- [ ] 7. project lifecycle state と既存表示契約を提供する

- [x] 7.1 framework-independent lifecycle state と削除確認を実装する
  - name input、rename target、delete confirmation target、pending、field/error、refresh-only recovery を candidate state から独立した state として保持する。
  - delete request は catalog 上の project ID と表示名を一つの confirmation snapshot へ固定し、cancel では service、preference、generation を変更しない。
  - command または後続 refresh 中は UI control を無効化し、service の single-flight rejectionを表示可能にする。commit 済み refresh failure 後は mutation control を再送せず retry だけを許可する。
  - create、rename、delete confirm/cancel、stale target、failure/retry の state test で candidate draft/list/editor state を必要とせず全遷移を観測できる状態を完了とする。
  - _Requirements: 9.3, 9.4, 9.5, 9.10, 9.11, 9.12, 10.3, 10.6_
  - _Boundary: ProjectLifecycleState_
  - _Depends: 6.3_

- [x] 7.2 project lifecycle の semantic message descriptor を追加する
  - project 一覧、作成、改名、対象名と所属候補も削除される影響を示す削除確認、validation、mutation failure、pending、refresh retry を区別する key 非依存の intent と必要 parameter を定義する。
  - lifecycle state と command result の各遷移を descriptor へ写像し、locale や物理 `MessageKey` に依存せず同じ意味・発火条件を保つ。
  - presentation が descriptor を渡す resolver consumer port を提供し、ja/en catalog file、具体 key/value、descriptor-to-key mapping、aggregation、parity を project-context へ追加しない。
  - descriptor contract test で全 intent の発火条件と project 名・operation・安定 error category parameter が観測でき、catalog 内部を import しない状態を完了とする。
  - _Requirements: 10.1, 10.3, 10.7_
  - _Boundary: ProjectLifecycleMessageDescriptors_
  - _Depends: 7.1_

- [x] 7.3 lifecycle presentation と host-neutral mount contract を実装する
  - lifecycle state と read/lifecycle port だけを使い、既存の project nav、create/rename form、対象名と所属候補も削除される影響を明示する delete confirmation の role・label・操作順を再現する。
  - keyboard、focus、pending status、field error、confirm/cancel、refresh retry、resolver 差し替えによる日英切替を提供し、descriptor parameter の project 名と解決済み message を text child として描画する。
  - layout class と CSS rule、独立管理画面、candidate 一覧/editor の構造を追加せず、既存 host container へ mount/unmount できる contribution にする。
  - DOM contract で language switch 後も入力・確認・現在選択を維持し、markup-like project 名から HTML node が生成されず、unmount 後に subscription と DOM が残らない状態を完了とする。
  - _Requirements: 9.4, 9.5, 9.12, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - _Boundary: ProjectLifecyclePresentation_
  - _Depends: 7.1, 7.2_

- [ ] 8. lifecycle capability、boundary、横断検証を統合する

- [x] 8.1 public/runtime facade へ project lifecycle capability を統合する
  - lifecycle port を read、selection command、guard registration、replacement guard と別の frozen capability として公開する。
  - runtime seam は最小 foundation adapter、lifecycle service/state、注入された message resolver consumer port を使う presentation を組み立てる factory を公開し、singleton の生成・保持、物理 catalog adapter の生成、production host wiring は downstream application shell に残す。candidate-management や application-shell の具体 module を import しない。
  - capability consumer test で read-only、selection、replacement、lifecycle の各 owner が不要な service/data/preference capability へ到達できず、lifecycle refresh error が busy と context refresh failure を型安全に区別できる状態を完了とする。
  - _Requirements: 6.2, 6.6, 8.5, 9.1, 9.2, 9.6, 10.6_
  - _Boundary: ProjectContextPublicApi and Runtime_
  - _Depends: 6.3, 7.3_

- [x] 8.2 lifecycle import と data ownership の negative boundary gate を追加する
  - project-context の lifecycle implementation が許可された domain、runtime validation、foundation public adapter、ui-language、ui-messages、React 以外へ依存しないことを検査する。
  - candidate-management 内部、foundation repair policy/root shape、Chrome storage、別 feature、application-shell への deep import と、通常 consumer への lifecycle data/service instance 公開を negative fixture で拒否する。
  - lifecycle implementation から ja/en catalog file、具体 `MessageKey`、catalog aggregation への import と、project-context 内での descriptor-to-key mapping を negative fixture で拒否する。
  - layout/CSS、candidate view/state、保存 schema、backup format の変更が本 spec の task boundaryへ混入していないことを差分と gate で確認する。
  - positive consumer と全 negative fixture が安定した rule で期待どおり pass/fail する状態を完了とする。
  - _Requirements: 8.4, 8.5, 8.6, 9.6, 10.6, 10.7_
  - _Boundary: ProjectContextBoundaryGate Lifecycle_
  - _Depends: 8.1_

- [ ] 8.3 (P) lifecycle contract と DOM integration test を完成する
  - synthetic data port で create/rename/delete、delete cancel、foundation repair 済み delete result、mutation failure、refresh failure/retry、public lifecycle port の並行呼出し rejection を一つの contract harness で検証する。
  - lifecycle presentation を testing-library と user-event で操作し、所属候補も削除される影響 warning、既存 role/label、keyboard、focus、pending、semantic descriptor の発火条件・parameter、synthetic resolver consumption、安全な text rendering を固定する。
  - selection/preference/guard/replacement の既存 contract suite と組み合わせても generation、fallback、forced notification、subscriber isolation が退行しないことを確認する。
  - 全 lifecycle branch が一回 mutationと成功後一回 refresh、失敗時非 refresh、commit後 refresh-only retry の観測可能な証拠を持つ状態を完了とする。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 10.1, 10.2, 10.3, 10.4, 10.5, 10.7_
  - _Boundary: ProjectLifecycle Contract and DOM Validation_
  - _Depends: 8.1_

- [ ] 8.4 core browser E2E と downstream migration contract を提供する
  - test-only browser harness へ synthetic な日英 resolver を注入し、create、rename、所属候補への影響を示すdelete確認/取消、delete後fallback/empty、mutation failure、refresh-only recovery を日本語・英語と keyboard で操作する。
  - project lifecycle host の locator、capability injection、message descriptor、旧 candidate project UI 撤去後の期待値を downstream `ui-message-catalog` と `project-candidate-management` が再利用できる contract kit にする。
  - production candidate/application-shell の具体 wiring、layout/CSS、candidate editor/list を core harness に取り込まず、downstream 接続後の横断 E2E revalidation trigger を固定する。
  - core E2E が架空 project だけで成功し、candidate host migration 後に同じ見た目・操作・selection consistency を再検証可能な状態を完了とする。
  - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - _Boundary: ProjectLifecycle Core Browser E2E and Downstream Contract Kit_
  - _Depends: 8.2, 8.3_

- [ ] 9. Change Brief v0.5.0-boundary-reconciliation の完全 validation と downstream readiness を確定する
  - lifecycle data/service/state/presentation/semantic message descriptor、public/runtime、boundary、contract、DOM、core E2E の focused test を先に実行し、失敗 boundary を特定する。
  - typecheck、public consumer typecheck、lint、unit/contract/DOM test、boundary、fixture、UI text、production build、Playwright E2E の既存 validation flow を通す。
  - Change Brief `v0.5.0-boundary-reconciliation` の全 In-scope item と Requirement 9–10 の traceabilityを再確認し、ja/en 物理 catalog/key/value/aggregation/parityを含む全 Out-of-scope item、`v0.5.0` lifecycle behavior、既存 Task 1–5 の承認済み behaviorが保たれていることを差分検査する。
  - downstream `ui-message-catalog` が descriptor-to-key adapter と物理 catalogを実装でき、`project-candidate-management` が旧 project lifecycle を撤去して host 接続できる contract と revalidation trigger が揃い、実サイト由来 fixture や未所有 production wiring が混入せず全 gate が成功する状態を完了とする。
  - _Requirements: 4.1, 8.4, 8.5, 8.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - _Boundary: ProjectContext Change Brief v0.5.0 Boundary Reconciliation Final Validation_
  - _Depends: 8.4_

## Implementation Notes

- 2026-08-12 / Change Brief `v0.5.0`: project lifecycle の canonical owner を project-context へ追加する。Task 6–9 は既存 Task 1–5 の完成済み selection/preference/guard/selector/replacement 実装を置換せず拡張する。
- 2026-08-12 / Change Brief `v0.5.0-boundary-reconciliation`: project-context は lifecycle message の semantic intent・発火条件・parameter descriptor と resolver consumer seam だけを所有する。ja/en catalog file、具体 key/value、descriptor-to-key mapping、aggregation、parity は `ui-message-catalog` が所有し、Task 7–9 では変更しない。
- 6.1–6.3: project delete は foundation data adapter への一回の mutation だけを行い、candidate/current-build reference repair algorithm を project-context へ複製しない。mutation 成功後の refresh failure は commit 済みとして扱い、retry は refresh だけを再実行する。
- 7–8: project-context が lifecycle state/message semantics/presentation を所有し、`ui-message-catalog` が物理 catalog adapterを、candidate-management が downstream Change Brief で host 接続と旧 project UI 撤去を行う。本 spec では `src/ui-messages/catalog/*`、catalog aggregation/parity、`src/features/candidate-management/*`、layout、CSS、独立管理画面を変更しない。
- 2026-08-11: refresh で current project が catalog から失効した場合、次の snapshot を commit してから `catalog-invalidated` forced change を一度通知する。fallback があれば `to` はその project ID、empty / unavailable では `null` とし、downstream guard が旧 project の未保存 draft を回復可能なまま fence できるようにする。
- 1.1: `contracts.ts` は型契約のみ、`catalog.ts` が projection と純粋 snapshot 構築（`createProjectContextSnapshot` / `unavailableProjectContextSnapshot` / `resolveProjectCatalogSelection`）を持つ。generation 採番と transaction 直列化は task 2.3 の service が所有する。service はこれらを再実装せず利用すること。
- 2.1–2.2: `ProjectChangeGuardCoordinator` は opaque な confirmation / permit と registry revision を保持する。selection の永続化・snapshot commit は task 2.4 の service transaction が所有する。
- 2.3: `ProjectContextService` は lifecycle の catalog/preference I/O と snapshot publish だけを所有する。guard 付き selection と replacement の service 統合は task 2.4 以降で行う。
- 1.1: `unavailable` snapshot は `catalog` property 自体を持たない（`"catalog" in snapshot` が false）。この shape を壊さないこと。
- 1.2: `chrome.storage.local` の参照と存在確認は `preference-store.ts` に閉じ、`runtime.ts` は adapter 選択だけの composition seam とした（design.md の記述矛盾は DEF-003 で先送り）。task 1.3 の AST gate は file-scope で検査すること（DEF-004）。
- 1.2: preference の decode は `src/domain/runtime-schema/public.ts` 経由のみ。`src/project-context/` 内での直接 Zod import は tasks.md 実装前提により禁止。
- 1.3: preference key gate は `preference-store.ts` の file scope で `get/set/remove` の直接呼び出しだけを許可し、method alias・dynamic key・area 全体操作を fail closed に拒否する。consumer import 制限は task 4.3 が所有する。
- 4.3: 要件 8.6 は boundary rule `project-context-no-legacy-selection-authority` で閉じる。逆流経路は「Allowed Dependencies 外への import」と「初期化・fallback 入力契約への `selectedProjectId` member」の二つに限られるため、この二条件を AST で検査する。snapshot は context 自身の出力なので同名 field でも通す。要件 8.7 は shell 実装が本 spec の Out of Boundary なので、contract kit の `collectUnavailableRecoveryContractViolations` として downstream へ渡す形で固定した。
- 4.3: 実装 file 名は design.md から変更した（`switch-guards.ts` → `guard-coordinator.ts`、`presentation-contribution.ts` → `.tsx`）。`react-root.tsx` は presentation-contribution へ統合し、`selector.css` は selector が className を持たないため作成しない。design.md の File Structure Plan は実体へ更新済み。
- 5: downstream `source-price-refresh` E2E の非決定的失敗は、`Extensions.triggerAction` が production `sidePanel.open()` で生成する panel とテストが手動で開く panel が同じ activation を二重監視し、片方の重複 stage advance が失敗する fixture 競合だった。action 前後の CDP target 差分から追加 panel だけを閉じ、durable `activated` を確認してから後段 activation を投入することで解消した。source-price-refresh 120-case 高負荷反復と完全 validation で再発しないことを確認する。
