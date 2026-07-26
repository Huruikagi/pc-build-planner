# Roadmap

## Overview

Issue #7「日本向け専用の看板を外し、国非依存の汎用ツールとして整理する」に対応し、`pc-build-planner` を国・言語に依存しない汎用ツールとして成立させる。到達点は v0.2.0 のリリースであり、UI が日本語・英語の両方で利用でき、通貨の既定値が特定の国を暗黙に仮定しない状態とする。

取り込みエンジンは既に構造化メタデータ（JSON-LD / OpenGraph）依存でロケール非依存であり、ドメイン層も日本語文言を持たない。したがって本ロードマップの作業対象は **UI 層とプロダクト定義文書に限定される**。

## Approach Decision

- **Chosen**: 二段階分割。まず振る舞い不変のリファクタで UI 文言を単一カタログへ集約しロケータを安定化（`ui-message-catalog`）、その上で言語切り替え可能な i18n 基盤と英語対応を載せる（`ui-internationalization`）。言語切り替えは **自前カタログ + React Context 方式（ケースA）** を採用し、`chrome.i18n` は manifest と Chrome Web Store 掲載のためだけに使う。
- **Why**:
  - i18n 本体より「文言依存の剥がし」の方が作業量が大きい。`styles.css` の日本語 `aria-label` 属性セレクタ（約10箇所）、E2E ロケータ（約99箇所）、単体・統合テストのアサーション（約150〜200箇所）が日本語文言に構造的に依存している。これを i18n と同時に行うと単一 spec が30〜40タスクへ肥大化し、レビュー単位が粗くなる。
  - 分割し、先にロケータを安定化しておくことで **テスト破壊が1回で済む**。逆順や一括では同じテストを二度修正することになる。
  - `chrome.i18n` には **拡張内でユーザーが言語を切り替える手段が存在しない**（ロケール上書きAPIもロケール変更イベントも無い）。仕様であり回避策がないため、切り替えUIを提供するなら自前カタログ以外の選択肢がない。
  - 自前カタログは E2E の観点でも優位。言語切り替えが単なるアプリ状態になるため、ブラウザ再起動もロケール環境変数の操作も不要になる。
- **Rejected alternatives**:
  - **単一 spec で一括実施**: spec サイクルは1回で済むがタスクが肥大化し、レビュー単位が粗くなる。
  - **`chrome.i18n` を直接利用（ケースB）**: 追加コードはほぼゼロだが、アプリ内で言語を切り替えられず、E2E で英語UIを検証するにはブラウザ再起動とロケール環境変数の切り替えが必要になる。後述の `--lang` の OS 依存問題を抱え込む。
  - **i18next / react-i18next の導入**: MIT ライセンスで CSP 適合、GPL 汚染も無いが、2言語・サイドパネル1枚の規模に対して約22KB gz は過剰。将来5言語以上または複雑な複数形要件が出た時点で再検討する。
  - **文言集約のみ実施し i18n は後日**: v0.2.0 のスコープを Issue #7 全体とする判断により不採用。

## Scope

- **In**:
  - UI 文言の単一カタログへの集約と、文言に依存しないロケータ基盤への移行
  - 日本語・英語の2言語対応と、サイドパネル内の言語切り替えUI
  - `manifest.json` の `name` / `description` の国際化と `_locales/` 導入
  - 通貨未確定時のフォールバック方針の是正
  - steering のポジショニングを国非依存の記述へ更新
  - v0.2.0 のバージョン更新とリリース
- **Out**:
  - 日本語・英語以外の言語追加（基盤は追加可能な形にするが、本ロードマップでは翻訳を用意しない）
  - `category-hint.ts` のキーワード辞書の多言語化（日本語ECサイト向けのロケール別データとして維持し、翻訳対象外とする）
  - 通貨の自動換算、為替レート取得、価格の通貨別表示整形
  - ロケール別の日付・数値フォーマット（今回は文言のみを対象とする）
  - 取り込みエンジンのサイト固有対応

## Constraints

- **`chrome.i18n` はアプリ内の言語切り替えを提供しない。** 表示言語はブラウザUI言語に固定され、ロケールを上書きするAPIもロケール変更イベントも存在しない。アプリ内文言に `chrome.i18n` を使わない根拠であり、この制約は回避不可能である。
- **`_locales/` を配置するなら `default_locale` は必須**であり、`default_locale` のカタログは全キーを揃える必要がある（最終フォールバック先のため）。他ロケールは部分翻訳でよい。逆に `_locales/` が無いのに `default_locale` を書くと拡張が読み込めない。
- **`chrome.i18n` は複数形（plural）・性別・ICU MessageFormat を非サポート。** Chromium 公式が「複数形に依存しない表現を使え」と明記している。プレースホルダは最大9個。
- **Chromium の `--lang` フラグは Windows でのみ有効。** Linux では `LANGUAGE` / `LC_*` / `LANG` 環境変数のみが参照され、macOS では `AppleLanguages` が優先される（`ui/base/l10n/l10n_util.cc` の実装コメントに明記）。CI は Linux 前提のため、ブラウザUI言語に依存する設計を採ると E2E が OS 依存の暗黙知を抱える。
- **Playwright の `use: { locale }` は `chrome.i18n` に影響しない。** CDP の `Emulation.setLocaleOverride` によるレンダラ側のエミュレーションであり、ブラウザプロセスのアプリケーションロケールには届かない。Webアプリの i18n テストの手法をそのまま持ち込まないこと。
- MV3 の CSP 制約（`eval` 禁止、remote code 禁止）により、翻訳リソースは静的 import でバンドルへ含める。動的ロード系のバックエンドプラグインは使用しない。
- 既存の技術方針（`tech.md`）を維持する。React は表示 adapter に限定し、ドメイン state や port を component へ埋め込まない。文言解決も同様に表示層の関心として閉じる。

## Boundary Strategy

- **Why this split**:
  - `ui-message-catalog` は **振る舞い不変のリファクタ** として閉じる。UI の表示は日本語のまま変わらず、検証は「表示文言が変わっていないこと」で完結する。i18n の設計判断を一切含まないため、レビューの争点が「文言の集約が漏れなく正しいか」だけに絞られる。
  - `ui-internationalization` は **新しい振る舞いの追加** に閉じる。文言が既にカタログ化されている前提に立てるため、言語解決・永続化・切り替えUI・英語翻訳という新規の関心だけを扱える。
  - この境界により、テストの大量修正は `ui-message-catalog` に一度だけ集中する。
- **Shared seams to watch**:
  - **カタログのキー設計**が2つの spec をまたぐ最重要の接合面。`ui-message-catalog` の時点で「日本語文言をそのまま値に持つが、キー体系と参照方法は i18n 後と同一」にしておく必要がある。ここを妥協すると `ui-internationalization` で全参照箇所を再度触ることになり、分割の利点が消える。
  - **助詞レベルの文字列連結**（`名前 + "が選択されていません。"`、`` `${name}を編集` `` 等）は日本語文法前提であり翻訳不能。**どちらの spec が文構造を再設計するかを明示すること。** 本ロードマップでは `ui-message-catalog` の責務とする（カタログ化の時点で文単位のメッセージへ再設計する）。
  - **`styles.css` の日本語属性セレクタ**は文言とスタイルの不正な結合であり、`ui-message-catalog` で `data-*` へ剥がす。剥がし漏れは i18n 実施時に視覚的な崩れとして遅れて顕在化するため、spec 1 の完了条件に含める。
  - **`application-shell`** は言語切り替えUIの設置面になる。`ui-internationalization` が新設するが、shell が所有する UI composition の境界を越えないこと。
  - **`category-hint.ts` と `normalizer.ts` の `円` パーサ**は「翻訳対象外のロケール別データ／ロジック」として明示的に区別する。i18n の対象へ誤って巻き込まないこと。

## Existing Spec Updates

- [x] application-shell -- 言語切り替えUIの設置面としての責務と、ナビゲーションラベルがカタログ由来になる点を requirements/design/tasks へ反映済み（要件1.6・8.1・8.2、task 6.1/6.2）。実装は`ui-message-catalog`/`ui-internationalization`側のタスク完了後。Dependencies: ui-internationalization
- [x] local-data-foundation -- `ui-internationalization` が新設した `src/ui-language/preference-store.ts` を、「featureはchrome.storageへ直接依存しない」という既存の Allowed Dependencies 原則に対する明示的な例外として Allowed Dependencies へ追記済み（コミット `00a744e`）。言語設定はドメインデータではなく `localDataRoot` の外にある専用キー1つに閉じ、write authority・交換形式・容量監視のいずれにも影響しないことを確認済み（`ui-internationalization` design.md の「保存先の判断」を参照）。`scripts/validate-boundaries.mjs` の到達点制限（StorageAccessGuard、2ファイル限定）と整合済み。Dependencies: ui-internationalization
- [ ] ci-release-workflow -- 既存のリリース手順（version 整合ゲート、マイルストーン確認）をそのまま使う。手順変更が不要であることを v0.2.0 の実機リリースで確認する。ワークフロー自体の本番実行は milestone `v0.1.0` に対して確認済み（run `30149484114`、`ci-release-workflow` spec 自身の検証）だが、これは本ロードマップが求める **v0.2.0 での実機リリース確認ではない**。下記「v0.2.0 バージョン更新」の完了が前提。Dependencies: なし

## Direct Implementation Candidates

- [x] 通貨フォールバックの是正 -- `src/features/candidate-management/view.tsx` の `?? "JPY"` を空文字へ変更し、「通貨不明」を明示的に表現する変更を実施済み（コミット `98059c6`）。候補管理UIの見た目・ドメイン型（`currency: string`）は変更なし。
- [x] steering のポジショニング更新 -- `.kiro/steering/product.md` の「日本の自作PCユーザー向け」を国非依存の記述へ改め、「国・言語への非依存」を新設済み（コミット `c1d80dd`）。「UI文言の i18n は v0.2.0 の対象」および `円` パーサ・`category-hint.ts` を日本語ロケール向けの局所最適化（翻訳対象外）として維持する旨も記録済み。
- [x] v0.2.0 バージョン更新 -- `manifest.json` と `package.json` の `version` を `0.2.0` へ一致させて更新済み（README リリース手順の1.のみ実施。マイルストーン配下issueの完了確認とRelease ワークフローの手動起動（手順2・3）は未実施）。

## Specs (dependency order)

- [x] ui-message-catalog -- UI文言を単一カタログへ集約し、テスト・スタイルの文言依存を剥がす振る舞い不変のリファクタ。Dependencies: none
- [x] ui-internationalization -- 自前カタログ方式による ja/en 対応、言語切り替えUI、`_locales/` と manifest の国際化。Dependencies: ui-message-catalog。`/kiro-validate-impl` でGO判定済み（要件1.1〜9.5の全50節を被覆、`pnpm validate:ci` 940件 pass、Playwright 9件 pass、境界違反ゼロ、2026-07-26確認）。

## Status（2026-07-26 更新）

両 spec（`ui-message-catalog` / `ui-internationalization`）、Direct Implementation Candidates（通貨フォールバック是正、steering更新、v0.2.0バージョン更新）、Existing Spec Updates（`application-shell` / `local-data-foundation`）はすべて完了。残るのは README リリース手順の2.（対象マイルストーン配下issueの完了確認）と3.（GitHub Actions「Release」ワークフローの手動起動）によるv0.2.0実機リリースのみ。
