# Implementation Plan

> **順序の意図**: スタイルと E2E ロケータの文言非依存化（タスク群1）を、カタログへの文言移送（タスク群3以降）より**先**に行う。逆順にすると同じテストを二度修正することになる。
>
> **転記の検証装置**: タスク群3・4では、テスト側の文言リテラルを**無改変のまま残す**。既存テストが緑であることが「表示文言が1文字も変わっていない」ことの証拠になる。期待値のカタログ化はタスク群5でのみ行う。

- [ ] 1. 文言非依存の要素識別基盤とロケータ移行

- [x] 1.1 (P) 候補管理の要素識別属性の付与とスタイル移行
  - `src/features/candidate-management/view.tsx` の該当要素へ `data-region` を付与する（`projects` / `project-form` / `candidate-list` / `candidate-form`）
  - `src/features/candidate-management/styles.css` の日本語 `aria-label` 属性セレクタ6箇所を `data-region` セレクタへ置き換える。ルートクラスとの結合を維持し詳細度を落とさない
  - 既存の `aria-label`・クラス名・DOM 構造は一切変更しない。属性は追加のみ
  - 完了条件: `styles.css` に日本語が1文字も残らず、候補管理の既存 DOM テストと E2E が無改変で成功する
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Boundary: ElementIdentityConvention_

- [x] 1.2 (P) 現在構成の要素識別属性の付与とスタイル移行
  - `src/features/current-build/view.tsx` の候補一覧へ `data-region="candidate-list"` を付与する
  - `src/features/current-build/styles.css` の日本語属性セレクタ4箇所を置き換える
  - 完了条件: `styles.css` に日本語が1文字も残らず、現在構成の既存 DOM テストと E2E が無改変で成功する
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Boundary: ElementIdentityConvention_

- [x] 1.3 E2E ロケータヘルパの新設と src 参照経路の実測
  - `e2e/locators.ts` を新設し、`region` / `action` / `navItem` の要素特定ヘルパを定義する
  - Playwright のトランスフォームが `src/` の TypeScript を NodeNext 流の `.js` 指定子で解決できるかを、最小の import 1件で実測する。解決できない場合はその事実を本ファイルのコメントへ記録し、タスク5.2の方針をロケータのみの移行へ後退させる
  - 完了条件: 既存 E2E を1本もその場では書き換えないまま、`e2e/locators.ts` を import した状態で Playwright が起動し全 spec が成功する
  - _Requirements: 9.5_
  - _Boundary: E2ELocatorHelpers_

- [x] 1.4 (P) 候補管理・現在構成の E2E ロケータ移行
  - `e2e/candidate-management.spec.ts` と `e2e/current-build.spec.ts` の文言ベースのロケータを、`e2e/locators.ts` 経由の識別子ベースへ置き換える
  - ナビゲーションの機能切替は機能 ID による特定へ移す
  - 「特定の文言が表示されること」を検証している `expect` は**この時点では文言リテラルのまま残す**
  - 完了条件: 両 spec の要素特定から日本語が消え、`pnpm test:e2e` が成功する
  - _Requirements: 9.1, 9.4, 9.5_
  - _Boundary: E2ELocatorHelpers_
  - _Depends: 1.1, 1.2, 1.3_

- [x] 1.5 (P) 商品取り込み・バックアップ復元の E2E ロケータ移行
  - `e2e/product-capture.spec.ts` と `e2e/backup-restore.spec.ts` に同じ移行を適用する
  - 対象要素に識別属性が無い場合は view へ `data-region` / `data-action` を追加する。`aria-label` は変更しない
  - 「特定の文言が表示されること」を検証している `expect` は文言リテラルのまま残す
  - 完了条件: 両 spec の要素特定から日本語が消え、`pnpm test:e2e` が成功する
  - _Requirements: 9.1, 9.4, 9.5, 8.2, 8.3_
  - _Boundary: E2ELocatorHelpers, ElementIdentityConvention_
  - _Depends: 1.3_

- [x] 1.6 単体・統合テストの要素特定の識別子移行
  - `tests/features/**` と `tests/application-shell/**` のうち、表示文言で要素を特定しているアサーションを `data-*` による `querySelector` または役割ベースの特定へ移す
  - 期待値そのものが文言であるアサーション（`textContent` への正規表現マッチなど）は**変更しない**
  - 検証している振る舞いの集合を増減させない
  - 完了条件: 要素特定に文言を使っているテストが残っておらず、`pnpm test` が全件成功する
  - _Requirements: 9.2, 9.4_
  - _Boundary: E2ELocatorHelpers_

- [ ] 2. UIメッセージカタログ基盤

- [ ] 2.1 メッセージ契約と型基盤の定義
  - `src/ui-messages/contracts.ts` に `MessageDefinition` / `PluralDefinition` / `MessageParams` / `MessageNamespace` / `MessageDescriptor` を定義する
  - 定数オブジェクトからドット区切りキー union を導出する `MessageKeyOf`、キーから定義を引く `DefinitionAt`、プレースホルダ名を抽出する `PlaceholderNames` を定義する
  - 型は言語に依存しない形にする。言語ごとの値集合が後から追加できることを型で担保する
  - 完了条件: 型のみのモジュールとして `pnpm typecheck` が通り、`ui-messages` 以外へ一切依存していない
  - _Requirements: 1.1, 1.2, 1.3, 4.5, 10.1, 10.4_
  - _Boundary: MessageContracts_

- [ ] 2.2 (P) メッセージフォーマッタの実装
  - `src/ui-messages/format.ts` に `formatMessage` を実装する。`{name}` の置換、`PluralDefinition` の `count` によるフォーム選択、`one` / `zero` 未定義時の `other` への後退を行う
  - 未対応のプレースホルダは置換せずそのまま残し、例外を投げない
  - 返り値は常に `string` とし、マークアップを生成しない
  - 単体テストで、置換・複数形分岐・未解決プレースホルダ・副作用なしを固定する
  - 完了条件: `tests/ui-messages/format.test.ts` が全件成功する
  - _Requirements: 1.4, 1.6, 4.5_
  - _Boundary: MessageFormatter_
  - _Depends: 2.1_

- [ ] 2.3 共有名前空間のカタログ投入と重複文言の統合
  - `src/ui-messages/catalog/` を新設する。**この時点で10個の名前空間ファイルを全て作成し、`catalog/index.ts` の集約を確定させる**。機能名前空間（`candidate` / `build` / `compatibility` / `capture` / `backup`）は空の定数として置き、以降のタスクが自分のファイルだけを編集できる状態にする
  - `common` / `category` / `persistenceError` / `nav` / `shell` の各名前空間へ現行の文言をそのまま転記する
  - カテゴリ表示名12件を、3つの view に重複していた表から単一定義へ統合する。`PartCategory` を網羅する型として定義し、増減が型検査で失敗するようにする
  - 起動失敗文言を、`composition-root.ts` と `application-composition.ts` の2箇所から単一キーへ統合する
  - 永続化エラーは**文字列として完全一致するものだけを共有キーへ統合**する。`storage` / `notFound` / `unsupportedData` / `corruptData` は feature ごとに文面が異なるため個別キーとして保持する
  - 文面の改善・誤字修正・表記ゆれの統一を一切行わない
  - 統合前後の `code → 文言` 対応表が1件ずつ一致することを単体テストで固定する
  - 完了条件: カテゴリ網羅性テストと永続化エラー対応表テストが成功し、カタログが静的 import だけで解決される
  - _Requirements: 1.1, 1.5, 2.5, 5.1, 5.2, 5.3, 5.4, 5.5, 10.5_
  - _Boundary: MessageCatalog_
  - _Depends: 2.1_

- [ ] 2.4 リゾルバ・記述子ファクトリ・公開入口の実装
  - `src/ui-messages/resolver.ts` に `createMessageResolver` と `message` を実装する。キーとパラメータの過不足がコンパイルエラーになることを型で保証する
  - `resolveDescriptor` は未知キーに対してキー文字列を返し、画面を落とさない
  - `src/ui-messages/public.ts` を唯一の公開入口として整備し、`defaultMessageResolver` を含む公開面を確定する。カタログ定数そのものは公開しない
  - 存在しないキーの参照とパラメータの過不足がコンパイルエラーになることを、型検査で失敗する最小例を用いて確認する
  - 完了条件: 単体テストが成功し、`pnpm typecheck` と `pnpm validate:boundaries` が通る
  - _Requirements: 1.2, 1.3, 9.3, 10.2, 10.3_
  - _Boundary: MessageResolver, UiMessagesPublicEntry_
  - _Depends: 2.2, 2.3_

- [ ] 2.5 React Context による供給経路の実装
  - `src/ui-messages/react.tsx` に `MessageProvider` と `useMessages` を実装する。既定値は同梱カタログに対する resolver とする
  - Context の値は resolver そのものとし、言語コードやカタログを露出しない
  - `tests/setup-dom.ts` 系のテストハーネスから Provider 付きで `render` できるヘルパを整える
  - Provider の有無で表示が変わらないことを DOM テストで固定する
  - 完了条件: `tests/ui-messages/react.test.tsx` が成功し、後続タスクが `useMessages()` を使える状態になる
  - _Requirements: 3.5, 10.3_
  - _Boundary: MessageReactContext_
  - _Depends: 2.4_

- [ ] 3. 機能ごとのカタログ値投入と view 移行

- [ ] 3.1 (P) 現在構成のカタログ値投入と view 移行
  - `build` 名前空間へ現在構成の文言を転記し、`src/features/current-build/view.tsx` の文言リテラルを `useMessages()` 経由へ置き換える
  - `categoryLabels` と `errorMessages` は共有名前空間のキーへの写像に置き換える。写像は文言を持たない
  - `current-build/registration.ts` の `mountBuildView` で `MessageProvider` を張る
  - 完了条件: `src/features/current-build/view.tsx` に日本語が1文字も残らず、**現在構成の既存テストを無改変のまま** `pnpm test` と `pnpm test:e2e` が成功する
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.1, 3.2, 3.5, 4.2_
  - _Boundary: FeatureViewAdapters_
  - _Depends: 2.5_

- [ ] 3.2 (P) 互換性確認のカタログ値投入と view 移行
  - `compatibility` 名前空間へ文言を転記し、`RULE_LABELS` / `REASON_LABELS` / `AGGREGATE_LABELS` / `EMPTY_MESSAGES` / `FAILURE_MESSAGES` をキーへの写像に置き換える
  - 助詞連結を文単位メッセージへ再設計する。「{側ラベル}が選択されていません。」「{側ラベル}の値が未確認です。」を条件ごとの独立キーとし、側ラベルをパラメータで受ける
  - 「{側ラベル}（未選択）」のテンプレート合成を1つの完結した文へ置き換える
  - 読点による列挙結合の区切り文字を `common` 名前空間のキーへ移す
  - `react-root.tsx` で `MessageProvider` を張る
  - 完了条件: `src/features/compatibility/view.tsx` に日本語が1文字も残らず、**互換性確認の既存テストを無改変のまま** `pnpm test` が成功する
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.1, 3.2, 3.5, 4.1, 4.2, 4.3, 4.4_
  - _Boundary: FeatureViewAdapters_
  - _Depends: 2.5_

- [ ] 3.3 (P) バックアップ復元のカタログ値投入と view 移行
  - `backup` 名前空間へ文言を転記し、診断メッセージ表をキーへの写像に置き換える
  - 「復元が完了しました（プロジェクト{n}件、候補{n}件、現在構成{n}件）。」を、3つの件数をパラメータで受ける1つの完結した文にする。日本語の値は単純文字列形式のまま置き、複数形フォームは作らない
  - 「{基本文}（位置: {path}）」の合成を、位置情報を伴う場合の独立キーへ置き換える
  - `react-root.tsx` で `MessageProvider` を張る
  - 完了条件: `src/features/backup-restore/view.tsx` に日本語が1文字も残らず、**バックアップ復元の既存テストを無改変のまま** `pnpm test` と `pnpm test:e2e` が成功する
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.1, 3.2, 3.5, 4.1, 4.2, 4.3, 4.5_
  - _Boundary: FeatureViewAdapters_
  - _Depends: 2.5_

- [ ] 3.4 (P) 候補管理のカタログ値投入
  - `candidate` 名前空間へ、候補管理の全文言（フォームラベル、属性ラベル、フィールドエラー、削除確認、一覧項目、編集フォーム）を現行のまま転記する
  - `${name}を編集` / `${name}を削除` / `${field}（自由入力）` を、名前・項目名をパラメータで受ける独立キーへ再設計する
  - 削除確認の JSX 子要素列による組み立てを、種別ごとの独立キーへ再設計する
  - 完了条件: 候補管理に必要な全キーが定義され、`pnpm typecheck` が通る
  - _Requirements: 2.5, 4.1, 4.4, 10.1_
  - _Boundary: MessageCatalog_
  - _Depends: 2.5_

- [ ] 3.5 候補管理の view 移行
  - `src/features/candidate-management/view.tsx` の全文言リテラルを `useMessages()` 経由へ置き換える
  - `categoryLabels` / `errorMessages` / `fieldErrorMessages` をキーへの写像に置き換える
  - `aria-label` / `placeholder` の値も resolver 経由にする。`aria-label` の文字列は変更しない
  - 文字列連結・テンプレート合成による文言組み立てを残さない
  - `react-root.tsx` で `MessageProvider` を張る
  - 完了条件: 当該ファイルに日本語が1文字も残らず、**候補管理の既存テストを無改変のまま** `pnpm test` と `pnpm test:e2e` が成功する
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.5, 4.2, 4.3_
  - _Boundary: FeatureViewAdapters_
  - _Depends: 3.4_

- [ ] 3.6 (P) 商品取り込みのカタログ値投入
  - `capture` 名前空間へ、取り込みの全文言（フィールドラベル、取得元種別ラベル、カテゴリ推定ラベル、失敗文言表、各フェーズ画面の文言）を現行のまま転記する
  - `推定: {label}（詳細編集の初期選択になります）` と `候補を保存しました（保存先: {projectName}）。` を、パラメータを受ける独立キーへ再設計する。推定不能時・保存先不明時はそれぞれ別キーとする
  - カテゴリ表示名は共有 `category` 名前空間を使い、重複定義を作らない
  - 完了条件: 商品取り込みに必要な全キーが定義され、`pnpm typecheck` が通る
  - _Requirements: 2.5, 4.1, 4.4, 5.1, 10.1_
  - _Boundary: MessageCatalog_
  - _Depends: 2.5_

- [ ] 3.7 商品取り込みの view 移行
  - `src/features/product-capture/view.tsx` の全文言リテラルを `useMessages()` 経由へ置き換える
  - 各フェーズ画面（取り込み前・取り込み中・確認・保存中・完了・失敗・手入力案内）の文言と `aria-label` を resolver 経由にする
  - 外部由来の商品名を含む描画が通常の JSX child のままであり、マークアップとして解釈されないことを回帰テストで固定する
  - `react-root.tsx` で `MessageProvider` を張る
  - 完了条件: 当該ファイルに日本語が1文字も残らず、**商品取り込みの既存テストを無改変のまま** `pnpm test` と `pnpm test:e2e` が成功する
  - _Requirements: 1.6, 2.1, 2.2, 2.3, 3.1, 3.2, 3.5, 4.2, 4.3_
  - _Boundary: FeatureViewAdapters_
  - _Depends: 3.6_

- [ ] 4. アプリケーションシェルの契約変更と移行

- [ ] 4.1 シェル表示経路のメッセージ記述子化
  - `src/application-shell/contracts.ts` の `ShellViewState` / `ShellMaintenanceState` / `StartupError` / `SelectionError` / `CompositionError` の `message` を `MessageDescriptor` へ変更する
  - `src/application-shell/shell-view.tsx` が `useMessages()` で記述子を解決し、状態表示（読み込み中・エラー・保守中・機能なし）と再試行ラベル・機能表示失敗の文言をカタログ参照へ移す
  - `src/application-shell/react-shell-root.tsx` でシェルの React root に `MessageProvider` を張る
  - `FeatureActivationError.detail` と `reportError` は描画経路を持たないため変更しない
  - 完了条件: `shell-view.tsx` に日本語が1文字も残らず、**シェルの既存 DOM テストを無改変のまま** `pnpm test` が成功する
  - _Requirements: 2.1, 2.2, 3.3, 6.1, 6.2_
  - _Boundary: ShellMessageContracts, ShellViewAdapter_
  - _Depends: 2.5_

- [ ] 4.2 シェルロジック層の記述子化と診断コード化
  - `side-panel-host.ts` の表示経路を `message(...)` による記述子構築へ置き換える
  - 同ファイルの診断経路（`reportDiagnostic`）を安定した英字コードへ置き換え、日本語文言と機微値を出さない
  - `maintenance-projection.ts` の保守メッセージ、`application-shell-integration.ts` の起動失敗メッセージ、`composition-root.ts` / `application-composition.ts` の起動失敗メッセージを記述子化し、統合済みの単一キーを参照する
  - 機能が申告した利用不可理由の自由文字列は、翻訳対象ではなく記述子のパラメータとして扱う
  - `tests/application-shell/side-panel-host.test.ts` の診断文字列アサーションを書き換える前に、表示を検証しているつもりのアサーションが混ざっていないことを1件ずつ確認する
  - 完了条件: `src/application-shell/` の `.ts` ファイルに表示文言としての日本語が1文字も残らず、記述子を解決した結果が現行と同一の文言になることを DOM テストが示す
  - _Requirements: 2.1, 2.3, 5.3, 6.1, 6.3, 6.4, 6.5_
  - _Boundary: ShellMessageEmitters_
  - _Depends: 4.1_

- [ ] 4.3 ナビゲーションラベルのキー申告への一括移行
  - `ApplicationFeatureRegistration.navigation.label` を `labelKey: MessageKey` へ変更し、`ShellNavigationItem` も同様に変更する
  - 5つの feature の `registration.ts` を同時に `nav` 名前空間のキー申告へ移す。`order` と `icon` は変更しない
  - `feature-registry.ts` の `navigation` 検証を `labelKey` に合わせる
  - `shell-view.tsx` が表示直前にキーを解決し、ラベル・順序・アクセシブル名を現行と同一に保つ
  - 未定義キーの申告が型検査で失敗することを、失敗する最小例で確認する
  - 部分適用状態を作らず、契約と全登録を一括で切り替える
  - 完了条件: `src/features/*/registration.ts` に日本語が1文字も残らず、`tests/contracts/application-shell-contract-kit.test.ts` を含む全テストと E2E が成功する
  - _Requirements: 2.1, 2.2, 7.1, 7.2, 7.3, 7.4_
  - _Boundary: ShellMessageContracts, FeatureNavigationRegistrations_
  - _Depends: 4.1_

- [ ] 5. 期待値のカタログ化・機械検査・最終検証

- [ ] 5.1 単体・統合テストの文言期待値のカタログ化
  - 「特定の文言が表示されること」を検証しているアサーションの期待値を、公開入口の既定 resolver から解決した値へ置き換える
  - fixture の架空商品名、`test()` / `describe()` のテスト名、`category-hint.ts` のキーワードは対象外とする
  - 検証している振る舞いの集合を増減させない
  - 完了条件: `tests/` に表示文言の期待値としての日本語リテラルが残っておらず、`pnpm test` が全件成功する
  - _Requirements: 9.2, 9.3, 9.4_
  - _Boundary: E2ELocatorHelpers_
  - _Depends: 4.2, 4.3_

- [ ] 5.2 E2E の文言期待値のカタログ化
  - 4つの E2E spec に残っている文言リテラルの期待値を、`e2e/locators.ts` が再輸出する resolver から解決した値へ置き換える
  - タスク1.3で `src/` の import が解決できないと判明していた場合は、ロケータの識別子化のみを完了とし、文言期待値がリテラルのまま残る理由を `e2e/locators.ts` のコメントへ記録する
  - 完了条件: `pnpm test:e2e` が成功し、E2E に残る日本語が上記の記録済み例外のみになる
  - _Requirements: 9.1, 9.3, 9.4_
  - _Boundary: E2ELocatorHelpers_
  - _Depends: 5.1_

- [ ] 5.3 文言リテラル再混入の機械検査の追加
  - `scripts/validate-ui-text.mjs` を新設する。既存の `validate-boundaries.mjs` と同じ TypeScript scanner ベースのトークン走査方式を用いる
  - 検査規則: view / registration / react-root / application-shell の文字列・テンプレートリテラルに自然言語が含まれること、スタイルシートの属性セレクタ値に自然言語が含まれること、view がカタログ定数を直接 import していること
  - 除外対象（`src/ui-messages/catalog/`、`src/features/product-capture/category-hint.ts`、`src/domain/`、`src/persistence/`、`tests/`）を明示し、除外理由をスクリプト内へ記録する
  - `package.json` に `validate:ui-text` を追加し、`validate:ci` の `pnpm test` の前段へ組み込む
  - 完了条件: 意図的に日本語リテラルを1件戻すとスクリプトが非ゼロ終了し、戻す前の状態では違反ゼロで通る
  - _Requirements: 2.4, 3.4, 8.5_
  - _Boundary: UiTextGuard_
  - _Depends: 5.2_

- [ ] 5.4 振る舞い不変性の最終検証
  - `pnpm validate` の全段（型検査、公開consumer型検査、静的検査、公開境界検査、fixture検査、文言検査、最終ビルドゲート、単体・統合テスト、Playwright E2E）を実行する
  - 生成物に対する `pnpm validate:artifacts` を実行し、カタログの静的同梱と CSP 非弱化を確認する
  - 移行前後で `pnpm typecheck` の所要時間に顕著な悪化がないことを確認し、悪化していれば型レベルのパラメータ導出を明示的な型注釈へ後退させる
  - 全画面を実際に表示し、表示文言・DOM 構造・視覚表現が移行前と一致することを確認する
  - 完了条件: `pnpm validate` が全段成功し、表示上の差分がゼロであることが確認できている
  - _Requirements: 1.5, 2.1, 2.2, 2.3, 2.4, 8.4, 10.5_
  - _Depends: 5.3_

## Implementation Notes

- タスク1.3: `src/application-shell/shell-view.tsx` のナビゲーションボタンは現状 `data-feature-id` などの安定識別子を持たない（`data-feature-id` は選択中機能を表す `.shell-feature` セクション側にのみ存在し、ナビゲーションボタン自体には無い）。`e2e/locators.ts` の `navItem` は `.shell-navigation [data-feature-id="..."]` を前提に実装済みのため、タスク1.4でナビゲーションボタンへ `data-feature-id={item.id}` を追加する必要がある。
