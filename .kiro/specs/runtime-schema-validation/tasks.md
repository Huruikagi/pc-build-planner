# Implementation Plan

- [x] 1. Runtime schema の導入可否と supply chain を確立する

- [x] 1.1 Zod Mini の設定済み canonical import を追加する
  - Zod Mini 4.4.3 を exact runtime dependency とし、schema 生成前に `jitless` を設定する唯一の入口を公開する。
  - canonical entry 以外の direct package import を禁止する前提を固定し、vendor error や schema instance を外部契約へ含めない。
  - 最小 schema が有効値を型付き値へ decode し、不正値を内部 issue として返す unit test が通る状態を完了とする。
  - _Requirements: 1.1, 1.2, 2.1, 2.6, 3.2, 3.3_
  - _Boundary: ConfiguredZodMini_

- [x] 1.2 Production schema feasibility gate を実装する
  - 本番と同じ ESM、browser platform、Chrome 116 target、production define で最小 schema probe を bundle する。
  - bundle import 前に global `Function` の apply と construct を捕捉する trap を置き、直接呼び出しと alias 呼び出しの negative fixture を検出する。
  - build、静的 scan、runtime trap のいずれかが失敗した場合は非 zero で停止し、owner schema wave を開始できない結果にする。
  - configured probe の動的 Function 呼び出しが 0 件で、直接・alias fixture が確実に失敗することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 8.1, 8.4_
  - _Boundary: ProductionSchemaGate_

- [x] 1.3 Bundle size report と license notice の独立 gate を追加する
  - production entry ごとの baseline、current、delta bytes を machine-readable result と検証出力へ記録する。
  - baseline は同一 run 内で canonical Zod module を副作用のない stub へ esbuild alias した build として生成し、固定値や過去 artifact に依存せず任意 commit で再現できるようにする。stub 差し替えは gate 専用とし、application build と package flow へ波及させない。
  - Zod の MIT notice を配布用 notice asset として用意し、build staging と archive で検証できる契約を定義する。
  - notice 欠落、report 欠落、不正な size result の negative test が非 zero になり、正常 fixture が再現可能な report を返す状態を完了とする。
  - _Requirements: 1.4, 1.5, 8.4, 8.6_
  - _Boundary: ProductionSchemaGate_

- [x] 2. 共通 validation kernel を構築する

- [x] 2.1 共通 primitive と plain strict object を実装する
  - UUID、UTC timestamp、HTTP(S) URL、revision、positive safe integer の受理集合を既存 canonical predicate と parity させる。
  - array、unknown key、必須 key 欠落、非 plain prototype、enumerable symbol を coercion や key stripping なしで拒否する。
  - 各 primitive に owner の error code 語彙を `tagged()` failure tag として付与し、共有層は tag を不透明な文字列として運ぶ。
  - 境界値 table に対し旧 validator と同じ accept/reject 結果になり、成功値だけが型付き output になることを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 3.2_
  - _Boundary: SharedSchemaPrimitives_
  - _Depends: 1.3_

- [x] 2.2 (P) JSON safety inspector を実装する
  - own enumerable property を deterministic order で走査し、non-JSON 値、cycle、data URL、raw HTML、禁止 key、unsafe object を値を漏らさず分類する。
  - nested property と array index から最初の違反 canonical path を返し、owner が error code を写像できる内部 issue に限定する。
  - synthetic nested/cyclic fixture が期待する issue kind/path で拒否され、有効 JSON が変更されず返ることを完了条件とする。
  - _Requirements: 2.3, 2.4, 6.6, 8.6_
  - _Boundary: JsonSafetyInspector_
  - _Depends: 1.3_

- [x] 2.3 (P) Validation issue と canonical path の adapter を実装する
  - vendor issue を code、owner failure tag、string/number path segment だけの内部 view へ射影し、入力値と vendor object を parse call の外へ出さない。
  - `$` base、property、array index を既存形式へ組み立て、owner profile が tag を第一根拠として既存 error union を返せるようにする。tag なしの structural issue（未知 key、必須 key 欠落）だけを issue code から写像し、path 文字列から error code を推測しない。
  - `selectPrimaryIssue` の優先順（path 深さ→schema 宣言順→tag 付き優先）を固定し、error code/path parity test が deterministic に通る状態を完了とする。
  - _Requirements: 2.5, 2.6_
  - _Boundary: ValidationIssueAdapter_
  - _Depends: 1.3_

- [x] 2.4 共通 kernel の公開入口と source boundary gate を統合する
  - configured namespace と共通 helper だけを validation 公開入口から提供し、業務 schema を共有層へ追加しない。
  - schema output と既存公開型の双方向 assignability を typecheck fixture で固定する。
  - direct Zod import、validation 内部 deep import、feature 間 schema deep import の negative fixture が boundary gate で失敗する状態を完了とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: Shared Validation Public Boundary_
  - _Depends: 2.1, 2.2, 2.3_

- [x] 3. Local data foundation を owner-local schema へ移行する

- [x] 3.1 Candidate の draft・content・value schema と公開 validator を移行する
  - candidate の category、product、sources、primary source、snapshot、normalized attributes、ID、timestamp の strict shape を宣言する。
  - 既存の draft/content/value validator signature と candidate source URL path helper を公開契約として維持する。
  - valid/invalid fixture の value、error code、path が移行前期待値と一致し、不要な candidate 内部 guard/cast が削除された状態を完了とする。
  - _Requirements: 3.1, 3.4, 4.1, 4.4, 8.2, 8.3_
  - _Boundary: FoundationSchemaSet_
  - _Depends: 2.4_

- [x] 3.2 Root 内の project・build・dedupe・maintenance shape を移行する
  - project、current build/item、request dedupe、maintenance active/inactive の strict schema fragments を owner 内へ定義する。
  - 現行 schema version、revision、required/optional field、positive quantity の受理集合を維持する。
  - nested shape fixture が既存 code/path で成功または失敗し、schema 導入による version/shape 変更がないことを完了条件とする。
  - _Requirements: 4.1, 4.4, 8.2_
  - _Boundary: FoundationSchemaSet_

- [x] 3.3 Root aggregate の duplicate と reference semantics を接続する
  - schema 成功後に project、candidate、build、source、request dedupe の uniqueness と ownership/reference を既存順序で検査する。
  - JSON safety と semantic issue を既存 `ValidationErrorCode` と最初の canonical path へ写像する。
  - invalid root が write authority へ渡らず直前の有効 root が保持される integration test を完了条件とする。
  - _Requirements: 2.4, 2.5, 4.1, 4.4, 4.5, 8.2_
  - _Boundary: FoundationSchemaSet_

- [x] 3.4 Query と mutation command の strict schema を移行する
  - command kind ごとの必須・許容 field、request ID、expected revision、proposed root を discriminated shape として検証する。
  - query の余剰 field、未知 kind、mutation の欠落 field を既存 error code/path で拒否する。
  - 有効 command の公開型と handler behavior が不変で、不正 command が handler mutation へ到達しないことを完了条件とする。
  - _Requirements: 4.2, 4.5, 8.2, 8.3_
  - _Boundary: FoundationSchemaSet_

- [x] 3.5 Replacement schema と atomic failure contract を移行する
  - replacement candidate に root と同じ shape、version、JSON safety、reference semantics を base path を保って適用する。
  - assessment と atomic replacement の fencing・commit 手順を変更せず、validation failure を commit 前に返す。
  - malformed replacement、reference failure、write failure の各 test で既存 root が不変となり、foundation wave の全 parity test が通る状態を完了とする。
  - _Requirements: 4.3, 4.4, 4.5, 8.1, 8.2, 8.4_
  - _Boundary: FoundationSchemaSet_

- [x] 4. Backup 交換境界を owner-local schema へ移行する

- [x] 4.1 Backup envelope と item shape schema を実装する
  - product、format version、created timestamp、data collections、project、build/item を feature-owned strict schema として宣言する。
  - candidate item は foundation の公開 candidate validator を利用し、foundation 内部 schema を deep import しない。
  - 現行 valid envelope が同じ型付き値へ decode され、unknown/missing/invalid primitive が同じ path で拒否されることを完了条件とする。
  - _Requirements: 3.1, 3.3, 5.1, 5.2, 5.5_
  - _Boundary: BackupExchangeSchemaSet_
  - _Depends: 3.5_

- [x] 4.2 Backup の JSON、reference、version、mapping parity を完成する
  - non-JSON と forbidden content を `not-json` / `invalid-structure` へ、shape 成功後の duplicate/ownership を `invalid-reference` へ既存順で写像する。
  - unknown/future/missing migration path を変換せず `unsupported-version` にし、root mapping と format/schema version の独立性を維持する。
  - export/restore fixture の value、error/path、atomic failure が全て parity し、置換済み重複 guard/cast が owner 内から除かれた状態を完了とする。
  - _Requirements: 5.2, 5.3, 5.4, 5.5, 8.2, 8.3, 8.4_
  - _Boundary: BackupExchangeSchemaSet_

- [ ] 5. Product capture 境界を owner-local schema へ移行する

- [ ] 5.1 Capture result と field schema を宣言する
  - normalized field、money、core/spec field、source、document order、missing field、rejected field/reason の strict schema を定義する。
  - request、tab、page URL、captured timestamp の既存受理集合を維持し、schema 導入だけで field を暗黙に狭めない。
  - schema output と既存 `CaptureResult` が assignable で、valid/invalid field table が parity することを完了条件とする。
  - _Requirements: 3.1, 3.4, 6.1, 6.2, 8.2_
  - _Boundary: CaptureSchemaSet_
  - _Depends: 4.2_

- [ ] 5.2 Capture draft mapper を schema decode へ接続する
  - capture result を一度だけ decode し、成功後に unresolved draft と editor prefill を生成する。
  - invalid payload では partial draft、source、diagnostic を生成せず、安定した `invalid-payload` だけを返す。
  - draft mapping とログ非漏洩の回帰 test が通り、手書き key guard と無検証 cast が削除された状態を完了とする。
  - _Requirements: 6.1, 6.2, 6.6, 8.2, 8.3, 8.4_
  - _Boundary: CaptureSchemaSet_

- [ ] 6. Runtime message と activation 境界を段階移行する

- [ ] 6.1 (P) Foundation runtime message shape を移行する
  - foundation command kind の strict message filter を schema decode へ置換し、未関係 message は従来どおり無視する。
  - sender ID、tab、extension URL による caller classification を shape schema から独立した authorization として維持する。
  - invalid message/sender が handler へ到達せず、有効 message と handler failure response が既存どおりになることを完了条件とする。
  - _Requirements: 6.3, 6.5, 6.6, 8.2_
  - _Boundary: RuntimeActivationSchemaSet Foundation Messages_
  - _Depends: 5.2_

- [ ] 6.2 (P) Transient activation store envelope を移行する
  - version 1 envelope、record、tombstone、sequence、tab ID、stage の strict schema を定義する。
  - unsupported version と corrupt envelope の既存区分、tombstone dominance、capacity、stage transition semantics を維持する。
  - invalid persisted value が subscriber へ通知されず、valid record の read/write/checkpoint fixture が parity することを完了条件とする。
  - _Requirements: 6.3, 6.5, 8.2, 8.3_
  - _Boundary: RuntimeActivationSchemaSet Transient Store_
  - _Depends: 5.2_

- [ ] 6.3 Transient request/response transport を移行する
  - watch-ready、stage-advance、authorization decision、public error response の versioned strict schema を定義する。
  - panel sender authorization と scheduler error の public code mapping を維持し、不正 response を `invalid-message` として閉じる。
  - worker listener と panel port の contract tests で invalid payload が record として返らず、有効 round trip が従来どおり完了することを完了条件とする。
  - _Requirements: 6.3, 6.5, 6.6, 8.2_
  - _Boundary: RuntimeActivationSchemaSet Transient Transport_

- [ ] 6.4 (P) Product capture activation payload を移行する
  - capture target、activation ID、positive tab ID の owner-local strict schema を定義する。
  - invalid intent は既存 `invalid_activation` に写像し、capture session を開始しない。
  - valid/invalid activation fixture が同じ typed value/error になり、payload cast が不要になることを完了条件とする。
  - _Requirements: 3.1, 6.4, 6.6, 8.2, 8.3_
  - _Boundary: RuntimeActivationSchemaSet Product Capture Activation_
  - _Depends: 5.2_

- [ ] 6.5 Candidate editor prefill と activation payload を移行する
  - editor target、unresolved draft、category hint、capture diagnostic の owner-local schema を既存 pre-edit validation と統合する。
  - invalid payload、unavailable project、mutation-disabled state の既存 diagnostic/error と state 不変性を維持する。
  - invalid activation が editor/pending state を変更せず、有効 prefill が従来の editor state を開く contract test を完了条件とする。
  - _Requirements: 3.1, 6.4, 6.6, 8.2, 8.3_
  - _Boundary: RuntimeActivationSchemaSet Candidate Activation_
  - _Depends: 5.2_

- [ ] 6.6 (P) Application shell の activation adapter result を移行する
  - success/error の discriminated `Result` shape と既存 activation error union を内部 schema で検証する。
  - registry lookup、availability、single-delivery、exception isolation の既存 router semantics を変更しない。
  - malformed adapter result が `invalid_activation` / `activation_failed` へ閉じ、有効 adapter result が一度だけ配信されることを完了条件とする。
  - _Requirements: 6.4, 6.5, 6.6, 8.2_
  - _Boundary: RuntimeActivationSchemaSet Shell Adapter Result_
  - _Depends: 5.2_

- [ ] 6.7 Runtime/activation wave の統合 parity を固定する
  - message shape、sender authorization、store、transport、feature activation、router の cross-boundary contract を synthetic fixture で通す。
  - invalid request/response/record/intent が listener notification、feature state mutation、payload log を発生させないことを検証する。
  - runtime/activation wave の全 focused tests が通り、次の snapshot wave を開始できる状態を完了とする。
  - _Requirements: 6.3, 6.4, 6.5, 6.6, 8.1, 8.2, 8.4, 8.6_
  - _Boundary: Runtime Activation Integration_
  - _Depends: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 7. Feature state snapshot を owner-local schema へ移行する

- [ ] 7.1 (P) Current build version 1 snapshot を移行する
  - version、`selectedProjectId`、selected category、quantity drafts の strict shape と safe string/key 規則を定義する。
  - shape 成功後に project/candidate ownership を current state へ照合し、legacy project ID を selection authority にしない。
  - invalid version/shape/reference で state が不変となり、有効 snapshot が同じ値へ復元される test を完了条件とする。
  - _Requirements: 7.1, 7.2, 7.3, 7.5, 8.2, 8.3_
  - _Boundary: StateSnapshotSchemaSet Current Build_
  - _Depends: 6.7_

- [ ] 7.2 (P) Candidate management version 3 snapshot を移行する
  - `project-candidate-management` の version 3 base contract と、`candidate-source-bookmarks` が同じ snapshot shape へ追加した source collection、primary reference、price、kind、URL safety を owner-local schema と helper に分割する。
  - `selectedProjectId` と draft/source/project の reference validation、失敗時の state 不変性を維持する。
  - candidate-source-bookmarks の複数 source editor fixture を含む version 3 snapshot が同じ restored value/error になり、旧・未知 version を永続状態へ触れず拒否し、不要な手書き shape guard/cast が削減された状態を完了とする。
  - _Requirements: 7.1, 7.2, 7.3, 7.5, 8.2, 8.3_
  - _Boundary: StateSnapshotSchemaSet Candidate Management_
  - _Depends: 6.7_

- [ ] 7.3 Duplicate merge の version 1 snapshot と stale recovery を移行する
  - candidate-management v3 の source-aware 公開 helper を利用し、duplicate merge owner の version 1 contract で match、summary、evidence、error、decision state を strict schema として維持する。
  - evaluating/committing snapshot は既存どおり `stale-decision` failure へ復元し、自動 commit を再開しない。
  - selected match/reference の invalid fixture を拒否し、有効 deciding/failed state が同じ結果へ復元されることを完了条件とする。
  - _Requirements: 7.1, 7.3, 7.4, 7.5, 8.2, 8.3_
  - _Boundary: StateSnapshotSchemaSet Duplicate Merge_
  - _Depends: 7.2_

- [ ] 7.4 Snapshot wave の no-mutation parity を完成する
  - current-build v1、candidate-management v3 と candidate-source-bookmarks 拡張済み shape、duplicate-merge v1 の version/shape/reference error table を一つの wave gate として実行する。
  - restore failure では current state が変更されず、成功値だけが一度適用されることを contract test で確認する。
  - owner ごとの snapshot version/field と `selectedProjectId` が不変で、全 snapshot focused tests が通る状態を完了とする。
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.4_
  - _Boundary: State Snapshot Integration_
  - _Depends: 7.1, 7.2, 7.3_

- [ ] 8. Production gate と完全検証を統合する

- [ ] 8.1 Schema gate、report、notice を既存 build/package pipeline へ接続する
  - feasibility、direct/deep import、artifact、bundle size、notice の各検査を既存 build、final gate、artifact、package command から必ず実行する。
  - schema-bearing production artifact と license notice を必須成果物にし、欠落または dynamic Function 検出時は archive を生成しない。
  - 正常 build/package が report と notice を含んで成功し、各 negative fixture が対応 command を非 zero にする状態を完了とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.3, 3.5, 8.1, 8.4_
  - _Boundary: Runtime Schema Production Integration_
  - _Depends: 1.3, 2.4, 3.5, 4.2, 5.2, 6.7, 7.4_

- [ ] 8.2 Focused parity と完全 validation を通す
  - owner wave ごとの valid/invalid、error/path、reference、no-mutation test を先に実行し、失敗 boundary を特定する。
  - typecheck、public consumer typecheck、lint、unit/contract/integration、production build、boundary、fixture、artifact、Playwright E2E の完全フローを実行する。
  - fixture と検証出力に実サイト由来 HTML、画像、URL、商品値、payload dump がなく、`pnpm validate` が成功する状態を完了とする。
  - _Requirements: 2.6, 3.4, 4.5, 5.5, 6.6, 7.5, 8.2, 8.3, 8.5, 8.6_
  - _Boundary: Runtime Schema Final Validation_
  - _Depends: 8.1_

## Implementation Notes

- esbuild は TypeScript の未使用 import を除去するため、build 失敗 fixture は import した binding を実際に使う必要がある。
- Zod の production bundle には `const F = Function; new F("")` という jitless 判定 probe が実在する。alias 代入を静的に拒否すると configured probe が誤検出になるため、alias 検出は runtime の `Function` Proxy trap が担当する（`jitless` 有効時の実行回数は実測 0）。
- `esbuild` を `write: false` + `entryPoints` で使う場合は `outdir` の指定が必要（未指定だと outputFiles が空になる）。
- owner tag は vendor issue の `message` に `tag:` prefix で載せる（Zod が node 単位で保持する唯一の channel）。共有層の structural failure は `structural:` prefix。`tagged()` は `z.clone` で node を複製するため元の primitive は untagged のまま再利用できる。
- 共通 primitive は factory 関数（`uuid<ProjectId>()`）。branded 公開型を owner が cast なしで満たすための形。
- optional field は `z.optional` ではなく `optionalField()` を使う。`z.optional` は present-undefined を silently strip するが、設計は key stripping を禁止しているため `plainObject` が field tag 付きで拒否する。
- `plainObject` は not-object → unsafe prototype/symbol → missing key → unknown key → present-undefined を pipe 前段で判定してから値を検証する。この順序が既存 `object()` の error code/path 順と parity する根拠。
- `z.output` の optional key は `T | undefined` になり `exactOptionalPropertyTypes` の公開型へ代入できない。`SchemaOutput<S>` が exact-optional へ正規化する（assignability fixture: `tests/domain/runtime-schema-assignability.ts`）。
- `inspectJsonSafety` は旧 `inspectPayload` より厳しい: 非 JSON 値を base path ではなく違反した nested path で `not-json` として返し、nested の非 plain prototype/enumerable symbol も `unsafe-object` として拒否する。owner wave は kind→既存 code の写像でこの差を吸収すること。
- boundary gate に `canonical-runtime-schema-import-only`（`zod*` の直接 import 禁止）を追加し、`validate:boundaries` の scan root へ `src/domain` を追加した。domain の許可 entry は `public` と `runtime-schema/public` の 2 つ。
- foundation の JSON safety は `inspectJsonSafety` に統一し、5 種の kind をすべて `forbidden-payload` へ写像する。旧 `inspectPayload` より厳しく、非 JSON 値（`undefined` / `NaN` / 関数）と nested の非 plain prototype を型 error ではなく `forbidden-payload` で拒否する。既存 fixture の code/path はすべて一致した。
- shape は schema fragment、順序と cross-item 規則は owner の semantic pass、という分割で既存の error code/path 順を保つ。root 全体を一つの schema にすると `selectPrimaryIssue` の「浅い issue 優先」が aggregate の走査順（projects→candidates→builds→dedupe→maintenance）を壊す。
- 公開 validator は decode 結果ではなく入力そのものを返す（`assert.strictEqual(result.value, input)` が既存契約）。Zod の `strictObject` は新しい object を返すため、最終 return の cast だけは必要。内部の `as string` cast は decode 済み branded 値で置換して削除した。
- `z.optional(z.unknown())` は `plainObject` の gate が required 判定に使う `def.type === "optional"` を満たすので、条件付き field（sources / primarySourceId / maintenance の owner fields）は `z.unknown()` で受けて semantic pass に回せる。
- canonical Zod entry は **named import/export 限定**。`import * as z` の namespace 再 export は tree shaking を無効化し production entry あたり +512KB（named なら +35KB）。bundle size gate がこの回帰の検知器になる。
- size gate の stub plugin は esbuild の `onResolve` filter が **specifier** に当たることに注意。`./zod-mini.js` を解決してから canonical path と比較しないと stub が適用されず、delta が常に 0 になる。
- `scripts/validate-boundaries.mjs` の flat token scanner は class 外の `#`（Zod の template literal に実在）で zero-width token を無限生成する。位置が進まない token を 1 文字読み飛ばして継続する。
- 一部 persistence test の `registerHooks` は `.js`→`.ts` を無条件で書き換えるため、node_modules 由来の specifier まで壊す。importer が node_modules ならそのままにする。
