# Implementation Plan

> **実装前提**: 上流 `runtime-schema-validation` の configured runtime schema 公開入口と production gate が実装・検証済みであること。未完了の場合は本 spec 内で代替 schema や direct Zod import を追加せず、Task 1.2 を開始しない。

- [ ] 1. project context の基礎契約と信頼境界を確立する

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

- [ ] 2. guard 付き context transaction を構築する

- [ ] 2.1 (P) project change guard の登録・確認基盤を実装する
  - stable ID による登録、duplicate 拒否、解除、登録順評価、registry revision を実装する。
  - project 選択と catalog 全体置換を判別する intent について allow と confirmation-required だけを集約し、draft 内容や保存・破棄方法、置換候補を受け取らない。
  - confirmation を intent、base generation、registry revision に結び付け、cancel と stale 判定を提供する。
  - 両 intent の登録・評価・取消・stale と forced notifier の例外隔離が test で観測できる状態を完了とする。
  - _Requirements: 3.4, 3.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.13, 6.3, 6.5, 6.7_
  - _Boundary: ProjectChangeGuardCoordinator_
  - _Depends: 1.1_

- [ ] 2.2 catalog 全体置換の permit lifecycle を実装する
  - prepare と必要な confirm から、snapshot generation と guard registry revision に結び付いた一時 permit を発行し、それ自体では snapshot、preference、generation を変更しない。
  - begin 時に取消、generation、registry revision、別 transaction による stale を再検証し、無効な permit は置換開始を拒否して再評価可能な結果を返す。
  - complete は outcome にかかわらず permit を先に terminal closed とし、succeeded のときだけ forced replacement を一回通知して、failed または cancel では通知しない。
  - prepare、confirm、cancel、begin、complete の全分岐と通知例外を test で観測でき、refresh は downstream owner が別 transaction として要求できる状態を完了とする。
  - _Requirements: 5.2, 5.3, 5.4, 5.9, 5.10, 5.11, 5.12, 5.13, 6.5, 6.7_
  - _Boundary: ProjectChangeGuardCoordinator Replacement_
  - _Depends: 2.1_

- [ ] 2.3 (P) 初期化と catalog refresh の context state machine を実装する
  - 初期化時に catalog と preference を読み、valid preference、先頭 fallback、empty、unavailable の優先規則で一つの snapshot を確定する。
  - invalid / missing preference を repair し、repair 成功前に ready を公開しない。
  - refresh では有効な現在選択を維持し、削除・置換時は先頭 fallback または empty へ移行し、失敗時は unavailable へ閉じる。
  - unavailable からの retry、generation の単調増加、listener 一回通知が integration test で確認できる状態を完了とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.4, 3.5, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - _Boundary: ProjectContextService Lifecycle_
  - _Depends: 1.1, 1.2_

- [ ] 2.4 選択・確認 transaction と競合抑止を完成する
  - select、confirm、cancel、refresh を一つの queue へ直列化し、unknown target と同値再選択を state 不変で処理する。
  - guard 評価後に必要なら confirmation を返し、有効な confirm だけが preference write と snapshot commit へ進む。
  - preference write 成功後にだけ selection と generation を更新し、stale completion、write failure、guard failure で以前の snapshot を保持する。
  - rapid selection、refresh 競合、target deletion、stale confirmation の決定的 test で最後に確定した一つの選択だけが公開される状態を完了とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - _Boundary: ProjectContextService Selection_
  - _Depends: 2.1, 2.3_

- [ ] 2.5 能力別 public facade と subscription isolation を実装する
  - snapshot 取得・購読、選択・確認・取消・refresh、guard 登録、catalog 全体置換の prepare・確認・取消・完了通知を read / command / guard / replacement port へ分離する。
  - frozen facade から service、catalog source、preference adapter、guard collection、runtime schema を公開しない。
  - unsubscribe 後の非通知、listener 例外隔離、canonical Result、通常 consumer の public 入口を contract test で固定する。
  - downstream owner が shell 具体実装や feature deep import なしに必要な capability だけを受け取れる状態を完了とする。
  - _Requirements: 1.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.5, 8.6, 8.7_
  - _Boundary: ProjectContextPublicApi_
  - _Depends: 2.2, 2.4_

- [ ] 3. 共通 selector presentation を提供する

- [ ] 3.1 (P) project selector の日英 message と状態表現を追加する
  - ready、empty、unavailable、retry、pending、confirmation、error に必要な message を日本語・英語へ同じ key と placeholder で追加する。
  - project-context namespace を既存 catalog parity と UI text gate に接続する。
  - message resolver の両言語 test で raw key、未翻訳文字列、placeholder drift がない状態を完了とする。
  - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - _Boundary: ProjectSelector Messages_
  - _Depends: 1.1_

- [ ] 3.2 共通 project selector component を実装する
  - read port を購読し、ready の native select、empty の disabled state、unavailable の retry、pending status を描画する。
  - confirmation-required を一つの keyboard 操作可能な確認 UI として表示し、confirm/cancel の結果を command port へ渡す。
  - accessible label、live status、focus、Escape cancel、重複操作抑止を実装し、project 名を text child としてのみ描画する。
  - 日本語・英語の切替後も選択が変わらず、markup-like 名から HTML element が生成されない DOM test が通る状態を完了とする。
  - _Requirements: 5.4, 5.5, 5.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  - _Boundary: ProjectSelector_
  - _Depends: 2.5, 3.1_

- [ ] 3.3 composition 専用 presentation contribution を実装する
  - shell が渡す exact container に LanguageProvider と selector の一つの React root を mount する。
  - 二重 mount、mount failure、idempotent unmount を扱い、subscription、pending UI、root、container を確実に cleanup する。
  - 通常 public API に React root や runtime adapter を混在させず、slot の作成と singleton composition は downstream shell に残す。
  - mount/unmount contract test で listener と DOM が残らず、再 mount できる状態を完了とする。
  - _Requirements: 6.6, 7.1, 7.3, 7.6, 7.7, 8.5_
  - _Boundary: ProjectContextPresentationContribution_
  - _Depends: 3.2_

- [ ] 4. 契約・境界・downstream readiness を検証する

- [ ] 4.1 (P) context lifecycle と guard の横断 contract test を完成する
  - side panel 再オープンを表す再初期化、作成、削除、全置換、catalog failure、preference failure、回復を架空 catalog で検証する。
  - consumer を複数購読しても同じ generation と selection を受け取り、stale operation で後退しないことを確認する。
  - guard confirmation、cancel、forced selection、notifier failure と catalog invalidation を一つの transaction harness で検証する。
  - replacement permit の prepare、confirm、cancel、stale begin、failed completion、success 通知を検証し、success 後の refresh が独立 transaction であることを固定する。
  - 全 lifecycle branch で ready/empty/unavailable の不変条件と preference の結果が一致する状態を完了とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.1, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 6.4, 6.5, 6.7_
  - _Boundary: ProjectContext Contract Integration_
  - _Depends: 2.5_

- [ ] 4.2 (P) selector の DOM・accessibility contract test を完成する
  - ready/empty/unavailable/pending/confirmation/error の利用者表示を testing-library と user-event で操作する。
  - keyboard、focus、label、live status、disabled state、retry、confirm/cancel、言語切替を利用者視点で検証する。
  - 未信頼な project 名が text のままで、画像・script・HTML node を生成しないことを確認する。
  - mount/unmount を繰り返しても React root と subscription が残らない状態を完了とする。
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  - _Boundary: ProjectSelector Validation_
  - _Depends: 3.3_

- [ ] 4.3 public import と legacy authority の negative gate を完成する
  - 通常 consumer、composition owner、runtime owner、replacement owner の許可入口を区別し、内部 deep import と schema instance 公開を拒否する。
  - public consumer typecheck で read-only consumer が command、preference、service instance へ到達できないことを固定する。
  - legacy snapshot ID を context 初期化・fallback の入力へ渡す経路と、context unavailable が settings/backup 起動を阻止する契約を negative fixture で拒否する。
  - storage gate と import gate の全 negative fixture が対応する安定した rule で非 zero になり、正しい consumer が通る状態を完了とする。
  - read、command、guard、replacement の能力分離を positive / negative fixture で固定し、replacement owner が service や別 port へ到達できないことを確認する。
  - _Requirements: 6.1, 6.2, 6.6, 6.7, 8.4, 8.5, 8.6, 8.7_
  - _Boundary: ProjectContextBoundaryGate_
  - _Depends: 1.3, 2.5, 3.3_

- [ ] 4.4 (P) downstream adapter と横断 E2E の契約 kit を提供する
  - read port の ready/empty/unavailable、generation、forced change を owner-local adapter が検証できる reusable contract kit にする。
  - selector の stable role、label、status、confirmation を downstream Playwright model から利用できる locator contract として固定する。
  - synthetic replacement owner が prepare、confirm、begin、complete、refresh を順序付け、失敗・取消・stale を再評価できる reusable contract kit を提供する。
  - candidate/current-build/compatibility/backup/handoff/shell の具体実装を kit に取り込まず、各 owner が production wiring 後に同じ期待値を再利用できるようにする。
  - 架空 project fixture だけで reopen persistence、selection consistency、restore recovery の downstream scenario を記述可能な状態を完了とする。
  - _Requirements: 5.9, 5.10, 5.11, 5.12, 5.13, 6.6, 6.7, 8.6, 8.7, 8.8_
  - _Boundary: ProjectContext Downstream Contract Kit_
  - _Depends: 2.5, 3.3_

- [ ] 4.5 core service と selector の browser 横断 E2E を実装する
  - 架空 catalog、共有 preference、guard、selector を test-only browser harness で composition し、production manifest と bundle へ含めない。
  - project 選択、確認・取消、再初期化後の preference 復元、選択削除後の fallback、empty、unavailable retry を Playwright で操作する。
  - catalog 全体置換を prepare、confirm、begin、complete succeeded、refresh の順で操作し、failed、cancel、stale では通知せず、success 後の refresh failure は置換を再実行せず retry できることを確認する。
  - DOM locator は downstream contract kit と同じ role・label・status を利用し、日本語・英語、keyboard、markup-like project 名を検証する。
  - core E2E が実 feature や shell の内部を import せず成功し、downstream production wiring 後に同じ期待値を再利用できる状態を完了とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 4.3, 4.4, 4.6, 5.4, 5.5, 5.6, 5.9, 5.10, 5.11, 5.12, 5.13, 6.7, 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 8.8_
  - _Boundary: ProjectContext Core Browser E2E_
  - _Depends: 4.1, 4.2, 4.4_

- [ ] 5. focused test と完全 validation で implementation readiness を確定する
  - catalog、preference、selection / replacement guard、service、能力別 public facade、selector、presentation、boundary gate の focused test を先に実行し、失敗 boundary を特定する。
  - typecheck、public consumer typecheck、lint、unit/contract/DOM test、boundary、fixture、UI text、production build の既存 validation flow を通す。
  - downstream E2E の revalidation trigger と未所有 integration を contract kit から確認し、本 spec 内へ shell/feature 実装が混入していないことを差分検査する。
  - fixture、diagnostic、検証出力に実サイト由来 HTML、画像、URL、商品値、保存値 dump がなく、全 gate が成功する状態を完了とする。
  - _Requirements: 3.5, 5.9, 5.10, 5.11, 5.12, 5.13, 6.5, 6.6, 6.7, 7.6, 7.8, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8_
  - _Boundary: ProjectContext Final Validation_
  - _Depends: 4.1, 4.2, 4.3, 4.4, 4.5_

## Implementation Notes

- 1.1: `contracts.ts` は型契約のみ、`catalog.ts` が projection と純粋 snapshot 構築（`createProjectContextSnapshot` / `unavailableProjectContextSnapshot` / `resolveProjectCatalogSelection`）を持つ。generation 採番と transaction 直列化は task 2.3 の service が所有する。service はこれらを再実装せず利用すること。
- 1.1: `unavailable` snapshot は `catalog` property 自体を持たない（`"catalog" in snapshot` が false）。この shape を壊さないこと。
- 1.2: `chrome.storage.local` の参照と存在確認は `preference-store.ts` に閉じ、`runtime.ts` は adapter 選択だけの composition seam とした（design.md の記述矛盾は DEF-003 で先送り）。task 1.3 の AST gate は file-scope で検査すること（DEF-004）。
- 1.2: preference の decode は `src/domain/runtime-schema/public.ts` 経由のみ。`src/project-context/` 内での直接 Zod import は tasks.md 実装前提により禁止。
- 1.3: preference key gate は `preference-store.ts` の file scope で `get/set/remove` の直接呼び出しだけを許可し、method alias・dynamic key・area 全体操作を fail closed に拒否する。consumer import 制限は task 4.3 が所有する。
