# 要件定義書

## はじめに

一過性表示面は、application shellへ「常設ナビゲーションに並ばず、権限を与えるジェスチャーでだけ起動し、対象タブの文書世代が失効すると終了するfeature区分」を導入する。本specは汎用的な登録・起動・寿命・戻り先契約だけを所有し、最初の業務利用者への適用は下流spec `product-capture-transient-migration` が担う。

## 境界コンテキスト

- **対象内**: 一過性featureの登録区分、ナビゲーションからの除外、ジェスチャー起動要求、対象タブと起動世代の固定、遷移・更新・閉鎖・常設選択による終了、戻り先、汎用的な引き渡し終了、Chrome runtime adapter、決定的検証。
- **対象外**: product-captureのUI・状態・抽出処理、候補編集draft、保存規則、価格更新メニューの実登録、設定画面、永続商品データ。
- **隣接する期待**: `product-capture-transient-migration` は本specの公開契約を利用する。application shellのloading・error・maintenance・mutation抑止は再定義しない。

## 要件

### 要件1: 一過性表示面の登録区分

**目的:** feature実装者として、常設ナビゲーションを占有しない表示面を型付き登録したい。

#### 受け入れ基準

1. The 一過性表示面 shall featureを常設または一過性の表示区分で登録できる
2. When 一過性featureが登録される, the 一過性表示面 shall そのfeatureを常設ナビゲーションへ提示しない
3. When 表示区分が未指定の既存featureが登録される, the 一過性表示面 shall 常設featureとして既存の表示と選択動作を維持する
4. The 一過性表示面 shall 同時に一つのfeatureだけを主表示領域へ提示する
5. If 一過性featureが起動されていない, the 一過性表示面 shall 主表示領域へ常設featureだけを提示する
6. If 一過性featureの登録情報が不正または不足している, the 一過性表示面 shall その登録を隔離し他のfeatureの利用を継続する

### 要件2: ジェスチャーによる起動

**目的:** 利用者として、権限を与えた操作と同じ文書世代に対してだけ一過性面を利用したい。

#### 受け入れ基準

1. When 利用者が拡張アイコンを操作する, the 一過性表示面 shall side panelを開き対象タブで実行可能な一過性featureを主表示領域へ提示する
2. When side panelが閉じた状態から起動される, the 一過性表示面 shall 起動要求を失わず初期表示として提示する
3. When side panelが既に常設featureを表示している, the 一過性表示面 shall 同じジェスチャーで一過性featureへ切り替える
4. When 一過性featureを提示する, the 一過性表示面 shall ジェスチャー時の単一タブと起動世代を固定する
5. Where 別の権限付与ジェスチャー経路が登録される場合, the 一過性表示面 shall 同じ起動・対象固定規則を適用する
6. When 同じタブに対する新しいジェスチャーを受け取る, the 一過性表示面 shall 新しい起動世代として受理し実行可能な状態を提示する
7. If 起動要求を提示前に安全に成立させられない, the 一過性表示面 shall 一過性featureを提示せず再操作可能な理由を利用者へ示す

### 要件3: 終了、引き渡し、戻り先

**目的:** 利用者として、対象文書へ実行できなくなった時点で操作面が消え、適切な常設画面へ戻ってほしい。

#### 受け入れ基準

1. When 対象タブがトップレベル遷移または更新する, the 一過性表示面 shall 現行世代を終了して直前の常設featureを提示する
2. When 対象タブが閉じられる, the 一過性表示面 shall 現行世代を終了して直前の常設featureを提示する
3. When 利用者が常設ナビゲーション項目を選択する, the 一過性表示面 shall 一過性featureを終了して選択されたfeatureを提示する
4. If 直前の常設featureが存在しない, the 一過性表示面 shall 利用可能な常設featureを提示する
5. If 直前の常設featureが利用不可である, the 一過性表示面 shall 代替の常設featureと遷移理由を提示する
6. While 一過性featureを終了している, the 一過性表示面 shall 対象タブへの実行操作を提示しない
7. When 一過性featureを終了する, the 一過性表示面 shall 業務の永続状態を変更しない
8. If 終了処理に失敗する, the 一過性表示面 shall 常設featureと同時表示せず再試行可能な状態を保持する
9. When 一過性featureが型付き引き渡しに成功する, the 一過性表示面 shall 戻り先を復帰せず引き渡し先featureを主表示として保持する
10. If 旧世代のイベントまたは完了通知が到着する, the 一過性表示面 shall 現行世代の表示状態を変更しない

### 要件4: 検証可能性と非回帰

**目的:** shell保守者として、一過性面の寿命と既存常設featureの非回帰を決定的に検証したい。

#### 受け入れ基準

1. The 一過性表示面 shall 登録、起動、対象固定、世代更新、終了、戻り先をChrome APIなしの自動テストで観測可能にする
2. The 一過性表示面 shall 遷移、更新、タブ閉鎖、常設選択、引き渡し成功・失敗の経路を自動検証可能にする
3. The 一過性表示面 shall side panelが閉じている場合と既に開いている場合の起動経路を自動検証可能にする
4. The 一過性表示面 shall 常設featureの登録、ナビゲーション、遷移、availability障害分離を回帰させない
5. Where 本契約を利用する実featureがproduction buildへ登録される場合, the 一過性表示面 shall Chrome 116以降の未パッケージManifest V3拡張で起動から終了までの主要動線を検証可能にする
6. The 一過性表示面 shall 実サイト由来のHTML、画像、商品データをテスト資産として必要としない
