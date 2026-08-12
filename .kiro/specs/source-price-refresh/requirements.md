# 要件文書

## はじめに

本機能は、保存済みの販売ページを再訪した利用者に、コンテキストメニューから一回の明示操作でその取得元の価格を再取得する経路を提供する。現在ページと保存済みソースを安全に照合し、取得できた価格と取得日時だけを対象ソースへ反映することで、検討中ブックマークの価格を更新しつつ、失敗時には既存データを保護する。

## 境界コンテキスト

- **対象範囲**: 「価格を更新」コンテキストメニュー、一過性表示面での進行・結果表示、source ownerの公開portを使う保存済みソースの一意照合、販売ページからの価格のみの再取得、公開patch portを使う対象ソースの価格・取得日時の原子的更新、共有`AppDataError`のconsumer mapping、権限・失敗・非回帰の検証。
- **対象外**: 定期巡回、バックグラウンド監視、価格履歴、在庫監視、通貨換算、価格以外の再取得、ソースの追加・削除・プライマリ規則、一過性表示面の基盤、抽出順位・価格正規化規則、同一商品の検知・統合判断。
- **隣接期待**: `transient-feature-surface` の起動世代と固定タブを利用し、source ownerが所有するURL identity、catalog scope、一意照合、ambiguity、ソースID、取得元別価格、プライマリ導出、条件付きpatchを公開portから再利用する。`local-data-foundation` が共有`AppDataError`のcanonical vocabularyとmappingを所有し、application shellは最終compositionだけを所有する。

## Change Integration

- **Change Brief**: `v0.5.0-boundary-reconciliation`
- **In scope trace**: source public match/patch portのconsumer化、旧`ManagementError` import撤去、共有`AppDataError` mapping、価格workflowとtransient UIの非回帰を要件2、4、5、6、7へ統合する。
- **Out of scope preservation**: URL identity、source catalog・policy・ambiguity、candidate mutation、共有errorのcanonical定義・意味・粒度、価格抽出・正規化、定期監視・履歴、application shell composition、UI layoutを変更しない。
- **Non-regression**: explicit action、activeTab、固定tab/世代、価格だけの更新、失敗時の旧値保持、primary projection、transient result UIを維持する。

## 要件

### 要件 1: 明示操作による一回完結の価格更新

**目的:** PCパーツ検討者として、保存した販売ページを再訪した場所から一回の操作で価格更新を開始したい。そうすることで、権限切れの操作面に迷わず最新価格を確認できる。

#### 受入基準

1. When 利用者が閲覧中ページの「価格を更新」コンテキストメニューを実行する, the 価格更新機能 shall その操作で与えられた対象タブと起動世代に対して価格更新を開始する。
2. When 価格更新を開始する, the 価格更新機能 shall 一過性表示面へ進行状態を提示する。
3. When 価格更新が成功する, the 価格更新機能 shall 更新された価格と取得時点を一過性表示面へ提示する。
4. If 価格更新を安全に開始できない, the 価格更新機能 shall 永続状態を変更せず、再操作または修正に必要な理由を提示する。
5. While 対象タブまたは起動世代が現行でない, the 価格更新機能 shall 更新操作を提示または継続しない。
6. The 価格更新機能 shall 拡張アイコンの通常起動または常設ナビゲーションから価格更新を暗黙に開始しない。

### 要件 2: 保存済みソースの一意な特定

**目的:** PCパーツ検討者として、再訪中のページに対応する保存済み取得元だけを更新したい。そうすることで、別候補や別ソースの価格が誤って変わることを防げる。

#### 受入基準

1. When 価格更新対象ページのURLを取得する, the 価格更新機能 shall source ownerの公開match portへURLとcatalog scopeを渡し、その検証済み結果だけを利用する。
2. When URLを照合する, the 価格更新機能 shall source ownerが返すcanonical URL identityとmatch結果を使用し、正規化規則を再実装しない。
3. Where URLにsource ownerが同一取得元と定義する表記差がある, the 価格更新機能 shall 公開match portの同一結果を維持する。
4. The 価格更新機能 shall source ownerが別取得元と判定した類似URLを独自規則で一致へ変更しない。
5. When source public portが一件の保存済み販売ソースを返す, the 価格更新機能 shall その候補ID、ソースID、および照合preconditionを更新対象として固定する。
6. If source public portが一致なしを返す, the 価格更新機能 shall ソースを新規追加せず、更新対象が見つからないことを提示する。
7. If source public portが曖昧な一致を返す, the 価格更新機能 shall いずれも更新せず、更新対象を一意にできないことを提示する。
8. If source public portが価格更新対象外のソースを返す, the 価格更新機能 shall 価格を再取得せず対象外であることを提示する。

### 要件 3: 価格だけの再取得

**目的:** PCパーツ検討者として、既存の商品情報を変えずに閲覧中ページの現在価格だけを再取得したい。そうすることで、手動補正や確認済み属性を維持できる。

#### 受入基準

1. When 更新対象が一意に特定される, the 価格更新機能 shall 閲覧中ページから価格候補だけを取得する。
2. When 複数の価格候補を取得する, the 価格更新機能 shall 商品取り込みと同じ抽出優先順位と正規化規則で一件を選択する。
3. When 価格を取得する, the 価格更新機能 shall 元表記と正規化された金額・通貨を区別して保持する。
4. The 価格更新機能 shall 商品名、メーカー、型番、カテゴリ、正規化済み属性、メモまたはソース種別を再取得結果で変更しない。
5. If ページから有効な価格を取得できない, the 価格更新機能 shall 既存価格と取得日時を維持し、価格を取得できなかったことを提示する。
6. If ページが更新開始時の対象から遷移した、権限が失効した、またはページ応答を検証できない, the 価格更新機能 shall 再取得結果を破棄し永続状態を変更しない。

### 要件 4: 取得元別価格の原子的反映

**目的:** PCパーツ検討者として、取得した価格を対応するソースだけへ安全に反映したい。そうすることで、候補一覧の代表表示を含む保存状態を信頼できる。

#### 受入基準

1. When 有効な価格を取得し更新対象が現行の保存状態でも一致する, the 価格更新機能 shall source ownerの公開条件付きpatch portを用いて対象ソースの価格と取得日時を一回の整合した更新として確定する。
2. When 非プライマリソースを更新する, the 価格更新機能 shall 他のソースと候補一覧の代表価格を変更しない。
3. When プライマリソースを更新する, the 価格更新機能 shall 保存値を複製せず、更新後のプライマリソースから候補一覧の代表価格を導出する。
4. While ソース価格と取得日時だけを更新する, the 互換性判定機能 shall 確認済みの正規化属性に基づく判定結果を維持する。
5. If 更新確定前に対象ソースのURL、種別、所属候補または識別子が変わる, the 価格更新機能 shall source ownerのprecondition failureを古い照合結果で上書きせず再試行可能な競合として提示する。

### 要件 5: 失敗時のデータ保全と回復案内

**目的:** PCパーツ検討者として、価格更新の失敗で保存済み価格を失いたくない。そうすることで、再試行や手動確認まで既存の検討情報を利用できる。

#### 受入基準

1. If 価格更新の永続化に失敗する, the 価格更新機能 shall 更新前の候補とソースを保持し、部分更新を残さない。
2. If 更新中に別の変更と競合する, the 価格更新機能 shall 後発の保存状態を上書きせず再試行を案内する。
3. While 保存基盤が保守状態である, the 価格更新機能 shall 価格更新を確定せず保守終了後の再試行を案内する。
4. If 保存容量不足または保存領域障害が発生する, the 価格更新機能 shall 既存価格を維持して識別可能な失敗理由を提示する。
5. When 抽出完了または更新確定前に旧世代となる, the 価格更新機能 shall 旧世代の結果で現行表示または保存状態を変更しない。When 原子的な更新確定後に旧世代となる, the 価格更新機能 shall 旧世代の完了で現行表示を変更せず、補償更新によって有効なcommitを巻き戻さない。
6. The 価格更新機能 shall URL、抽出価格、商品値または保存内容を診断ログへ出力しない。

### 要件 6: 権限境界、再利用性、非回帰

**目的:** feature保守者として、明示操作・最小権限・既存公開境界を維持しながら価格更新を決定的に検証したい。

#### 受入基準

1. The 価格更新機能 shall コンテキストメニュー項目の提供に必要な権限だけを追加し、全サイトへの恒久的な読み取り権限を要求しない。
2. The 価格更新機能 shall 利用者操作なしの定期巡回、バックグラウンド価格取得または投機的なページ解析を実行しない。
3. Where 同一URLの再取り込みが検出される, the 価格更新機能 shall source ownerの同じ公開match/patch portを使う価格取得workflowを隣接機能から利用可能にする。
4. The 価格更新機能 shall URL照合、対象一意性、販売ページ制約、価格選択、失敗時非更新およびプライマリ導出をChrome APIなしの自動テストで検証可能にする。
5. Where Chrome 116以降の未パッケージ拡張で実行される, the 価格更新機能 shall コンテキストメニュー実行から成功・失敗表示までの主要動線を検証可能にする。
6. The 価格更新機能 shall worker実行コードをDOMおよびReactへ依存させず、ページ解析を注入先文書へ限定する。
7. The 価格更新機能 shall 実サイト由来のHTML、画像または商品データをテスト資産として必要としない。

### 要件 7: 共有errorとsource public seamのconsumer境界

**目的:** feature保守者として、価格更新をcanonical source/error ownerの公開契約だけへ接続したい。そうすることで、循環proxyを撤去しながら利用者向け失敗結果を維持できる。

#### 受入基準

1. The 価格更新機能 shall source entity、URL identity、catalog matcher、ambiguity policy、candidate mutationを定義または再公開せず、source ownerの公開match/conditional patch portだけを利用する。
2. The 価格更新機能 shall 旧candidate-owned `ManagementError`を定義、import、mappingまたは公開せず、foundation公開入口の共有`AppDataError`をconsumerとして利用する。
3. When 共有`AppDataError`を価格更新errorへ写像する, the 価格更新機能 shall 既存のvalidation、conflict、maintenance、storage、quota、unsupported-dataの種類、意味、粒度および利用者向け結果を変更しない。
4. If source matchまたはconditional patch portが失敗する, the 価格更新機能 shall canonical errorを既知の別原因へ推測で畳み込まず、既存価格・取得日時・transient stateの保全規則を適用する。
5. The 価格更新機能 shall candidate-management、source ownerまたはapplication shellに価格workflowのproxyを要求せず、公開portを直接受け取るconsumer contractを提供する。
6. The 価格更新機能 shall application shellのproduction compositionを実装せず、shellが接続できるfeature contributionとworker-safe menu registrationだけを公開する。
7. When source public contractまたは共有`AppDataError` contractが変更される, the 価格更新機能 shall consumer contract、unit、runtime、UIおよびE2Eで価格workflowの互換性を再検証する。
