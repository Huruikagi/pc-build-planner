# Research & Design Decisions — ui-message-catalog

## Summary

- **Feature**: `ui-message-catalog`
- **Discovery Scope**: Extension（既存コードベースへの振る舞い不変リファクタ）
- **Key Findings**:
  - 表示文言は5つの feature view とアプリケーションシェルに集中しており、ドメイン層・永続化層・互換性判定ルールは既にクリーンである。剥がす対象は明確に限定できる。
  - `application-shell` のロジック層が生成する文言は、診断ログと画面表示の**両方**に同じ文字列を使っている。この2経路を分離しないとメッセージ識別子化が成立しない。
  - 「重複している」とされていた永続化エラー表は、**文面が完全一致するものと微妙に異なるものが混在している**。機械的な統合は表示文言の変更＝振る舞い変更を引き起こす。
  - 各 feature は自前の React root を生成する。シェルが張る React Context は feature のツリーへ届かないため、供給点は feature ごとに必要になる。

## Research Log

### 現行コードの文言分布（実測）

- **Context**: brief の概算値（約300箇所、styles.css 約10、E2E 約99、tests 約150〜200）を実コードで検証する。
- **Sources Consulted**: `src/`、`e2e/`、`tests/`、`scripts/`、`package.json`、`tsconfig.json` の直接走査。
- **Findings**:
  - `src/**/*.ts(x)` で日本語を含む行は436行。うちコメント・JSDoc を除いた文言リテラルは約231箇所。
  - 表示文言を持つファイルは限定的:
    | ファイル | 日本語行数 | 種別 |
    |---|---|---|
    | `src/features/candidate-management/view.tsx` | 90 | 表示文言 |
    | `src/features/product-capture/view.tsx` | 67 | 表示文言 |
    | `src/features/backup-restore/view.tsx` | 43 | 表示文言 |
    | `src/features/compatibility/view.tsx` | 40 | 表示文言 |
    | `src/features/current-build/view.tsx` | 32 | 表示文言 |
    | `src/application-shell/side-panel-host.ts` | 15 | ロジック層メッセージ |
    | `src/application-shell/shell-view.tsx` | 9 | 表示文言 |
    | `src/application-shell/composition-root.ts` | 2 | ロジック層メッセージ |
    | `src/application-shell/maintenance-projection.ts` | 1 | ロジック層メッセージ（他4行はコメント） |
    | `src/application-shell/application-composition.ts` | 1 | ロジック層メッセージ（他1行はコメント） |
    | `src/application-shell/application-shell-integration.ts` | 1 | ロジック層メッセージ |
    | `src/features/*/registration.ts` | 各1 | ナビゲーションラベル（5件） |
  - `src/features/backup-restore/{exchange,service,state,contracts}.ts`、`src/persistence/**`、`src/domain/**` の日本語は**全て JSDoc とコメント**であり、表示文言ではない。移行対象外。
  - `styles.css` の日本語属性セレクタは実測10箇所（`candidate-management` 6、`current-build` 4）。brief の概算と一致。
  - E2E の文言依存行は実測100行（`backup-restore` 35、`current-build` 36、`candidate-management` 18、`product-capture` 11）。`extension-fixture.ts` と `unpacked-extension.spec.ts` は文言非依存。
  - `tests/` の日本語行1606行のうち、`test()` / `describe()` のテスト名が738行を占める。**テスト名は表示文言ではなく移行対象外**。残る約750行から fixture の架空商品名とコメントを除いた分が実質のアサーション対象となる。
- **Implications**: 移行対象は「5つの feature view + シェル view + シェルロジック5ファイル + registration 5ファイル」に閉じる。brief の「約300箇所」は fixture・コメント・テスト名を含んだ数であり、実作業量はより小さい。

### ロジック層メッセージの二重経路

- **Context**: `side-panel-host.ts` の文言が画面へ届くのか診断ログ止まりかを確定する。
- **Findings**:
  - `side-panel-host.ts:76-79` などで、同一の文字列が `reportDiagnostic(message)`（診断）と `publish({ kind: "error", message })`（表示）の両方へ渡される。
  - `publish` の値は `ShellViewState`（`contracts.ts:146-158`）の `message: string` を経て `shell-view.tsx:118` の `<p>{state.message}</p>` で描画される。**表示経路である**ことを確認した。
  - `maintenance-projection.ts` の保守メッセージも `ShellMaintenanceState.message` → `ShellViewState`（`kind: "maintenance"`）→ `shell-view.tsx:128` で描画される。
  - `FeatureActivationError.detail` は `activation-router.ts:118` の型ガードでしか参照されず、**描画経路を持たない**。
  - `FeatureMountContext.reportError` / `WorkerRegistrationContext.reportError` は診断シンクであり描画されない。
- **Implications**: 表示経路（`ShellViewState`、`ShellMaintenanceState`、`StartupError`、`SelectionError`、`CompositionError`）だけをメッセージ識別子へ変更する。診断経路は表示文言ではないため別扱いにできる。

### 「重複」文言の実態

- **Context**: brief が挙げた重複3種（カテゴリ名×2、永続化エラー×3、起動エラー×2）を突き合わせる。
- **Findings**:
  - **カテゴリ表示名**: `candidate-management/view.tsx:16-29`、`current-build/view.tsx:11-24`、`product-capture/view.tsx:38-49` の3箇所に存在し、**12キー全ての文面が完全一致**する。単一定義へ統合可能。
  - **起動エラー**: `composition-root.ts:66` の `STARTUP_FAILED` と `application-composition.ts:76` の `STARTUP_ERROR` は同一文面「アプリケーションを開始できませんでした」。統合可能。
  - **永続化エラー**: 文面が一致するものと**しないもの**が混在する。
    | コード | candidate-management | current-build | product-capture |
    |---|---|---|---|
    | `validation` | 同一 | 同一 | 同一 |
    | `maintenance` | 同一 | 同一 | 同一 |
    | `quota` | 同一 | 同一 | 同一 |
    | `conflict` | 同一 | 同一 | 未定義 |
    | `snapshot-restore-failed` | 同一 | 同一 | 未定義 |
    | `storage` | 「拡張機能を開き直してから〜」 | 同左 | **「もう一度お試しください。」** |
    | `not-found` | 「対象が見つかりませんでした。一覧を〜」 | **「対象の候補が〜。読み込み直して〜」** | 未定義 |
    | `unsupported-data` | 「破損しているか、対応していない〜。既存データは〜」 | 「対応していない形式です。既存データは〜」 | 「破損しているか、対応していない形式です。」 |
    | `corrupt-data` | 未定義 | 「保存データが破損しています。既存データは〜」 | 未定義 |
- **Implications**: **文面が一致するペアだけを統合する**という規則を設計へ明記する必要がある。コードが同名だからという理由での統合は表示文言を書き換え、振る舞い不変性（要件2）に違反する。

### 助詞連結・動的合成の所在

- **Findings**:
  - `compatibility/view.tsx:101-104`: `{labels[field.side]}` + `"が選択されていません。"` / `"の値が未確認です。"` — 断片連結。
  - `compatibility/view.tsx:84`: `` `${labels[side]}（未選択）` `` — テンプレート合成。
  - `compatibility/view.tsx:78`: `value.join("、")` — 日本語の読点による列挙結合。
  - `candidate-management/view.tsx:106,115`: `` `${name}を編集` `` / `` `${name}を削除` `` — `aria-label` のテンプレート合成。
  - `candidate-management/view.tsx:250`: `` `${field.label}（自由入力）` ``。
  - `candidate-management/view.tsx:918,921`: JSX 内で「プロジェクト「{name}」と所属する候補も削除します。」を子要素列として組み立て。
  - `product-capture/view.tsx:166`: `` `推定: ${label}（詳細編集の初期選択になります）` ``。
  - `product-capture/view.tsx:331`: `` `候補を保存しました（保存先: ${projectName}）。` ``。
  - `backup-restore/view.tsx:36`: `` `${base}（位置: ${error.path}）` ``。
  - `backup-restore/view.tsx:139-141`: 「復元が完了しました（プロジェクト{n}件、候補{n}件、現在構成{n}件）。」— **件数を3つ含む**。英語対応時に複数形が問題化する典型。
- **Implications**: 件数を含むメッセージが実在するため、複数形を表現できる形式をカタログ値の型へ最初から入れておく必要がある。プレースホルダ数も3を超える（`backup-restore` の完了メッセージ）ため、上限9という `chrome.i18n` の制約を持ち込まない判断は妥当である。

### React root の構成

- **Findings**: `src/features/*/react-root.tsx` および `current-build/registration.ts` の `mountBuildView` が、それぞれ `createRoot(container)` で**独立した React root** を生成する。シェルの React root（`react-shell-root.tsx`）とは別ツリーである。
- **Implications**: シェル側に1つ Provider を置くだけでは feature の view へ Context が届かない。**各 feature の root 生成箇所で Provider を張る**必要がある。これは後続 spec が言語切り替えを実装する際にも同じ構造で効くため、この spec で確定させておく価値が高い。

### 検証フローと型設定の制約

- **Findings**:
  - `tsconfig.json` は `strict`、`exactOptionalPropertyTypes: true`、`noUncheckedIndexedAccess: true`、`module/moduleResolution: NodeNext`。`include` に `e2e/**/*.ts` を含む。
  - `pnpm validate:ci` = typecheck → typecheck:public-consumer → lint → validate:boundaries → validate:fixtures → validate:final-build → test。`pnpm validate` はこれに Playwright を加える。
  - `scripts/validate-*.mjs` は TypeScript の `createScanner` でトークン化して検査しており、コメントを自然に除外できる。同じ手法で文言リテラルの機械検査を追加できる。
  - `security.md` は「ログへ出すのは安定したエラーコードに限る」と明記している。
- **Implications**: `noUncheckedIndexedAccess` により動的な添字アクセスは `| undefined` を生む。カタログ解決は動的インデックスではなく、定数オブジェクトに対する型付き参照として設計する。機械検査スクリプトは既存3本と同じ書き方で追加できる。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 単一中央カタログ + React Context | `src/ui-messages/` に全キーと値を集約し、Context で供給 | キー空間が単一なので「ロケール間のキー網羅」を型で強制できる。重複文言の canonical owner が自然に決まる | feature-first の縦割りから見ると横断モジュールが1つ増える | **採用** |
| feature ごとのメッセージモジュール + 集約 | 各 feature が `messages.ts` を所有し、中央が集約 | 所有権が feature に閉じる | 集約側が feature 内部へ deep import する形になり `structure.md` の公開境界規約に反する。ロケール網羅の型強制も分散して成立しにくい | 不採用 |
| モジュールレベルの `t()` 直接 import | Context を使わず関数を直接呼ぶ | 実装が最小 | 言語切り替え時に全参照箇所を再度触ることになり、分割の利点が消える | 不採用 |
| `chrome.i18n` を前提にした設計 | `getMessage` 互換の形へ寄せる | 後で移行しやすい（ように見える） | プレースホルダ上限9、複数形非対応、アプリ内切り替え不可という制約を先取りしてしまう。roadmap が明示的に否定 | 不採用 |

## Design Decisions

### Decision: カタログを `src/ui-messages/` の新規境界として置く

- **Context**: 表示文言はカテゴリ名・永続化エラーのように feature をまたいで共有されるものと、feature 固有のものが混在する。`structure.md` は「単に重複して見えるという理由で汎用 `shared` へ移動せず、canonical owner を決めて公開契約経由で利用する」と定める。
- **Alternatives Considered**: 1) `application-shell` へ同居させる 2) feature ごとに分散して集約 3) 独立境界を新設
- **Selected Approach**: `src/ui-messages/` を新設し、`public.ts` を唯一の公開入口とする。この境界は他のどのモジュールにも依存しない葉であり（例外は `src/domain/public.js` からの**型のみ**の import）、シェルと全 feature が静的 import で利用する。
- **Rationale**:
  - 表示文言は「表示層の関心」であって feature のドメインロジックではない。`tech.md` の「React は表示 adapter に限定し、文言解決も表示層の関心として閉じる」に一致する。
  - `application-shell` へ置くと、feature が文言を得るために shell へ依存する形になり、brief が禁じた「カタログの供給経路が `FeatureMountContext` 境界を越える」構造へ引き寄せられる。
  - 後続 spec が「`ja` と同じキー集合を `en` が持つこと」を型で強制するには、キー空間が単一である必要がある。
- **Trade-offs**: 縦割りの例外が1つ増える。ただし依存方向は一方向（`ui-messages` → 誰にも依存しない）で、公開境界検査の対象に加えられる。
- **Follow-up**: `scripts/validate-boundaries.mjs` が新境界を誤検出しないことを実装時に確認する。

### Decision: 参照は React Context 経由に統一し、モジュール直呼びを禁じる

- **Context**: 後続 spec が言語切り替えを載せるとき、参照箇所を再び触らないことが分割の前提条件である。
- **Selected Approach**: view からの参照は `useMessages()` が返す resolver だけを経路とする。カタログ定数を view から直接 import しない。Provider は各 React root の生成箇所（シェル1箇所 + feature 5箇所）で張る。
- **Rationale**: 言語切り替えは「Provider の値が変わる」だけの操作になり、参照箇所は無変更で済む。モジュールレベルの `t()` を許すと、その参照箇所は言語が切り替わっても再描画されず、後続 spec で全て書き換えることになる。
- **Trade-offs**: React ツリー外（ロジック層）からは resolver を使えない。これはメッセージ識別子化（要件6）と整合しており、むしろ望ましい制約である。
- **Follow-up**: 「view がカタログ定数を直接 import していないこと」を機械検査へ含める。

### Decision: 表示経路と診断経路を分離し、診断は安定コードにする

- **Context**: `side-panel-host.ts` は同一文字列を表示と診断の両方へ流している。
- **Selected Approach**: 表示経路はメッセージ識別子（`MessageDescriptor`）を運ぶ。診断経路（`reportError` / `reportDiagnostic`、`FeatureActivationError.detail`）は日本語文言をやめ、`feature-unmount-failed` のような安定した英字コードを出す。
- **Rationale**: `security.md` は「ログへ出すのは安定したエラーコードに限る」と明記しており、この分離は既存規約の充足でもある。診断出力は画面に現れないため、要件2の「表示文言を1文字も変えない」に抵触しない。
- **Trade-offs**: `tests/application-shell/side-panel-host.test.ts` の診断文字列アサーションは書き換えになる。これは表示の検証ではないため、要件9.4（検証している振る舞いの集合を変えない）と両立する。
- **Follow-up**: 実装時、診断文字列を検証しているテストが「表示」を検証しているつもりでないことを1件ずつ確認する。

### Decision: 文面が一致するものだけを統合する

- **Context**: 永続化エラー表は同名コードでも文面が異なる。
- **Selected Approach**: 統合の判定基準を「コード名の一致」ではなく「**文字列としての完全一致**」に置く。一致しないものは feature 名前空間のキーとして個別に保持する。
- **Rationale**: 名前による統合は表示文言の書き換えになり、要件2に直接違反する。
- **Trade-offs**: `persistenceError.*` 名前空間に共有キーと feature 固有キーが混在する。設計上はキーのコメントで由来を明示して吸収する。
- **Follow-up**: 統合前後で全ての `code → 文言` 対応表が一致することを、移行タスクの完了条件として突き合わせる。

### Decision: 既存の文言リテラルアサーションを転記の検証装置として使う

- **Context**: カタログへ移した後で「期待値もカタログから解決する」テストへ変えてしまうと、転記時の誤字を検出できない自己参照的な検証になる。
- **Selected Approach**: 移行を2段に分ける。第1段では view をカタログ参照へ変えるが、**テスト側の文言リテラルは無改変のまま残す**。テストが緑であることが「1文字も変わっていない」ことの証拠になる。第2段（最終フェーズ）で、そのリテラルをカタログ解決へ置き換える。
- **Rationale**: 振る舞い不変性の根拠を、レビュアの目視ではなく既存テストの実行結果に置ける。
- **Trade-offs**: テストを2回触ることになるが、触るのは「期待値の書き方」だけであり、ロケータの移行（第1フェーズで完了済み）とは重ならない。
- **Follow-up**: 第2段のタスクは feature 単位に分け、各タスクの直前に第1段が緑であることを前提とする。

### Decision: 複数形はカタログ値の形式として許容だけしておく

- **Context**: 日本語は複数形を持たないため、この spec の時点では複数形は一度も使われない。しかし件数を含むメッセージが実在する。
- **Selected Approach**: メッセージ値の型を `string | { forms: { other, one?, zero? } }` の判別可能な形とし、件数を含むメッセージは `count` パラメータを受け取る形で定義する。日本語の値は `string` 形式のまま置く。
- **Rationale**: 「複数形を塞がない」という roadmap の制約を、実装コストほぼゼロで満たす。後続 spec は英語値を `forms` 形式で追加でき、参照側は無変更で済む。
- **Trade-offs**: 使われない分岐がフォーマッタに1つ増える。フォーマッタは十数行であり許容範囲。
- **Follow-up**: 日本語のみの現時点では `forms` 形式の値を作らない（投機的抽象を作らない）。フォーマッタの分岐だけを用意し、単体テストで動作を固定する。

## Risks & Mitigations

- **転記時の誤字が検出されない** — 上記「転記の検証装置」により、既存の文言リテラルアサーションを無改変で通すことを各移行タスクの完了条件にする。
- **E2E から `src/` の TypeScript を import できない可能性** — Playwright のトランスフォームが NodeNext 流の `.js` 指定子を解決できるかは実測が必要。最初の E2E タスクで最小の import を1件通して確認し、通らない場合はロケータのみ移行し文言の期待値は最終フェーズで扱う。
- **`data-*` 属性の追加が既存のスタイル・テストへ副作用を持つ** — 属性の追加のみで既存属性・クラス・`aria-label` は変更しない。視覚回帰は既存の DOM テストと E2E で検出する。
- **型レベルのプレースホルダ抽出がコンパイル時間を悪化させる** — キー数は約200、値は短文であり実害は小さい見込み。`pnpm typecheck` の所要時間を移行前後で比較し、悪化が顕著なら `ParamsFor` を手書きの型注釈へ後退させる。
- **`ApplicationFeatureRegistration.navigation` の契約変更が公開境界検査に触れる** — 契約変更は shell が所有する型の変更であり、全 feature の `registration.ts` が同時に追随する必要がある。単一の統合タスクとして扱い、部分適用状態を作らない。

## References

- `.kiro/steering/roadmap.md` — 二段階分割の判断、`chrome.i18n` を使わない根拠、共有接合面の指定
- `.kiro/steering/tech.md` — React を表示 adapter に限定する方針、検証フローの構成
- `.kiro/steering/structure.md` — 縦割りと canonical owner の規約、公開入口の規約
- `.kiro/steering/security.md` — ログへ出すのは安定したエラーコードに限る、機械検査で規約を守る
- `.kiro/steering/testing.md` — `node:test` + testing-library、`data-*` を `querySelector` で引く既存の書き方

## v0.3.0 Merge Discovery (2026-07-27)

### Summary

- **Discovery Scope**: Extension / integration-focused light discovery
- **Key Findings**:
  - 現行実装はja/enの10名前空間、型付き`MessageKey`、`MessageDescriptor`、resolver、placeholder parityを既に持つ。新しいresolverやalias layerは不要である。
  - `settings-screen`は`catalog/{ja,en}/settings.ts`と`nav.settings`を明示し、`nav.backupRestore`削除を要求する。product-captureはtransient化により`nav.productCapture`を申告しない。
  - 初回横断レビューでは`ui-internationalization`の10名前空間前提と`settings-screen`のcatalog ownership重複を検出した。両specは11名前空間の公開consumer契約と、意味/consumer/layout対key/value/parity/removalの一意な所有権へ改訂済みである。

### Producer / Consumer Contract Reconciliation

- **Sources Consulted**: `transient-feature-surface`、`product-capture-transient-migration`、更新済み`product-page-capture`、`application-shell`、`settings-screen`、更新済み`backup-restore`、更新済み`ui-internationalization`のrequirements/design/tasks、および`src/ui-messages/`とmessage consumer。
- **Findings**:
  - producerがexact keyとして固定しているのは`nav.settings`だけである。settingsの見出し・説明、一過性notice、capture回復案内のキー命名はcatalog ownerへ委ねられている。
  - 一過性noticeはshellのready/maintenanceと併存する`MessageDescriptor`であり、feature stateや自由文字列aliasではない。
  - product-captureの権限失効は、旧「ページを表示し直して再実行」から「ページ再表示後に拡張アイコンを再操作し、新しい付与世代を得る」へ意味が変わる。
  - loading/global startup failureのsettings案内は、現在のresolverがどちらでも`設定 / Settings`を認識できる固定二言語値でなければならない。
- **Implications**:
  - exact keyを`nav`、新規`settings`、`shell`、`capture`の4領域に限定し、feature behaviorやlanguage stateをcatalogへ持ち込まない。
  - `settings`を`common`や`shell`へaliasせず、11番目のcanonical namespaceとして追加する。
  - `nav.productCapture`と`nav.backupRestore`はcompatibility aliasを残さず、consumer切替と同じcheckpointで削除する。

### Decision: 既存resolverを維持しdata-only migrationにする

- **Alternatives Considered**:
  1. featureごとにmessage moduleを追加する — canonical ownerとja/en parityが分散する。
  2. 旧navigation keyをaliasとして残す — stale registrationを型検査で検出できなくなる。
  3. 既存catalogへexact keyを追加・削除する — 現行の型・resolver・Providerを再利用できる。
- **Selected Approach**: 3。新規抽象を作らず、ja/enの静的catalogデータ、集約点、parity testだけを拡張する。
- **Rationale**: build-vs-adoptの観点で既存基盤が要件を満たし、変更面と実装順を最小化できる。
- **Trade-offs**: navigation consumerの切替とdead key削除を原子的に行う必要がある。

### Risks & Mitigations

- 10名前空間前提やcatalog共同所有が再混入する — 11名前空間の公開consumer契約とowner別file planをcross-spec reviewで再検証し、catalog側でaliasを作らない。
- ja/enの一方だけに新キーやplaceholderが入る — 型による双方向網羅と`catalog-parity.test.ts`のplaceholder集合検査を両方通す。
- 旧navigation keyがtest fixtureやsnapshotに残る — catalogだけでなく`src/`、`tests/`、`e2e/`のdead consumer検索gateを設ける。
- 一過性noticeがfeature behaviorを所有してしまう — catalogは固定文言だけを持ち、noticeの発火・clear・寿命はproducer specへ委ねる。

### Canonical Registration Union Reconciliation

- `ApplicationFeatureRegistration`は`application-shell/public.ts`が公開するcanonical判別共用体を参照し、本specでは再定義しない。
- `PersistentApplicationFeatureRegistration`は`presentation: "persistent"`とnavigationを必須とし、その`navigation.labelKey`だけがcatalog key consumerになる。
- `TransientApplicationFeatureRegistration`は`presentation: "transient"`を明示しnavigationを持たない。transient product-captureにはnavigation metadataも`nav.productCapture`も提供しない。
- 未知／欠損presentationとbranch矛盾はproducer側のcanonical registry検証へ委ね、catalog側に登録解釈を追加しない。
