# Brief: ui-message-catalog

## Problem

UI 文言が各 view コンポーネントへ直接埋め込まれており、文言が「表示以外の役割」まで担ってしまっている。具体的には次の3つの不正な結合が生じている。

1. **スタイルが文言に依存している。** `src/features/candidate-management/styles.css:83` の `form[aria-label="プロジェクト編集"]` のように、CSS が日本語の `aria-label` を属性セレクタで参照している箇所が約10箇所ある。文言を変えるとスタイルが黙って壊れる。
2. **テストが文言に依存している。** E2E は `getByRole("button", { name: "現在構成" })` 形式のロケータに全面依存しており、4 spec で約99箇所。単体・統合テストのアサーションにも約150〜200箇所が埋まっている。
3. **同じ文言が複数箇所で重複定義されている。** カテゴリ表示名の表が `candidate-management/view.tsx:18-28` と `current-build/view.tsx:13-23` に二重定義され、永続化エラーコードの文言表は3つの view に重複している。片方だけ直す事故が起こりうる。

加えて、日本語の助詞前提で文字列を組み立てている箇所（`名前 + "が選択されていません。"`、`` `${name}を編集` `` 等）があり、これは文構造として翻訳が原理的に不可能である。

これらは i18n 以前の問題として単独で解決する価値があり、かつ i18n を実施する上での前提条件でもある。

## Current State

- `src/` 全体で日本語文言は約300箇所（コメントを除く）。うち JSX テキストノード約150件、`aria-label`/`placeholder` 属性約47件。
- **ドメイン層は既にクリーン。** `src/domain/` の日本語は全て JSDoc であり、`src/features/compatibility/rules.ts` は `reasonCode: "value-not-equal" | "input-missing"` という列挙コードで判定結果を返している。設計として既に「メッセージID + 文言解決」の分離ができている。
- **例外は `application-shell`。** `side-panel-host.ts` に実行時エラー文字列をテンプレートリテラルで生成する箇所が約13件（`` `feature ${id} は利用できません: ${availability.reason}` `` 等）あり、ロジック層に文言が埋まっている。`composition-root.ts` / `application-composition.ts` / `application-shell-integration.ts` / `maintenance-projection.ts` にも合計5件。
- `application-composition.ts` と `composition-root.ts` で `"アプリケーションを開始できませんでした"` が重複定義されている。
- 各 feature の `registration.ts` がナビゲーションラベルを文字列で保持している（5件）。
- `_locales/` は存在せず、`chrome.i18n` の利用箇所もゼロ。`side-panel.html` は `<html lang="ja">` 固定。

## Desired Outcome

- UI に表示される全ての文言が単一のカタログから解決され、view コンポーネントに日本語リテラルが残っていない。
- **表示される文言は現状と1文字も変わらない。** この spec は振る舞い不変のリファクタであり、UI の見た目・文言・操作結果に差分が出ないことが完了条件である。
- `styles.css` が日本語文言を参照していない。スタイルは `data-*` 属性など文言に依存しない識別子で要素を選択する。
- E2E および単体・統合テストが、文言を変更しても壊れないロケータ／アサーション基盤に載っている。
- 助詞連結によって組み立てられていた文言が、文単位の独立したメッセージへ再設計されている。
- 重複していた文言テーブル（カテゴリ名、永続化エラー、起動エラー）が単一定義に統合されている。
- ロジック層（`application-shell` 配下）が文言そのものではなくメッセージIDとパラメータを扱っている。

## Approach

文言カタログを新設し、**キー体系と参照方法を i18n 導入後と同一の形にした上で、値には現行の日本語をそのまま入れる**。これにより後続の `ui-internationalization` は「カタログの値を差し替え、言語解決を追加する」だけで済み、参照箇所を再度触る必要がなくなる。

作業の順序は、テストが壊れる回数を最小化するよう組む。先に `styles.css` の属性セレクタと E2E ロケータを文言非依存へ移行し、その後に文言をカタログへ移す。逆順だと同じテストを二度修正することになる。

助詞連結の箇所は機械的な置換ができない。文全体を1つのメッセージとして再設計する（例: 「〇〇が選択されていません。」を、部品名をパラメータとして受け取る1つの完結した文にする）。この判断はこの spec が所有する。

## Scope

- **In**:
  - 文言カタログの新設（キー体系、型付け、参照ヘルパ）
  - view 層の日本語リテラルのカタログへの移行
  - `application-shell` 配下のロジック層 約18件のメッセージID + パラメータ化
  - `styles.css` の日本語属性セレクタの `data-*` への置換（約10箇所）
  - E2E ロケータの文言非依存化（約99箇所、4 spec）
  - 単体・統合テストのアサーションの追随（約150〜200箇所）
  - 重複文言テーブルの統合（カテゴリ名×2、永続化エラー×3、起動エラー×2）
  - 助詞連結・動的合成箇所の文単位メッセージへの再設計
  - 各 feature の `registration.ts` のナビゲーションラベルのカタログ化
- **Out**:
  - 言語の追加、翻訳、言語切り替え（`ui-internationalization` が所有）
  - `_locales/` および `chrome.i18n` の導入（同上）
  - `manifest.json` の `name` / `description` の国際化（同上）
  - **表示文言の文面そのものの改善**。誤字修正や言い回しの改善は行わない。助詞連結箇所の再設計は文構造の変更であって文面の改善ではなく、これは In に含む
  - `category-hint.ts` のキーワード辞書。これは UI 文言ではなく日本語ECサイト向けのマッチングデータであり、カタログの対象外
  - `normalizer.ts` の `円` パーサ。ロケール別のパースロジックであり文言ではない
  - テストフィクスチャ内の日本語データ値（商品名等）。表示文言ではない

## Boundary Candidates

- **カタログそのもの**（キー定義、値、型、参照ヘルパ）と、**カタログの利用側**（各 view、shell）
- **文言非依存のロケータ基盤**（`data-*` 属性の付与規約、E2E ヘルパ）と、**それを使うテスト**
- **表示層の文言解決**（view）と、**ロジック層のメッセージID生成**（`application-shell`）。後者はパラメータ付きの構造化されたエラー表現を返し、文言化しない
- **文単位で完結するメッセージ**と、**パラメータを受け取るテンプレート**。助詞連結を排除する境界

## Out of Boundary

- 言語の追加および翻訳データ。この spec の完了時点でカタログは日本語1言語のみを持つ
- 言語切り替えUI、言語の永続化、ブラウザ言語からの初期値決定
- ロケール別の日付・数値・通貨フォーマット
- ドメイン層および `compatibility/rules.ts` への変更。既に文言を持たないため対象外
- 表示文言の文面改善、UI の再デザイン、アクセシビリティ要件の拡張

## Upstream / Downstream

- **Upstream**:
  - `application-shell` — UI composition と `FeatureMountContext` の境界。カタログの供給経路がこの境界を越えないようにする
  - `local-data-foundation` — `Result<T, E>` の canonical 定義。エラーのメッセージID化で再定義しないこと
  - 各 feature spec（`product-page-capture`、`project-candidate-management`、`current-build-management`、`compatibility-checking`、`backup-restore`）— 表示文言の現行仕様の出所
- **Downstream**:
  - `ui-internationalization` — 本 spec のカタログを直接の前提とする。キー体系が確定していることが着手条件

## Existing Spec Touchpoints

- **Extends**: なし。既存 spec の要件を変更しない（振る舞い不変のため）
- **Adjacent**:
  - `application-shell` — ロジック層のメッセージID化とナビゲーションラベルのカタログ化で shell のコードに触れるが、shell が所有する mount/unmount lifecycle と UI composition の責務境界は変更しない
  - 全 feature spec — view のコードに広く触れるが、各 feature の機能要件・受け入れ条件は変更しない。テストの**アサーション対象**は変わらず、**アサーションの書き方**だけが変わる

## Constraints

- **振る舞い不変が最優先の制約。** 表示文言・UI 構造・操作結果に差分を出さない。`aria-label` の値を変える場合はアクセシビリティ上の等価性を保つこと（`data-*` はスタイルとテストのための追加であって、`aria-label` の置き換えではない）
- **カタログのキー体系は `ui-internationalization` の要件を先取りして設計する。** 後から全参照箇所を触り直す事態を避ける。具体的には、値の型が文字列であること、パラメータがプレースホルダで表現されること、キーが機能単位で名前空間化されていることを満たす
- **`chrome.i18n` の制約を先取りしない設計にすること。** 最終的な実装は自前カタログ方式（`chrome.i18n` はアプリ内文言に使わない）であるため、プレースホルダ数の上限9個や複数形非サポートといった `chrome.i18n` 固有の制限をカタログ設計へ持ち込む必要はない。ただし複数形については、日本語が複数形を持たないため現時点で顕在化せず、英語対応時に問題化する。カタログ設計時点で複数形を表現できる余地を残すか、少なくとも塞がないこと
- `tech.md` の方針を維持する。React は表示 adapter に限定し、文言解決も表示層の関心として閉じる。ドメイン state や port を component へ埋め込まない
- TypeScript strict、`any` 禁止。カタログのキーは型で保護し、存在しないキーの参照がコンパイルエラーになること
- MV3 / CSP 制約により、カタログは静的にバンドルへ含める
- 検証は既存の `pnpm validate` フロー（型検査・build・test・E2E）に乗せる
