# 要件定義書

## はじめに

application shellは、PC build plannerのside panelにおける共有ホスト、ナビゲーション、feature登録、公開API合成、共通状態表示を一元化する。利用者は、独立した各featureを一貫した画面から利用でき、復元などのmaintenance中には誤ってデータ変更操作を実行しないで済む。feature実装者は共有runtime入口を編集せず、安定した登録契約を介してshellへ参加できる。

## 境界コンテキスト

- **対象内**: side panel host、常設featureナビゲーション、一過性featureを含む登録済みfeatureのmount/unmount、型付きfeature activationの配送、利用可能状態、共通loading/error/maintenance表示、設定画面への到達・回復案内のcomposition、mutation操作の共通抑止、composition root、root公開API合成。
- **対象外**: feature固有の業務ロジック・state・view、永続化、maintenance lease管理、復元、商品抽出、互換性判定、表示言語の意味・保存・解決。
- **隣接する期待**: local-data-foundationは信頼できるmaintenance状態をread-only契約で提供し、各featureは登録情報・view lifecycle・公開契約を提供する。`transient-feature-surface`は一過性featureの起動世代と寿命を、`settings-screen`は表示言語・backup区画を持つ常設設定画面を提供する。ui-messages/ui-languageはメッセージカタログと表示言語の状態・永続化・解決を所有し、application shellはそれらを合成・表示するだけで、文言・言語の意味や保存を解釈しない。

## 要件

### 要件1: Side panelホストとナビゲーション
**目的:** 利用者として、登録された機能を一貫したside panelから選択したい。それによりPC構成計画の作業間を迷わず移動できる。

#### 受け入れ基準
1. When side panelが開始されたとき, the application shell shall 登録済みで利用可能な常設featureだけをナビゲーションへ表示する
2. When 利用者がナビゲーション項目を選択したとき, the application shell shall 選択したfeatureのviewを表示する
3. When 別のfeatureへ移動したとき, the application shell shall 以前のfeatureの表示を終了してから新しいfeatureを表示する
4. If 選択中のfeatureが利用不可になったとき, the application shell shall 利用可能な遷移先と理由を表示する
5. The application shell shall 常設featureと一過性featureを合わせて同時に一つのfeatureだけを主表示領域へ表示する
6. The application shell shall 各featureが提供するナビゲーションラベルを、利用者が選択している表示言語で提示する
7. When 初期表示または選択中featureのfallbackを決定するとき, the application shell shall 利用可能な常設featureだけを候補にする
8. When 一過性featureが有効な起動要求で表示されたとき, the application shell shall 常設ナビゲーションを維持しながらその一過性featureを主表示領域へ表示する

### 要件2: Feature登録契約
**目的:** feature実装者として、共有runtimeファイルを編集せずにfeatureをshellへ参加させたい。それによりfeatureを独立して実装・検証できる。

#### 受け入れ基準
1. When featureが登録されたとき, the application shell shall feature識別子、常設または一過性の明示的な表示区分、表示開始・終了動作、利用可能状態、および受理可能な型付きactivationを受け付け、常設featureにだけ型付きナビゲーション情報を要求する
2. If 同じfeature識別子が複数回登録されたとき, the application shell shall 重複を拒否し診断可能なエラーを返す
3. If 登録情報が不正または不足しているとき, the application shell shall そのfeatureを表示対象にせず他のfeatureの利用を継続する
4. When featureの利用可能状態が変化したとき, the application shell shall ナビゲーションと現在表示を新しい状態へ同期する
5. The application shell shall feature固有の業務データを解釈せず登録契約に含まれる情報だけを扱う
6. If 一過性featureの登録にナビゲーション情報が含まれる、または常設featureの登録にナビゲーション情報がない場合, the application shell shall 区分と情報が矛盾する登録を拒否し他のfeatureの利用を継続する

### 要件3: Composition rootと公開API
**目的:** 開発者として、runtime依存と公開契約を一箇所で合成したい。それにより依存方向と共有入口の所有者を明確にできる。

#### 受け入れ基準
1. When 拡張runtimeが開始されたとき, the application shell shall foundationとfeature登録を一度だけ合成してside panelを起動する
2. When root公開APIが利用されたとき, the application shell shall feature単位の公開契約を一貫したroot契約として提供する
3. If 必須の上流契約を初期化できないとき, the application shell shall feature画面を開始せず共通エラーを表示する
4. The application shell shall 各featureによる共有runtime入口およびroot公開APIの直接変更を必要としない参加方式を提供する
5. When production compositionがfeatureを合成するとき, the application shell shall foundationの絞り込みdata portとshell navigatorを合成contextとして各feature contributionへ注入し、feature内部実装へdeep importしない
6. When service worker contextでcatalogを合成するとき, the application shell shall side panel専用contributionのmodule graphを取り込まず、worker bundleをDOMおよびReact非依存に保つ
7. When root公開APIが参照されるとき, the application shell shall catalogから導出した型と合成contextを受け取る合成関数だけを提供し、data portなしの空の即時値をfeatureの公開契約として提示しない

### 要件4: 共通状態表示と障害分離
**目的:** 利用者として、shellやfeatureの待機・失敗状態を理解したい。それにより次に取れる操作を判断できる。

#### 受け入れ基準
1. While shellを初期化している間, the application shell shall 共通loading表示を提示する
2. If featureの表示開始が失敗したとき, the application shell shall 安全な共通エラー表示と再試行または別featureへの移動手段を提示する
3. If 一つのfeatureの登録または表示が失敗したとき, the application shell shall 利用可能な他のfeatureの操作を維持する
4. When エラー表示に外部由来文字列が含まれるとき, the application shell shall その文字列を実行可能なmarkupとして扱わずテキストとして表示する
5. While 一過性featureが主表示領域にある間, the application shell shall 一過性featureが提供する`transientNotice`を常設ナビゲーションと併存する安全なテキストとして提示する
6. While 初期読み込み中で常設ナビゲーションを利用できない間, the application shell shall 表示言語の変更場所が「設定 / Settings」であることを日本語・英語のどちらからも判別できる案内として提示する
7. If 起動失敗により設定画面へ移動できないとき, the application shell shall 「設定 / Settings」への到達方法と利用可能な回復操作を日本語・英語のどちらからも判別できる案内として提示する

### 要件5: Maintenance表示とmutation抑止
**目的:** 利用者として、復元などのmaintenance中に変更操作を実行しないよう明確に案内されたい。それにより拒否される操作や競合を避けられる。

#### 受け入れ基準
1. When foundationがmaintenance開始状態を通知したとき, the application shell shall 全featureに共通するmaintenance表示を提示する
2. While maintenance状態が有効な間, the application shell shall mutationとして登録された操作を開始不能にする
3. While maintenance状態が有効な間, the application shell shall read-onlyとして登録された閲覧とナビゲーションを維持する
4. When foundationが現行世代のmaintenance終了状態を通知したとき, the application shell shall mutation操作の共通抑止を解除する
5. If 古い世代または順序が逆転したmaintenance通知を受け取ったとき, the application shell shall 現在の新しい状態を後退させない
6. The application shell shall maintenance leaseの取得、更新、解放または永続化を行わない
7. When mount中のfeatureに対してmutationの可否が変化したとき, the application shell shall その変化をfeatureが購読できる形で通知し、featureの再mountを要求せずに表示を更新できるようにする

### 要件6: Runtime互換性と検証可能性
**目的:** 開発者として、対象Chrome環境でshell統合を再現可能に検証したい。それによりfeature追加時の共有境界の回帰を防げる。

#### 受け入れ基準
1. Where PC版Chrome 116以降で未パッケージのManifest V3拡張として実行される場合, the application shell shall side panelの主要操作を提供する
2. When side panelを開く操作が行われたとき, the application shell shall 有効なユーザージェスチャーの文脈を維持する
3. The application shell shall リモートコード、動的コード評価、インラインJavaScriptを必要とせず動作する
4. When feature登録、遷移、表示失敗、maintenance状態変更を統合検証するとき, the application shell shall 各結果を決定的に観測できる

### 要件7: Feature間の型付きactivation
**目的:** 利用者として、ある機能で開始した作業を入力内容を失わず対象機能へ引き継ぎたい。それにより同じ情報を再入力せず一貫した作業を継続できる。

#### 受け入れ基準
1. When 登録済みfeatureへのactivationが要求されたとき, the application shell shall 対象featureを表示してactivation内容をそのfeatureへ一度だけ配送する
2. When activation先が現在表示中のfeatureであるとき, the application shell shall 不要な表示終了を行わずactivation内容を現在のfeatureへ配送する
3. If 対象feature、遷移先またはactivation内容が受け付けられないとき, the application shell shall 現在の表示を維持して診断可能な失敗を返す
4. If 対象featureの表示開始またはactivation適用が失敗したとき, the application shell shall 入力元featureが提供した状態を復元して表示し、回復可能な案内を提供する
5. The application shell shall feature固有のactivation内容を解釈または変換せず対象featureの検証結果に従う
6. If activation先featureの表示終了に失敗したとき, the application shell shall 入力元featureを同時に表示せず、失敗したfeatureの終了を再試行可能な状態として保持する
7. When 一過性featureへの有効なtyped activationが要求されたとき, the application shell shall 常設navigation選択を必要とせず既存activation契約で対象featureを表示し内容を一度だけ配送する
8. When 一過性featureから常設featureへのtyped activationが成功したとき, the application shell shall 一過性featureを終了し引き渡し先だけを主表示領域へ保持する

### 要件8: 設定画面の常設統合
**目的:** 利用者として、表示言語とバックアップ・復元へ常設の設定画面から到達したい。それにより狭いside panelの共通領域を占有せず必要な設定を見つけられる。

#### 受け入れ基準
1. When settings featureが登録されたとき, the application shell shall それを常設navigation、通常選択、初期選択、およびfallbackの対象として扱う
2. While 常設navigationを利用できる状態にある間, the application shell shall 通常表示、maintenance表示、およびfeature表示失敗からsettings featureへの移動を受け付ける
3. The application shell shall shellヘッダに表示言語コントロールを配置せず、表示言語とバックアップ・復元の操作面をsettings featureへ委ねる
4. When settings featureの表示言語が変化したとき, the application shell shall 現在mount中のsettings featureを不要に再mountせずnavigation表示を同じ言語へ更新する
