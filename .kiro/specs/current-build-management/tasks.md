# Implementation Plan

- [x] 1. 現在構成の公開契約とカテゴリポリシーを確立する
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

- [x] 2. 現在構成の照会と更新規則を実装する
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

- [x] 3. Foundationの原子的参照修復を統合する
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

- [x] 4. 現在構成の画面状態と表示を実装する
- [x] 4.1 読込・保存・失敗回復の画面状態を実装する
  - feature再表示・project再選択で候補と現在構成を再照会し、修復後状態を表示stateへ反映する。
  - 選択project・カテゴリ、候補、commit済み構成snapshot、数量draft、保存中操作、表示errorを分離する。
  - 読込revisionを更新contextへ渡し、成功時だけcommit後snapshotへ置換して同じ操作の二重送信を抑止する。
  - 保存失敗、競合、maintenance、破損・非対応・利用不能を回復方針へ写像し、必要な場合は変更操作を無効化する。
  - 完了時、再読込、成功、失敗、競合、二重送信、操作停止のstate testで永続結果と表示stateが一致する。
  - _Depends: 2.1, 2.2, 2.3, 3.2_
  - _Requirements: 1.1, 1.2, 1.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: BuildState_

- [x] 4.2 rollback用のopaque画面snapshotを実装する
  - 選択project・カテゴリと未保存数量draftだけをversion付きJSON値としてcaptureし、永続root、保存中request、購読、React objectを含めない。
  - shellから渡されたunknownをfeature境界で検証し、永続データ読込後に存在するproject・candidateだけを復元する。
  - 不正shape、未知version、stale参照では永続データを変更せず初期表示へ退避して識別可能なerrorを示す。
  - 完了時、capture/restore、invalid、unknown version、stale referenceのcodec testが成功する。
  - _Depends: 4.1_
  - _Requirements: 1.1, 1.2, 5.2, 5.3_
  - _Boundary: BuildStateSnapshotCodec_

- [x] 4.3 (P) カテゴリ別候補と現在構成をReactで表示する
  - 選択project・カテゴリに属する候補だけを表示し、未分類候補を選択肢へ含めない。
  - 単一カテゴリの選択・置換・解除と、複数カテゴリの追加・数量・解除操作を画面状態へ接続する。
  - 候補なし・構成なし、数量error、保存error、参照error、修復後の除外を識別可能に表示する。
  - 外部文字列を安全なJSX childとして描画し、完了時に主要操作と空・error状態のDOM testが成功する。
  - _Depends: 4.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 4.2, 4.5, 5.3, 5.4_
  - _Boundary: BuildView_

- [x] 4.4 snapshot-awareなfeature registrationを実装する
  - current-buildの公開query、navigation metadata、availability、mount lifecycleをshell登録契約へ提供する。
  - shellのoperation policyを変更可否へ反映し、専用feature containerだけへReact rootをmountする。
  - 復元候補をfeature内codecで検証し、mounted handleは同じcodecのopaque snapshotだけをcaptureする。
  - unmount時に購読解除とReact root cleanupを一度だけ実行する。
  - 完了時、登録shape、availability、operation policy、restore/capture、cleanupのshell contract testが成功する。
  - _Depends: application-shell 1.3, application-shell 1.4, application-shell 4.1, application-shell 5.1, application-shell 5.2, application-shell 5.3, 4.2, 4.3_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.2, 4.5, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: CurrentBuildFeatureRegistration_

- [x] 5. side panel統合と受け入れ回帰を完成する
- [x] 5.1 Foundation・候補query・shellへ現在構成機能を統合する
  - candidate-managementの公開入口から分類済み候補queryだけを受け取り、feature内部へのdeep importを行わない。
  - current-buildのquery、service、state、view、registration、公開APIをcompositionへ渡し、Storage APIと共有runtime入口をfeature側から直接操作しない。
  - maintenance中は読取を維持しつつ変更操作を拒否し、通常時はproject選択から単一・複数候補の採用、数量変更、解除、再表示までを完了できるようにする。
  - 完了時、既存side panel host上で一連の管理フローが動作し、root公開APIから同じcommit済み構成を取得できる統合testが成功する。
  - _Depends: application-shell 4.1, application-shell 4.2, application-shell 4.4, application-shell 4.5, project-candidate-management 6.1, 4.4_
  - _Requirements: 1.1, 1.2, 2.2, 2.3, 2.4, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: Current build side panel integration_

- [x] 5.2 構成管理と下流公開契約の受け入れ回帰を完成する
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
- design.mdのSystem Flows図（Mermaid sequence diagram）はmutation経路だけを描いており、BuildStateがCurrentBuildQuery/CandidateQueryへ直接依存する読込経路は描かれていない。Components tableは「Service P0、Query P0」とだけ記載しCandidateQueryを明示しないが、BuildServiceの契約(execute()のみ)には一覧取得手段がないため、候補・project一覧の読込はcandidate-managementのManagementState前例（stateがqueryとserviceを両方直接持つ）に倣いBuildStateから CandidateQuery.listProjects/listBuildEligible を直接呼ぶ設計とした。
- BuildErrorの無効化(構成変更を無効化)対象はrequirement 5.4が明示する3種類（corrupt-data・unsupported-data・storage）に限定し、quota・maintenance・conflictは再試行/再読込可能な一時的失敗として扱う。quotaを無効化対象に含めると5.4の文言（容量超過ではなく「破損・非対応・利用不能」）と食い違うため注意。
- BuildStateはproject単位でしか候補を先読みしない（BuildService/CurrentBuildQueryと同じ設計判断）ため、snapshot codecのstale候補参照チェックは「現在選択中のcategoryで絞り込まれたvalue.candidates」ではなく、project全体のeligible候補集合に対して行う必要がある。BuildState.hasCandidateReference(candidatePartId, projectId)を追加し、category-management側のManagementState.hasCandidateReferenceと同じ役割を持たせた。
- BuildState.value.selectedCategoryがnullのとき、value.candidatesはprojectの全classified候補（uncategorized以外の全カテゴリ）を含む。BuildViewでカテゴリ別に絞り込む前提のtestを書く場合は、対象カテゴリタブを明示的にクリックしてからassertする必要がある（category未選択=「すべて」相当のため）。
- 単一選択カテゴリの候補には数量入力欄自体を描画しない設計とした。これによりrequirement 2.5（数量変更を許可しない）はUI操作導線を提供しないことで満たされ、reject理由の表示は不要になる。
- BuildStateはproject単位の遅延読込のため、registrationのmount時にrestoredStateの`selectedProjectId`を非権威的にpeekしてから`state.selectProject(...)`で対象projectのeligible候補を先読みし、その後にcodec.restore()で正式検証する必要がある（candidate-managementのManagementStateは全project分を`load()`で先読みするため、この前処理が不要）。検証失敗時は`state.load()`を再実行してphantom選択を確実に既定projectへ戻してからrejectSnapshotRestore()を呼ぶ。
- current-buildのFile Structure Planにreact-root.tsxは含まれないため、React root生成はcandidate-managementのように別ファイルへ分離せずregistration.ts内へ直接実装した。
- File Structure Planにstyles.cssを含めていたが、現状のview.tsxは専用スタイルを必要としないため未実装とした。CSSはTSからimportせずbuild/HTML経由で読み込む方式（candidate-managementのstyles.cssも同様）のため、欠落によるimport依存の破綻はなく、要件にもスタイル指定はない。将来UIの装飾が必要になった時点で追加する。
- side-panel-contributions.tsはcurrent-buildがcandidate-managementの公開queryへ依存するため、均一なfactory配列パターン（[factory1, factory2].map(f => f(context))）をやめ、依存順に明示的に組み立てる形へ変更した。既存の3test（feature-contribution-catalog.test.ts、root-public-api.test.ts、build-smoke.test.ts）は"candidateManagement"単独を前提にしていたため["candidateManagement","currentBuild"]へ更新が必要だった。build-smoke.test.tsはdist/を検査するため、更新後は`pnpm build`を再実行してから`pnpm test`する必要がある。
- 実DOM統合testでReactのview click handlerがstate.execute()をvoidで発火（fire-and-forget）する場合、act()コールバック内で固定tick数のflushを仮定するのは脆い。実Foundation write authorityの確定を待つには、public queryをpollingするwaitUntilヘルパーの方が確実。
- Playwright e2eをworker並列実行すると、UIのPromiseが解決した時点でもchrome.storage.localへの書き込みがまだ確定していないケースがある（並列CPU負荷下でのみ再現）。reload直前にchrome.storage.local.getを直接pollingして永続化を確認してからreloadする方式が、固定waitForTimeoutより確実。
- 全29 acceptance criteria（requirements.md）は既存のunit(category-policy)、contract(contracts/service/query)、integration(reference-repair/query.integration/current-build-flow.integration)、DOM(state/view/registration)、e2eテストで完全に追跡できることを5.2で監査済み。current-build-managementのspecは全task完了。
