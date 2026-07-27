# Brief: ui-internationalization

## Problem

`pc-build-planner` は取り込みエンジンが構造化メタデータ（JSON-LD の `priceCurrency`、OpenGraph の `product:price:currency`）に依存しているため、実装としては既に国・言語に依存しない汎用エンジンになっている。価格パーサも `¥` / `$` / `€` / `£` と通貨コードに対応済みである。

にもかかわらず UI 文言が日本語のみであるため、日本語話者以外が使えない。実装の汎用性と提供形態が乖離しており、「日本向け専用」という看板が実態より狭い制約として残っている。

## Current State

- 前提 spec `ui-message-catalog` の完了により、UI 文言は単一カタログから解決され、view とロジック層に日本語リテラルが残っていない。ただしカタログの値は日本語1言語のみ。
- `styles.css` と E2E ロケータは既に文言非依存へ移行済みであり、文言を差し替えてもスタイル・テストが壊れない。
- 助詞連結による文言合成は解消済みで、全てのメッセージが文単位で完結している。
- `_locales/` は存在せず、`chrome.i18n` の利用箇所もゼロ。
- `manifest.json` の `name` は `"PC Build Planner"`（英語）、`description` フィールドは存在しない。`default_locale` も未指定。
- `side-panel.html` は `<html lang="ja">` 固定。
- `manifest.json` の構造は `tests/runtime/manifest.test.ts` と `tests/tooling/package.test.ts` が検証している。

## Desired Outcome

- サイドパネルの UI が日本語と英語の両方で表示できる。
- ユーザーがサイドパネル内で表示言語を切り替えられ、選択が次回起動時も保持される。
- 言語未選択時はブラウザのUI言語から妥当な初期値が決まる。
- `manifest.json` の `name` / `description` が Chrome の表示言語に応じて切り替わり、Chrome Web Store のロケール別掲載情報を入稿できる状態になる。
- `円` パーサと `category-hint.ts` のキーワード辞書が「日本語ロケール向けの局所最適化であり翻訳対象外」として明示的に位置づけられている。
- E2E で英語UIが検証されており、その検証がブラウザ再起動やロケール環境変数の操作を必要としない。

## Approach

**自前カタログ + React Context 方式（ケースA）** を採用する。`chrome.i18n` はアプリ内の文言解決には一切使わず、`manifest.json` の `name` / `description` と Chrome Web Store のロケール別掲載情報のためだけに `_locales/` を最小構成で維持する。

この方式を選ぶ理由は、`chrome.i18n` が **拡張内でユーザーが言語を切り替える手段を提供していない** ためである。表示言語はブラウザUI言語に固定され、ロケールを上書きする API もロケール変更イベントも存在しない。これは仕様であり回避策がない。

副次的な決め手として E2E のテスタビリティがある。自前カタログなら言語切り替えは単なるアプリ状態であり、E2E は言語セレクタを操作するだけで英語UIを検証できる。`chrome.i18n` に依存する設計では、ブラウザUI言語を変える必要があり、そのための手段が OS 依存で壊れやすい（後述の Constraints を参照）。

ライブラリは導入しない。2言語・サイドパネル1枚の規模に対し i18next + react-i18next の約22KB gz は過剰であり、自前実装なら 1〜3KB で済む上に `as const` + `keyof` による型安全なキーが得られる。将来5言語以上または複雑な複数形要件が生じた時点で再検討する。

## Scope

- **In**:
  - 言語カタログの英語版（`en`）の追加。`ui-message-catalog` が確立したキー体系をそのまま使う
  - 言語解決の仕組み（React Context + フック）と、カタログの静的 import
  - 表示言語の永続化（`chrome.storage.local`）と、初期値の決定（永続値 > `chrome.i18n.getUILanguage()` を ja/en へ正規化）
  - 設定画面の表示言語区画に配置する言語切り替えUI
  - `_locales/{ja,en}/messages.json` の新設（`name` / `description` のみの最小構成）、`manifest.json` への `default_locale` 追加と `__MSG_*` 化
  - `side-panel.html` の `lang` 属性の動的化
  - 複数形・助数詞を含む文言の英語対応（`復元が完了しました（プロジェクト{n}件、候補{n}件、現在構成{n}件）` 等）
  - `manifest.json` 構造を検証する既存テストの更新
  - E2E への英語UI検証の追加
  - `category-hint.ts` と `normalizer.ts` の `円` パーサを「翻訳対象外のロケール別データ／ロジック」として構造上・文書上で明示
- **Out**:
  - 日本語・英語以外の言語。基盤は追加可能な形にするが、翻訳データは用意しない
  - `category-hint.ts` のキーワード辞書の多言語化。英語ECサイト向けのカテゴリ推定は別の課題であり、本 spec は日本語辞書を「ja 専用データ」として隔離するところまでを行う
  - ロケール別の日付・数値・通貨フォーマット（`Intl.DateTimeFormat` / `Intl.NumberFormat` の導入）。文言のみを対象とする
  - 通貨の自動換算、為替レート取得
  - Chrome Web Store のストア掲載情報（詳細説明・スクリーンショット）の英語版作成。これは manifest 由来ではなくダッシュボードでの入稿作業であり、リリース作業として別途扱う
  - i18n ライブラリの導入

## Boundary Candidates

- **言語カタログのデータ**（ja / en の値）と、**言語解決の仕組み**（Context、フック、正規化ロジック）
- **言語の永続化と初期値決定**（`chrome.storage.local` へのアクセス、`chrome.i18n.getUILanguage()` の正規化）と、**それを消費する表示層**
- **アプリ内文言の国際化**（自前カタログ）と、**manifest / ストア掲載の国際化**（`_locales/` + `chrome.i18n`）。両者は目的も仕組みも独立しており、混同すると設計が壊れる
- **翻訳対象の文言**と、**翻訳対象外のロケール別データ**（`category-hint.ts` の日本語キーワード辞書、`円` パーサ）
- **言語切り替えUI の配置**（`settings-screen` が所有する表示言語区画）と、**言語状態そのもの**（本specの `ui-language` 公開契約）

## Out of Boundary

- UI 文言のカタログ化そのもの。`ui-message-catalog` が所有し、本 spec の着手前に完了している前提
- `styles.css` の文言依存の解消、E2E ロケータの文言非依存化。同上
- 表示文言の文面改善や UI の再デザイン
- ドメイン層・`compatibility/rules.ts` への変更。既に文言を持たない
- 取り込みエンジンの多言語サイト対応、サイト固有ロジックの追加
- 通貨フォールバックの是正（Direct Implementation として先行実施済み）

## Upstream / Downstream

- **Upstream**:
  - `ui-message-catalog` — **硬い依存**。カタログのキー体系が確定していることが着手条件
  - `settings-screen` — 言語切り替えUIの設置面。公開 `LanguageSelectControl` を表示言語区画へ配置し、言語状態や保存を所有しないこと
  - `application-shell` — 設定への常設navigationと `LanguageProvider` の設置面。headerへ言語controlを置かず、UI composition と `FeatureMountContext` の境界を越えないこと
  - `local-data-foundation` — ドメインデータの単一write authorityを維持する。言語設定は解決済み方針どおり `LocalDataRoot` 外の専用キーへ保存し、foundation、交換形式、容量監視へ混入させない
- **Downstream**:
  - `ci-release-workflow` — v0.2.0 リリース時に `_locales/` と `default_locale` を含むパッケージが正しくビルドされること
  - 将来の言語追加（3言語目以降）。本 spec が確立した基盤の上に載る

## Existing Spec Touchpoints

- **Extends**:
  - `settings-screen` — 公開 `LanguageSelectControl` を表示言語区画へ配置する。settings は配置とlifecycle合成だけを所有し、言語状態・保存・文言解決は本specが引き続き所有する
  - `application-shell` — `LanguageProvider` と表示言語追随を維持しつつ、headerの言語controlを撤去してsettingsへの到達または二言語案内を提供する
- **Adjacent**:
  - `product-page-capture` — `category-hint.ts` と `normalizer.ts` に触れるが、抽出・正規化の**振る舞いは変更しない**。日本語固有のロジックを構造上分離するのみ
  - `backup-restore` — 複数形・助数詞を含む文言（`プロジェクト{n}件、候補{n}件、現在構成{n}件`）の再設計対象。バックアップ形式や復元の振る舞いは変更しない
  - `ci-release-workflow` — manifest 構造の変更に伴い、既存の manifest 検証テストとリリース前ゲートに影響しないか確認

## Constraints

- **`chrome.i18n` はアプリ内の言語切り替えを提供しない。** ロケール上書きAPIもロケール変更イベントも存在せず、メッセージは初回参照時にキャッシュされる。この制約が自前カタログ方式を選択する直接の根拠であり、設計上覆せない。
- **`_locales/` を配置するなら `default_locale` は必須。** 逆に `_locales/` が無いのに `default_locale` を書くと拡張が読み込めない。`default_locale` に指定したロケールの `messages.json` は全キーを揃える必要がある（最終フォールバック先のため）。他ロケールは部分翻訳で可。
- ロケールディレクトリ名は `pt_BR` 形式の**アンダースコア**（ハイフンではない）。キーは大文字小文字を区別せず、`@@` 始まりは予約。
- **`chrome.i18n` は複数形・性別・ICU MessageFormat を非サポート**、プレースホルダは最大9個。ただし本 spec ではアプリ内文言に `chrome.i18n` を使わないため、この制限が効くのは `_locales/` に置く `name` / `description` のみであり実質的な制約にならない。**アプリ内の複数形は自前で扱う**（`Intl.PluralRules` の薄いヘルパ、または複数形中立な表現への統一）。
- **Chromium の `--lang` フラグは Windows でのみ有効。** Linux では `LANGUAGE` / `LC_*` / `LANG` 環境変数のみ、macOS では `AppleLanguages` が優先される（`ui/base/l10n/l10n_util.cc` の実装コメントに明記）。**この制約は本 spec の設計では回避される**（アプリ内状態で言語を切り替えるため）が、`chrome.i18n.getUILanguage()` を初期値決定に使う以上、E2E で初期値決定ロジックを検証しようとすると顕在化する。初期値決定の検証は E2E ではなく単体テストで行うこと。
- **Playwright の `use: { locale }` は `chrome.i18n` に影響しない。** CDP の `Emulation.setLocaleOverride` によるレンダラ側のエミュレーションであり、ブラウザプロセスのアプリケーションロケールには届かない。同様に Playwright は `--lang` を自動付与しない。
- `locales/<locale>.pak` が存在しないロケールは要求が棄却されフォールバックする。`en-US.pak` は常時同梱だが `ja.pak` は slim な Docker イメージで欠落しうる。
- MV3 / CSP により翻訳リソースは静的 import でバンドルへ含める。動的ロード系のバックエンドは使用しない。
- `tech.md` の方針を維持する。React は表示 adapter に限定し、`chrome.storage.local` の 10MB 上限と容量監視の前提を崩さない。言語設定は極小のデータだが、保存経路の所有者を明確にすること。
- TypeScript strict、`any` 禁止。ja / en のカタログが**同一のキー集合を持つことを型で保証する**こと。キーの取りこぼしがコンパイルエラーになる設計が望ましい。
- 検証は既存の `pnpm validate` フローに乗せる。E2E での英語UI検証はブラウザ再起動やロケール環境変数を必要としない方法で行うこと。
