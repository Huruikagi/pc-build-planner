# Implementation Plan

- [x] 1. 互換性判定の契約と固定ルールを確立する
- [x] 1.1 判定対象、個別結果、集約結果、失敗の契約を定義する
  - 上流ID・日時・Resultを再利用し、RuleId、確認済み入力、根拠、不足項目を判別可能にする
  - 個別statusと4区分の集約statusを混同せず、結果を読み取り専用の派生スナップショットとして表現する
  - 全5規則と全結果区分が型検査で網羅され、永続モデルを追加しない状態にする
  - _Requirements: 1.2, 1.3, 1.5, 2.6, 4.4, 4.5, 5.5_

- [x] 1.2 固定5種類の純粋ルールを実装する
  - CPUソケットとDDR規格の等値、クーラー・ケース対応集合の包含を確認済み値だけで評価する
  - 左右の属性欠損または未確認値を不足項目付き判定不能とし、非互換へ変換しない
  - 一致、非一致、左右欠損の架空入力に対し、5規則が決定的な個別結果を返す
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 2. 判定対象展開と集約を実装する
- [x] 2.1 (P) 現在構成からルール対象を展開する
  - 構成項目を同一projectの分類済み候補へ結合し、5規則の左右カテゴリごとに候補ID単位の組み合わせを生成する
  - 数量による同一組み合わせの重複を抑止し、カテゴリ欠如をルール単位の不足対象として残す
  - 構成外候補を含めず、別project、存在しない候補、未分類参照を識別可能な失敗として返す
  - _Depends: 1.1_
  - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4, 6.3_
  - _Boundary: TargetExpander_

- [x] 2.2 (P) 個別結果の集約優先規則を実装する
  - 非互換を最優先し、互換と判定不能の混在を注意、全互換を互換あり、判定不能だけを判定不能へ集約する
  - 入力順序が変わっても同じ集約statusを返す
  - 4区分それぞれの代表的な個別結果集合が期待する集約statusになる
  - _Depends: 1.1_
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: ResultAggregator_

- [x] 3. 上流読取と判定サービスを統合する
- [x] 3.1 現在構成と候補照会から互換性reportを生成する
  - CurrentBuildQueryとCandidateQueryをprojectIdで照会し、参照検証後に対象展開、ルール評価、集約を順に実行する
  - 構成なし、読取失敗、破損・非対応、不正参照を結果statusと混同しない失敗へ写像する
  - 同じ入力から個別根拠と集約結果を持つreportが得られ、上流データと現在構成が変更・保存されない
  - _Depends: 1.2, 2.1, 2.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 3.3, 5.5, 5.6, 6.1, 6.2, 6.3_
  - _Boundary: CompatibilityService_

- [x] 3.2 再評価で最新の構成と確認済み属性を反映する
  - 評価要求ごとに上流を再読取し、構成または属性変更後のreportを古い結果から更新する
  - 未確認の元表記だけが変わっても互換性あり・なしの根拠へ混入しない
  - 変更後の確認済み値で再実行すると、対応する個別結果と集約statusが更新される
  - _Requirements: 1.4, 1.5, 4.5_
  - _Boundary: CompatibilityService_

- [x] 4. 互換性画面の状態と表示を実装する
- [x] 4.1 評価の読込、最新性、空、失敗状態を実装する
  - idle、loading、ready、empty、failedを分離し、同時評価では最新世代の完了だけを反映する
  - loading中は以前のreportを最新として操作判断に利用させず、失敗時は誤った互換性statusを表示しない
  - 構成なし、読取失敗、不正参照がそれぞれ識別可能な画面状態になる
  - _Depends: 3.1, 3.2_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: CompatibilityState_

- [x] 4.2 集約結果と個別根拠をReactで安全に表示する
  - framework非依存のCompatibilityStateをpropsとして受け、4区分の集約結果と、各ルールの対象名、比較値または不足項目、理由を同じ画面で確認可能にする
  - 注意事項ありでは互換と判定不能の個別行を隠さず、利用者が補う情報を特定できるようにする
  - マークアップを含む架空パーツ名を通常のJSX childとして表示し、`dangerouslySetInnerHTML`と`innerHTML`を使用しない。空・失敗・loadingをfeature所有のCSSで結果区分と視覚的に区別する
  - _Requirements: 5.5, 5.6, 6.1, 6.2, 6.4, 6.5_
  - _Boundary: CompatibilityView_

- [x] 4.3 React root adapterとfeature registration・合成入口を実装する
  - `view.tsx`をframework非依存のCompatibilityState/Query portへ接続し、`public.ts`、registration module、`FeatureCompositionContext`から`FeatureContribution`を組み立てる合成入口をfeature内で所有する
  - application shellの`FeatureMountContext`へReact rootをmountし、切替・停止時に`root.unmount()`と購読解除を一度だけ行う
  - shell contract test kitで登録、read-only operation policy、公開API、cleanupが適合し、合成入口が返すFeatureContributionをshellが解決できることを確認できる
  - _Depends: application-shell 1.1, 1.3, 1.4; local tasks 4.1, 4.2_
  - _Requirements: 1.1, 1.4, 1.5, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5_
  - _Boundary: CompatibilityFeatureRegistration, ReactRootAdapter_

- [x] 5. side panel統合と受け入れ検証を完成する
- [x] 5.1 互換性機能を既存side panelと公開入口へ統合する
  - shell所有の`side-panel-contributions.ts`へ本機能のcontributionを追加し、featureが返すFeatureContributionをshellがcompositionする。共有runtime入口とroot barrelはfeature側から編集しない
  - 既存の依存順合成に倣い、CandidateQueryとCurrentBuildQueryをそれぞれの上流contributionの公開queryから取得してserviceへ注入し、RepositoryやStorage APIを直接利用せず画面を起動する
  - 現在構成を変更して互換性画面を再表示すると、新しい候補と確認済み属性の結果が表示される
  - 選択済み候補だけの全5規則を、同じside panel内で根拠付き確認できる
  - _Depends: application-shell 4.1; local task 4.3_
  - _Requirements: 1.1, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.3, 5.5, 5.6_
  - _Boundary: Side panel integration_

- [x] 5.2 固定ルールの回帰テストを完成する
  - 全5規則それぞれの一致、不一致、左右の属性不足、未確認値を架空データで検証する
  - 入力順序と実行順序を変えても個別結果が同一で、未確認値を断定根拠にしないことを検証する
  - RuleRegistryの全規則と個別status分岐が独立した自動テストで再現可能になる
  - _Depends: 1.2_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: RuleRegistry tests_

- [x] 5.3 対象展開の回帰テストを完成する
  - 複数メモリ候補の全ペア、数量重複抑止、カテゴリ欠如、構成外候補と不正参照を架空データで検証する
  - project、partId、categoryの参照検証と5規則の対象有無が期待する対象または失敗へ写像される
  - TargetExpanderの全分岐が独立した自動テストで再現可能になる
  - _Depends: 2.1_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.3_
  - _Boundary: TargetExpander tests_

- [x] 5.4 集約優先規則の回帰テストを完成する
  - 非互換優先、互換と不明の注意、全互換、全不明を検証する
  - 個別結果の順序を入れ替えても集約statusが変わらないことを確認する
  - ResultAggregatorの4区分と優先分岐が独立した自動テストで再現可能になる
  - _Depends: 2.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: ResultAggregator tests_

- [x] 5.5 service、状態、画面の統合・受け入れテストを完成する
  - 構成なし、不正参照、読取失敗、遅延した旧評価、安全なReact DOM描画とunmount cleanupで誤った最新結果を示さないことを検証する
  - 読取失敗や評価失敗時のログへパーツ名、URL、属性値が出力されないことを架空の機密値で検証する
  - 現在構成の選択から不一致、部分不足の注意、全不足の判定不能までの受け入れフローが通り、上流保存値が不変である
  - _Depends: 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5_
  - _Boundary: Compatibility acceptance tests_

- [x] 6. 現在プロジェクト追従と最新性制御を追加する
- [x] 6.1 project contextを互換性評価用availabilityへ射影する
  - 検証済みreadyのprojectIdとgenerationだけをauthorityとして扱い、emptyとunavailableを代替選択なしで区別する
  - 同一generation・同一projectの重複通知で再評価を増やさず、購読解除後の通知が状態を変えないconsumer adapterを提供する
  - ready、empty、unavailableのsnapshotと購読解除が独立テストで観測できる
  - _Depends: project-context 2.4, 4.4_
  - _Requirements: 1.1, 1.6, 7.1, 7.2, 7.5, 7.7, 7.9_
  - _Boundary: CompatibilityProjectContextAdapter_

- [x] 6.2 context最新性、empty-build契約、日英回復表示をatomicに統合する
  - ready通知ごとに以前のreportを直ちに外して最新projectを評価し、context generationと要求番号が一致する完了だけをreadyへ反映する
  - empty、unavailable、構成なし、構成空、読取・参照失敗をno-projects、context-unavailable、empty-build、failedとして結果から分離する
  - 構成recordは存在するが選択itemが0件のとき、query/service契約からempty-buildを生成し、状態と表示まで同じ変更単位で接続する
  - 再試行はadapterの最新snapshotを読み直し、現在readyのprojectだけを再評価する
  - 既存完了タスク4.1の5状態モデルは完了履歴として保持し、本タスクが現設計の7状態とcontext世代モデルで置き換える
  - AからBへの切替、遅延A完了、unavailableからreadyへの回復、再試行で、旧結果や代替projectが表示状態へ戻らない
  - 日本語と英語の同一message key群で全状態と再試行をアクセシブルに表示し、native button、live region、安全なJSX childをconsumer移行と同じ変更単位で検証する
  - _Depends: 3.1, 3.2, 6.1_
  - _Requirements: 1.4, 1.6, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: CompatibilityQuery, CompatibilityService, CompatibilityState, CompatibilityView, compatibility message catalogs, task-local tests_

- [x] 7. 日英表示とfeature lifecycleを統合する
  - _Integrated: 旧タスク7.1の日英状態・根拠・回復表示は、公開状態契約のconsumer移行をatomicに保つためタスク6.2へ統合済み_

- [x] 7.2 context購読をfeature registrationとmount lifecycleへ接続する
  - shellから注入されたProjectContextReadPortをowner-local adapterへ渡し、mount時にstate購読と評価を開始する
  - feature-contribution、registration、公開query、React rootを既存ApplicationFeatureRegistration契約へ接続し、unmount時にrootとcontext購読を一度だけ解放する
  - 既存完了タスク5.1は旧production compositionの履歴として保持し、本タスクが共有fileを所有しない現feature境界で置き換える
  - production composition共有fileを本specで変更せず、project-contextとcurrent-buildの更新完了を前提にshellが注入可能なFeatureContributionを返す
  - contract test kitで登録、read-only operation policy、公開API、mount/unmount cleanupが観測できる
  - _Depends: 6.1, 6.2; project-context 2.4, 4.4; current-build-management 9_
  - _Requirements: 1.1, 1.5, 1.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: CompatibilityFeatureRegistration, ReactRootAdapter_

- [ ] 8. context追従とアクセシビリティの回帰検証を完成する
- [ ] 8.1 (P) adapterとstateのcontext遷移を自動テストする
  - ready AからB、empty、unavailable、unavailableからready、重複通知、解除後通知、遅延完了破棄、最新snapshot再試行を架空portで検証する
  - project 0件、利用不能、構成空、失敗の各状態が互換性reportを保持せず、異なるprojectへfallbackしないことを検証する
  - context generationと評価要求番号の全分岐が決定的なテスト結果として再現できる
  - _Depends: 6.1, 6.2_
  - _Requirements: 1.6, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9_
  - _Boundary: Compatibility context adapter and state tests_

- [ ] 8.2 (P) 日英DOMと回復操作を自動テストする
  - 日本語・英語で全結果、空・失敗理由、再試行ラベルが対応するmessageから表示されることをtesting-libraryで検証する
  - テキスト識別、live region、native buttonのkeyboard操作、安全なJSX child描画をuser-eventと架空文字列で検証する
  - 両言語の全状態とアクセシビリティ要件がDOM testで再現可能になる
  - _Depends: 6.2_
  - _Requirements: 6.5, 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: Compatibility view DOM tests_

- [ ] 8.3 project切替から結果表示までの統合・E2Eを完成する
  - feature contributionを架空context、build、candidate queryと合成し、切替後projectだけのreport、旧要求破棄、購読解除、上流不変を検証する
  - production buildした拡張で共通selectorを切り替え、不一致、部分不足、全不足、project 0件、構成空、日英表示を確認する
  - roadmapのapplication-shell production wiring更新は未発番の外部owner taskであり、その完了後だけE2Eを実行する
  - `pnpm validate`の既存gateで型、lint、境界、fixture、test、build、E2Eが通り、実サイト由来fixtureや機微値ログを含まない
  - _Depends: 7.2, 8.1, 8.2; application-shell roadmap production-wiring update_
  - _Requirements: 1.1, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: Compatibility integration and E2E tests_
