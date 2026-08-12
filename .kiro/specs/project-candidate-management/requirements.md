# Requirements Document

## Introduction

複数サイトで見つけたPCパーツを構成検討の単位ごとに整理する利用者向けに、候補パーツをローカルで管理する。候補管理は共通の現在プロジェクトを唯一の作業対象とし、欠損値と未分類を許容する編集、取り込みから継続するpre-edit、プロジェクト切替時の未保存内容、既存の取得元編集体験を安全に扱う。プロジェクト自体の作成・改名・削除は共通のプロジェクト機能へ委譲し、候補管理はその表示領域への接続と候補draftの保護だけを担う。

## Boundary Context

- **In scope**: 候補パーツCRUD、重複商品workflow専用の最小候補作成契約、共通の現在プロジェクトへの追従、project lifecycle表示領域への接続と旧候補管理内project操作の撤去、カテゴリ別表示、未分類補正、共通項目・カテゴリ別属性・元表記・価格・取得日時・取得元の編集UI、候補削除確認、project未解決・空名pre-editのsession内保持、project解決後の編集継続、切替時のdraft保護、既存snapshotの非権威的project metadata検査、共有データ操作エラーを同じ種類・粒度・表示挙動で扱う移行。
- **Out of scope**: project lifecycleのcommand・state・確認・message意味、project context自体の選択・preference・fallback、共有selectorとproduction composition、共有データ操作エラーの定義・低位エラーからのmapping、取得元entity・catalog・URL identity・mutation、商品同一性の正規化・照合・統合判断、候補UI layout変更、複数project同時編集、ページ抽出、現在構成への採用、互換性判定、保存形式変更、snapshot field削除・version変更、取り込み側intentの再試行。
- **Adjacent expectations**: `project-context` がproject lifecycleと検証済みの現在project・切替確認を提供し、候補管理は既存hostへそのpresentationを接続する。`local-data-foundation` が共有データ操作エラーと保存契約を提供する。`candidate-source-bookmarks` が取得元catalog・URL identity・mutationを提供し、候補管理は既存source editor UIから利用する。`duplicate-product-merge` は候補管理のproject限定queryと最小create契約を利用し、商品同一性contractを候補管理へ提供する。商品取り込みは候補編集intentを渡すが、保存先は候補管理が現在projectだけから解決する。後続の構成管理へ候補参照契約を提供する。

## Change Integration

- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **In-scope trace**: project lifecycle撤去とpresentation接続は1.1–1.8、共有データ操作エラーのconsumer移行は2.5・4.5・5.4・6.2、取得元core撤去とsource editor UI保全は4.1・4.3・4.6・6.3・6.7・6.8、商品同一性contractへの差替えは6.9、重複商品workflow専用の最小候補作成契約は6.10、候補CRUD・pre-edit・current project binding・draft guard非回帰は2–9で扱う。
- **Out-of-scope preservation**: エラーの種類・粒度・表示、候補UI layout、候補CRUD、既存query、typed editor intent、pre-edit、draft guard、source editor UI、保存形式、snapshot version 3/shapeを変更しない。project lifecycle、共有エラー定義・mapping、取得元core、商品同一性core、production compositionを本specへ取り込まない。

## Requirements

### Requirement 1: 共通プロジェクト操作との安全な統合
**Objective:** As a PC構成を検討する利用者, I want 候補管理と同じ画面領域から共通のプロジェクト操作を継続したい, so that 候補draftを失わず現在の作業対象を管理できる

#### Acceptance Criteria
1. When 候補管理画面を開く, the 候補管理機能 shall 共通のプロジェクト一覧・作成・改名・削除操作を既存の画面領域から利用可能にする
2. When 共通のプロジェクト操作が完了する, the 候補管理機能 shall 共通機能が再検証した現在プロジェクトへ候補一覧と編集状態を追従させる
3. If 共通のプロジェクト操作が入力または保存の問題で失敗する, the 候補管理機能 shall 共通機能が示す理由と再試行操作を候補draftとは独立して表示する
4. When 利用者がプロジェクトの削除を要求する, the 候補管理機能 shall 共通機能が提供する対象と所属候補への影響を識別できる確認を表示する
5. When プロジェクト操作が未保存の候補draftまたはpre-editへ影響する, the 候補管理機能 shall 共通の操作が永続状態を変更する前に候補draftの破棄確認へ参加する
6. When 利用者が候補draftの破棄確認を取り消す, the 候補管理機能 shall 入力内容と現在プロジェクトを維持し、共通のプロジェクト操作を開始させない
7. If プロジェクト操作は保存済みだが現在プロジェクトの再検証に失敗する, the 候補管理機能 shall 同じ操作を再実行させず、共通機能の再検証専用回復を利用可能にする
8. The 候補管理機能 shall project lifecycleの入力検証、永続化、再検証、削除確認および利用者向けmessageを候補固有の処理として重複実行しない

### Requirement 2: 候補パーツの作成と所属
**Objective:** As a 利用者, I want 欠損のある商品情報でも現在のプロジェクトへ候補を登録したい, so that 調査途中の情報を失わず後から補完できる

#### Acceptance Criteria
1. When 利用者が候補の作成を確定する, the 候補管理機能 shall 確定時点で検証済みの現在プロジェクトへ候補を直接所属させる
2. The 候補管理機能 shall 商品名を除く価格、URL、メーカー、型番、取得日時、カテゴリ別属性の欠損を許容する
3. If 商品名が空である, the 候補管理機能 shall 理由を示して候補を保存しない
4. When カテゴリを指定せず候補を作成する, the 候補管理機能 shall 未分類候補として利用可能にする
5. If 候補の保存に失敗する, the 候補管理機能 shall 入力内容を保持して失敗理由を示す
6. If 保存時点で現在プロジェクトが未選択または利用不能である, the 候補管理機能 shall 候補を保存せず入力内容を保持し、プロジェクトの選択、作成または回復を求める

### Requirement 3: 現在プロジェクトに追従する候補確認
**Objective:** As a 利用者, I want すべての画面と同じ現在プロジェクトの候補をカテゴリ別に確認したい, so that 異なる構成案を誤って編集しない

#### Acceptance Criteria
1. When 検証済みの現在プロジェクトが確定または変更される, the 候補管理機能 shall そのプロジェクトに直接所属する候補だけを表示する
2. The 候補管理機能 shall 候補をCPU、マザーボード、メモリ、GPU、ストレージ、電源、ケース、CPUクーラー、未分類で区別する
3. When 利用者がカテゴリを選択する, the 候補管理機能 shall 該当カテゴリの候補だけを一覧表示する
4. While 候補一覧を表示している, the 候補管理機能 shall 欠損項目を値が存在するかのように補完せず識別可能に表示する
5. When 未分類カテゴリを選択する, the 候補管理機能 shall 後から分類・編集できる候補を表示する
6. If 現在プロジェクトが空または利用不能である, the 候補管理機能 shall 別のプロジェクトへ独自にfallbackせず、選択、作成または回復が必要な状態を表示する
7. The 候補管理機能 shall 現在プロジェクトを決める独自selectorを表示しない

### Requirement 4: 候補情報の安全な編集
**Objective:** As a 利用者, I want 共通項目と互換性に関わる属性を編集したい, so that 元情報を参照しながら確認済みの値へ補正できる

#### Acceptance Criteria
1. When 利用者が候補を開く, the 候補管理機能 shall 共通項目、現在カテゴリの正規化属性、抽出元表記を区別して表示する
2. When 利用者が有効な変更を確定する, the 候補管理機能 shall 確認値と更新日時を保存して一覧へ反映する
3. When 利用者が候補カテゴリを変更する, the 候補管理機能 shall 商品名、価格、URL、メーカー、型番、取得日時、抽出元表記を保持する
4. When 未分類候補へカテゴリを設定する, the 候補管理機能 shall 選択カテゴリの属性を編集可能にする
5. If 入力値が選択カテゴリで受け付けられない, the 候補管理機能 shall 問題の項目を示して保存せず編集内容を保持する
6. The 候補管理機能 shall 抽出元表記をユーザー確認値で暗黙に上書きしない

### Requirement 5: 候補の削除
**Objective:** As a 利用者, I want 不要な候補を安全に削除したい, so that 誤操作を避けつつ候補一覧を整理できる

#### Acceptance Criteria
1. When 利用者が候補の削除を要求する, the 候補管理機能 shall 対象を識別できる確認を表示する
2. When 利用者が削除を確認する, the 候補管理機能 shall 対象候補だけを所属プロジェクトから削除する
3. When 利用者が削除確認を取り消す, the 候補管理機能 shall 永続状態を変更しない
4. If 候補の削除に失敗する, the 候補管理機能 shall 候補を表示したまま失敗理由を示す

### Requirement 6: ローカル保存と隣接機能向け契約
**Objective:** As a 利用者と後続機能の開発者, I want 管理結果が安全に保存され一貫して参照できること, so that 再起動後の管理と後続フローを成立させられる

#### Acceptance Criteria
1. When 管理画面を再度開く, the 候補管理機能 shall 保存済みプロジェクト、候補、分類、確認値を復元する
2. If 保存領域が破損、非対応、容量不足または利用不能である, the 候補管理機能 shall 既存データを上書きせず識別可能な案内を表示する
3. The 候補管理機能 shall 後続の商品取り込みから構造的に検証可能な候補編集intentを受け取る契約を提供する
4. The 候補管理機能 shall 後続の構成管理がプロジェクト別・カテゴリ別に候補を参照できる契約を提供する
5. While 候補が未分類である, the 候補管理機能 shall 後続の現在構成で利用可能な候補として公開しない
6. When 後続機能が候補編集内容を指定して詳細編集を要求する, the 候補管理機能 shall 現在プロジェクトの解決結果と入力内容を保持した編集画面またはproject-required案内を開く
7. When 利用者が候補の取得元を確認または編集する, the 候補管理機能 shall 既存の取得元編集体験を維持し、隣接する取得元機能が提供する検証済みcatalogと変更結果を表示へ反映する
8. If 取得元の確認または変更に失敗する, the 候補管理機能 shall 候補draftと既存の取得元表示を保持し、既存と同じ種類・粒度で失敗理由を示す
9. When 候補保存前の商品同一性確認が必要になる, the 候補管理機能 shall 隣接する商品同一性機能の判定結果を利用し、独自の正規化または照合規則で結果を置き換えない
10. When 重複商品workflowが新規候補としての保存を明示的に選ぶ, the 候補管理機能 shall 検証済みdraftを一度だけ作成できる最小の候補作成契約をcanonical公開入口から提供し、既存の候補照会契約とtyped editor intentの意味を変更しない

### Requirement 7: 解決前pre-editの受理と現在プロジェクトへのbinding
**Objective:** As a 商品取り込みから編集を継続する利用者, I want projectや商品名が未解決でも抽出結果を候補管理へ引き継ぎたい, so that 再抽出や仮データ作成をせず常設画面で補正と保存を完了できる

#### Acceptance Criteria
1. When 構造的に有効なpre-edit draftを受け取り現在プロジェクトが利用可能である, the 候補管理機能 shall その現在プロジェクトへdraftを割り当てて編集を開始する
2. When 構造的に有効なpre-edit draftを受け取り現在プロジェクトが未選択または利用不能である, the 候補管理機能 shall activationを受理し、同一side panel session内で入力内容を保持した`project-required`状態と選択、作成または回復の案内を表示する
3. When `project-required`状態で有効な現在プロジェクトが確定する, the 候補管理機能 shall そのプロジェクトへ保持中draftを割り当て、再抽出せず候補編集を開始する
4. If `project-required`状態でproject作成に失敗する, the 候補管理機能 shall 保持中draftを失わず作成失敗を示して再試行可能にする
5. If legacyまたは未信頼なpre-edit payloadにproject IDが含まれる, the 候補管理機能 shall その値を検証済みprefillへ保持せず、保存先またはfallbackの決定にも使用せず、検証済みの現在プロジェクトだけから保存先を解決する
6. When 商品名が空でcategoryと正規化属性が整合するpre-edit draftを受け取る, the 候補管理機能 shall 編集開始を許可して商品名の入力を求める
7. If 利用者が空の商品名のまま保存しようとする, the 候補管理機能 shall 既存の保存時検証で拒否し編集内容を保持する
8. If pre-edit payloadの必須形状、category、正規化属性とのcategory整合、category hintまたはcapture diagnosticsが不正である, the 候補管理機能 shall 未信頼値を表示せずactivationを拒否する
9. While pre-edit draftを受理済みである, the 候補管理機能 shall 引き渡し元が終了しても保持を継続し、候補保存の成功、利用者の明示取消または新しい検証済みpre-edit activationでのみ置換または破棄する
10. If side panel documentが閉鎖、extension reloadまたはbrowser終了で破棄される, the 候補管理機能 shall pre-edit draftを永続復元または自動再抽出しない

### Requirement 8: プロジェクト切替時の編集保護
**Objective:** As a 候補を編集中の利用者, I want 現在プロジェクトの変更時に未保存内容を保護したい, so that 切替や削除によって入力を黙って失わない

#### Acceptance Criteria
1. When 現在プロジェクトの変更が要求され、候補draftまたはpre-editに未保存内容がない, the 候補管理機能 shall 切替を妨げない
2. When 現在プロジェクトの変更が要求され、候補draftまたはpre-editに未保存内容がある, the 候補管理機能 shall 入力を保持したまま破棄確認を要求する
3. When 利用者が破棄確認を取り消す, the 候補管理機能 shall 入力内容と現在プロジェクトを維持する
4. When 利用者が破棄を確認してプロジェクト変更が確定する, the 候補管理機能 shall 変更前のdraftを破棄し、変更後の現在プロジェクトを表示する
5. When project削除またはcatalog置換によって現在プロジェクトの強制変更が通知される, the 候補管理機能 shall 未保存draftを保持し、変更後のプロジェクトへ暗黙に保存せず、継続方法を案内する
6. If 切替確認の処理中に対象の現在プロジェクトまたは要求が古くなる, the 候補管理機能 shall 古い確認結果でdraftを破棄しない

### Requirement 9: 画面snapshotの非権威的project metadata
**Objective:** As a 画面遷移から候補編集へ戻る利用者, I want 直前の編集状態を現在プロジェクトと矛盾なく復元したい, so that 古い画面状態が作業対象を上書きしない

#### Acceptance Criteria
1. The 候補管理機能 shall 既存のsnapshot versionとshapeを維持する
2. When 画面snapshotを復元する, the 候補管理機能 shall snapshot内のproject IDを現在プロジェクトとの一致検査にだけ使用する
3. If snapshot内のproject IDが検証済みの現在プロジェクトと一致する, the 候補管理機能 shall 検証可能な編集状態を復元する
4. If snapshot内のproject IDが現在プロジェクトと一致しない、存在しない、または現在プロジェクトが利用不能である, the 候補管理機能 shall snapshotによって現在プロジェクトを上書きせず、安全な初期状態またはdraft保持状態と識別可能な案内を表示する
5. If snapshotのversion、shapeまたは内容が不正である, the 候補管理機能 shall 永続データと現在プロジェクトを変更せず復元を拒否する
