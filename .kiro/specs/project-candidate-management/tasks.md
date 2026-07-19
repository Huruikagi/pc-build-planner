# Implementation Plan

- [ ] 1. application shellへの管理feature参加境界を整える
  - `local-data-foundation` の公開ドメイン契約と、application shellのside panel host、React基盤、registration contract、contract test kitが利用可能であることを前提確認する
  - feature内に`public.ts`、`registration.ts`、style入口の骨格を作り、共有manifest、side panel document、runtime入口、root barrelを変更しない
  - 模擬registrationがshell contract test kitへ適合し、production buildにfeature-local moduleとstyleだけが取り込まれることを確認する
  - _Depends: application-shell 1.1, 1.2, 1.3, 1.4, 4.1_
  - _Requirements: 6.1, 6.2_
  - _Boundary: CandidateFeatureEntry_

- [ ] 2. 管理ドメイン契約と業務サービスを実装する
- [ ] 2.1 プロジェクト管理コマンドを実装する
  - 作成、名前変更、削除をFoundation Repositoryの一貫した更新へ接続する
  - 空名を項目エラーとして拒否し、削除時は所属候補のカスケード結果を返す
  - 有効な操作後に保存済みプロジェクトが返り、失敗時に既存ルートが維持される
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2.2 候補の作成・編集コマンドを実装する
  - 商品名以外の欠損を許容し、候補を単一プロジェクトへ所属させる
  - カテゴリ変更で共通項目と元表記を保持し、新カテゴリ属性だけを明示入力から構築する
  - 未分類を含む有効な候補が保存され、不正項目はpath付きエラーになる
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 2.3 プロジェクト・カテゴリ別の候補照会契約を実装する
  - 指定プロジェクト以外の候補を返さず、カテゴリ指定時は該当候補だけを返す
  - 取り込み向け作成契約と、未分類を除く構成管理向け参照契約を公開する
  - 架空データでプロジェクト別、全カテゴリ、未分類、構成利用可能一覧が確認できる
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 6.3, 6.4, 6.5_

- [ ] 2.4 候補削除コマンドを実装する
  - IDで対象候補だけを削除し、存在しない対象と保存失敗を判別する
  - 削除成功後も同じプロジェクトの他候補が保持される
  - _Requirements: 5.2, 5.4_

- [ ] 3. 管理画面の状態と表示を実装する
- [ ] 3.1 (P) 読込・選択・編集状態を実装する
  - 永続スナップショットと編集ドラフトを分離し、操作中の二重送信を抑止する
  - 保存失敗時は一覧と入力を維持し、破損・容量・非対応エラーを識別可能にする
  - 再読込で保存済み選択肢と確認値が復元される
  - _Depends: 2.1, 2.2, 2.3, 2.4_
  - _Requirements: 1.5, 2.5, 4.2, 4.5, 5.4, 6.1, 6.2_
  - _Boundary: ManagementState_

- [ ] 3.2 (P) プロジェクト・カテゴリ別React一覧を実装する
  - framework非依存のManagementStateをpropsとして受け、プロジェクト選択、全カテゴリタブ、候補一覧、未分類一覧をReact componentで描画する
  - 表示文字列は通常のJSX childとして扱い、`dangerouslySetInnerHTML`と`innerHTML`を使用しない
  - 欠損項目を「未入力」として表示し、異なるプロジェクトの候補を混在させない
  - 利用者がプロジェクトとカテゴリを切り替えると該当候補だけが画面に残る
  - _Depends: 2.3_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Boundary: ManagementView_

- [ ] 3.3 プロジェクト編集Reactフォームを実装する
  - プロジェクトの作成と名前変更を同じ名前規則で扱い、空名エラーを対象入力へ関連付ける
  - 作成・変更成功時はプロジェクト一覧へ反映し、失敗時は入力内容を保持する
  - 新規プロジェクト作成と既存名変更が画面から完了する
  - _Depends: 3.1, 3.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [ ] 3.4 候補編集Reactフォームを実装する
  - 共通項目、カテゴリ属性、読み取り専用の元表記を区別して表示する
  - カテゴリ変更で適切な属性入力へ切り替え、項目エラーを対象入力へ関連付ける
  - 作成・更新成功時は一覧へ反映し、失敗時は入力内容を保持する
  - _Depends: 3.1, 3.2_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 3.5 削除確認フローを実装する
  - 対象名と影響範囲を示し、確認時だけ削除コマンドを実行する
  - 取消時は状態が変わらず、失敗時は対象を一覧へ残す
  - プロジェクト削除と候補削除の両方で誤操作防止が確認できる
  - _Requirements: 1.4, 5.1, 5.2, 5.3, 5.4_

- [ ] 3.6 React root adapterとfeature registrationを実装する
  - `view.tsx`をframework非依存のManagementState/Service portへ接続し、`public.ts`とregistration moduleをfeature内で所有する
  - application shellの`FeatureMountContext`へReact rootをmountし、切替・停止時に`root.unmount()`と購読解除を一度だけ行う
  - shell contract test kitで登録、mount、operation policy、cleanupが適合することを確認できる
  - _Depends: application-shell 1.1, 1.3, 1.4; local tasks 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 6.2, 6.3, 6.4, 6.5_
  - _Boundary: CandidateFeatureRegistration, ReactRootAdapter_

- [ ] 4. 境界統合と受け入れフローを検証する
- [ ] 4.1 管理UIとFoundation Repositoryを統合する
  - application shellがfeatureの`registration.ts`と`public.ts`をcompositionし、共有runtime入口、HTML host、root barrelをfeature側から編集しない
  - すべての読取・更新が公開Repositoryを経由し、Storage API直接利用がないことを確認する
  - 保存成功時だけ画面スナップショットを更新し、再起動後も内容を復元する
  - プロジェクト作成から候補登録、分類補正、編集、削除まで一連の操作が完了する
  - _Depends: application-shell 4.1; local task 3.6_
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.4, 3.1, 3.5, 4.2, 4.4, 5.2, 6.1, 6.2_

- [ ] 4.2 後続機能向け公開契約と回帰テストを完成する
  - 取り込み側が欠損を含む候補を単一プロジェクトへ作成できることを契約テストで示す
  - 構成管理側の照会が分類済み候補だけを返し、カテゴリ変更後の値を参照できることを示す
  - 実サイトデータを使わず全カテゴリ、欠損、保存失敗、削除取消のテストが通る
  - _Depends: 4.1_
  - _Requirements: 2.1, 2.2, 3.2, 3.4, 4.3, 4.6, 5.3, 6.3, 6.4, 6.5_
