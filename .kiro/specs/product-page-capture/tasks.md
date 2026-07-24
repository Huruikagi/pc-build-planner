# Implementation Plan

- [x] 1. 取り込み実行入口と型付き境界を整える
  - 上流のFoundation、候補作成ポート、サイドパネル、ビルド・テスト基盤が利用可能であることを前提条件として確認する
  - action、`activeTab`、`scripting`を最小権限で追加し、全サイトへの恒久権限やリモートコードを導入しない
  - 未信頼payload、取得候補、根拠、セッション、判別可能な失敗の共有契約をstrict型で定義する
  - ビルド後のmanifestからactionを実行でき、既存の候補管理画面も起動できる
  - _Requirements: 1.1, 1.2, 1.3, 2.5, 6.5_

- [x] 2. ページ抽出パイプラインを実装する
- [x] 2.1 (P) 汎用ソースから根拠付き候補を収集する
  - JSON-LD、meta、見出し、パンくず、表、定義リストから共通商品項目と主要スペック候補を収集する
  - DOM、HTML、画像を返さず、値ごとの取得元種別と元表記を保持する
  - 有界な走査で架空ページの部分結果を返し、未知形状が他の抽出結果を失敗させない
  - _Depends: 1_
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 7.1, 7.3_
  - _Boundary: GenericExtractor_

- [x] 2.2 (P) ページ由来値を検証・正規化する
  - 空白、制御文字、長さ、URL、価格を項目別に検証し、採用値と棄却理由を返す
  - 実行可能なマークアップを実行せず、未確認値を確認済み値へ昇格させない
  - 不正値を含む架空入力から安全な部分結果と項目別理由を確認できる
  - _Depends: 1_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.1_
  - _Boundary: CaptureNormalizer_

- [x] 2.3 候補を固定優先順位で選択する
  - 正規化済み候補を構造化データ、meta、見出し・パンくず、表・定義リストの順で選択する
  - 同順位を文書順で決定し、欠損と元表記を保持した確認ドラフトを生成する
  - 複数候補を含む架空ページで採用値と根拠が常に同じになる
  - _Requirements: 2.2, 2.3, 2.4, 3.5, 3.6, 7.1_

- [x] 3. 取り込み調停と競合防止を実装する
  - action操作時に現在の単一タブを確定し、注入側で抽出パイプラインを実行する
  - 戻り値を未信頼入力として再検証し、requestId、tabId、URLの不一致結果を破棄する
  - 権限失効、制限ページ、タブ遷移、注入失敗、応答不能、payload不正を識別可能な結果へ変換する
  - action以外では抽出が走らず、失敗時にRepositoryが呼ばれないことを確認できる
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 3.3, 3.4, 6.1, 6.2, 6.4, 7.2_

- [x] 4. 確認セッションとサイドパネル表示を実装する
- [x] 4.1 (P) 一時セッションの状態遷移と編集を実装する
  - 抽出中、確認、保存中、成功、失敗を区別し、元表記と利用者修正値を別々に保持する
  - 商品名必須、未分類、project選択、失敗後のドラフト保持と再試行を状態規則へ反映する
  - 保存中の再送を拒否し、同一セッションから保存要求が一度だけ発生する
  - _Depends: 2.3, 3_
  - _Requirements: 3.5, 3.6, 4.3, 4.4, 4.5, 5.1, 5.2, 5.6, 5.7, 6.3, 6.4_
  - _Boundary: CaptureState_

- [x] 4.2 (P) 簡易確認と回復可能な案内をReactで表示する
  - 商品名、カテゴリ、価格、メーカー、型番、URL、欠損、取得元、元表記を安全なtext表示で描画する
  - 権限、制限ページ、抽出なし、タブ遷移、保存失敗ごとに再実行または手入力の導線を示す
  - framework非依存のCaptureStateをpropsとして受け、抽出値を通常のJSX childとして描画し、`dangerouslySetInnerHTML`と`innerHTML`を使用しない
  - 完了時、利用者が根拠を見て修正でき、安全な描画をDOM testで確認できる
  - _Depends: 2.3, 3_
  - _Requirements: 2.3, 2.4, 3.3, 4.1, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 6.5_
  - _Boundary: CaptureView_

- [x] 4.3 候補管理の詳細編集導線を接続する
  - 抽出済み値、`sourceInfo`、元表記、取得根拠を候補管理の型付きprefillへ変換し、`openCandidateEditor`だけを介して詳細編集を要求する
  - 商品候補がない場合も手入力用の詳細編集へ進めるようにする
  - shell navigation、候補側検証、mountの失敗時はcapture sessionを保持し、簡易確認と詳細編集の往復後も同じ修正値とproject選択が表示される
  - _Depends: application-shell 5.3; project-candidate-management 5.1_
  - _Requirements: 4.2, 4.3, 4.6_
  - _Boundary: CandidateEditorNavigation_

- [x] 4.4 React root adapterとfeature registrationを実装する
  - `view.tsx`をframework非依存のCaptureState/portへ接続し、`public.ts`、side panel registration、worker registrationをfeature内で所有する
  - application shellの`FeatureMountContext`へReact rootをmountし、切替・停止時に`root.unmount()`と購読解除を一度だけ行う
  - shell contract test kitでUI登録、action handler登録、typed activation呼出、operation policy、cleanupが適合することを確認できる
  - _Depends: application-shell 1.1, 1.3, 1.4; local tasks 3, 4.1, 4.2, 4.3_
  - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 6.4, 6.5_
  - _Boundary: CaptureFeatureRegistration, CaptureWorkerRegistration, ReactRootAdapter_

- [x] 5. 確認済みドラフトを候補作成契約へ統合する
- [x] 5.1 確認セッションを上流の候補ドラフトへ変換する
  - 必須の商品名とprojectIdを検証し、カテゴリ未確認を未分類へ変換する
  - 確認値、元表記、取得元、取得日時を上流契約の別フィールドへ写し、余剰ページ値を除外する
  - 欠損を含む有効セッションが型安全な候補ドラフトになり、不正セッションは項目エラーになる
  - _Requirements: 3.5, 3.6, 4.5, 5.1, 5.2, 5.3, 5.4_

- [x] 5.2 候補作成ポートへ一度だけ保存する
  - 選択projectへ既存ポート経由で候補を作成し、永続化・容量・移行ロジックを重複実装しない
  - 成功時はprojectと完了状態を表示し、失敗時はドラフトと選択を保持して上流エラーを案内する
  - 同一保存操作で候補が一件だけ作成され、未分類候補も上流規則どおり保存される
  - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 6.3_

- [x] 6. 取り込み全体の受け入れフローと回帰を検証する
- [x] 6.1 actionから候補保存までを統合する
  - application shellがside panel registration、worker registration、`public.ts`をcompositionし、feature側から共有runtime入口とroot barrelを編集しない
  - action、抽出、順位付け、確認、修正、project選択、候補作成を既存runtimeとサイドパネルへ接続する
  - 情報が十分な架空ページと欠損のある架空ページの両方で、保存完了まで一連の操作が成立する
  - 同じ架空sessionから詳細編集を選ぶと候補管理が型付きprefillで開き、戻った場合もcapture sessionが維持される
  - すべての読取・更新が責任境界を守り、content scriptから保存領域を直接操作できない
  - _Depends: application-shell 4.1, 5.3; project-candidate-management 4.2; local tasks 4.4, 5.2_
  - _Requirements: 1.1, 2.1, 2.2, 2.4, 3.5, 4.1, 4.2, 5.1, 5.3, 5.4, 5.5_

- [x] 6.2 失敗・安全性・fixture制約の回帰テストを完成する
  - 権限失効、制限ページ、ページ遷移、形式不正、抽出失敗、projectなし、容量不足、保存失敗、重複送信を検証する
  - 商品値・完全URL・HTMLがログや保存payloadへ漏れず、実行可能なページ値が描画されないことを検証する
  - テスト資産が架空HTMLと架空商品だけで構成され、実サイトHTML、画像、取得データなしで全テストが通る
  - _Requirements: 1.4, 1.5, 2.5, 3.1, 3.2, 3.3, 3.4, 4.5, 4.6, 5.2, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3_

- [x] 6.3 実chrome.scripting連携によるproduction composition接続を実装する
  - task 6.1で抽象のままとした`CaptureRuntimePort`へ、`chrome.tabs`/`chrome.scripting.executeScript`を用いた実装を追加する(content-script bundle用のesbuild entry追加を含む可能性があり、`scripts/build.mjs`という全spec共有のbuild toolingへの変更を伴う)
  - `chrome.action.onClicked`からside panelを開き、worker registrationのaction handlerを起動する実配線をservice worker側に追加する
  - `src/application-shell/side-panel-contributions.ts`・production worker compositionへ`createProductCaptureContribution`を実際に登録する
  - 実Chromeブラウザでの動作確認ができない開発環境のため、自動テストとコードレビューだけで検証し、実機での早期の手動確認を推奨する旨を記録する
  - _Depends: local task 6.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 7. カテゴリ参考値（categoryHint）を詳細編集の初期選択へ引き継ぐ
  - `inferCategoryHint(raw): PartCategory | undefined`を追加し、抽出カテゴリ表記から確信できるカテゴリだけを推定する（具体カテゴリを広いキーワードより優先、`other`/`uncategorized`は非推定、確信できなければ`undefined`）
  - `CandidateEditorPrefill`へdraftとは別枠の`categoryHint?: PartCategory`を追加し、activationの実行時検証で未指定または有効カテゴリだけを受理する
  - 候補管理activationは`draft.category === "uncategorized"`かつ`categoryHint`があるときだけ初期カテゴリと空属性を種付けする（確定値優先。共有ヘルパー`withCategory`を候補管理内でview/activation双方から利用）
  - `CandidateEditorNavigation.open`は抽出カテゴリから`categoryHint`を推定してprefillへ付与する。直接「保存」経路は従来どおり`uncategorized`のままとし、人的確認を経ないカテゴリ確定を発生させない
  - CaptureViewのカテゴリ行を編集不可の表示専用（推定＋取得根拠）へ変更する
  - _Requirements: 3.6, 4.7, 4.8_
  - _Boundary: inferCategoryHint / CandidateEditorNavigation / CandidateEditorPrefill_

## Implementation Notes

- Task 1: `scripts/validate-artifacts.mjs`のvalidateManifestは共有tooling（全specの`pnpm validate:final-build`から使われる）。permission許可listの拡張は`tests/tooling/final-validation-gate.test.ts`の合成manifest fixtureにも`action`/新permissionsを反映しないと既存成功系testが壊れる。
- Task 4.1: 注入されたasync依存（`coordinator.captureCurrentTab()`、`submitDraft()`）は必ずtry/catchで包み、例外を`failed`状態へ変換すること。素通しすると再入防止guardのせいで`extracting`/`submitting`のまま永久に復帰不能になる（レビュー1回目で指摘・修正済み）。同様の依存注入を行う後続task（5.2など）でも同じ防御を徹底する。

- Task 4.4: application-shell/public.tsがRegistrationErrorを再公開していなかったため追加した(ApplicationWorkerRegistration.register()の戻り値型として必須)。styles.cssはFile Structure Plan逸脱として本taskでは未実装(current-build-managementと同様の記録)。CaptureStateはoperation policy gatingを持たないため、保守モード中の保存拒否はtask 5.2で配線するCaptureCandidatePort側のエラー伝播に委ねる。

- Task 6.1: createProductCaptureContribution()はCaptureStateを一度だけ生成しmount()間で共有するため、詳細編集の往復によるsession維持はsnapshot/restoreを使わず実現できる(application-composition.tsがcontribution factoryをstart()ごとに一度だけ呼ぶため、この前提は本番構成でも成立する)。CaptureRuntimePortの実chrome.scripting連携とside-panel-contributions.tsへの実登録はtask 6.3へ意図的に切り出した(ユーザー承認済み、実Chromeで動作検証できない開発環境のため)。openManualEntryのproject解決はdependencies.projects[0]をデフォルトに使う暫定挙動であり、projectsが空の場合は無音でno-opになる既知の制約。

- Task 6.2: 6.2が要求する失敗・安全性シナリオはほぼ全てtask 2〜5の各unit test(coordinator/normalizer/state/view/draft-mapper/submit-draft.test.ts)で既に個別検証済みのため、本taskではcreateProductCaptureContribution()経由の実合成を通したend-to-end確認に絞った(regression.test.ts、8 tests)。特にRequirement 6.5(診断ログへ商品値・URLを記録しない)はconsole.*呼び出しが該当featureに一件も存在しないことによる構造的充足であり、regression.test.tsのconsole spyテストが唯一の具体的な回帰guardになる。console.log/warn/errorをmonkey-patchするharnessは`--test-isolation=none`環境でグローバル汚染を招くため、afterEachで必ず元へ復元すること(レビュー1回目で指摘・修正済み)。同様にmockのcall記録なしで「呼べた」だけを確認するテストはtautologyになりやすい(検出・修正済み: openCandidateEditorの呼び出し引数を記録し、prefillの内容まで検証する)。

- Task 6.3: `chrome.action.onClicked`はCaptureStateを共有できないservice worker context上で発火するため、side panel主導のアーキテクチャを採用した(ユーザー承認済み)。`chrome.action.onClicked`はside panelを開く(`chrome.sidePanel.open`)だけを行い、実際の取り込み開始は既存の同一document内button(`data-capture-start`、`state.startCapture()`を直接呼ぶ)が担う。cross-context messagingは不要になった一方、task 4.4で実装済みの`createCaptureWorkerRegistration`/`WorkerRegistrationContext.addActionHandler`は本番のどのworker compositionへも配線せず、意図的に本番未使用のまま残す(`integration.test.ts`/`regression.test.ts`が直接呼び出して検証する用途にのみ残存)。`CaptureRuntimePort`の実装は`chrome.scripting.executeScript`を`files`(bundle済みcontent script注入)→`func`(戻り値取得、closure不要な自己完結関数)の二段階で呼ぶ構成にした。`files`単体の完了値はbundle形式(esbuildのIIFE wrapper)に依存し戻り値取得が不確実なため避け、Chromeが仕様として保証する`func`の戻り値伝播だけに依存する。`side-panel-contributions.ts`は`chrome`未定義のunit test環境向けに、常に失敗を返すだけの無害なinert runtime portへ自動fallbackする(第2引数`chromeApis`省略時)。projectsはmount時ごとに`listProjects()`で再取得する方式へ変更した(旧来の起動時static配列は将来projectを追加してもcapture UIに反映されない実質的な機能欠落だったため)。実Chromeブラウザでの動作確認ができない開発環境のため、本taskの検証は自動テスト(unit/integration/regression)とコードレビューに加え、Playwrightで実Chromiumへ本当に読み込んだunpacked extensionに対するe2eテスト(`e2e/product-capture.spec.ts`)まで実施した。ただしPlaywright/CDPには拡張機能のtoolbarアイコンをクリックする手段がなく、`activeTab`の実付与は再現できないため、e2eは「`chrome.tabs.query`が実際に呼ばれ、URL権限がない状態を正しく`permission-lost`として検出・表示し再試行できる」ところまでを検証しており、`chrome.scripting.executeScript`による実ページ抽出の成功経路そのものは未検証である。ビルド済み拡張機能を実Chromeへ手動で読み込み、実際にツールバーアイコンをクリックして取り込み成功経路を早期に確認することを強く推奨する。

- Feature validation (`/kiro-validate-impl`, 2026-07-24): クロスタスク監査で2件の欠陥を検出・修正した。
  1. **`tab-changed`検証が本番で到達不能だった** — task 3のcoordinatorはrequestId/tabId/pageUrlの不一致を破棄する実装だったが、task 6.3の`createChromeCaptureRuntimePort.inject()`がページの戻り値ではなく自分の引数(`target.url`)からenvelopeを組み立てていたため、3つの照合がすべて恒真式になっていた。`tabs.query()`解決後〜`files`注入到達までにページ遷移が確定すると、ページBの抽出値がページAのURLで`sourceInfo`に刻まれたまま保存可能状態になり、Requirement 6.1が本番で未充足だった。content scriptが`location.href`を`{pageUrl, candidates}`として返し、portが`target.url`ではなくその値をenvelopeへ載せる方式へ修正。**`requestId`/`tabId`はページ側から echo させていない**: 両injectionは拡張のisolated worldで動くためページはhookを定義も観測もできず、`tabId`はChrome自身の注入対象、`requestId`はページ由来にできないので、echoさせても保証は増えず「guardに見えるだけの機構」になる。実際に遷移を検出できるのは`pageUrl`だけ。stub portだけを使う既存の`coordinator.test.ts`は本番経路の再発を検出できないため、実port+coordinatorを直結した回帰testを`chrome-runtime-port.test.ts`へ追加した(旧実装へ戻すと落ちることを確認済み)。
  2. **`styles.css`が本番bundleへ入っていなかった** — feature stylesheetを束ねる唯一のentryである`src/application-shell/side-panel.css`が`product-capture/styles.css`を`@import`しておらず、`view.tsx`が使う5クラスのruleが`dist/styles.css`に一件も含まれていなかった(欠損警告色・取得根拠の弱調・エラー色がすべて無効)。import漏れはbuildもlintも素通りする種類の欠陥なので、`src/features/*/styles.css`が必ず`dist/styles.css`へ到達することを検査するtestを`tests/tooling/build-smoke.test.ts`へ追加した(feature追加時にも効く汎用guard、@import削除で落ちることを確認済み)。
  - 検証: `pnpm test` 584 pass / 0 fail、typecheck・public-consumer・lint・boundaries・fixtures・final-build gate 全通過、`playwright test` 4 passed(実Chromiumのunpacked extension)。**実Chromeでの`executeScript`成功経路そのものは依然未検証**(Playwright/CDPからtoolbarアイコンをクリックできず`activeTab`の実付与を再現できないため)。手動確認は引き続き必須。
