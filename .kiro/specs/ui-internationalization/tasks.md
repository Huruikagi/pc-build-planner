# Implementation Plan

> **順序の意図**: `ui-message-catalog`の公開型付き契約を消費する基盤（タスク群1）と言語ランタイム（タスク群2）を先に確定させる。英語表示の受入検証（タスク群4）は機能面単位で並行実行できるが、公開resolverの選択経路が無いとja/enの追随を確認できないため後段へ置く。
>
> **振る舞い不変の証拠**: 日本語表示は本 spec の前後で1文字も変わらない。既存の DOM テスト・E2E を無改変で通し続けることがその証拠になる。ロケール固有データの隔離（タスク群7）も同様に、`product-capture` の既存テストを無改変で通すことを完了条件とする。

- [x] 1. 公開カタログ契約の消費と型による整合保証

- [x] 1.1 11名前空間の公開型付き契約を受け入れる
  - `settings`を含む11名前空間のja/en resolverを`src/ui-messages/public.ts`だけから取得し、カタログ内部、localeファイル、parity実装を直接参照しない
  - 公開consumer型検査で`MessageKey`、`MessageResolver`、`MessageProvider`、`useMessages`の接合を固定し、上流契約の不整合を型検査で検出する
  - 完了条件: ja/en双方で11名前空間の代表keyを解決でき、catalog deep importが境界検査で拒否される
  - _Requirements: 4.1, 4.2, 9.1, 9.2, 9.5_
  - _Boundary: UiMessagesPublicContract, LanguageCatalogConsumer_

- [x] 1.2 言語別resolver選択のconsumer型基盤を実装する
  - 対応言語から公開`MessageResolver`を選ぶ契約を定義し、キー集合・placeholder・数量定義のparityをconsumer側で複製しない
  - 上流公開契約を不整合にした最小consumer例が型検査で失敗することを確認する
  - 完了条件: 公開型以外を参照せず、選択言語ごとに同じ`MessageResolver`契約をProviderへ供給できる
  - _Requirements: 4.1, 9.2_
  - _Boundary: LanguageCatalogConsumer_
  - _Depends: 1.1_

- [x] 1.3 対応言語レジストリと公開面の確定
  - 対応言語の集合、その型、ソース言語、フォールバック言語、各言語の原語表記を単一の定義として持つモジュールを新設する
  - 言語ごとの解決器を1つずつ生成して同一参照で返す関数を用意し、既定の解決器がソース言語の解決器と一致することを保つ
  - ui-languageの公開入口へ、対応言語の型・集合・原語表記・言語別resolverの取得を追加する。ui-message-catalogの供給経路と記述子の形は変更しない
  - 原語表記を含むモジュールを文言リテラル検査の除外へ加える
  - 完了条件: 対応言語を1つ増やして原語表記を書かないと型検査が失敗し、既存の全テストが無改変で成功する
  - _Requirements: 1.6, 4.1, 4.3, 9.1, 9.3, 9.5_
  - _Boundary: LanguageRegistry_
  - _Depends: 1.2_

- [x] 2. 言語ランタイムの基盤

- [x] 2.1 (P) 言語タグ正規化と初期値決定の純関数
  - 地域サブタグ付き・区切り文字違い・大文字小文字違いの言語タグを対応言語へ正規化し、対応付けられない値は未解決として返す関数を実装する
  - 保存値・ブラウザ表示言語・フォールバック言語の優先順で初期値を決める関数を実装する。ブラウザ API を直接呼ばず、値を入力として受け取る
  - 想定入力の一覧（地域付き、未対応言語、空文字、未定義、非文字列）と期待値を表として単体テストで固定する
  - 完了条件: 実ブラウザを起動しない単体テストだけで初期値決定の全分岐が検証されている
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 8.3, 9.3_
  - _Boundary: LanguageResolution_
  - _Depends: 1.3_

- [x] 2.2 (P) 表示言語の永続化ポート
  - 表示言語専用のキー1つだけを読み書きする保存ポートを実装する。キー名は定数として内部に持ち、引数で受け取らない
  - 読み取り値は未検証の値として受け、正規化を通してからのみ内部型へ変換する。解釈できない値は保存値なしと同じ結果へ落とす
  - 読み書きの失敗を判別可能な結果型で返し、例外を漏らさない。失敗コードは安定した英字コードのみとし、保存値をログへ出さない
  - テストと非 Chrome 実行環境のためのメモリ実装を用意する
  - 完了条件: 壊れた保存値・書き込み失敗・保存 API 不在の各ケースで例外が漏れず、保存ルートおよび容量監視に一切触れていない
  - _Requirements: 1.4, 2.5, 3.1, 3.2, 3.4, 3.6_
  - _Boundary: LanguagePreferenceStore_
  - _Depends: 1.3_

- [x] 2.3 言語ストアと初期化経路
  - 現在の表示言語を保持し、購読者へ同期通知する React 外の単一ストアを実装する。初期化前のシードはソース言語とし、その理由をモジュール内へ明記する
  - 初期化はブラウザ表示言語で即座に確定させたうえで保存値があれば置き換え、解決の完了を待てる形にする。二度目以降の初期化は明示的な選択を上書きしない
  - 言語の設定は同期的に通知し、保存は非同期に追随させる。保存が失敗しても値を巻き戻さない。同値設定では通知も保存も行わない
  - テスト間で状態が漏れないよう、初期状態へ戻す手段を用意する
  - 完了条件: 同値無通知・保存失敗時の非巻き戻し・初期化の冪等性・購読解除後の非通知が単体テストで固定されている
  - _Requirements: 1.2, 2.1, 2.6, 3.1, 3.5_
  - _Boundary: LanguageStore_
  - _Depends: 2.1, 2.2_

- [x] 3. 表示層への結合と切り替え操作面

- [x] 3.1 言語対応の供給コンポーネントとフック
  - 言語ストアを購読し、現在の言語に対応する解決器を既存の供給経路へ渡すコンポーネントを実装する。既存の供給経路と参照フックのシグネチャは変更しない
  - 現在の言語・選択可能な言語の一覧・切り替え関数を返すフックを実装する。カタログそのものを露出しない
  - DOM テストのハーネスの供給点を新しいコンポーネントへ置き換え、各テストの後始末で言語ストアを初期状態へ戻す
  - 完了条件: 同一ツリー内で言語を切り替えると表示文言が切り替わり、切り替えによって React ルートが再生成されず入力途中の値が保持されることが DOM テストで確認できている
  - _Requirements: 1.2, 1.3, 9.1_
  - _Boundary: LanguageReactBinding_
  - _Depends: 2.3_

- [x] 3.2 (P) 文書の言語属性の同期
  - 現在の表示言語を文書の言語属性へ設定し、以後の変更へ追随する購読を開始する仕組みを実装する。購読解除の手段を返す
  - サイドパネル文書から固定の言語属性を取り除き、静的な既定言語という事実を残さない
  - 文書の言語属性がハードコードされていないことを、既存の文書構造検査テストへ追加する
  - 完了条件: 初期設定と切り替え追随の双方で文書の言語属性が更新されることが DOM テストで確認でき、文書側に固定値が残っていない
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: DocumentLanguageSync_
  - _Depends: 2.3_

- [x] 3.3 言語切り替えコントロール
  - 選択可能な言語の一覧から選択肢を導出し、各言語の原語表記で表示するコントロールを実装する。言語一覧をコントロール内に持たない
  - 現在選択されている言語が判別できる状態を持たせ、選択でストアの切り替えを発火させる。コントロール自身は状態を持たない
  - コントロールのアクセシブル名はカタログ由来とし、要素の識別は既存の識別属性の規約に従う。文言に依存するセレクタを作らない
  - コントロールのスタイルを専用のスタイルシートへ閉じる
  - 完了条件: コントロールの操作で表示言語が切り替わり、対応言語を1つ増やすと選択肢が自動的に増えることが DOM テストで確認できている
  - _Requirements: 1.1, 1.6, 9.3_
  - _Boundary: LanguageSelectControl_
  - _Depends: 3.1_

- [x] 4. 公開カタログ契約による英語表示の受入検証

- [x] 4.1 (P) 共有・settings名前空間の英語resolverを受け入れる
  - 共有語彙、navigation、shell、settingsを含む公開resolverの英語結果を検証し、consumer側へ値表やaliasを作らない
  - 外部由来文字列が公開resolverを通しても変化しないことを確認する
  - 完了条件: ja/enの11名前空間を公開契約から解決でき、`settings.title`と`nav.settings`が選択言語へ追随する
  - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 9.4_
  - _Boundary: LanguageCatalogConsumer_
  - _Depends: 1.3_

- [x] 4.2 (P) 候補管理の英語resolver結果を受け入れる
  - 候補管理のフォーム、エラー、確認文を公開resolverだけから解決し、consumer側で断片を連結しない
  - 完了条件: 候補管理の代表keyとパラメータ付き文が英語で解決される
  - _Requirements: 4.1, 4.2, 4.3, 4.7, 9.4_
  - _Boundary: LanguageCatalogConsumer_
  - _Depends: 1.3_

- [x] 4.3 (P) 現在構成と互換性確認の英語resolver結果を受け入れる
  - 現在構成と互換性確認の代表keyを公開resolverだけから解決する
  - 完了条件: 部位名を含む文が英語の完結文として解決される
  - _Requirements: 4.1, 4.2, 4.3, 4.7, 9.4_
  - _Boundary: LanguageCatalogConsumer_
  - _Depends: 1.3_

- [x] 4.4 (P) 商品取り込みの英語resolver結果を受け入れる
  - 取り込み各フェーズと失敗文言を公開resolverだけから解決し、共有カテゴリ語彙をconsumer側で重複定義しない
  - 完了条件: 商品取り込みの代表keyが英語で解決される
  - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 9.4_
  - _Boundary: LanguageCatalogConsumer_
  - _Depends: 1.3_

- [x] 4.5 (P) バックアップ復元の数量resolver結果を受け入れる
  - バックアップ・復元の代表keyと件数を含む文を公開resolverから解決し、consumer側で数量フォームや部分文を再構成しない
  - 完了条件: 単一件数と複数種類の件数を含む復元完了通知が英語の1文として解決される
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 9.4_
  - _Boundary: LanguageCatalogConsumer_
  - _Depends: 1.3_

- [x] 4.6 上流parity gateとconsumer契約を統合検証する
  - `ui-message-catalog`所有のja/en parity gateを実行し、本specでは公開resolverの件数0・1・2と複数件数文だけをconsumer契約として検証する
  - 完了条件: 上流parity gate、公開consumer型検査、resolver契約テストが成功する
  - _Requirements: 4.2, 4.4_
  - _Depends: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. アプリケーションへの統合

- [x] 5.1 初期shell headerへの言語コントロール配置（完了履歴）
  - この完了項目は初回国際化時の配置履歴であり、現行の配置要件ではない。settings-screenへの移設とheader撤去はタスク9で扱う
  - 当時のシェル共通ヘッダ領域を追加し、読み込み中・通常・エラー・保守中の全ての状態で言語コントロールを描画した
  - シェルの供給点を言語対応のコンポーネントへ置き換える。シェルの状態型・ナビゲーション項目の形・エラー境界・機能搭載コンテナの構造は変更しない
  - ヘッダ領域のスタイルを文言に依存しないセレクタで定義する
  - 完了条件: 4つの状態それぞれでコントロールが描画され操作できることが DOM テストで確認でき、シェルの既存テストが無改変で成功する
  - _Requirements: 1.1, 1.5_
  - _Boundary: HistoricalShellHeaderLanguageSurface_
  - _Depends: 3.3_

- [x] 5.2 起動経路での言語ランタイムの初期化
  - サイドパネルの起動経路が、ブラウザ表示言語の取得と保存ポートを組み立てて言語ランタイムを初期化し、解決の完了を待ってからシェルを起動するようにする
  - 初期化直後に文書の言語属性の同期を開始する
  - ブラウザ API が存在しない実行環境では、取得結果なしとメモリ保存の経路で動作させる。ブラウザ API への直接参照は起動経路と保存ポートに限る
  - 初期化が失敗しても起動を止めない
  - 完了条件: 初期化がシェル起動より前に完了すること、初期化が失敗しても起動が続行することが起動経路のテストで確認できている
  - _Requirements: 2.1, 2.6, 5.1_
  - _Boundary: LanguageRuntimeBootstrap_
  - _Depends: 3.2, 5.1_

- [x] 5.3 各機能の表示ルートへの供給点の置き換え
  - 5つの機能の表示ルート生成箇所の供給点を、言語対応のコンポーネントへ置き換える。それ以外の変更を行わない
  - 各機能は言語境界の公開入口だけを参照し、ストアの実体・保存経路・解決ロジックを知らない状態を保つ
  - 機能の搭載・解放のライフサイクルと搭載コンテキストの形へ触れない
  - 完了条件: 言語を切り替えると5つの機能画面すべてが同時に追随し、機能の搭載・解放の既存契約テストが無改変で成功する
  - _Requirements: 1.2, 1.3_
  - _Boundary: FeatureRootLanguageBinding_
  - _Depends: 5.1_

- [x] 6. 拡張マニフェストと配布物の国際化

- [x] 6.1 ロケール資産の新設とマニフェストの国際化
  - 英語と日本語のロケール資産を新設し、拡張の名称と説明の2キーのみを持たせる。両ロケールとも全キーを揃える
  - マニフェストの名称と説明をロケール参照へ置き換え、既定ロケールを英語として宣言する。権限・最低対応バージョン・コンテンツセキュリティポリシーは変更しない
  - ロケール資産に URL を含めない
  - マニフェスト構造を完全一致で検証している既存テストを、新しい構造と整合するよう更新する
  - 完了条件: 拡張が読み込め、マニフェスト構造の既存テストが新構造で成功し、権限とセキュリティに関する既存検査が引き続き有効である
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_
  - _Boundary: ExtensionLocaleAssets_

- [x] 6.2 マニフェストとロケール資産の整合検査
  - 生成物検査へ、ロケール参照があるなら既定ロケールが宣言されていること、既定ロケールの資産が実在すること、参照される全キーが既定ロケールに存在すること、ロケール資産が期待する形であることの検査を追加する
  - マニフェスト単体の検査とディレクトリを見る検査を分け、既存の単体呼び出しの前提を壊さない
  - 配布物を合成しているツール側テストへロケール資産を加える
  - 完了条件: 既定ロケール未宣言・資産欠落・キー欠落の各ケースで検査が失敗し、正常時は違反ゼロで通る
  - _Requirements: 6.5, 8.5_
  - _Boundary: ManifestLocaleGuard_
  - _Depends: 6.1_

- [x] 6.3 配布物へのロケール資産の同梱
  - ビルドがロケール資産を生成物へ再帰的にコピーするようにする
  - 配布用パッケージの生成経路がロケール資産をそのまま運ぶことを実測し、追加の変更が必要かを判断する
  - 配布用アーカイブにロケール資産が含まれることを検証するテストを追加する
  - 完了条件: 生成物と配布用アーカイブの双方に両ロケールの資産が含まれることがテストで確認できている
  - _Requirements: 8.4_
  - _Boundary: BuildLocaleCopy_
  - _Depends: 6.1_

- [x] 6.4 保存 API 到達点の境界検査
  - 保存 API への到達を、保存基盤のアダプタと表示言語の保存ポートの2ファイルへ限定する規則を、既存の公開境界検査へ追加する
  - 生成物側にも同じ検査が効くことを確認する
  - 完了条件: 許可外のファイルから保存 API へ到達する記述を1件加えると検査が非ゼロ終了し、現状では違反ゼロで通る
  - _Requirements: 3.2, 3.4_
  - _Boundary: StorageAccessGuard_
  - _Depends: 2.2_

- [x] 7. ロケール固有データの隔離

- [x] 7.1 (P) 日本語ロケール向け取り込み支援データの分離
  - カテゴリ推定のキーワード辞書と、日本語の価格表記の判定を、専用のロケールデータ用モジュールへ移設する。順序と一致規則を維持し、値を編集しない
  - 各モジュール冒頭に、表示文言ではないこと、翻訳対象外であること、他ロケールでの動作を妨げない加算的な最適化であること、多言語化が本 spec の対象外であることを記す
  - 推定ロジックと正規化ロジックは元の位置に残し、ロケールデータを参照する形にする。両ファイルに日本語リテラルを残さない
  - 文言リテラル検査の除外へロケールデータ用ディレクトリを加え、推定ロジック側を除外から外す
  - 完了条件: 商品取り込みの既存テストを無改変のまま通し、抽出結果が移設前後で一致し、推定ロジック側へ日本語を1件戻すと文言検査が失敗する
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - _Boundary: JapaneseLocaleData, UiTextGuardExclusions_

- [x] 8. 英語UIの検証と最終確認

- [x] 8.1 英語UIの操作起点での検証
  - 言語コントロールのロケータと、言語別に期待値を解決する手段を E2E の共有ヘルパへ追加する
  - 英語へ切り替えたうえで5つの機能画面を順に表示し、主要文言が公開英語resolverの解決値と一致することを検証する仕様を追加する。ブラウザ再起動・ロケール環境変数・起動オプションを一切使わない
  - 英語へ切り替えた後にサイドパネルを開き直しても英語のまま表示されることを検証する
  - 完了条件: 追加した E2E が既定の実行環境で成功し、実行環境の言語設定に依存する記述がどこにもない
  - _Requirements: 1.1, 3.1, 4.3, 8.1, 8.2_
  - _Depends: 5.3, 6.3_

- [x] 8.2 言語をまたぐ振る舞い不変性の検証
  - 英語表示のままバックアップから復元し、復元完了通知が英語の1文として表示され、復元の前後で表示言語が変わらないことを検証する
  - 英語表示のまま候補の作成・編集・削除を行い、保存結果が現行と同一であることを検証する
  - 完了条件: 復元操作が表示言語を書き換えないこと、および表示言語が保存データと判定結果に影響しないことが E2E で確認できている
  - _Requirements: 1.4, 3.3, 4.5_
  - _Depends: 8.1_

- [x] 8.3 検証フロー全段の実行と最終確認
  - 型検査、公開consumer型検査、静的検査、公開境界検査、fixture検査、文言検査、最終ビルドゲート、単体・統合テスト、Playwright E2E の全段を実行する
  - 生成物検査を実行し、翻訳リソースが静的に同梱されていること、コンテンツセキュリティポリシーと権限集合が変わっていないことを確認する
  - 日本語表示のまま全画面を表示し、本 spec の前後で表示文言・DOM 構造・視覚表現が一致することを確認する
  - 英語表示で全画面を表示し、未翻訳の文言および供給点の張り忘れが残っていないことを確認する
  - 完了条件: 全段が成功し、日本語表示に差分がなく、英語表示に日本語の取り残しがない
  - _Requirements: 4.3, 8.6_
  - _Depends: 8.2, 6.2, 6.4, 7.1, 4.6_

- [ ] 9. 言語コントロールをsettings配置へ移行する

- [ ] 9.1 ui-language公開契約をsettingsの埋め込み利用者として固定する
  - 公開言語Providerとcontrolがsettingsからpublic entryだけを通じて利用でき、言語code、store、保存portをpropsまたはsettings stateへ複製しない契約を検証する
  - controlの選択肢、原語表記、現在値、保存失敗時のin-memory継続を既存owner内に維持し、settingsまたはshellへの逆依存を境界検査で拒否する
  - `settings`を含む11名前空間のja/en resolverを`src/ui-messages/public.ts`の型付き契約だけから消費し、ui-language、settings、shellからcatalog localeファイルへ直接到達しないことを検証する
  - 完了条件: public consumer型検査、11名前空間resolver契約、control単体検証、公開境界検査が成功し、settingsが言語の意味・初期値・保存・catalogを所有せずcontrolを配置できる
  - _Requirements: 1.1, 1.6, 3.5, 4.1, 4.2, 9.1, 9.2, 9.3_
  - _Boundary: UiLanguagePublicEntry, LanguageSelectControl, LanguageCatalogConsumer_

- [ ] 9.2 settings lifecycleでの表示言語追随を受け入れ検証する
  - settings表示言語区画に公開controlが一度だけ存在し、言語変更時にsettings root、表示中の区画、埋め込みsection host、入力途中の値、スクロール位置を保持することを確認する
  - maintenance中はoperation policyによるデータ変更制限と独立して切り替えを受け付け、保存失敗時もsettingsと埋め込みsectionの状態を失わない既存契約を受け入れる
  - 完了条件: settings-screenが提供するDOM／integration testとui-languageのstore／Provider testが成功し、settings側に複製された言語stateが存在しない
  - _Depends: 9.1, settings-screen 3.3_
  - _Requirements: 1.2, 1.3, 1.5, 3.5, 4.3_
  - _Boundary: SettingsLanguageIntegration, LanguageReactBinding_

- [ ] 9.3 shell状態ごとのsettings到達と文言追随を受け入れ検証する
  - shell header、loading、global startup errorに言語controlが存在せず、ready／maintenance／feature-local failureではpersistent settings navigationが維持されることを確認する
  - settingsでの言語変更後、shell navigationと状態文言が同じresolverへ追随し、loading／global startup errorでは「設定 / Settings」と既存回復操作が提示されることを確認する
  - 完了条件: application-shellのDOM／production-shaped統合testが成功し、旧header controlへのproduction期待が残らず、shellが言語stateや保存を所有しない
  - _Depends: 9.2, application-shell 7.2_
  - _Requirements: 1.2, 1.7, 1.8, 4.3_
  - _Boundary: SettingsLanguageIntegration_

- [ ] 9.4 移行済みsettings経路で国際化固有のE2Eを受け入れ検証する
  - `settings-screen 4.3` が所有するsettings locator、経路移行、再open、backup／transient検証を再実装せず、その成果を前提として既存の国際化E2Eを実行する
  - settingsで英語へ切り替えた後の全対象面の英語表示、候補の作成・編集・削除結果の不変、文書言語属性の追随という本spec固有のassertionを維持する
  - 完了条件: 国際化固有のPlaywright specが成功し、ブラウザ再起動・環境ロケール・起動オプションやheader構造へ依存しない
  - _Depends: 9.3, settings-screen 4.3_
  - _Requirements: 1.4, 4.3, 5.1, 5.2, 8.1, 8.2_
  - _Boundary: LanguageE2ESpec_

- [ ] 9.5 settings配置移行の完全検証gateを通す
  - 型、公開consumer、静的検査、catalog parity、公開境界、fixture、文言、final build、単体／統合／DOM、Playwrightの全段を実行する
  - 対象specとproduction graphを検索し、旧header配置への参照が完了履歴と撤去検証以外に残らず、旧名前空間数の固定記述、catalog localeファイルの所有・deep import、settings／shellからui-language内部moduleへの参照が残らないことを確認する
  - 完了条件: 全gateが成功し、11名前空間のja/en公開resolver、表示言語の保存値、domain data、backup交換形式、manifest権限に意図しない差分がない
  - _Depends: 9.4_
  - _Requirements: 3.2, 3.4, 3.6, 8.5, 8.6, 9.5_
  - _Boundary: ValidationGate_

## Implementation Notes

- タスク3.1/3.3: `src/ui-language/react.tsx`（JSX不使用でも）や `language-select.tsx` を `pnpm test`（`--test-isolation=none` で全テストが単一プロセスを共有）のフル実行下に置くと、`tests/persistence/**` の拡張子明示 `.ts` 動的importが tsx のローダーを desync させ、以後の `.js` 指定子から `.tsx` ファイルへのフォールバック解決が `ERR_MODULE_NOT_FOUND` で失敗する（`ui-message-catalog` タスク2.5で既知の同一問題）。孤立実行では再現せず、`pnpm test` の実行順でのみ顕在化する。回避策は同じ: `src/ui-language/` 配下の新規モジュールは実DOMを描画する場合でも JSX 構文を避けて `createElement` ベースの `.ts` ファイルとする（`react.tsx`→`react.ts`、`language-select.tsx`→`language-select.ts`）。**テストファイル自体は `.tsx` のままで問題ない**（失敗するのは相対 `.js` 指定子を介した解決であり、テストランナーが直接開く entry ファイルの拡張子ではないため）。
