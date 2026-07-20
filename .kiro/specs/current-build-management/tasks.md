# Implementation Plan

- [ ] 1. 現在構成の契約とカテゴリポリシーを確立する
- [ ] 1.1 現在構成のコマンド、結果、表示契約を定義する
  - Foundationの候補ID、プロジェクトID、CurrentBuild、Resultを再利用し、候補詳細や互換性結果を重複させない
  - 選択、数量変更、解除、revision競合、maintenanceを判別可能な入力と失敗結果で表現する
  - 下流がプロジェクト単位で読み取り専用の候補参照と数量を取得できる契約が型検査を通る
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_

- [ ] 1.2 カテゴリ別の選択ポリシーを実装する
  - CPU、CPUクーラー、マザーボード、電源、ケースを単一選択にする
  - メモリ、GPU、ストレージ、ケースファン、拡張カード、その他を複数選択にし、未分類を選択不可にする
  - 全カテゴリが一つの方式へ網羅的に分類され、単一カテゴリは数量1固定として検証される
  - _Requirements: 1.3, 2.1, 2.5, 3.1_

- [ ] 2. 現在構成の業務サービスと照会を実装する
- [ ] 2.1 単一選択の更新規則を実装する
  - 同一プロジェクトの分類済み候補だけを受け付け、初回選択と候補置換を一つの更新として保存する
  - 選択解除でカテゴリを空にし、数量変更要求を拒否する
  - 保存後の単一カテゴリには候補が最大一つ、数量が1の項目だけ存在する
  - _Depends: 1.1, 1.2_
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 5.1, 5.3_

- [ ] 2.2 複数選択と数量の更新規則を実装する
  - 複数候補を維持しながら候補を数量1で追加し、同一候補の再追加を重複項目にしない
  - 正整数だけを数量として保存し、解除時は対象候補だけを除外する
  - 有効な数量変更後に指定値が一項目へ反映され、不正数量では直前の構成が保持される
  - _Depends: 1.1, 1.2_
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.3_

- [ ] 2.3 (P) 下流向け現在構成照会を実装する
  - プロジェクトごとに保存済み構成を最大一つ返し、未作成を正常な空結果として区別する
  - 検証済みの候補ID、数量、更新日時だけを読み取り専用スナップショットにする
  - 保存直後の候補と数量を照会でき、候補詳細と互換性結果が返却値へ含まれない
  - _Depends: 1.1_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: CurrentBuildQuery_

- [ ] 3. Foundationの候補参照修復契約を統合する
- [ ] 3.1 原子的な候補参照修復を契約検証する
  - 候補削除、未分類化、保持不能なカテゴリ変更が候補mutationと同じcommitで対象参照だけを除去することをFoundation fixtureで検証する
  - current-build featureから成功後のreconcile mutationを発行せず、他候補と数量が維持されることを確認する
  - 完了時、修復後のqueryと下流照会に無効な候補IDが残らず、candidate mutationの保存回数が一回になる
  - _Depends: local-data-foundation ReferenceRepairPolicy; project-candidate-management 4.1; local task 2.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.3_
  - _Boundary: Foundation reference repair contract integration_

- [ ] 3.2 修復済み構成の再読込を実装する
  - feature再表示またはproject再選択時にCurrentBuildQueryを再実行し、Foundationが修復した構成をUI stateへ反映する
  - 修復不能な不正参照は採用品として表示せず、変更操作を停止するtyped errorへ変換する
  - 完了時、候補変更後の画面に修復済み構成が表示され、追加の保存操作なしで他の選択が維持される
  - _Depends: 3.1_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.4_
  - _Boundary: CurrentBuildQuery, BuildState_

- [ ] 4. 現在構成の画面状態と表示を実装する
- [ ] 4.1 読込、保存、失敗回復の状態を実装する
  - 選択プロジェクト・カテゴリ、永続スナップショット、保存中操作、表示エラーを分離する
  - 成功時だけ構成スナップショットを置換し、同じ変更の二重送信を抑止する
  - 再読込で保存済み構成が復元され、破損・非対応・利用不能時は変更操作が無効になる
  - _Depends: 2.1, 2.2, 2.3, 3.2_
  - _Requirements: 1.1, 1.2, 1.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.4, 5.5_

- [ ] 4.2 カテゴリ別候補と現在構成をReactで表示する
  - framework非依存のBuildStateをpropsとして受け、CandidateQueryの分類済み候補をプロジェクト・カテゴリで表示し、未分類を選択肢から除外する
  - 単一カテゴリには選択・解除、複数カテゴリには選択・数量・解除操作を表示する
  - 空状態、数量エラー、保存エラー、参照エラー、修復後に除去された選択を識別可能に表示し、異なるプロジェクトの候補を混在させない
  - 外部文字列を通常のJSX childとして描画し、`dangerouslySetInnerHTML`と`innerHTML`を使用しないことをDOM testで確認できる
  - _Depends: 4.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 4.2, 4.5, 5.3, 5.4_

- [ ] 4.3 React root adapterとfeature registrationを実装する
  - `view.tsx`をframework非依存のBuildState/Service portへ接続し、`public.ts`とregistration moduleをfeature内で所有する
  - application shellの`FeatureMountContext`へReact rootをmountし、切替・停止時に`root.unmount()`と購読解除を一度だけ行う
  - shell contract test kitで登録、operation policy、公開API、cleanupが適合することを確認できる
  - _Depends: application-shell 1.1, 1.3, 1.4; local tasks 4.1, 4.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.2, 4.5, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: CurrentBuildFeatureRegistration, ReactRootAdapter_

- [ ] 5. side panel統合と受け入れフローを完成する
- [ ] 5.1 現在構成機能を既存side panelとFoundationDataPortへ統合する
  - application shellがfeatureの`registration.ts`と`public.ts`をcompositionし、共有runtime入口とroot barrelをfeature側から編集しない
  - CandidateQuery、BuildService、CurrentBuildQuery、State、Viewを既存ランタイムで組み立て、Storage API直接利用を避ける
  - 候補の分類変更・削除と同じFoundation commitで参照が修復され、current-build側から別writeが発生しないことを確認する
  - プロジェクト選択から単一・複数候補の採用、数量変更、解除、再起動復元まで画面上で完了する
  - _Depends: application-shell 4.1; local task 4.3_
  - _Requirements: 1.1, 1.2, 2.2, 2.3, 2.4, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: Side panel integration_

- [ ] 5.2 構成管理と下流公開契約の回帰テストを完成する
  - 全カテゴリポリシー、別プロジェクト・未分類・不正数量拒否、不正参照の操作停止を架空データで検証する
  - 候補削除、未分類化、保持不能な分類変更、保存失敗で無効参照が残らず他の選択が保持されることを検証する
  - 再起動後の構成と下流照会が同じ候補ID・数量を返し、全受け入れフローが通る
  - _Depends: 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: Current build acceptance tests_
