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
  - 完了時、canonical validationが成功し、全53 acceptance criteriaを自動testで追跡できる。
  - _Depends: 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: Current build acceptance validation_

- [x] 6. 共通の現在プロジェクトへ追従する連携基盤を追加する
- [x] 6.1 現在プロジェクトのavailabilityをfeature状態へ投影する
  - 共通contextの確定済みsnapshotからready、empty、unavailableとgenerationだけをowner-localな状態へ投影する。
  - ready時だけproject IDを公開し、emptyまたはunavailable時は独自のproject選択やfallbackを行わない。
  - context通知を購読し、古いgenerationを無視しながら同じ値の不要な再通知を抑止する。
  - 完了時、ready、empty、unavailable、generation逆転、購読解除のadapter testが成功し、独自selectorを必要としないavailability契約を確認できる。
  - _Requirements: 1.1, 1.5, 1.6, 7.1, 8.2, 8.4_
  - _Boundary: CurrentBuildProjectContextAdapter_

- [x] 6.2 数量draftの切替guardをowner-localに調停する
  - stableなguard所有者として登録し、評価ごとのtoken、切替元・切替先、base generationを保持してfeature側の判断へ渡す。
  - 確認完了前に要求またはgenerationが古くなった場合はallowせず、古い結果をproject-contextへ返さない。
  - forced変更は保存や破棄を代行せずfeature所有者へ通知し、draft内容や保存関数をcontext境界の外へ漏らさない。
  - unmount時はguard登録を一度だけ解除し、解除後の評価や通知がfeature状態を変更しないようにする。
  - 完了時、allow、確認要求、stale、forced通知、二重解除のadapter testがowner fakeを使って成功する。
  - _Requirements: 7.1, 7.7, 7.8_
  - _Boundary: CurrentBuildProjectContextAdapter_

- [x] 7. authority追従stateと安全なdraft保存・復元を実装する
- [x] 7.1 複数の数量draftを一つの原子的更新として保存する
  - 全dirty draftを正整数として先に検証し、一件でも不正ならmutationを発行せず直前の構成を維持する。
  - 有効な数量群は旧projectの一つの現在構成更新へまとめ、request IDと読込revisionによる競合検査を適用する。
  - 成功時はcommit後の構成を再照会し、失敗時は保存済み構成と入力値を変更せず回復可能な失敗を返す。
  - 完了時、複数数量の一括成功、validation失敗、revision競合、保存失敗を検証するservice testで、成功時の保存が一回、失敗時の保存がゼロ回になる。
  - _Requirements: 3.3, 3.4, 5.1, 5.3, 7.3, 7.4_
  - _Boundary: BuildService_

- [x] 7.2 検証済みの現在プロジェクトだけを画面stateへ反映する
  - ready通知では同じprojectの候補と現在構成を読み込み、選択projectをcontext snapshotのprojectionとして保持する。
  - emptyまたはunavailable通知ではproject ID、候補、構成を安全に解放し、project固有の変更操作を停止して理由を示せる状態にする。
  - generationと読込開始時のprojectを照合し、遅れて完了した旧projectの結果を現在stateへ適用しない。
  - lifecycle修復後は追加writeを発行せず構成を再照会し、有効な候補参照だけを表示stateへ反映する。
  - 完了時、ready切替、empty、unavailable、no fallback、stale load、修復後再読込のstate testが成功する。
  - _Depends: 6.1_
  - _Requirements: 1.1, 1.4, 1.5, 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.4, 7.1, 7.7, 7.8_
  - _Boundary: BuildState_

- [x] 7.3 project切替確認と数量draftのlifecycleを管理する
  - 保存済み数量と異なる入力だけをdirty draftとして追跡し、draftがなければ切替を直ちに許可する。
  - 確認中は対象token、切替元・切替先、base generation、対象draftを保持し、保存、破棄、取消の結果を一度だけ確定する。
  - 保存は旧projectへ全dirty draftを一括commitできた場合だけ、破棄は対象draftを除去した場合だけ切替を許可する。
  - validation・保存失敗、取消、stale結果では入力と旧projectを維持し、同じ確認操作や保存操作の重複送信を抑止する。
  - forced変更ではdraftを隔離状態へ移して新projectへ暗黙保存せず、利用者が明示的に破棄するまで内容と案内を保持する。
  - 完了時、draftなし、保存、破棄、取消、validation・保存失敗、stale、forced変更、二重送信のstate testが成功する。
  - _Depends: 6.2, 7.1, 7.2_
  - _Requirements: 5.3, 5.5, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  - _Boundary: BuildState_

- [x] 7.4 version 1 snapshotを非権威的metadataとして復元する
  - 既存のversionとshapeを維持し、unknown入力のfield、値、候補参照をfeature境界で厳密に検証する。
  - snapshotのproject IDは現在のready projectとの一致検査だけに使い、一致時だけカテゴリと参照可能な数量draftを復元する。
  - 不一致、不存在、empty、unavailableでは現在projectを変更せず、安全な初期状態または隔離中draftを維持して案内を返す。
  - 不正shape、未知version、不正参照では永続データと現在projectを変更せず復元を拒否する。
  - 完了時、exact shape、project一致、不一致、不存在、unavailable、invalid、stale referenceのcodec testが成功する。
  - _Depends: 7.2, 7.3_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: BuildStateSnapshotCodec_

- [x] 8. カテゴリ別の採用要約と操作UIを実装する
- [x] 8.1 (P) 全カテゴリの安全な選択要約を日英で生成する
  - 全選択可能カテゴリをcanonical順で返し、単一選択はパーツ名、複数選択は全パーツ名と各数量、空は未選択として表現する。
  - 表示用の短縮とは別に完全なaccessible textを生成し、カテゴリ名、選択内容、数量または未選択状態を識別可能にする。
  - 日本語と英語のmessage catalogから同じ意味の要約を構成し、外部由来名称を実行可能な内容として解釈しない。
  - 完了時、single、multiple、empty、日英、長い名称、markup風名称のunit testが完全な安全textを確認できる。
  - _Depends: 7.2_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 9.8, 9.9_
  - _Boundary: CategorySummary, UI message catalogs_

- [x] 8.2 共通project対応の構成管理viewを更新する
  - 独自project selectorを撤去し、ready、empty、unavailable、候補なし、構成なし、保存・validation errorを区別して表示する。
  - 保存、破棄、取消の切替確認と隔離中draftの継続案内を表示し、処理中は重複操作を受け付けない。
  - 各カテゴリ操作へカテゴリ名と現在要約を併記し、選択・解除・置換・数量保存の成功と同じstate更新で要約を反映する。
  - 長い要約は操作を妨げず視覚的に省略し、完全な内容をaccessible nameへ残してkeyboard focusと現在カテゴリを識別可能にする。
  - 外部由来名称は安全なJSX textとして描画し、実行可能なHTMLとして扱わない。
  - 完了時、availability、確認3分岐、隔離draft、即時要約、日英、keyboard、aria、長文省略、安全textのDOM testが成功する。
  - _Depends: 7.2, 7.3, 8.1_
  - _Requirements: 1.2, 1.4, 1.5, 1.6, 3.3, 3.4, 3.5, 5.3, 5.4, 5.5, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_
  - _Boundary: BuildView_

- [x] 9. feature lifecycleへcontext連携を統合する
  - feature mount時にcontext adapterの購読とdraft guardを登録し、authorityが確定したprojectを読み込んでからsnapshotを検査する。
  - feature contributionへproject-contextのread・guard public portを注入し、command portやcontext内部serviceへ依存しない。
  - captureでは既存version 1 shapeだけを返し、unmountではcontext、guard、operation policy、state、React rootを各一度だけ解放する。
  - application-shellとroot runtimeのproduction wiringは所有せず、public portを使うcontract harnessでcurrent-build側の統合境界を検証する。
  - 完了時、登録shape、authority先行load、restore/capture、operation policy、cleanup、public-port限定依存のcontract・integration testが成功する。
  - _Depends: 6.1, 6.2, 7.2, 7.3, 7.4, 8.2_
  - _Requirements: 1.1, 1.5, 1.6, 5.2, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: CurrentBuildFeatureRegistration, FeatureContribution integration_

- [x] 10. 更新された構成管理契約を横断検証する
- [x] 10.1 project切替guardとsnapshot復元を統合検証する
  - project-context public portのcontract harnessから共通selector相当の切替要求と確定通知を発行し、独自selectorやfallbackなしで追従することを確認する。
  - draft保存、破棄、取消、validation・保存失敗、stale要求、forced変更を検証し、旧projectまたは隔離状態へ正しいdraftが残ることを確認する。
  - 再表示とrollback復元でversion 1 snapshotが現在projectを変更せず、一致時だけ画面stateを復元することを確認する。
  - 完了時、guardとsnapshotのintegration suiteが全分岐で成功し、production shell wiringへ依存せずowner境界の契約を再現できる。
  - _Depends: 9_
  - _Requirements: 1.1, 1.5, 1.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: Project context and current build contract integration_

- [x] 10.2 カテゴリ要約の表示品質を回帰検証する
  - 単一、複数、未選択の全カテゴリ要約が選択操作と同じUI内に表示され、保存成功直後に更新されることを確認する。
  - 日本語と英語、keyboard操作、focus、aria-current、screen reader向け完全textをDOMとbrowser harnessで確認する。
  - 長い名称と複数項目が視覚的に省略されても操作可能で、markup風の外部名称がtextとして扱われることを確認する。
  - 完了時、要約・国際化・accessibility・安全表示のDOM回帰とE2E相当harnessが成功する。
  - _Depends: 8.2_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_
  - _Boundary: Current build presentation validation_

- [x] 10.3 参照修復と下流公開契約の回帰を検証する
  - 候補のカテゴリ変更、未分類化、削除、project削除が上流mutationと同じcommitで参照を修復し、current-buildから追加writeが出ないことを再確認する。
  - 不存在、別project、重複、カテゴリ規則違反の参照を採用品として返さず、識別可能な停止errorになることを確認する。
  - 下流queryがprojectごと最大一つの構成を候補IDと正整数数量だけで返し、候補詳細や互換性結果を含めないことを確認する。
  - 完了時、repair integrationとpublic consumer contract testが成功し、保存回数と公開shapeを観測できる。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: Foundation repair and CurrentBuildPublicApi validation_

- [x] 10.4 全53受入基準のcanonical validationを完了する
  - 要件1から9の全53受入基準をunit、contract、DOM、integration、browser harnessのいずれかへ対応付け、未追跡項目がないことを監査する。
  - 型検査、境界検査、lint、unit、contract、DOM、integration、production buildをproject標準の一括検証で実行する。
  - 失敗があれば該当boundaryの実装またはtestを修正し、全suiteを再実行して回帰がないことを確認する。
  - 完了時、canonical validationが成功し、53件すべての追跡結果と合格した検証出力を確認できる。
  - _Depends: 10.1, 10.2, 10.3_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_
  - _Boundary: Current build acceptance validation_

## Implementation Notes

- 9ではCurrentBuildFeatureRegistrationがmount時にdraft guard登録→context authority読込→snapshot検査の順で処理し、unmountでguard・context・operation policy・transient state・React rootを冪等解放する。project-context未注入時は候補一覧先頭へfallbackせずunavailableとしてfail closedにするため、side panel integration harnessもread/guard public portを明示的に注入する必要がある。

- BuildService.execute（2.2）はBuildCommandの3種を単一のswitchで扱うため、CategoryPolicyのmode分岐（single/multiple）は2.2の時点で自然に実装済みとなった。2.3は新規実装ではなく、2.2で未検証だった複数選択カテゴリ経路（追加・数量変更・解除・重複防止・不正数量拒否）へservice testを追加してcanonical構成規則を証明するタスクだった。src側の変更は不要だった。
- 3.1はlocal-data-foundationのreferenceRepairPolicy（候補削除・カテゴリ変更で変更対象自身のBuildItemだけを無条件に除去し、無関係な参照は触れない）と、current-build-managementのCurrentBuildQuery（2.1）を実データポートで結合するintegration testのみで完結した。src側の変更は不要で、Foundation側の修復が既にrequirement 4.1-4.4を満たしていることを確認できた。
- Foundationのschema validator（src/domain/validation.ts）は、currentBuild.items.candidatePartIdが同一project内の実在candidateを参照することを既にroot検証で強制している。存在しない候補・別project候補への参照はrepository.readRoot()の時点でcorrupt-dataとして拒否され、CurrentBuildQueryの不変条件チェックへは到達しない。一方、build重複・item重複・未分類参照・カテゴリ別選択数はFoundationが関知しないfeature固有不変条件であり、CurrentBuildQuery（2.1）が担う。3.2はこの分担を実Foundation stackで証明するintegration testのみで完結し、src側の変更は不要だった。
- BuildStateの候補読込依存は`CandidateQuery.listBuildEligible`だけに限定し、project一覧・選択authorityはproject-contextへ集約した。context未接続時も候補一覧先頭へfallbackせず`unavailable`としてfail closedにする。
- BuildErrorの無効化(構成変更を無効化)対象はrequirement 5.4が明示する3種類（corrupt-data・unsupported-data・storage）に限定し、quota・maintenance・conflictは再試行/再読込可能な一時的失敗として扱う。quotaを無効化対象に含めると5.4の文言（容量超過ではなく「破損・非対応・利用不能」）と食い違うため注意。
- BuildStateはproject単位でしか候補を先読みしない（BuildService/CurrentBuildQueryと同じ設計判断）ため、snapshot codecのstale候補参照チェックは「現在選択中のcategoryで絞り込まれたvalue.candidates」ではなく、project全体のeligible候補集合に対して行う必要がある。BuildState.hasCandidateReference(candidatePartId, projectId)を追加し、category-management側のManagementState.hasCandidateReferenceと同じ役割を持たせた。
- BuildState.value.selectedCategoryがnullのとき、value.candidatesはprojectの全classified候補（uncategorized以外の全カテゴリ）を含む。BuildViewでカテゴリ別に絞り込む前提のtestを書く場合は、対象カテゴリタブを明示的にクリックしてからassertする必要がある（category未選択=「すべて」相当のため）。
- 単一選択カテゴリの候補には数量入力欄自体を描画しない設計とした。これによりrequirement 2.5（数量変更を許可しない）はUI操作導線を提供しないことで満たされ、reject理由の表示は不要になる。
- registrationのmount時はproject-contextのauthoritative projectを先に読込み、その後にsnapshotの`selectedProjectId`を一致検査専用metadataとして検証する。snapshotからprojectを先読み・選択する経路は持たない。
- current-buildのFile Structure Planにreact-root.tsxは含まれないため、React root生成はcandidate-managementのように別ファイルへ分離せずregistration.ts内へ直接実装した。
- `styles.css`はカテゴリ要約の省略表示、switch確認、focus・状態表現を所有し、shellの`side-panel.css`から読み込む。accessible nameには省略前の完全なtextを残す。
- side-panel-contributions.tsはcurrent-buildがcandidate-managementの公開queryへ依存するため、均一なfactory配列パターン（[factory1, factory2].map(f => f(context))）をやめ、依存順に明示的に組み立てる形へ変更した。既存の3test（feature-contribution-catalog.test.ts、root-public-api.test.ts、build-smoke.test.ts）は"candidateManagement"単独を前提にしていたため["candidateManagement","currentBuild"]へ更新が必要だった。build-smoke.test.tsはdist/を検査するため、更新後は`pnpm build`を再実行してから`pnpm test`する必要がある。
- 実DOM統合testでReactのview click handlerがstate.execute()をvoidで発火（fire-and-forget）する場合、act()コールバック内で固定tick数のflushを仮定するのは脆い。実Foundation write authorityの確定を待つには、public queryをpollingするwaitUntilヘルパーの方が確実。
- Playwright e2eをworker並列実行すると、UIのPromiseが解決した時点でもchrome.storage.localへの書き込みがまだ確定していないケースがある（並列CPU負荷下でのみ再現）。reload直前にchrome.storage.local.getを直接pollingして永続化を確認してからreloadする方式が、固定waitForTimeoutより確実。
- 7.4でBuildSnapshotErrorへ`project-mismatch`を追加した。破損（invalid-shape/unsupported-version/invalid-reference）とは区別し、「古い画面状態を今の現在projectへ適用できない」案内に使う。8.2のviewと9のregistrationは、この2系統を別の表示として扱う必要がある。
- 7.4のcodecは`state.value.projects`を参照しなくなり、現在projectは`state.value.selectedProjectId`（contextからのprojection）とだけ照合する。snapshotのproject IDは一致検査専用で、選択authorityにも復元対象にもしない。empty/unavailable時は7.2の解放処理でselectedProjectIdがnullになるため、照合対象なし=project-mismatchになる。
- 7.3のdirty draft判定は「currentBuild.itemsに存在し、かつdraft文字列が保存済み数量と異なるもの」に限定した。未選択候補へのdraftは`set-quantities`が保存できない（not-found）ため切替確認の対象にしない。
- 7.3の確認は`BuildState.draftGuardOwner()`が返すowner objectでadapterへ渡す。`evaluate`はdirty draftがなければ即allow、あればPromiseを保留してUI（saveSwitchDrafts/discardSwitchDrafts/cancelSwitch）の確定を待つ。`#settleSwitch`が一度だけ解決し、二重解決とstale適用を防ぐ。
- 7.3のstale判定は`#contextGeneration !== baseGeneration`。`#applyAvailability`と`#evaluateSwitch`の先頭でも保留中確認をstaleとして閉じるため、context側が先に進んだ確認結果は保存にも破棄にも使われない。
- 7.1のnote（`set-quantities`成功時のdraft掃除が未実装）は7.3の`#draftsAfter`で解消済み。`execute()`は`#executeCommand`へ委譲し、切替保存側はcommit可否のbooleanでguardの許可を決める。
- BuildStateはproject-contextを常に唯一の選択authorityとして扱う。`value.projects`、`CandidateQuery.listProjects`、一覧先頭fallback、screen-driven `selectProject`は撤去し、context未接続・解除後は`unavailable`へ遷移してproject固有stateとmutationを解放する。
- 7.2のempty/unavailable解放は`quantityDrafts`も空にする。requirement 7.7（強制変更でもdraftを保持）と両立させるには、7.3でguardの`notifyForced`がavailability通知より先にdraftを隔離状態（design.mdの`orphanedDraft`）へ移す必要がある。この順序が崩れるとforced変更でdraftが消える。
- state testでcontext通知が起動する非同期読込を待つには、`await Promise.resolve()`の固定回数ではなく`setTimeout(0)`のmacrotask flushを使う（`#applyAvailability`がPromise.allの読込を挟むため）。
- `set-quantities`（7.1）の検証順は「選択対象外の候補が一件でもあれば即not-found」→「残りを全件検証してvalidation fieldsへ集約」。fieldsのkeyはcandidatePartIdなので、BuildView（8.2）は入力欄ごとにerrorを対応付けられる。数量が不正でも保存済み構成は一切変更しない（mutation発行ゼロ回）。
- BuildState.executeは`set-quantity`/`remove`成功時に該当candidateのdraftを、`set-quantities`成功時に保存対象の全draftを解消する。
- project-contextのguard契約（`ProjectContextChangeGuard.evaluate`）が返せるのは`allow`/`confirmation-required`と`guard-failed`だけである。design.mdのSystem Flows（「evaluateはfeature確認の完了を待ち、保存成功または破棄時だけallow」）に従い、current-buildのadapterは`confirmation-required`を返さず、owner（BuildState）の確認完了までevaluateをawaitして`allow`かfailureへ畳む方式にした。candidate-managementのadapterは`confirmation-required`を返してcontext側の確認へ委ねる別方式なので、二つのadapterのguard戦略は意図的に異なる。
- stale判定は「評価開始時のgeneration」と「後続評価によるtoken追い越し」の二軸で行う。project-contextは`evaluateSelection`成功後にpreference書き込みとpublishを行うため、正常経路ではevaluate中にgenerationは進まない。逆にrefresh・catalog invalidationが割り込むとgenerationが進むので、この検査が古い確認結果の適用を止める。
- adapterのsubscribeは、generation逆転の無視に加えて「status+projectIdが同じなら再通知しない」内容dedupeを行う。project名編集などcatalogだけが変わるrefreshでgenerationは進むが、current-buildの再読込は不要なため。generationの最大値自体はdedupe時も更新するので単調性は保たれる。
- 全53 acceptance criteria（requirements.md）はunit（category-policy）、contract（contracts/service/query）、integration（reference-repair/query.integration/current-build-flow.integration）、DOM（state/view/registration）、E2Eで完全に追跡できる。validation remediationでは、mutation開始時と完了時のproject ID・context generationを照合し、切替後に返る旧projectの成功・失敗結果をstateへ適用しない回帰testも追加した。current-build-managementのspecは全task完了。
- project-contextのforced通知は新snapshotのpublish後に届くため、current-buildはauthority変更のpublishを受けた時点で旧projectのdirty数量draftを隔離する。またunmount時はguard登録解除後でも進行中の選択transactionが停止しないよう、context解放で保留中guard評価を`stale-request`へ必ずsettleする。
