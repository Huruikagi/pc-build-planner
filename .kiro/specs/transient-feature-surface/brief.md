# Brief: transient-feature-surface

出典: GitHub issue [#6](https://github.com/Huruikagi/pc-build-planner/issues/6)（milestone v0.3.0）

## Problem

商品取り込みを使う利用者が、取り込みボタンを押しても黙って失敗する状況に遭遇する。

`activeTab` 権限は、拡張へのジェスチャー（ツールバーアイコンのクリック / コマンド / 拡張が登録したコンテキストメニュー）があった瞬間に、そのタブのその時点のドキュメントにだけ注入を許可し、トップレベル遷移で失効する。ところが現状の `action.onClicked` はサイドパネルを開くだけで（`src/runtime/service-worker.ts:76` に「このリスナーの仕事はパネルを開くことだけ」と明記）、取り込みの実行はパネル内ボタン（`data-capture-start`）に分離されている。

この「**付与するジェスチャー**」と「**実行するジェスチャー**」の分離が、UI の見た目と実際の取り込み可否のズレを生む。

- アイコンで開く → 別 URL へ遷移 → パネル内「取り込みを開始」ボタンは付与失効で黙って失敗（`permission-lost`）
- もう一度アイコンを押してから取り込むと成功する
- idle / review / saved / retry のいずれの状態に残る `startCapture` 系ボタン（`data-capture-start` / `data-capture-retry`）も、遷移後は必ず失敗する = **欺瞞的アフォーダンス**

さらに `permission-lost` の文言（`src/features/product-capture/view.tsx:62`）は「ページを表示し直してから再実行してください」となっており、リロードでは直らないため誤誘導になっている。

## Current State

- `src/runtime/service-worker.ts`: `action.onClicked` はサイドパネルを開くだけ。付与の有無を feature へ伝える経路がない。
- `src/application-shell/side-panel-host.ts`: `select(id)` は存在する（:354 付近）が、service worker からパネルへ働きかけるチャネルがない。
- `src/application-shell/feature-registry.ts` / `contracts.ts`: `FeatureContribution` は navigation 情報を持つことが前提で、登録済み feature は常設ナビへ並ぶ。
- application-shell 要件1.1「登録済みで利用可能な feature のナビゲーションを表示する」/ 要件1.5「同時に一つの feature だけを主表示領域へ表示する」/ 要件2.1（登録契約）/ 要件7（typed activation）が現在の表示モデルを規定している。
- product-capture は常設ナビの一項目として登録されている。
- 遷移を検知して状態をリセットする仕組み（`chrome.webNavigation.onCommitted` / `chrome.tabs.onUpdated` の購読）は存在しない。

ギャップ: **付与の有無を表現する概念が shell にも feature にも無い**ため、「取り込める状態」を UI に反映できない。

## Desired Outcome

「取り込み UI を出せる = 実際に取り込める」が一致している。

- 構成を見たいだけ → アイコンで開く。取り込みは走らず副作用ゼロ。
- 取り込みたい → アイコンで開く（付与が乗る）→ 取り込みビューが前面に立つ → 実行して成功する。
- 遷移した → 付与が失効する → **取り込みビューが自動的に畳まれ**、常設ナビの画面へ戻る。押しても失敗するボタンは画面ごと存在しない。
- 遷移後に取り込みたい → アイコンを再クリック → 付与し直してビューが立つ。

## Approach

issue の選択肢 **E（product-capture を常設ナビから外し、アイコンで開いたときだけ立ち上がる一過性ビューにする）を軸**に据え、`一過性ビューの寿命 ≡ activeTab 付与の寿命` として定義する。これにより issue が本命としていた A（付与フラグ通知 + capture 前面化）と B（有効性ゲート + 遷移リセット）が、個別機構ではなく情報設計の帰結として満たされる。

- A の「capture ビューの前面化」= 一過性ビューの**起動**そのもの。
- B の「遷移リセット」= 一過性ビューの**自動終了**。ボタンを disable にするのではなく画面ごと畳むため、欺瞞的アフォーダンスが構造的に消える。

**auto-run（アイコン = 即取り込み）は採らない。** issue で明示的に却下されている。ビューを立てるところまでが shell の仕事で、注入・抽出は利用者がビュー内で実行を選んだときに走る。したがって構成確認目的でパネルを開いても、注入 / スピナー / `restricted-page`・`no-candidate` エラー表示の副作用は出ない。

本 spec は shell 側の**一過性 feature 契約**と、その**最初の利用者としての product-capture の移行**の両方を所有する。契約だけを先に作って利用者がいない状態で設計するリスクを避ける。

## Scope

- **In**:
  - shell への一過性 feature 登録契約の追加（ナビへ常設せず intent 起動でのみ表示される feature 種別）
  - 起動口の契約: ツールバーアイコンのクリック、および将来のコンテキストメニュー項目（`chrome.contextMenus`、issue #6 の選択肢 D）を同一の起動経路として受け付ける
  - service worker → サイドパネルの通知チャネル（付与ジェスチャーの発生と対象タブ / URL の伝達）
  - パネルが新規に立ち上がる場合と、既に開いていて別 feature を表示している場合の両方のカバー
  - 遷移検知（`chrome.webNavigation.onCommitted` または `chrome.tabs.onUpdated`）による一過性ビューの自動終了と、終了後の戻り先の定義
  - product-capture を常設ナビから外し、一過性 feature として再登録する移行
  - `permission-lost` 文言の修正（issue #6 の選択肢 C）
- **Out**:
  - アイコンクリックでの取り込み自動実行（auto-run）
  - `host_permissions` による恒久的サイトアクセスへの路線変更（issue のスコープ外メモ）
  - 価格更新のコンテキストメニュー項目そのもの（`source-price-refresh` が本契約に登録する）
  - 設定画面の新設およびナビ構成のそれ以外の変更（`settings-screen`）
  - 抽出ロジック・ランカー・正規化の変更

## Boundary Candidates

- **一過性 feature の登録契約**（shell 所有）: `FeatureContribution` に presentation 種別を持たせるか、navigation を optional にするか。常設 feature の登録契約を壊さないこと。
- **付与ライフサイクルの表現**（shell 所有）: 「今このタブ / URL に対して付与が有効」という状態の所有者と、その失効イベント源。
- **起動ジェスチャー経路**（runtime adapter）: `action.onClicked` と `chrome.contextMenus` を同一の起動 intent へ正規化する境界。
- **worker → panel チャネル**: `action.onClicked` は service worker 側、`SidePanelHost` はパネル側にあるため通信が要る。既存の typed activation（要件7 / `activation-router.ts`）を拡張するか、別チャネルにするか。
- **一過性ビュー終了時の戻り先**: 直前に表示していた常設 feature か、既定 feature か。保存完了直後の扱い（保存先プロジェクトの候補一覧へ寄せるか）は設計で判断する。

## Out of Boundary

- 取り込みの抽出精度・優先順位（product-page-capture が所有）
- 候補の保存・編集契約（project-candidate-management が所有）
- ソースの複数化・価格の per-source 化（candidate-source-bookmarks が所有）
- 表示言語・メッセージカタログの意味（ui-language / ui-messages が所有）

## Upstream / Downstream

- **Upstream**: `application-shell`（feature 登録・typed activation・side panel host）、`product-page-capture`（移行対象の feature）、`ui-message-catalog`（文言キーの追加）
- **Downstream**: `settings-screen`（本 spec 確定後の常設ナビ構成を前提に設計する）、`source-price-refresh`（コンテキストメニュー「価格を更新」を本契約の2番目の起動口として登録する）

## Existing Spec Touchpoints

- **Extends**:
  - `application-shell` -- 要件1.1 / 1.5（ナビ常設と単一主表示の前提）、要件2.1（登録契約が受け付ける情報）、要件7（typed activation の拡張）の改訂が必要
  - `product-page-capture` -- 要件1.4（付与失効時に「再実行可能な案内を表示する」→ ビューを畳む挙動へ）、要件6.1（解析中の遷移時の扱い）の改訂が必要
  - `ui-message-catalog` / `ui-internationalization` -- ナビ項目の削除と新規文言（ja / en）
- **Adjacent**:
  - `settings-screen` -- 同じサイドパネルのナビ面を触る。**本 spec を先に確定させる**（roadmap の Boundary Strategy 参照）
  - `backup-restore` -- 常設 feature 側の代表例として、契約変更が既存登録を壊さないことの確認対象

## Constraints

- Chrome 116以降 / Manifest V3 / 未パッケージ拡張。
- `activeTab` を維持し、全サイトへの恒久的な読み取り許可を要求しない（product-page-capture 要件1.3）。
- `chrome.webNavigation` を使う場合は manifest への `webNavigation` 権限追加の要否を設計で判断する。`chrome.tabs.onUpdated` で代替できるなら追加権限なしを優先する（issue #9 に「`"tabs"` 権限はタブの `url`/`title` を読み取る場合のみ必要」との整理あり）。
- リモートコード・動的コード評価・インライン JavaScript を必要としない（application-shell 要件6.3）。
- feature 外からは `public.ts` のみを利用する境界規約を維持し、`scripts/validate-boundaries.mjs` を通す。
- worker bundle を DOM および React 非依存に保つ（application-shell 要件3.6）。service worker 側に追加するコードがこの制約を破らないこと。
- E2E（`e2e/locators.ts` ほか）は常設ナビに product-capture がある前提のロケータを持つため、更新が必要。
