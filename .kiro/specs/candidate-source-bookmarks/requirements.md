# 要件文書

## はじめに

本機能は、一つの候補へ複数の販売・メーカー紹介ページを束ね、取得元ごとの価格、取得時点、サイト名、種別を保存・比較・再訪できる「検討中ブックマーク」を提供する。取得元モデル、catalog、mutation、URL identity、明示scope内の一意照合を独立した共有coreとして公開し、候補editorや価格更新などのconsumerが同じ規則を利用できるようにする。

## Change Integration

- **Change Brief**: `v0.5.0-boundary-reconciliation`
- **In-scope trace**: 取得元共有coreと公開入口は要件8・9、catalog/reference/mutationと条件付き価格patchは要件3・8、URL正規化・identity・照合scope・曖昧結果は要件9、候補editor consumer seamは要件3・8、共有`AppDataError` projectionは要件7・8で扱う。
- **Out-of-scope preservation**: 価格抽出・更新workflow、候補editor UIの所有または再設計、商品同一性、保存schemaの意味変更、application shellのcomposition実装は本変更で追加しない。既存の1:N source、primary導出、原子的mutation、安全な再訪、表示・error semanticsを維持する。

## 境界コンテキスト

- **対象範囲**: 候補の複数source、取得元別価格、primary指定、source種別、手動操作、安全な再訪、source共有型・policy・catalog・reference・mutation、HTTP/HTTPS URL identity、明示scope内の0件・一意・曖昧照合、条件付き価格patch、共有`AppDataError`のconsumer projection、候補editor向けconsumer seam、公開contractと境界検査。
- **対象外**: 価格抽出と価格更新workflow、候補editor UIのlayout・state ownership、同一商品の検知・統合・商品identity、価格履歴、通貨換算、メーカー判定mapの保守、保存root/schemaの意味変更、production compositionとshell wiring。
- **隣接期待**: `local-data-foundation`が`AppDataError`を定義・mappingし、`project-candidate-management`が候補CRUDとsource editor UIを所有する。本機能は両者の公開契約を消費し、`source-price-refresh`へ取得元照合・条件付きpatchを、`duplicate-product-merge`へcandidate限定URL matcher・source reference・add/conditional mutationを公開する。商品同一性の判断はsource URL identityから推測しない。

## 要件

### 要件 1: 候補ごとの複数source保持

**目的:** PCパーツ検討者として、一つの候補に複数の取得元を保持したい。そうすることで、同じ商品を重複候補へ分けずに販売ページとメーカー紹介ページをまとめて比較できる。

#### 受入基準

1. The 取得元core shall 一つの候補に0件以上のsourceを保持するpolicyを提供する。
2. The 取得元core shall 各sourceのページURL、サイト名、取得日時、価格、source種別を他のsourceと独立して表現する。
3. Where sourceの価格が不明である, the 取得元core shall 特定の金額または通貨を推測せず価格欠損として保持する。
4. Where 候補がsourceを持たない, the 取得元core shall 手動作成された候補を有効な状態として扱う。
5. The 取得元core shall 商品共通値から代表価格を保存せず、取得元別価格だけを価格の保存先とする。

### 要件 2: primary sourceと代表表示

**目的:** PCパーツ検討者として、複数sourceから代表となる一件を選びたい。そうすることで、候補一覧の価格と再訪先を意図したページへ揃えられる。

#### 受入基準

1. When 最初のsourceが候補へ追加される, the 取得元core shall そのsourceをprimaryとして選択する。
2. When 利用者が別のsourceをprimaryに指定する, the 取得元core shall 指定したsourceを唯一のprimaryとして保存する更新を返す。
3. While 候補が一件以上のsourceを持つ, the 取得元core shall 代表URLと代表価格をprimary sourceだけから導出する。
4. If primary sourceに価格がない, the 取得元core shall 他のsource価格へ暗黙に切り替えず代表価格を不明として返す。
5. Where 候補がsourceを持たない, the 取得元core shall 代表URLと代表価格を不明として扱う。

### 要件 3: sourceの手動管理と候補editor連携

**目的:** PCパーツ検討者として、既存候補へ追加で見つけたページを手動で結び付けたい。そうすることで、自動統合に頼らず検討資料を増減できる。

#### 受入基準

1. When 利用者が有効なWebページURLを入力してsourceを追加する, the 取得元core shall 入力済みのサイト名、取得日時、価格、種別とともに既存候補へ保存するmutationを提供する。
2. When 利用者がsourceのサイト名、取得日時、価格または種別を編集して保存する, the 取得元core shall 対象sourceだけを更新し、他のsourceを維持する。
3. When 下流consumerがcandidate/source ID、期待する未加工URL、期待種別retailとともに価格・取得日時を更新する, the 取得元core shall commit時の最新sourceを照合し、価格と取得日時だけを一回の原子的mutationでpatchして後発のsiteName変更を維持する。
4. When 利用者が非primary sourceを削除する, the 取得元core shall 残りのsourceとprimary指定を維持する。
5. If 利用者が残りのsourceがある状態でprimary sourceを削除しようとする, the 取得元core shall 新しいprimaryが選ばれるまで保存を拒否し、修正対象を示す。
6. When 利用者が候補の最後のsourceを削除する, the 取得元core shall 候補自体を残し、sourceなしの状態として保存する更新を返す。
7. If source編集内容が無効である, the 候補editor consumer shall 入力内容と既存保存値を保持し、取得元coreのfield errorを該当項目の修正理由へ投影する。
8. If 取得元公開portが未注入または失敗する, the 候補editor consumer shall draftとsource表示を保持し、旧candidate-owned source実装へfallbackしない。

### 要件 4: source種別の判定と上書き

**目的:** PCパーツ検討者として、価格確認用の販売ページと仕様確認用のメーカー商品紹介ページを区別したい。そうすることで、各ページの役割を迷わず判断できる。

#### 受入基準

1. When sourceが商品取り込みまたは手動追加によって作成される, the 取得元core shall 注入されたメーカー登録ドメイン照合契約を使用して初期種別を判定する。
2. When ページの登録ドメインがメーカー判定情報に一致する, the 取得元core shall source種別をメーカー商品紹介ページとして初期設定する。
3. If ページの登録ドメインがメーカー判定情報に一致しない, the 取得元core shall source種別を販売ページとして初期設定する。
4. When 利用者が自動判定されたsource種別を変更して保存する, the 取得元core shall 利用者の選択を以後の表示に使用する。
5. While 候補一覧または候補詳細にsource情報を表示する, the 候補editor consumer shall 販売ページとメーカー商品紹介ページを区別できる既存名称を維持する。

### 要件 5: 取得元ページへの安全な再訪

**目的:** PCパーツ検討者として、保存したどの取得元ページにも作業状態を失わず戻りたい。そうすることで、候補管理をブックマークとして利用できる。

#### 受入基準

1. When 利用者が候補一覧の代表sourceを開く操作を行う, the 候補editor consumer shall primary sourceのページを新しいブラウザタブで開く依頼を行う。
2. When 利用者が候補詳細の任意sourceを開く操作を行う, the 候補editor consumer shall 選択したsourceのページを新しいブラウザタブで開く依頼を行う。
3. While 取得元ページを開く, the 候補editor consumer shall サイドパネルと現在の作業タブを維持する。
4. If 開こうとするURLがHTTPまたはHTTPSではない、欠損している、あるいは不正である, the 取得元core shall ブラウザ遷移を許可せず既存の識別可能な失敗を返す。
5. The 取得元core shall 取得元ページを開くための追加ブラウザ権限を要求しない。

### 要件 6: 保存形式と原子的更新の一貫性

**目的:** 既存利用者として、source変更によって候補全体や保存形式が破損しないことを求める。そうすることで、ローカルデータを信頼して管理できる。

#### 受入基準

1. The 取得元core shall foundationが所有する現行の複数source保存shapeとprimary参照を消費し、保存schemaのversionまたは意味を変更しない。
2. When sourceの追加、編集、削除、primary変更または条件付き価格patchを保存する, the 取得元core shall 候補全体を一回の整合した更新として確定する。
3. If source URL、取得日時、価格、種別またはprimary参照が許容形式に一致しない, the 取得元core shall 書込みを拒否し問題の位置を識別可能にする。
4. If source変更の永続化に失敗する, the 取得元core shall 変更前の有効な候補を保持し、部分更新を残さない。
5. If 条件付き価格patchのsource、未加工URLまたは種別が最新保存値と一致しない, the 取得元core shall 書込みを行わず専用precondition失敗を返す。
6. If 条件付き価格patchがrevision競合する, the 取得元core shall precondition失敗へ統合せず既存conflictとして返す。
7. While 保存済みURLまたはサイト名を表示する, the 候補editor consumer shall 外部文字列を実行可能な内容として解釈しない。

### 要件 7: 共有data errorとsource固有error

**目的:** consumer実装者として、保存基盤の失敗とsource操作固有の失敗を安定した型で処理したい。そうすることで、owner移管後も既存の表示と回復動作を維持できる。

#### 受入基準

1. When foundation data operationが失敗する, the 取得元core shall `local-data-foundation`の公開入口から受け取る`AppDataError`を意味、variant、payload、contextを変えずsource公開結果へ投影する。
2. The 取得元core shall `AppDataError`、そのcanonical mapping、または`FoundationError`からのmappingを定義、複製、再公開しない。
3. If source入力、対象参照、primary規則、条件付きpatch前提または照合一意性が失敗する, the 取得元core shall 既存のvalidation、not-found、primary-required、precondition、ambiguous-matchをsource固有errorとして区別する。
4. The 取得元core shall source固有errorを`AppDataError`へ吸収せず、data operation failureと判別可能な公開resultを提供する。
5. If 公開境界で未知または不完全なdata errorを受け取る, the 取得元core shall 既知の`AppDataError`へ推測せずfail closedする。

### 要件 8: 共有source coreと隣接consumer契約

**目的:** 隣接機能の実装者として、候補管理内部へ依存せずsourceを照会・更新したい。そうすることで、循環依存とowner重複を避けられる。

#### 受入基準

1. The 取得元core shall source型、policy、catalog、reference、mutation、URL identity、matcherを一つのsource公開入口から提供する。
2. When consumerが全候補または指定候補のsource参照を要求する, the 取得元core shall candidate ID、source ID、任意URL、任意種別、primary状態をread-onlyで列挙する。
3. When consumerがcandidate/source IDで現行参照を要求する, the 取得元core shall 最新snapshotから該当参照を返し、candidate不在とsource不在を区別する。
4. The 取得元core shall 永続root、revision、候補draft、価格抽出結果、商品identityを公開referenceへ含めない。
5. When 候補editorがsource一覧またはmutationを必要とする, the 候補editor consumer shall source公開入口のportだけを注入され、candidate-managementからsource coreを実装または再公開しない。
6. When 価格更新consumerが保存済みsourceを探索する, the 取得元core shall 公開matcherと条件付き価格patchを提供し、価格抽出とworkflow stateを所有しない。
7. When 重複商品統合consumerが同一URLの振り分けまたはsource追加を行う, the 取得元core shall candidate限定matcher、source reference、addおよびconditional mutationを同じ公開入口から提供し、source URL identityを商品identityまたは統合判断として返さない。
8. The 取得元core shall application shellのproduction composition、runtime singleton、feature registrationを実装しない。

### 要件 9: URL identityと明示scope内の一意照合

**目的:** 価格更新consumerとして、保存済みsourceを同一のURL規則で安全に一意特定したい。そうすることで、重複時に誤った取得元を更新しない。

#### 受入基準

1. When HTTPまたはHTTPSのsource URLがidentity化される, the 取得元core shall 標準URL解析に基づく決定的な正規化値を返し、認証情報とfragmentをidentityへ含めない。
2. If URLが欠損、不正、HTTP/HTTPS以外、または安全にidentity化できない, the 取得元core shall identityを生成せず識別可能なvalidation失敗を返す。
3. The 取得元core shall query parameterを商品同一性の推測で削除または並べ替えず、source URLとして宣言した正規化規則だけを適用する。
4. When consumerが明示した全候補scopeまたは指定候補scopeでURL identityを照合する, the 取得元core shall scope内の全source referenceを同じ正規化規則で比較する。
5. If 照合結果が0件である, the 取得元core shall no-matchを返しsourceを変更しない。
6. If 照合結果が1件である, the 取得元core shall そのcandidate/source referenceだけを一意結果として返す。
7. If 照合結果が複数件である, the 取得元core shall 全候補を保持したambiguous-matchを返し、配列順、primary、価格または種別で暗黙選択しない。
8. The 取得元core shall source URL identityと商品identityを別契約として維持し、同じURLまたは異なるURLから同一商品を判定しない。
