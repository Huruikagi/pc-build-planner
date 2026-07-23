# Implementation Plan

- [x] 1. 取り込み実行入口と型付き境界を整える
  - 上流のFoundation、候補作成ポート、サイドパネル、ビルド・テスト基盤が利用可能であることを前提条件として確認する
  - action、`activeTab`、`scripting`を最小権限で追加し、全サイトへの恒久権限やリモートコードを導入しない
  - 未信頼payload、取得候補、根拠、セッション、判別可能な失敗の共有契約をstrict型で定義する
  - ビルド後のmanifestからactionを実行でき、既存の候補管理画面も起動できる
  - _Requirements: 1.1, 1.2, 1.3, 2.5, 6.5_

- [ ] 2. ページ抽出パイプラインを実装する
- [ ] 2.1 (P) 汎用ソースから根拠付き候補を収集する
  - JSON-LD、meta、見出し、パンくず、表、定義リストから共通商品項目と主要スペック候補を収集する
  - DOM、HTML、画像を返さず、値ごとの取得元種別と元表記を保持する
  - 有界な走査で架空ページの部分結果を返し、未知形状が他の抽出結果を失敗させない
  - _Depends: 1_
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 7.1, 7.3_
  - _Boundary: GenericExtractor_

- [ ] 2.2 (P) ページ由来値を検証・正規化する
  - 空白、制御文字、長さ、URL、価格を項目別に検証し、採用値と棄却理由を返す
  - 実行可能なマークアップを実行せず、未確認値を確認済み値へ昇格させない
  - 不正値を含む架空入力から安全な部分結果と項目別理由を確認できる
  - _Depends: 1_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.1_
  - _Boundary: CaptureNormalizer_

- [ ] 2.3 候補を固定優先順位で選択する
  - 正規化済み候補を構造化データ、meta、見出し・パンくず、表・定義リストの順で選択する
  - 同順位を文書順で決定し、欠損と元表記を保持した確認ドラフトを生成する
  - 複数候補を含む架空ページで採用値と根拠が常に同じになる
  - _Requirements: 2.2, 2.3, 2.4, 3.5, 3.6, 7.1_

- [ ] 3. 取り込み調停と競合防止を実装する
  - action操作時に現在の単一タブを確定し、注入側で抽出パイプラインを実行する
  - 戻り値を未信頼入力として再検証し、requestId、tabId、URLの不一致結果を破棄する
  - 権限失効、制限ページ、タブ遷移、注入失敗、応答不能、payload不正を識別可能な結果へ変換する
  - action以外では抽出が走らず、失敗時にRepositoryが呼ばれないことを確認できる
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 3.3, 3.4, 6.1, 6.2, 6.4, 7.2_

- [ ] 4. 確認セッションとサイドパネル表示を実装する
- [ ] 4.1 (P) 一時セッションの状態遷移と編集を実装する
  - 抽出中、確認、保存中、成功、失敗を区別し、元表記と利用者修正値を別々に保持する
  - 商品名必須、未分類、project選択、失敗後のドラフト保持と再試行を状態規則へ反映する
  - 保存中の再送を拒否し、同一セッションから保存要求が一度だけ発生する
  - _Depends: 2.3, 3_
  - _Requirements: 3.5, 3.6, 4.3, 4.4, 4.5, 5.1, 5.2, 5.6, 5.7, 6.3, 6.4_
  - _Boundary: CaptureState_

- [ ] 4.2 (P) 簡易確認と回復可能な案内をReactで表示する
  - 商品名、カテゴリ、価格、メーカー、型番、URL、欠損、取得元、元表記を安全なtext表示で描画する
  - 権限、制限ページ、抽出なし、タブ遷移、保存失敗ごとに再実行または手入力の導線を示す
  - framework非依存のCaptureStateをpropsとして受け、抽出値を通常のJSX childとして描画し、`dangerouslySetInnerHTML`と`innerHTML`を使用しない
  - 完了時、利用者が根拠を見て修正でき、安全な描画をDOM testで確認できる
  - _Depends: 2.3, 3_
  - _Requirements: 2.3, 2.4, 3.3, 4.1, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 6.5_
  - _Boundary: CaptureView_

- [ ] 4.3 候補管理の詳細編集導線を接続する
  - 抽出済み値、`sourceInfo`、元表記、取得根拠を候補管理の型付きprefillへ変換し、`openCandidateEditor`だけを介して詳細編集を要求する
  - 商品候補がない場合も手入力用の詳細編集へ進めるようにする
  - shell navigation、候補側検証、mountの失敗時はcapture sessionを保持し、簡易確認と詳細編集の往復後も同じ修正値とproject選択が表示される
  - _Depends: application-shell 5.3; project-candidate-management 2.5_
  - _Requirements: 4.2, 4.3, 4.6_
  - _Boundary: CandidateEditorNavigation_

- [ ] 4.4 React root adapterとfeature registrationを実装する
  - `view.tsx`をframework非依存のCaptureState/portへ接続し、`public.ts`、side panel registration、worker registrationをfeature内で所有する
  - application shellの`FeatureMountContext`へReact rootをmountし、切替・停止時に`root.unmount()`と購読解除を一度だけ行う
  - shell contract test kitでUI登録、action handler登録、typed activation呼出、operation policy、cleanupが適合することを確認できる
  - _Depends: application-shell 1.1, 1.3, 1.4; local tasks 3, 4.1, 4.2, 4.3_
  - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 6.4, 6.5_
  - _Boundary: CaptureFeatureRegistration, CaptureWorkerRegistration, ReactRootAdapter_

- [ ] 5. 確認済みドラフトを候補作成契約へ統合する
- [ ] 5.1 確認セッションを上流の候補ドラフトへ変換する
  - 必須の商品名とprojectIdを検証し、カテゴリ未確認を未分類へ変換する
  - 確認値、元表記、取得元、取得日時を上流契約の別フィールドへ写し、余剰ページ値を除外する
  - 欠損を含む有効セッションが型安全な候補ドラフトになり、不正セッションは項目エラーになる
  - _Requirements: 3.5, 3.6, 4.5, 5.1, 5.2, 5.3, 5.4_

- [ ] 5.2 候補作成ポートへ一度だけ保存する
  - 選択projectへ既存ポート経由で候補を作成し、永続化・容量・移行ロジックを重複実装しない
  - 成功時はprojectと完了状態を表示し、失敗時はドラフトと選択を保持して上流エラーを案内する
  - 同一保存操作で候補が一件だけ作成され、未分類候補も上流規則どおり保存される
  - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 6.3_

- [ ] 6. 取り込み全体の受け入れフローと回帰を検証する
- [ ] 6.1 actionから候補保存までを統合する
  - application shellがside panel registration、worker registration、`public.ts`をcompositionし、feature側から共有runtime入口とroot barrelを編集しない
  - action、抽出、順位付け、確認、修正、project選択、候補作成を既存runtimeとサイドパネルへ接続する
  - 情報が十分な架空ページと欠損のある架空ページの両方で、保存完了まで一連の操作が成立する
  - 同じ架空sessionから詳細編集を選ぶと候補管理が型付きprefillで開き、戻った場合もcapture sessionが維持される
  - すべての読取・更新が責任境界を守り、content scriptから保存領域を直接操作できない
  - _Depends: application-shell 4.1, 5.3; project-candidate-management 4.2; local tasks 4.4, 5.2_
  - _Requirements: 1.1, 2.1, 2.2, 2.4, 3.5, 4.1, 4.2, 5.1, 5.3, 5.4, 5.5_

- [ ] 6.2 失敗・安全性・fixture制約の回帰テストを完成する
  - 権限失効、制限ページ、ページ遷移、形式不正、抽出失敗、projectなし、容量不足、保存失敗、重複送信を検証する
  - 商品値・完全URL・HTMLがログや保存payloadへ漏れず、実行可能なページ値が描画されないことを検証する
  - テスト資産が架空HTMLと架空商品だけで構成され、実サイトHTML、画像、取得データなしで全テストが通る
  - _Requirements: 1.4, 1.5, 2.5, 3.1, 3.2, 3.3, 3.4, 4.5, 4.6, 5.2, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3_

## Implementation Notes

- Task 1: `scripts/validate-artifacts.mjs`のvalidateManifestは共有tooling（全specの`pnpm validate:final-build`から使われる）。permission許可listの拡張は`tests/tooling/final-validation-gate.test.ts`の合成manifest fixtureにも`action`/新permissionsを反映しないと既存成功系testが壊れる。
