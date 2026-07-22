# Implementation Plan

- [ ] 1. 現在構成の公開契約とカテゴリポリシーを確立する
- [x] 1.1 現在構成の操作・読取・失敗契約を定義する
  - Foundationが所有するID、CurrentBuild、BuildItem、正整数、revision、Resultを再利用し、候補詳細や互換性結果を重複させない。
  - 選択、数量変更、解除を表す操作と、request ID・expected revisionを持つ更新context、回復方針を選べる失敗分類を揃える。
  - project別のrevisionと0件または1件の現在構成を読み取り専用で返す公開契約を提供する。
  - 完了時、下流consumerの型検査でcanonical候補ID・数量を参照でき、候補詳細や互換性結果へ依存できない。
  - _Requirements: 4.5, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: CurrentBuildPublicApi, CurrentBuildQuery, BuildService contracts_

- [x] 1.2 カテゴリ別の選択ポリシーを実装する
  - CPU、CPUクーラー、マザーボード、電源、ケースを単一選択にする。
  - メモリ、GPU、ストレージ、ケースファン、拡張カード、その他を複数選択にし、canonicalな未分類カテゴリを選択不可にする。
  - 単一カテゴリは数量1、複数カテゴリは正整数だけを受け付ける規則を一元化する。
  - 完了時、全canonicalカテゴリの網羅テストが各カテゴリをちょうど一つの方式へ分類し、カテゴリ追加時の未処理分岐を検出する。
  - _Requirements: 1.3, 2.1, 2.5, 3.1, 3.4_
  - _Boundary: CategoryPolicy_

- [ ] 2. 現在構成の照会と更新規則を実装する
- [x] 2.1 (P) project別の現在構成を検証して照会する
  - 検証済みrootからprojectのrevisionと0件または1件の現在構成を読み、構成なしを正常な空結果として扱う。
  - 同じprojectの分類済み候補だけを参照し、候補ID重複、複数構成、カテゴリ別選択数違反を変更停止errorへ変換する。
  - 候補参照と正整数数量だけを公開し、互換性結果や候補詳細を返さない。
  - 完了時、正常・空・複数構成・重複・未分類・別project参照のquery testが決定的に成功する。
  - _Depends: 1.1, 1.2_
  - _Requirements: 1.1, 1.3, 1.4, 4.5, 5.2, 5.4, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: CurrentBuildQuery_

- [x] 2.2 (P) 単一選択カテゴリの更新規則を実装する
  - 同一projectの分類済み候補だけを受け付け、初回選択では新しい構成を作成し、既存構成では同じ構成IDを維持して更新する。
  - 未選択からの選択、別候補への置換、選択解除を数量1の規則で処理し、数量変更要求を拒否する。
  - request IDと読込revisionをFoundationの原子的mutationへ渡し、成功後にcommit済み構成を再照会する。
  - CandidateQueryとFoundationの失敗を利用者が再試行・再読込・操作停止を選べる失敗へ写像する。
  - 完了時、作成・置換・解除・ID維持・revision競合・保存失敗のservice testで、失敗時に直前構成が変化しない。
  - _Depends: 1.1, 1.2_
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 5.1, 5.3, 5.4_
  - _Boundary: BuildService_

- [x] 2.3 複数選択カテゴリと数量の更新規則を実装する
  - 既存項目を維持した候補追加、正整数の数量変更、対象候補だけの解除を同じ更新境界で扱う。
  - 同一候補の再追加を重複項目にせず、単一の数量へ集約する。
  - 不正数量と選択対象外候補を保存前に拒否し、既存の有効な構成を保持する。
  - 完了時、追加・数量変更・解除・重複防止・不正数量拒否のservice testで、保存結果がcanonical構成規則へ一致する。
  - _Depends: 2.2_
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.3_
  - _Boundary: BuildService_

- [ ] 3. Foundationの原子的参照修復を統合する
- [x] 3.1 候補・project変更時の参照修復を契約検証する
  - 候補削除、未分類化、カテゴリ変更、project削除で無効になる構成参照が、上流mutationと同じcommitから除去されることを確認する。
  - current-build側から成功後のreconcile writeを発行せず、無関係な候補参照と数量が維持されることを確認する。
  - 完了時、各変更の保存回数が1回で、修復後queryに無効参照がなく、既存の有効な単一選択が維持される統合testが成功する。
  - _Depends: local-data-foundation 3.2, local-data-foundation 4.4, local-data-foundation 4.7, local-data-foundation 6.9, project-candidate-management 2.3, project-candidate-management 2.4, 2.1, 2.2, 2.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.3_
  - _Boundary: Foundation reference repair contract integration_

- [x] 3.2 修復済み構成の照会と不正参照の停止動作を統合する
  - 候補・project変更のcommit後に現在構成を再照会し、修復された候補参照と数量だけを返す。
  - Foundationが拒否する存在しない候補・別project参照と、feature固有不変条件違反を採用品として返さず、変更停止errorへ変換する。
  - 完了時、各上流変更後のqueryが追加writeなしで修復済み構成を返し、不正rootでは識別可能なerrorとなるintegration testが成功する。
  - _Depends: 3.1_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.4_
  - _Boundary: CurrentBuildQuery integration_

- [ ] 4. 現在構成の画面状態と表示を実装する
- [ ] 4.1 読込・保存・失敗回復の画面状態を実装する
  - feature再表示・project再選択で候補と現在構成を再照会し、修復後状態を表示stateへ反映する。
  - 選択project・カテゴリ、候補、commit済み構成snapshot、数量draft、保存中操作、表示errorを分離する。
  - 読込revisionを更新contextへ渡し、成功時だけcommit後snapshotへ置換して同じ操作の二重送信を抑止する。
  - 保存失敗、競合、maintenance、破損・非対応・利用不能を回復方針へ写像し、必要な場合は変更操作を無効化する。
  - 完了時、再読込、成功、失敗、競合、二重送信、操作停止のstate testで永続結果と表示stateが一致する。
  - _Depends: 2.1, 2.2, 2.3, 3.2_
  - _Requirements: 1.1, 1.2, 1.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: BuildState_

- [ ] 4.2 rollback用のopaque画面snapshotを実装する
  - 選択project・カテゴリと未保存数量draftだけをversion付きJSON値としてcaptureし、永続root、保存中request、購読、React objectを含めない。
  - shellから渡されたunknownをfeature境界で検証し、永続データ読込後に存在するproject・candidateだけを復元する。
  - 不正shape、未知version、stale参照では永続データを変更せず初期表示へ退避して識別可能なerrorを示す。
  - 完了時、capture/restore、invalid、unknown version、stale referenceのcodec testが成功する。
  - _Depends: 4.1_
  - _Requirements: 1.1, 1.2, 5.2, 5.3_
  - _Boundary: BuildStateSnapshotCodec_

- [ ] 4.3 (P) カテゴリ別候補と現在構成をReactで表示する
  - 選択project・カテゴリに属する候補だけを表示し、未分類候補を選択肢へ含めない。
  - 単一カテゴリの選択・置換・解除と、複数カテゴリの追加・数量・解除操作を画面状態へ接続する。
  - 候補なし・構成なし、数量error、保存error、参照error、修復後の除外を識別可能に表示する。
  - 外部文字列を安全なJSX childとして描画し、完了時に主要操作と空・error状態のDOM testが成功する。
  - _Depends: 4.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 4.2, 4.5, 5.3, 5.4_
  - _Boundary: BuildView_

- [ ] 4.4 snapshot-awareなfeature registrationを実装する
  - current-buildの公開query、navigation metadata、availability、mount lifecycleをshell登録契約へ提供する。
  - shellのoperation policyを変更可否へ反映し、専用feature containerだけへReact rootをmountする。
  - 復元候補をfeature内codecで検証し、mounted handleは同じcodecのopaque snapshotだけをcaptureする。
  - unmount時に購読解除とReact root cleanupを一度だけ実行する。
  - 完了時、登録shape、availability、operation policy、restore/capture、cleanupのshell contract testが成功する。
  - _Depends: application-shell 1.3, application-shell 1.4, application-shell 4.1, application-shell 5.1, application-shell 5.2, application-shell 5.3, 4.2, 4.3_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.2, 4.5, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: CurrentBuildFeatureRegistration_

- [ ] 5. side panel統合と受け入れ回帰を完成する
- [ ] 5.1 Foundation・候補query・shellへ現在構成機能を統合する
  - candidate-managementの公開入口から分類済み候補queryだけを受け取り、feature内部へのdeep importを行わない。
  - current-buildのquery、service、state、view、registration、公開APIをcompositionへ渡し、Storage APIと共有runtime入口をfeature側から直接操作しない。
  - maintenance中は読取を維持しつつ変更操作を拒否し、通常時はproject選択から単一・複数候補の採用、数量変更、解除、再表示までを完了できるようにする。
  - 完了時、既存side panel host上で一連の管理フローが動作し、root公開APIから同じcommit済み構成を取得できる統合testが成功する。
  - _Depends: application-shell 4.1, application-shell 4.2, application-shell 4.4, application-shell 4.5, project-candidate-management 6.1, 4.4_
  - _Requirements: 1.1, 1.2, 2.2, 2.3, 2.4, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: Current build side panel integration_

- [ ] 5.2 構成管理と下流公開契約の受け入れ回帰を完成する
  - 全カテゴリpolicy、別project・未分類・不正数量拒否、複数構成・重複・不正参照の操作停止を架空データで検証する。
  - 候補・projectの変更と同じcommitで参照が修復され、追加writeなしで他の選択が保持されることを検証する。
  - 再起動後の構成、activation rollback後の未保存UI状態、下流queryが同じ候補ID・数量を返すことを検証する。
  - 型検査、境界検査、lint、unit・contract・DOM・integration・E2E、production buildの一連の検証を通す。
  - 完了時、canonical validationが成功し、全29 acceptance criteriaを自動testで追跡できる。
  - _Depends: 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: Current build acceptance validation_

## Implementation Notes

- BuildService.execute（2.2）はBuildCommandの3種を単一のswitchで扱うため、CategoryPolicyのmode分岐（single/multiple）は2.2の時点で自然に実装済みとなった。2.3は新規実装ではなく、2.2で未検証だった複数選択カテゴリ経路（追加・数量変更・解除・重複防止・不正数量拒否）へservice testを追加してcanonical構成規則を証明するタスクだった。src側の変更は不要だった。
- 3.1はlocal-data-foundationのreferenceRepairPolicy（候補削除・カテゴリ変更で変更対象自身のBuildItemだけを無条件に除去し、無関係な参照は触れない）と、current-build-managementのCurrentBuildQuery（2.1）を実データポートで結合するintegration testのみで完結した。src側の変更は不要で、Foundation側の修復が既にrequirement 4.1-4.4を満たしていることを確認できた。
- Foundationのschema validator（src/domain/validation.ts）は、currentBuild.items.candidatePartIdが同一project内の実在candidateを参照することを既にroot検証で強制している。存在しない候補・別project候補への参照はrepository.readRoot()の時点でcorrupt-dataとして拒否され、CurrentBuildQueryの不変条件チェックへは到達しない。一方、build重複・item重複・未分類参照・カテゴリ別選択数はFoundationが関知しないfeature固有不変条件であり、CurrentBuildQuery（2.1）が担う。3.2はこの分担を実Foundation stackで証明するintegration testのみで完結し、src側の変更は不要だった。
