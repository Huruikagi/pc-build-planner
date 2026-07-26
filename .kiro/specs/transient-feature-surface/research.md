# Gap Analysis: transient-feature-surface

作成日: 2026-07-26 / 対象要件: `.kiro/specs/transient-feature-surface/requirements.md`（要件1〜7）

## 1. 現状調査

### 1.1 表示面の登録と選択

| 資産 | 位置 | 本要件に対する意味 |
|---|---|---|
| `ApplicationFeatureRegistration` | `src/application-shell/contracts.ts:60` | `navigation: { labelKey, order, icon? }` が**必須プロパティ**。ナビ項目を持たない feature を表現する手段が型として存在しない |
| ナビ項目の構築 | `src/application-shell/application-composition.ts:435` | `createdRegistry.snapshot().map(...)` で**登録済み feature を無条件にナビ項目へ変換**している。除外の概念がない |
| ナビ描画 | `src/application-shell/shell-view.tsx` (`ShellNavigation`) | `navigation` prop をそのまま列挙。`data-feature-id` を DOM へ出す（E2E ロケータの拠り所） |
| 初期選択 / フォールバック | `src/application-shell/side-panel-host.ts:58` (`firstAvailable`) | `start()` と `reconcileAvailability()` の双方が使用。`navigation.order` 昇順で最初の available を選ぶ。**一過性 feature を登録すると初期選択やフォールバック先に選ばれうる** |
| 選択遷移 | `side-panel-host.ts:89` (`performSelect`) | unmount → mount の直列化。`selected` を上書きするだけで、**直前の feature を記憶しない** |
| 表示状態 | `contracts.ts:147` (`ShellViewState`) | `ready \| loading \| maintenance \| error` に `selected: FeatureId \| null`。一過性かどうかの区別を持たない |

### 1.2 引き渡し（activation）機構 — **既に存在する**

| 資産 | 位置 | 本要件に対する意味 |
|---|---|---|
| `FeatureActivationIntent` / `ActivationRouter` / `ShellNavigator` | `contracts.ts:40,83,89` / `activation-router.ts` | feature 間の型付き引き渡し。payload を未信頼として feature 側 `validate` に委ねる |
| `performActivation` の前状態退避 | `side-panel-host.ts:247,273` (`capturePreviousState` / `restorePrevious`) | **「直前 feature を覚えて戻す」処理の前例が既にある**。ただし1回の activation 内に閉じており、永続的な「戻り先」ではない |
| `CandidateEditorPrefill` | `src/features/candidate-management/activation.ts:24` | 候補管理側の受け口。draft + categoryHint を検証して編集画面を開く |
| `createCandidateEditorNavigation` | `src/features/product-capture/editor-navigation.ts` | **要件4.2 の実体がほぼそのまま存在する。** `open(session)` が `CaptureSession → CandidateDraft` を変換して `openCandidateEditor` を呼ぶ。`openManualEntry(name, projectId)` は要件4.5（候補ゼロ時の手入力導線）に対応。専用テスト（`editor-navigation.test.ts`, 230行）付き |

### 1.3 起動ジェスチャーと worker 境界

| 資産 | 位置 | 本要件に対する意味 |
|---|---|---|
| アイコンクリック | `src/runtime/service-worker.ts` (`createActionClickSidePanelBootstrap`) | `action.onClicked` → `sidePanel.open({ tabId })` のみ。**tabId は取得済み**（要件2.4 の対象タブ固定に使える）。「このリスナーの仕事はパネルを開くことだけ」とコメントで明記された現行方針そのもの |
| ジェスチャー同期制約 | `src/runtime/open-side-panel.ts` | `sidePanel.open` をユーザージェスチャー内で**同期的に開始**する契約。await を挟むと失敗する。要件2.1 の実装はこの制約下に置かれる |
| worker action チャネル | `contracts.ts:95` (`WorkerRegistrationContext.addActionHandler`) / `service-worker.ts` (`isActionMessage`) | `chrome.runtime.onMessage` を **worker 側**に張る。方向は「誰か → worker」。**本要件が必要とする worker → panel の方向は未実装** |
| worker catalog | `feature-contribution-catalog.ts:48` | `featureContributionCatalog` は `Object.freeze([])`。**production worker には現在どの feature registration も載っていない**（`createCaptureWorkerRegistration` は組み立てられるが worker には届いていない）。worker bundle の DOM/React 非依存を守るための構造 |
| manifest 権限 | `manifest.json` | `["storage", "activeTab", "scripting", "sidePanel"]`。**`tabs` / `webNavigation` / `contextMenus` はいずれも無い** |

### 1.4 取り込み feature の内部

| 資産 | 位置 | 本要件に対する意味 |
|---|---|---|
| セッション状態 | `src/features/product-capture/state.ts` / `contracts.ts:145` | `idle \| extracting \| review \| submitting \| saved \| failed`。要件4.1 の分割では **`review` / `submitting` / `saved` が一過性側から出ていく**対象 |
| **状態はunmountで消えない** | `feature-contribution.ts:56-61` のコメント | 「`state` はマウント済み view と worker の action handler が共有する単一インスタンスであり、サイドパネルの切り替えは React root を unmount するだけでこのインスタンスを破棄しない」。**「畳む = 状態が消える」ではない**ため、一過性の終了時にセッションを明示的に扱わないと、次回起動時に古いセッションが再出現する |
| view | `view.tsx`（473行） | idle / extracting / review / saved / failed の全表示を1コンポーネントが持つ。要件4.1 の分割はここの解体を伴う |
| 失敗文言 | `view.tsx` の `errorMessageKeys` | `permission-lost` を含む13種の `CaptureError` をカタログキーへ写像。要件5.3 の文言修正はカタログ側の変更 |

### 1.5 検証資産

- **unit/integration**: `tests/application-shell/`（`side-panel-host.test.ts`, `application-composition.test.ts`, `feature-registry.test.ts`, `shell-view.test.tsx` ほか18ファイル）、`tests/features/product-capture/`（16ファイル・約4,000行。うち `state.test.ts` 475行、`regression.test.ts` 449行、`view.test.tsx` 424行が本変更の直撃対象）
- **E2E**: `e2e/product-capture.spec.ts`(121行)、`e2e/locators.ts` の `navItem()` / `featurePanel()` / `captureStartButton()` / `captureRetryButton()`
- **文言**: `src/ui-messages/catalog/{ja,en}/nav.ts` に `productCapture` ラベル
- **機械検証**: `scripts/validate-boundaries.mjs`（公開境界）、`pnpm validate:ci` / `pnpm validate`

## 2. 要件↔資産マップ

| 要件 | 既存資産 | 差分 | 種別 |
|---|---|---|---|
| 1.1〜1.2 ナビに載らない登録区分 | `ApplicationFeatureRegistration` | `navigation` が必須。optional 化または presentation 種別の追加が必要 | **Missing** |
| 1.2 ナビからの除外 | `application-composition.ts:435` のナビ構築 | 除外フィルタが無い | **Missing** |
| 1.3 常設側の非回帰 | 既存の登録・選択経路 | 契約変更が既存4 feature を壊さないことの担保が必要 | **Constraint** |
| 1.5 一過性未起動時は常設のみ | `firstAvailable()` | 一過性を選択候補から除外しないと初期選択・フォールバックで選ばれる | **Missing** |
| 2.1〜2.3 ジェスチャー起動 | `action.onClicked` → `sidePanel.open` | worker → panel の通知経路が無い。パネル未起動時と起動済み時で到達方法が異なる | **Missing** |
| 2.1 同期ジェスチャー制約 | `open-side-panel.ts` | 通知を挟んでも `sidePanel.open` の同期開始を崩せない | **Constraint** |
| 2.4 / 2.6 対象タブ固定・更新 | `onClicked` の `tab.id` | 固定した tabId をパネル側へ渡し保持する器が無い | **Missing** |
| 2.5 コンテキストメニュー経路 | なし | `contextMenus` 権限が未付与。`Where` 条件のため本 spec では契約の受け入れ余地だけで足りる | **Unknown** |
| 3.1〜3.2 遷移・タブ閉鎖での終了 | なし | 遷移検知の購読が無い。権限要否が未確定 | **Missing / Unknown** |
| 3.1〜3.5 戻り先 = 直前の常設画面 | `capturePreviousState` / `restorePrevious` / `firstAvailable` | 「直前の常設 feature」を保持する状態が無い。前例はあるが activation 1回に閉じている | **Missing** |
| 3.7 終了時に永続状態を変更しない | `side-panel-host` の unmount 経路 | unmount 自体は永続化しない。ただし §1.4 の通りセッション状態は残るため明示的な扱いが必要 | **Constraint** |
| 3.8 終了失敗時の扱い | `unmountCurrent()` の失敗分岐 | 既存の「stale な feature が slot を保持する」方針を踏襲できる | 充足に近い |
| 4.2〜4.3 抽出結果の引き渡し | **`editor-navigation.ts` + `CandidateEditorPrefill`** | **ほぼ既存資産で足りる。** 呼び出しの契機を「利用者が詳細編集を選ぶ」から「抽出成功時」へ移すのが主変更 | 充足に近い |
| 4.1 実行面のみを一過性に | `view.tsx`(473行) / `state.ts` の6状態 | review / submitting / saved の表示と状態を一過性側から分離する解体が必要 | **Missing** |
| 4.4 遷移で確認内容を破棄しない | §1.4 の state 永続性 | 引き渡し後は候補管理側が保持するため構造的に満たされる | 充足に近い |
| 4.5 候補ゼロ時の手入力導線 | `openManualEntry` | 既存 | 充足 |
| 5.3 `permission-lost` 文言 | `view.tsx` の `errorMessageKeys` + カタログ | カタログ文言の差し替えのみ | 充足に近い |
| 5.1〜5.2 失敗する操作を出さない | 現状は idle/review/saved/retry に実行系ボタンが残る | 表示面の寿命で解消するのが本要件の骨子 | **Missing** |
| 6.1〜6.5 副作用抑止 | 現行の「開くだけ」方針 | auto-run を導入しない限り現行の性質が保たれる | 充足に近い |
| 7.1〜7.4 検証可能性 | 既存テスト群 | 一過性寿命の決定的観測点と、常設側の非回帰スイートが必要 | **Missing** |

## 3. 実装アプローチの選択肢

### Option A: 既存登録契約の拡張だけで済ませる

`ApplicationFeatureRegistration.navigation` を optional にし、`side-panel-host` に「直前の常設 feature」フィールドと遷移購読を足す。

- ✅ 新規モジュールが増えず、既存の選択・activation 経路をそのまま使える
- ✅ `firstAvailable` / ナビ構築のフィルタ追加は局所的
- ❌ `side-panel-host.ts`（425行）が「選択」「activation」「一過性寿命」「戻り先」の4責務を持ち、単一責務から外れる
- ❌ Chrome の遷移イベント購読を shell が直接持つと、runtime adapter との依存方向（steering `structure.md`）が濁る

### Option B: 一過性表示面を独立した概念として新設

`registry` とは別に一過性 surface の登録簿・寿命管理・戻り先決定を持つ新モジュールを作り、`side-panel-host` は主表示領域の占有権だけを調停する。

- ✅ 寿命管理が1モジュールに閉じ、テストが決定的に書ける（要件7.1）
- ✅ 遷移購読は runtime adapter として注入でき、依存方向が保たれる
- ❌ 主表示領域の占有権が2系統になり、競合（一過性起動中の常設 availability 変化など）の設計が必要
- ❌ `ShellViewState` / `presentation` の契約も二重化しやすい

### Option C: Hybrid（推奨）

- **登録契約は拡張**（Option A の一部）: `navigation` を optional 化、または `presentation: "persistent" | "transient"` を追加し、ナビ構築と `firstAvailable` から除外する
- **寿命管理は新モジュール**（Option B の一部）: 起動契機・対象タブ固定・終了条件・戻り先決定を専用モジュールへ切り出し、`side-panel-host` へは既存の `select` / `activate` で作用させる
- **遷移検知とジェスチャー通知は runtime adapter**: `src/runtime/` 側の port として注入し、shell が Chrome API へ直接依存しない
- **引き渡しは既存 activation を再利用**: `editor-navigation.ts` の呼び出し契機の変更に留める

- ✅ 既存の強い資産（activation、editor-navigation、unmount 直列化）を捨てない
- ✅ shell の責務追加を最小化しつつ、寿命ロジックを独立してテストできる
- ❌ 「登録契約」「寿命管理」「runtime adapter」の3箇所を協調させる設計が必要で、計画コストが高い

## 4. 規模とリスク

- **Effort: L（1〜2週間）** — shell の登録契約変更が既存4 feature とテスト18ファイルへ波及し、加えて `view.tsx`(473行) / `state.ts`(211行) の分割と、それらを対象とする約2,000行のテスト（`state.test.ts` / `view.test.tsx` / `regression.test.ts`）の書き換えを伴う。E2E とナビ文言も対象。
- **Risk: Medium〜High**
  - *High 要因*: 遷移検知の権限要否が未確定（manifest 変更＝利用者への権限影響）。worker → panel 通知はパネルのライフサイクルと競合しやすく、取りこぼしが「黙って起動しない」形で出る。
  - *Medium 要因*: 登録契約の変更点自体は局所的で、既存 activation・unmount 直列化・`restorePrevious` の前例が使える。`editor-navigation` が既にあることで要件4の中核は新規実装ではない。

## 5. Research Needed（設計フェーズへ持ち越す）

1. **遷移検知の手段と権限** — `chrome.tabs.onUpdated` を `tabs` 権限なしで購読したとき、対象タブのトップレベル遷移を判別できるか（`changeInfo.url` は権限なしでは省かれる想定。`status` だけで要件3.1 を満たせるか）。`chrome.webNavigation.onCommitted` は `webNavigation` 権限が必要。**追加権限なしで成立する経路を優先する**という制約に対して、どこまで妥協するか。
2. **worker → panel の通知方式** — `chrome.runtime.sendMessage` をパネルが受ける形か、`chrome.storage.session` を介した受け渡しか、`chrome.runtime.connect` の port か。特に `sidePanel.open()` 直後（パネルがまだ listener を張っていない時点）の**取りこぼし**をどう防ぐか（要件2.2）。
3. **パネル既存起動時の挙動** — `sidePanel.open()` を既に開いているパネルへ呼んだとき、ドキュメントが再読み込みされるのか既存インスタンスが維持されるのか。要件2.3 と 2.6 の実装が変わる。
4. **`activeTab` 失効の観測可能性** — 失効そのものを通知する API は無い前提で、遷移イベントを代理シグナルとする妥当性。注入試行の失敗を唯一の真実とする案との比較。
5. **`contextMenus` 権限の前倒し可否** — 要件2.5 は `Where` 条件のため本 spec では契約の受け入れ余地だけで足りるが、`source-price-refresh`(#12) が確実に必要とする。権限追加を本 spec で行うか #12 へ委ねるか。
6. **`CaptureSession` の寿命** — §1.4 の「state は unmount で破棄されない」性質を、一過性の終了時に維持するのか破棄するのか。要件4.4（引き渡し後の内容を破棄しない）と要件3.7（終了時に永続状態を変更しない）の両立点。

## 6. 設計フェーズへの推奨

- **Option C を起点にする。** 特に「引き渡しは `editor-navigation.ts` の呼び出し契機変更に留める」判断は、要件4の実装量を大きく下げる。
- **最初に決めるべきは登録契約の形**（`navigation` optional 化 vs `presentation` 種別追加）。ここが `application-composition.ts` のナビ構築、`firstAvailable`、`ShellViewState`、E2E ロケータのすべてに波及する。
- **`view.tsx` / `state.ts` の分割範囲を要件4.1 の観点で先に線引きする。** `review` 以降を候補管理側へ寄せると capture feature の状態機械は `idle / extracting / failed` まで縮む可能性があり、その場合 `state.test.ts` / `view.test.tsx` は書き換えではなく分割になる。
- **常設側の非回帰スイート（要件7.4）を設計時点でタスク化する。** 契約変更が既存4 feature に波及するため、後追いでは検出が遅れる。
- **product-page-capture spec の要件4.1 / 4.7 / 4.8（サイドパネル上の簡易確認とカテゴリ表示専用扱い）の帰属を design で決める。** 簡易確認を引き渡し先へ移すのか、簡易確認自体を廃して詳細編集へ直行するのかが未決。
