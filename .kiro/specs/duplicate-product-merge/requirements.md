# 要件文書

## はじめに

本機能は、別サイトで見つけた同一PCパーツを重複候補として保存してしまう利用者に対し、取り込み内容と対象プロジェクト内の既存候補を保存前に照合し、既存候補の別ソースとして統合する選択肢を提供する。照合は自動で行うが、統合は利用者が対象候補を明示して確定した場合だけ実行し、一致しない場合や統合を選ばない場合は従来どおり新規候補として保存する。

## 境界コンテキスト

- **対象範囲**: canonical product identity coreの型・normalizer・matcher・factory・公開入口と現行判定のcharacterization、取り込み・新規保存時のプロジェクト内照合、一致候補の順位付けと提示、利用者による統合または新規保存の確定、candidate/source公開matcher・mutationによる統合、同一URLの価格更新動線への振り分け、共有`AppDataError` consumer mapping、失敗時の入力保持。
- **対象外**: ソースコレクションとプライマリ導出の再定義、価格再取得、プロジェクト横断照合、保存済み候補どうしの事後マージ、抽出順位・商品マスター・外部商品DB・互換性判定の変更。
- **隣接期待**: 本機能が商品識別normalizer/matcherのcanonical public seamを提供する。`project-candidate-management`はproject限定queryとduplicate専用の最小`CandidateCreatePort`を、`candidate-source-bookmarks`はsource URL match/add/conditional mutationと原子的source変更を提供する。`local-data-foundation`は共有`AppDataError`を所有し、application shellは最終compositionだけを所有する。本機能のworkflowは自らが所有するidentity公開入口と隣接ownerの公開portだけを利用する。

## Change Integration

- **Change Brief**: `v0.5.0-boundary-reconciliation`
- **In scope trace**: identity type/normalizer/matcher/factory/public entryのcanonical ownership、candidate/source public seam consumer化、旧`ManagementError` import撤去、共有`AppDataError` mapping、duplicate detection・merge planning・confirmation・atomic routing・UI非回帰を要件1〜8へ統合する。
- **Out of scope preservation**: canonical error、candidate/source entity・query・mutation実装、source URL identity、price refresh、application shell composition、identity algorithmの意味、保存形式、UI layoutを変更しない。
- **Non-regression**: 自動照合と明示確認、新規保存を安全な初期判断とする規則、project内限定、誤検知時の新規保存、相互排他的な一回のatomic route、失敗時draft/既存値保持を維持する。

## 要件

### 要件 1: 保存前のプロジェクト内照合

**目的:** PCパーツ検討者として、新しい取り込みを保存する前に対象プロジェクト内の既存商品へ気付きたい。そうすることで、候補を重複作成せず複数サイトの情報を束ねられる。

#### 受入基準

1. When 取り込み由来の新規候補を保存しようとする, the 重複商品統合機能 shall candidate ownerの公開project限定queryとidentity public matcherを使い、新規候補を書き込む前に既存候補との一致を評価する。
2. The 重複商品統合機能 shall 照合対象を保存先として選択された一つのプロジェクト内に限定する。
3. If 対象プロジェクトに既存候補がない, the 重複商品統合機能 shall candidate ownerの最小`CandidateCreatePort`を一度だけ使い、統合確認を挟まず従来の新規保存を継続する。
4. If 有力な一致候補がない, the 重複商品統合機能 shall candidate ownerの最小`CandidateCreatePort`を一度だけ使い、誤検知を理由に保存を止めず従来の新規保存を継続する。
5. The 重複商品統合機能 shall 保存済み候補どうしを一覧から選ぶ事後マージを実行しない。

### 要件 2: 商品識別値の正規化と一致順位

**目的:** PCパーツ検討者として、サイトごとの表記ゆれがあっても同じ商品を一致候補として見つけたい。そうすることで、型番や商品名の書き方の差を手作業で吸収せずに済む。

#### 受入基準

1. When identity public matcherが取り込み値と既存候補の型番一致を返す, the 重複商品統合機能 shall その候補を最上位の一致候補として扱う。
2. When identity public matcherが型番で確定せずメーカー名と商品名の組み合わせ一致を返す, the 重複商品統合機能 shall その候補を補助的な一致候補として扱う。
3. If 取り込み値と既存候補の型番がともに存在し、正規化後も異なる, the 重複商品統合機能 shall メーカー名と商品名だけを根拠にその候補を提示しない。
4. If 型番の一致もメーカー名と商品名の組み合わせ一致も評価できない, the 重複商品統合機能 shall その候補を一致候補として扱わない。
5. The 重複商品統合機能 shall canonical identity public seamが同一と判定する大文字小文字、全角半角、前後空白および連続空白の差を維持し、規則を再実装しない。
6. The 重複商品統合機能 shall canonical identity public seamが同一と判定する型番内の空白、ハイフンおよびアンダースコアによる区切りの差を維持し、独自の区切り規則を追加しない。
7. If 取り込み候補と既存候補がともに分類済みでカテゴリが異なる, the 重複商品統合機能 shall その既存候補を統合先から除外する。
8. Where 取り込み候補または既存候補が未分類である, the 重複商品統合機能 shall 未分類であることだけを理由に一致候補から除外しない。
9. When 複数の一致候補がある, the 重複商品統合機能 shall 型番一致を補助的一致より先にし、同じ確信度では決定的な順序で提示する。
10. The 重複商品統合機能 shall 照合結果ごとに、一致に使用した識別値と確信度を利用者へ説明可能な形で保持する。

### 要件 3: 明示的な統合判断

**目的:** PCパーツ検討者として、一致候補を確認してから統合先を自分で決めたい。そうすることで、似た別商品を誤って一つへまとめることを防げる。

#### 受入基準

1. When 一件以上の有力な一致候補が見つかる, the 重複商品統合機能 shall 新規保存を実行する前に候補名、メーカー、型番、カテゴリおよび一致根拠を提示する。
2. When 複数の一致候補が見つかる, the 重複商品統合機能 shall 利用者が統合先を一件だけ選択できるよう順位付きで提示する。
3. The 重複商品統合機能 shall 一致候補を自動選択せず、新規候補として保存する選択肢を安全な初期判断として維持する。
4. When 利用者が一件の既存候補を選んで統合を確定する, the 重複商品統合機能 shall 選択された候補だけを統合先として使用する。
5. When 利用者が新規候補として保存することを選ぶ, the 重複商品統合機能 shall 一致候補を変更せず、取り込み内容を新しい候補として保存する。
6. If 利用者が判断を取り消す, the 重複商品統合機能 shall 永続状態を変更せず、編集内容を保持する。
7. The 重複商品統合機能 shall 利用者の明示確定なしに既存候補へソースを追加しない。

### 要件 4: 既存候補へのソース統合

**目的:** PCパーツ検討者として、選択した既存候補へ今回の取得元を追加したい。そうすることで、一つの商品に複数サイトの価格と出典をまとめられる。

#### 受入基準

1. When 利用者が統合を確定し、取り込み元が有効な新規ソースである, the 重複商品統合機能 shall candidate-source ownerの公開match/add/conditional mutation portを使い、そのURL、サイト名、取得日時、取得価格およびソース種別を選択候補へ原子的に追加する。
2. When 新しいソースが追加される, the 重複商品統合機能 shall 既存候補の商品名、メーカー、型番、注記、カテゴリ別正規化属性および抽出元表記を維持する。
3. When 新しいソースが追加される, the 重複商品統合機能 shall 既存のプライマリ指定を変更しない。
4. Where 統合先候補がソースを持たない, the 重複商品統合機能 shall 上流のソース追加規則に従って追加した最初のソースをプライマリにする。
5. The 重複商品統合機能 shall 取り込み値と既存候補の商品値が食い違う場合に、既存候補の確認値または元表記を暗黙に上書きしない。
6. When ソース統合が成功する, the 重複商品統合機能 shall 新規候補を作成せず、更新された既存候補を結果として示す。
7. The 重複商品統合機能 shall 新規候補を一度保存してから既存候補へ統合する二段階の更新を行わない。

### 要件 5: 同一ソースURLの振り分け

**目的:** PCパーツ検討者として、既に保存済みのページを再取り込みしたときに同じソースを重複登録したくない。そうすることで、一つの取得元を一意に保ちながら価格更新へ進める。

#### 受入基準

1. When 選択された統合先に取り込み元と同一と判定されるソースURLが存在する, the 重複商品統合機能 shall 新しいソースを追加しない。
2. When 同一ソースURLが一意に特定される, the 重複商品統合機能 shall 対象候補と対象ソースを価格更新動線へ引き渡す。
3. If 同一ソースURLが複数の保存先に一致して更新先を一意に特定できない, the 重複商品統合機能 shall いずれのソースも更新せず、利用者へ選択不能の理由を示す。
4. If 取り込み結果に有効な価格がない, the 重複商品統合機能 shall 既存ソースの価格を削除または不明値で上書きしない。
5. If 価格更新動線への引き渡しが失敗する, the 重複商品統合機能 shall 新しいソースを追加せず入力内容を保持し、再試行可能な失敗として示す。

### 要件 6: 失敗回復と原子的な変更

**目的:** PCパーツ検討者として、照合や統合が失敗しても入力内容と既存候補を失いたくない。そうすることで、安全に再試行または新規保存へ切り替えられる。

#### 受入基準

1. If 既存候補の読込または一致評価を完了できない, the 重複商品統合機能 shall 編集内容を保持し、照合の再試行または明示的な新規保存を選べる失敗として示す。
2. If ソース統合の永続化に失敗する, the 重複商品統合機能 shall 統合前の既存候補を維持し、部分的なソース追加を残さない。
3. If 統合対象が照合後に変更または削除される, the 重複商品統合機能 shall 古い照合結果で更新せず、最新状態を再評価するよう示す。
4. If 取り込み元ソースが統合可能な形式でない, the 重複商品統合機能 shall 統合を実行せず修正対象を示し、新規保存または編集へ戻れるようにする。
5. While 照合または保存処理が進行中である, the 重複商品統合機能 shall 同じ判断の重複送信による二重追加を防ぐ。
6. When 失敗後に利用者が新規保存を明示する, the 重複商品統合機能 shall 保持した編集内容を従来の新規保存規則へ渡す。

### 要件 7: 境界・安全性・検証可能性

**目的:** feature保守者として、重複検知だけを独立して安全かつ再現可能に検証したい。そうすることで、上流データ契約や隣接機能を壊さず改善できる。

#### 受入基準

1. The 重複商品統合機能 shall ソースコレクション、ソース識別子、取得元別価格およびプライマリ導出を再定義せず、上流の公開契約を利用する。
2. The 重複商品統合機能 shall ページからの価格再取得、価格履歴、通貨換算および定期監視を実行しない。
3. The 重複商品統合機能 shall 商品識別値、完全URLまたは保存内容を診断ログへ記録しない。
4. While 一致候補または失敗理由を表示する, the 重複商品統合機能 shall ページ由来の文字列を実行可能な内容として解釈しない。
5. The 重複商品統合機能 shall 照合規則、順位、カテゴリ除外、明示確定、同一URL振り分けおよび失敗回復を架空の商品データだけで自動検証可能にする。
6. The 重複商品統合機能 shall 新しいブラウザ権限、外部商品DB、サーバーまたはアカウントを必要としない。

### 要件 8: canonical product identity ownerと隣接consumer境界

**目的:** feature保守者として、商品同一性規則を一つの共有coreから提供し、重複統合workflowをcanonicalな公開契約だけへ接続したい。そうすることで、循環proxyを撤去しながら判定・確認・保存結果を維持できる。

#### 受入基準

1. The 重複商品統合機能 shall product identityの型、normalizer、matcher、factoryを一つの共有coreと公開入口から提供し、商品取り込みまたは候補管理をcanonical ownerにしない。
2. The 重複商品統合機能 shall 現行の大文字小文字、全角半角、空白、型番区切り、型番優先、メーカー名と商品名の補助一致、カテゴリ除外、確信度、根拠および決定的順位の結果を変更しない。
3. The 重複商品統合機能 shall 旧candidate-owned `ManagementError`を定義、import、mappingまたは公開せず、foundation公開入口の共有`AppDataError`を利用する。
4. When 共有`AppDataError`を統合workflow errorへ写像する, the 重複商品統合機能 shall validation、conflict、maintenance、storage、quota、unsupported-dataの種類、意味、粒度、draft保持および利用者向け結果を変更しない。
5. If identity coreまたはcandidate/source public portが失敗する, the 重複商品統合機能 shall 既知の別原因へ推測で畳み込まず、既存の明示新規保存、再評価、入力保持またはfail-closed規則を適用する。
6. The 重複商品統合機能 shall application shellのproduction compositionを実装せず、shellが直接接続できるduplicate workflow consumer contractとUI contributionだけを提供する。
7. When identity、candidate/sourceまたは共有`AppDataError` public contractが変更される, the 重複商品統合機能 shall identity coreのpublic consumer・normalizer/matcher characterization、confirmation、atomic routing、UIおよびE2Eを再検証する。
