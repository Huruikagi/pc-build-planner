# 要件定義書

## はじめに

商品取り込みを、常設ナビゲーションに並ぶ確認・保存画面から、実行だけを担う一過性表示面へ移行する。上流spec `transient-feature-surface` が提供する起動世代、固定対象タブ、寿命、原子的引き渡し契約を利用し、抽出結果の確認・補正・保存は候補管理の非一過性画面へ引き渡す。保存先は商品取り込み側で決めず、候補管理が検証済みの現在projectへ解決する。

## 境界コンテキスト

- **対象内**: product-captureの一過性登録、実行面への縮小、固定タブでの抽出、stale結果抑止、project未解決handoff、候補管理による未解決pre-editの受理と保持、受理失敗時だけのcapture側intent保持と再試行、成功時だけの終了、rollback世代、手入力開始、副作用抑止、capture/candidate非回帰。
- **対象外**: 一過性feature基盤とruntime配送、current projectの選択・fallback・永続化、候補pre-editの保存先決定、project CRUD、候補editor state、application shellのport注入、抽出優先順位・正規化、候補の保存規則、複数ソース化、価格更新、設定画面。
- **隣接期待**: `project-context` が現在選択を提供し、`project-candidate-management` がproject未解決handoffを受理してpending pre-editを保持し、検証済みcurrent contextへのbindingと再開を所有し、application shellがtyped activationを配送する。

## 要件

### 要件1: 実行面と結果保持面の分離

**目的:** 利用者として、対象ページの寿命と確認・補正作業を切り離し、途中の内容を失わずに作業したい。

#### 受け入れ基準

1. The 商品取り込み移行 shall 実行操作、実行中状態、実行失敗案内だけを一過性面へ提示する
2. When 抽出が成功する, the 商品取り込み移行 shall 抽出結果と取得根拠を候補管理の非一過性編集面へ引き渡す
3. When 候補管理が検証済みcurrent contextへのbindingまたはproject未解決pre-editの保持として引き渡しを受理する, the 商品取り込み移行 shall 上流の原子的引き渡し契約で一過性面を終了する
4. While 引き渡し後に確認または補正している, the 商品取り込み移行 shall 対象タブの遷移・更新・閉鎖によって内容を破棄しない
5. If 抽出処理全体で商品候補を得られない, the 商品取り込み移行 shall 空の商品名から手入力を開始できる候補編集面へ進む案内を提示する
6. If current contextが未選択または利用不能である, the 商品取り込み移行 shall 候補管理がproject未解決pre-editを受理して保持し一過性面の終了後も再開可能な状態を提示できるようにする
7. The 商品取り込み移行 shall 候補の確認、補正、保存規則を再定義しない
8. When 候補管理が保持するproject未解決pre-editに対して利用者がprojectを明示的に選択または作成する, the 商品取り込み移行 shall ページを再抽出させず同じpre-editから候補編集を再開できるようにする
9. If 候補管理が引き渡し自体を受理できないか原子的終了が完了しない, the 商品取り込み移行 shall 一過性面を終了済みとして扱わず、現行のrollback世代に結び付いた保持intentから再試行できる状態を維持する

### 要件2: 実行可否と失敗案内

**目的:** 利用者として、実行しても必ず失敗する操作を見せられず、回復方法を判断したい。

#### 受け入れ基準

1. While 一過性商品取り込み面を提示している, the 商品取り込み移行 shall 上流から配送された現行世代と固定タブに対する操作だけを提示する
2. The 商品取り込み移行 shall 現行世代でない状態から抽出を開始しない
3. If 実行時にアクセス権限が失効している, the 商品取り込み移行 shall 拡張アイコンの再操作で回復できることを案内する
4. If 対象が制限ページである, the 商品取り込み移行 shall 永続状態を変更せず対象外であることを提示する
5. If 抽出中に世代が変わるか対象タブが遷移・更新・閉鎖する, the 商品取り込み移行 shall 古い抽出結果を引き渡さない
6. If ページ処理が応答しないか予期せず失敗する, the 商品取り込み移行 shall 永続状態を変更せず実行失敗を提示する
7. When 失敗後に新しい起動世代を受け取る, the 商品取り込み移行 shall 失敗状態を破棄し新しい固定タブで実行可能な初期状態を提示する

### 要件3: 起動時の副作用抑止

**目的:** 利用者として、side panelを開いただけでページ解析や候補作成が始まらない状態を維持したい。

#### 受け入れ基準

1. When 一過性商品取り込み面が起動する, the 商品取り込み移行 shall 利用者が実行を選ぶまでページを読み取らない
2. The 商品取り込み移行 shall 起動だけで実行中・実行失敗表示または候補作成を発生させない
3. While 常設featureを表示している, the 商品取り込み移行 shall 上流の起動要求なしに商品取り込み面へ切り替えない
4. The 商品取り込み移行 shall 利用者が実行していないページを監視または解析しない
5. The 商品取り込み移行 shall 全サイトへの恒久的な読み取り権限を要求しない

### 要件4: 解決前draftと検証段階

**目的:** feature実装者として、projectや商品名が未解決の編集開始状態を、保存可能なcanonical draftと混同せず型安全に扱いたい。

#### 受け入れ基準

1. The 商品取り込み移行 shall project IDまたは保存先選択を含まない解決前draftを公開契約として表現する
2. When 候補管理が検証済みcurrent contextの現在projectへ解決前draftをbindできる, the 商品取り込み移行 shall その解決を候補管理へ委ねてcanonical draftの編集開始を可能にする
3. When 商品名が空の手入力draftを受け取る, the 商品取り込み移行 shall 構造的整合だけを検証して編集開始を許可する
4. When 空の商品名で保存しようとする, the 商品取り込み移行 shall 既存の保存時検証で拒否する
5. The 商品取り込み移行 shall 仮project ID、payload由来または画面snapshot由来のproject ID、consumer独自fallback、unsafe cast、保存時validatorの重複定義を保存先決定に使用しない
6. If current contextが未選択または利用不能である, the 商品取り込み移行 shall current contextを上書きせず候補管理がproject未解決pre-editを保持し、projectの選択、作成、またはcontext回復後に同じpre-editから編集を再開できるようにする
7. When 候補管理がcurrent contextへbindしたdraftを受理する, the 商品取り込み移行 shall 受理されたprojectを別のprojectへ置き換えず引き渡し成功として扱う
8. If staleまたは無効なproject情報がhandoff入力に含まれる, the 商品取り込み移行 shall その情報でcurrent contextを変更せずproject未解決契約に従って処理する

### 要件5: 検証可能性と既存動線の非回帰

**目的:** feature保守者として、capture移行と候補編集への引き渡しを再現可能に検証したい。

#### 受け入れ基準

1. The 商品取り込み移行 shall 状態集合が実行・実行中・失敗だけであることをunit testで検証可能にする
2. The 商品取り込み移行 shall stale世代の抽出結果が引き渡されないことを自動検証可能にする
3. The 商品取り込み移行 shall current contextへのbinding成功、current context未選択・利用不能時の候補管理による受理と保持、context回復後の同一pre-edit再開、候補受理失敗時のcapture側保持と再試行、候補ゼロの手入力開始をintegration testで検証可能にする
4. The 商品取り込み移行 shall 既存の抽出、候補編集、保存時検証を回帰させない
5. Where Chrome 116以降の未パッケージ拡張で実行される場合, the 商品取り込み移行 shall action後と同形のdurable activation受信、実product-capture登録の提示、および対象タブ失効または常設ナビゲーション選択による一過性面の終了・常設面復帰をproduction buildの自動E2Eで検証可能にし、固定tab抽出から検証済みcurrent projectの候補編集面への引き渡し、context未選択または利用不能時の候補管理による保持とcontext回復後の再開をChrome-shaped integration testで検証し、ブラウザーtoolbar iconによる起動、`activeTab`付与、実script注入、候補編集面到達は同じbuildに対する必須manual smokeとして分離する
6. The 商品取り込み移行 shall 実サイト由来のHTML、画像、商品データをテスト資産として必要としない
7. The 商品取り込み移行 shall staleなproject情報がcurrent contextを上書きしないこと、候補管理がbindingまたは未解決pre-edit保持として受理した場合だけ一過性面が終了すること、および受理失敗または原子的終了失敗時にcaptureがrollback世代から再試行できることを自動検証可能にする
