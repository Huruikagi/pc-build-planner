# 要件定義書

## はじめに

application shellは、PC build plannerのside panelにおける共有ホスト、ナビゲーション、feature登録、公開API合成、共通状態表示を一元化する。利用者は、独立した各featureを一貫した画面から利用でき、復元などのmaintenance中には誤ってデータ変更操作を実行しないで済む。feature実装者は共有runtime入口を編集せず、安定した登録契約を介してshellへ参加できる。

## 境界コンテキスト

- **対象内**: side panel host、featureナビゲーション、登録済みfeatureのmount/unmount、型付きfeature activationの配送、利用可能状態、共通loading/error/maintenance表示、mutation操作の共通抑止、composition root、root公開API合成。
- **対象外**: feature固有の業務ロジック・state・view、永続化、maintenance lease管理、復元、商品抽出、互換性判定。
- **隣接する期待**: local-data-foundationは信頼できるmaintenance状態をread-only契約で提供し、各featureは登録情報・view lifecycle・公開契約を提供する。

## 要件

### 要件1: Side panelホストとナビゲーション
**目的:** 利用者として、登録された機能を一貫したside panelから選択したい。それによりPC構成計画の作業間を迷わず移動できる。

#### 受け入れ基準
1. When side panelが開始されたとき, the application shell shall 登録済みで利用可能なfeatureのナビゲーションを表示する
2. When 利用者がナビゲーション項目を選択したとき, the application shell shall 選択したfeatureのviewを表示する
3. When 別のfeatureへ移動したとき, the application shell shall 以前のfeatureの表示を終了してから新しいfeatureを表示する
4. If 選択中のfeatureが利用不可になったとき, the application shell shall 利用可能な遷移先と理由を表示する
5. The application shell shall 同時に一つのfeatureだけを主表示領域へ表示する

### 要件2: Feature登録契約
**目的:** feature実装者として、共有runtimeファイルを編集せずにfeatureをshellへ参加させたい。それによりfeatureを独立して実装・検証できる。

#### 受け入れ基準
1. When featureが登録されたとき, the application shell shall feature識別子、ナビゲーション情報、表示開始・終了動作、利用可能状態を受け付ける
2. If 同じfeature識別子が複数回登録されたとき, the application shell shall 重複を拒否し診断可能なエラーを返す
3. If 登録情報が不正または不足しているとき, the application shell shall そのfeatureを表示対象にせず他のfeatureの利用を継続する
4. When featureの利用可能状態が変化したとき, the application shell shall ナビゲーションと現在表示を新しい状態へ同期する
5. The application shell shall feature固有の業務データを解釈せず登録契約に含まれる情報だけを扱う

### 要件3: Composition rootと公開API
**目的:** 開発者として、runtime依存と公開契約を一箇所で合成したい。それにより依存方向と共有入口の所有者を明確にできる。

#### 受け入れ基準
1. When 拡張runtimeが開始されたとき, the application shell shall foundationとfeature登録を一度だけ合成してside panelを起動する
2. When root公開APIが利用されたとき, the application shell shall feature単位の公開契約を一貫したroot契約として提供する
3. If 必須の上流契約を初期化できないとき, the application shell shall feature画面を開始せず共通エラーを表示する
4. The application shell shall 各featureによる共有runtime入口およびroot公開APIの直接変更を必要としない参加方式を提供する

### 要件4: 共通状態表示と障害分離
**目的:** 利用者として、shellやfeatureの待機・失敗状態を理解したい。それにより次に取れる操作を判断できる。

#### 受け入れ基準
1. While shellを初期化している間, the application shell shall 共通loading表示を提示する
2. If featureの表示開始が失敗したとき, the application shell shall 安全な共通エラー表示と再試行または別featureへの移動手段を提示する
3. If 一つのfeatureの登録または表示が失敗したとき, the application shell shall 利用可能な他のfeatureの操作を維持する
4. When エラー表示に外部由来文字列が含まれるとき, the application shell shall その文字列を実行可能なmarkupとして扱わずテキストとして表示する

### 要件5: Maintenance表示とmutation抑止
**目的:** 利用者として、復元などのmaintenance中に変更操作を実行しないよう明確に案内されたい。それにより拒否される操作や競合を避けられる。

#### 受け入れ基準
1. When foundationがmaintenance開始状態を通知したとき, the application shell shall 全featureに共通するmaintenance表示を提示する
2. While maintenance状態が有効な間, the application shell shall mutationとして登録された操作を開始不能にする
3. While maintenance状態が有効な間, the application shell shall read-onlyとして登録された閲覧とナビゲーションを維持する
4. When foundationが現行世代のmaintenance終了状態を通知したとき, the application shell shall mutation操作の共通抑止を解除する
5. If 古い世代または順序が逆転したmaintenance通知を受け取ったとき, the application shell shall 現在の新しい状態を後退させない
6. The application shell shall maintenance leaseの取得、更新、解放または永続化を行わない

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
