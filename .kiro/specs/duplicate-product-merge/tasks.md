# 実装計画

- [x] 1. 商品識別値を照合専用に正規化する
  - 既存の商品取り込みが使う制御文字除去・空白整理を共有し、表示用の確認値を変えずにNFKC、大文字小文字、型番区切りの差を吸収する。
  - 商品名・メーカー・型番だけを受ける型安全な公開境界を追加し、他featureが内部normalizerを直接参照しない形にする。
  - confirmedを優先し、欠損時だけoriginalを使い、空値から推測値を作らない。
  - 大小文字、全角半角、連続空白、型番の空白・ハイフン・アンダースコアが同じ比較keyへ収束し、保存・表示値が変わらないunit testが成功することを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.5_
  - _Boundary: ProductIdentityNormalizer_

- [x] 2. 一致判定と排他的な保存先ルーティングを実装する

- [x] 2.1 project内候補を判定する純粋matcherを構築する
  - 両側が分類済みで異なるカテゴリを除外し、片側が未分類なら照合を継続する。
  - 型番一致をhigh、型番で確定できない場合のメーカー+商品名一致をsupportingとし、両型番不一致では補助keyへfallbackしない。
  - identity不足をmatchにせず、確信度、根拠、候補要約を持つ説明可能な結果を返す。
  - confidenceとcandidate IDによる決定的順位を、入力配列順やlocaleに依存せず再現する。
  - 架空candidateだけを使うunit testでcategory gate、全match分岐、根拠、順位が観測できることを完了条件とする。
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 7.5_
  - _Boundary: DuplicateCandidateMatcher_

- [x] 2.2 (P) 同一URLを価格更新へ、新規URLをsource追加へ振り分ける
  - source-price-refresh公開のcandidate scope照合を最初に使い、独自のURL正規化や曖昧一致を実装しない。
  - 一意一致ではcanonical candidate/source IDへ価格観測を渡し、no-matchのときだけ上流source追加を一度呼ぶ。
  - ambiguous、invalid、ineligible、stale、price欠損、管理系失敗をsource追加へfallbackせず、既存sourceと価格を維持する。
  - 成功時に `source-added` または `price-refreshed` の片方だけが返り、両portが同じ操作で呼ばれないunit testが成功することを完了条件とする。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 6.2, 6.3, 6.4, 7.1, 7.2_
  - _Boundary: DuplicateUrlRouter_
  - _Depends: 1_

- [x] 2.3 保存前評価と明示判断のcommitを調停する
  - 選択projectをcanonical candidate queryで読み、別projectの候補やfoundation rootを参照しない。
  - matchなしは既存createを一度だけ実行し、matchありは永続化せず順位付き判断結果を返す。
  - 明示された新規保存または一件の統合targetだけを受理し、直近match集合にないtargetをstale decisionとして拒否する。
  - 統合ではURL routerの結果だけを採用し、create後の削除や失敗補償の別writeを行わない。
  - create、source add、price refreshが相互排他的なreceiptとなり、query/write失敗時にdraftを返せるcoordinator testが成功することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: DuplicateMergeCoordinator_
  - _Depends: 2.1, 2.2_

- [x] 3. candidate editorへ判断状態と明示確認UIを追加する

- [x] 3.1 create modeの判断lifecycleとrollback snapshotを追加する
  - 評価中、判断待ち、commit中、失敗を既存editor draftと分離して保持し、edit modeの保存には適用しない。
  - target未選択を初期状態とし、処理中の二重送信、古いmatch target、取消、再試行、明示新規保存を判別可能にする。
  - 成功時だけeditorを閉じて一覧を再読込し、失敗・取消では入力とmatchを保持する。
  - 判断待ちと失敗をversion付きsnapshotで検証・復元し、処理途中または不正snapshotから永続writeを開始しない。
  - stateとsnapshotのunit testでdraft保持、二重送信抑止、rollback、retryが観測できることを完了条件とする。
  - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: DuplicateMergeState_
  - _Depends: 2.3_

- [x] 3.2 (P) 統合判断と失敗文言を日本語・英語へ追加する
  - 一致根拠、確信度、新規保存、統合、取消、再試行、曖昧・競合・source失敗の安定したmessage keyを定義する。
  - 商品値や完全URLを固定文言へ埋め込まず、viewが安全なparameterとして渡せる契約にする。
  - 日本語・英語catalogのkey parityとformat parameter整合を既存catalog testで検証する。
  - 両言語で同じ判断と回復actionが表示可能になり、catalog parity gateが成功することを完了条件とする。
  - _Requirements: 3.1, 3.2, 3.3, 6.1, 6.3, 6.4, 7.4_
  - _Boundary: DuplicateMergeView_

- [x] 3.3 順位付き候補と明示的な統合判断を描画する
  - 候補名、メーカー、型番、カテゴリ、確信度、一致根拠をmatcher順で表示する。
  - 統合targetは未選択で開始し、「新規候補として保存」と「選択候補へ統合」を別actionとして提示する。
  - target未選択の統合を無効化し、取消時はeditor入力へ戻り、失敗時は再試行と明示新規保存を提示する。
  - ページ由来文字列を通常のJSX childとして扱い、完全URLを判断画面へ表示しない。
  - user-event DOM testで順位、選択、取消、action活性、入力保持、安全なtext描画が観測できることを完了条件とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.3, 7.4_
  - _Boundary: DuplicateMergeView_
  - _Depends: 3.1, 3.2_

- [ ] 4. candidate-managementとadjacent public portを統合する

- [x] 4.1 create modeの保存をcoordinatorとstateへ接続する
  - candidate-management内部で既存create保存を保存前評価へ差し替え、edit modeのupdateと既存validationを維持する。
  - source追加用のcanonical inputを上流capture/source mapperから受け、商品値、正規化属性、抽出元表記、primaryを独自にマージしない。
  - match判断中はwriteせず、成功時だけ一覧・editorを更新し、失敗時は既存field errorとdraft保持規則へ写像する。
  - candidate-management内部のservice/state integration testでmatchなし、新規選択、統合選択、edit非回帰が成功することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: DuplicateMergeCoordinator, DuplicateMergeState_
  - _Depends: 3.3_

- [x] 4.2 application shellで公開portを一度だけcompositionする
  - candidate query、candidate source mutation、source-price-refresh port、identity normalizerを各featureの `public.ts` から取得してcandidate contributionへ注入する。
  - shellは具体portの配線だけを行い、match、URL判断、source選択、保存判断を持たない。
  - foundation root、Storage adapter、他feature内部module、context menu、transient gesture、価格抽出portへ依存しない。
  - 新しい権限やruntime entryを追加せず、public consumer型検査とboundary contract testが成功することを完了条件とする。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 7.1, 7.2, 7.6_
  - _Boundary: DuplicateUrlRouter_
  - _Depends: 4.1_

- [ ] 5. critical flowと回帰gateを検証する

- [ ] 5.1 原子的な統合と全失敗回復をintegrationで検証する
  - 架空データでmatchなし、新規保存、source追加、同一URL価格更新を通し、candidate/source件数とprimary・product・attributesの保持を検証する。
  - query、validation、conflict、maintenance、storage、quota、ambiguous、stale、price欠損を注入し、部分writeがなくdraftとmatchが保持されることを検証する。
  - 同じ判断の二重送信がsource重複を作らず、target更新後の古い判断が再評価を要求することを検証する。
  - 成功・失敗のconsole spyで商品識別値、完全URL、保存内容、例外dumpが診断ログへ出ないことを検証する。
  - すべてのintegration scenarioがcanonical public portだけを通り、既存候補を破損しないことを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3_
  - _Boundary: DuplicateMergeCoordinator, DuplicateUrlRouter, DuplicateMergeState_
  - _Depends: 4.2_

- [ ] 5.2 (P) 判断UI、locale、安全な外部文字列をDOMで検証する
  - user-eventで順位付き候補、未選択初期値、target選択、新規保存、統合、取消、再試行を操作する。
  - 日本語・英語で判断、根拠、失敗理由、回復actionが同じ挙動になることを検証する。
  - 悪意ある商品名・メーカー・型番が要素やscriptとして解釈されず、完全URLや保存payloadがDOM・ログへ現れないことを検証する。
  - matchあり・なし・失敗のDOM testが既存candidate editorの入力とaccessibility属性を維持して成功することを完了条件とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.3, 7.4, 7.5_
  - _Boundary: DuplicateMergeView_
  - _Depends: 3.3_

- [ ] 5.3 取り込みから統合までの実拡張E2Eを追加する
  - 架空商品ページの取り込みからcandidate editorへ引き渡し、model一致候補を選んでsourceが一件増えcandidate件数が増えない経路を検証する。
  - 同じ架空URLの再取り込みではsourceが増えず、既存sourceの価格更新receiptへ到達することを検証する。
  - matchなしと明示新規保存では従来のcandidate createが成功し、統合対象が変化しないことを検証する。
  - production buildの未パッケージ拡張で三つのcritical pathが安定locatorを通して成功することを完了条件とする。
  - _Requirements: 1.1, 1.3, 1.4, 3.4, 3.5, 4.1, 4.6, 5.1, 5.2, 6.6, 7.5, 7.6_
  - _Boundary: DuplicateMergeCoordinator, DuplicateMergeView_
  - _Depends: 5.1, 5.2_

- [ ] 5.4 feature全体の品質gateを完了する
  - 公開境界、fixture資産、TypeScript strict、lint、unit/contract/integration/DOM test、production buildの各gateを順に実行する。
  - E2Eを含む完全検証で既存candidate-management、product-capture、source bookmark、price refresh動線の非回帰を確認する。
  - 新規権限、deep import、実サイトfixture、未追跡のschema変更が成果物へ含まれないことを機械検査する。
  - すべての共通検証commandが成功し、失敗がある場合は原因を本specの責務へ修正して再実行済みであることを完了条件とする。
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - _Boundary: DuplicateProductMergeIntegration_
  - _Depends: 5.3_
