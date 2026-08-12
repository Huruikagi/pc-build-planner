# Requirements Document

## Introduction

本仕様は、候補管理、現在構成、互換性確認、商品取り込み後の handoff などが同じ作業対象を参照できるように、アプリ全体で一つの「現在選択中 project」と project lifecycle を提供する。選択は検証済み project catalog にだけ基づき、side panel の再オープン、project の作成・改名・削除、backup 復元、読み取り失敗を経ても、利用者が別 project を誤操作しない一貫した状態として公開する。

## Change Brief Integration

- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **Delta**: `v0.5.0` で追加した project lifecycle の command、state、確認、成功・失敗、既存表示を保つ presentation を維持しつつ、project-context の message ownership を意味・発火条件・必要 parameter と descriptor consumption に限定する。
- **Preserved**: selection preference、fallback、guard、generation、共通 selector、backup replacement guard、project lifecycle の利用者挙動、および foundation が所有する原子的な project 削除と candidate/current-build 参照修復を変更しない。
- **Out-of-scope preservation**: lifecycle の ja/en 物理 catalog file、具体 key/value、catalog aggregation と parity は `ui-message-catalog` に委譲し、layout・CSS、保存形式、foundation 参照修復へ範囲を広げない。

## Boundary Context

- **In scope**: 現在 project の snapshot と catalog projection、選択 preference の復元・修復、選択と再検証の transaction、generation と購読、project 選択と catalog 全体置換を扱う change guard protocol、project の作成・改名・削除と削除確認、project lifecycle の状態と成功後再検証、能力別公開 port、共通 selector と project lifecycle presentation、lifecycle message の意味・発火条件・必要 parameter と descriptor consumption、アクセシビリティ、project-context 専用保存・公開境界 gate。
- **Out of scope**: project lifecycle の ja/en 物理 catalog file、具体 key/value、catalog aggregation と parity、layout・CSS の変更、独立した project 管理画面、候補一覧・候補編集の情報設計、foundation が所有する project 削除時の参照修復規則、canonical root と backup 交換形式の変更、backup 復元 transaction、商品取り込み handoff の保存先決定、各 feature の candidate state・snapshot・draft・consumer adapter、application shell の slot・singleton composition・production wiring、検索・並べ替え・アーカイブ、複数 project の同時表示、v1.0.0 の UI 全面刷新。
- **Adjacent expectations**: `ui-message-catalog` は project-context が定義する lifecycle message intent と parameter contract に対応する ja/en 物理 catalog、具体 key/value、aggregation、parity を所有する。foundation は project mutation と同じ原子的 transaction 内で candidate/current-build 参照整合性を修復する。candidate-management は candidate 管理と draft guard を所有し、project lifecycle の利用者となる。backup owner は catalog 置換前に change guard を準備し、置換結果を通知する。既存 snapshot の `selectedProjectId` は shape を維持した非権威的 metadata であり、現在選択を上書きしない。context が unavailable でも application shell は settings と backup recovery を起動できる。

## Requirements

### Requirement 1: 検証済み project context snapshot

**目的:** 複数画面で構成を検討する利用者として、どの画面でも同じ現在 project を参照したい。これにより切替忘れや別 project への誤操作を防げる。

#### Acceptance Criteria

1. When project catalog の読み取りが成功して一件以上の project が存在する, the project context shall `ready` 状態、catalog、catalog 内に存在する一つの現在 project ID を一つの snapshot として公開する
2. When project catalog の読み取りが成功して project が存在しない, the project context shall `empty` 状態、空の catalog、null の現在 project ID を一つの snapshot として公開する
3. If project catalog の読み取りに失敗する, the project context shall `unavailable` 状態を公開し、以前の現在 project を利用可能な選択として公開しない
4. While project context が `ready` 状態である, the project context shall 現在 project ID が同じ snapshot の catalog に一意に存在する不変条件を維持する
5. While project context が `empty` または `unavailable` 状態である, the project context shall project 固有の操作に利用できる現在 project ID を公開しない
6. When 同じ snapshot を複数の consumer が取得する, the project context shall consumer ごとの独自 fallback を必要としない同一の状態と選択を返す

### Requirement 2: 選択 preference の復元と決定的 fallback

**目的:** side panel を再度開く利用者として、直前に検討していた有効な project へ戻りたい。これにより画面を開くたびに選び直さず作業を継続できる。

#### Acceptance Criteria

1. When project context を初期化する, the project context shall 保存された選択を未検証値として読み、現在の catalog との照合に成功した後だけ現在 project として公開する
2. When 保存された project ID が現在の catalog に一意に存在する, the project context shall その project を現在 project として復元する
3. If 保存値が存在しない、形式が不正、または現在の catalog に存在しない, the project context shall catalog の先頭 project を決定的 fallback として選択し、修復した preference を保存する
4. When fallback を選ぶ, the project context shall catalog source が返した安定した順序を保持し、consumer ごとの推測や並べ替えを行わない
5. When catalog が空である, the project context shall 保存済み選択を消去し、`empty` 状態を公開する
6. If preference を読み取れない, the project context shall `unavailable` 状態を公開し、未確認の保存値または推測した project を現在 project として扱わない
7. If preference の修復を書き込めない, the project context shall 修復済み選択を公開せず、再試行可能な unavailable 結果を公開する

### Requirement 3: 原子的な選択 transaction と競合抑止

**目的:** project を切り替える利用者として、連打、遅延処理、保存失敗があっても最後に確定した一つの選択だけを利用したい。これにより画面と保存先の食い違いを防げる。

#### Acceptance Criteria

1. When `ready` 状態で catalog 内の別 project を選択し、全 guard が切替を許可する, the project context shall preference の保存成功後にだけ snapshot の現在 project と generation を一度に更新する
2. If 選択要求の project ID が現在の catalog に存在しない, the project context shall 要求を拒否し、現在 snapshot と preference を変更しない
3. When 同じ project ID を再選択する, the project context shall 保存、generation 更新、guard 呼び出し、購読通知を行わず成功結果を返す
4. While 選択または refresh transaction が進行中である, the project context shall 後続 transaction を直列化し、同時に複数の選択を確定しない
5. When 遅延した transaction の結果が新しい generation より古くなった, the project context shall stale な結果を適用せず、現在選択を過去の状態へ戻さない
6. If 選択 preference の書き込みに失敗する, the project context shall 現在 snapshot と generation を変更せず、安定した失敗結果を返す
7. When snapshot の状態または現在 project が確定して変化する, the project context shall 単調増加する generation を付与し、購読者へ一回だけ通知する

### Requirement 4: catalog lifecycle 後の再検証

**目的:** project の作成・削除や backup 復元を行う利用者として、変更後も存在する一つの project が現在対象として維持されてほしい。これにより削除済み・置換前の project への操作を防げる。

#### Acceptance Criteria

1. When project-context の lifecycle command が作成・改名・削除に成功するか、隣接 owner が catalog 置換の成功後に refresh を要求する, the project context shall catalog を再取得し、現在選択を新しい catalog に対して再検証する
2. When refresh 後も現在 project が catalog に存在する, the project context shall その選択を維持し、更新された catalog を公開する
3. If refresh 後に現在 project が存在せず catalog に別 project がある, the project context shall catalog の先頭 project へ決定的に切り替え、preference を修復する
4. If refresh 後の catalog が空である, the project context shall preference を消去し、`empty` 状態へ移行する
5. If refresh 中の catalog 読み取りまたは preference 修復に失敗する, the project context shall `unavailable` 状態へ移行し、削除済みまたは置換前の選択を利用可能として公開しない
6. When unavailable の原因が解消して refresh が成功する, the project context shall 保存値と最新 catalog を再検証し、`ready` または `empty` 状態へ回復する

### Requirement 5: feature-owned draft を保護する change guard

**目的:** 入力途中の内容を持つ利用者として、project 切替または全データ置換の前に未保存作業への影響を確認したい。これにより意図しない draft の喪失を避けられる。

#### Acceptance Criteria

1. When feature owner が change guard を登録する, the project context shall 解除可能な登録として保持し、以後の project 選択または catalog 全体置換の準備時にその guard の判断を求める
2. When 別 project への利用者起点の選択要求または catalog 全体置換の準備要求を受ける, the project context shall transaction 開始時点で登録済みの全 guard を一回ずつ評価する
3. When 全 guard が変更を許可する, the project context shall 追加確認なしで選択 transaction または downstream の置換処理を継続可能にする
4. When 一つ以上の guard が確認を要求する, the project context shall 現在選択を維持したまま一つの確認要求を返す
5. When 利用者が確認要求を取り消す, the project context shall 現在 snapshot、preference、generation を変更せず、強制切替通知を送らない
6. When 利用者が有効な確認要求を承認して選択が確定する, the project context shall その選択変更が強制確認済みであることを登録 guard へ通知する
7. If guard の評価が失敗するか確認要求が stale である, the project context shall 変更を拒否し、現在 snapshot と preference を変更しない
8. The project context shall feature-owned draft の内容、保存方法、破棄方法を取得または解釈せず、guard の判定結果だけを調停する
9. When catalog 全体置換の準備を要求する, the project context shall 現在 snapshot と guard registry revision に結び付いた一時的な許可または確認要求を返し、それ自体では snapshot、preference、generation を変更しない
10. When 利用者が catalog 全体置換の確認要求を取り消す, the project context shall 現在 snapshot、preference、generation を変更せず、置換確定通知を送らない
11. When downstream owner が許可済みまたは確認済み catalog 全体置換の成功を通知する, the project context shall 登録 guard へ置換が確定したことを一回通知し、最新 catalog に対する refresh を別 transaction として実行可能にする
12. If catalog 全体置換が失敗または取り消されたと downstream owner が通知する, the project context shall 置換確定通知を送らず、同じ置換候補を再評価可能にする
13. If catalog 全体置換の許可または確認要求が snapshot generation、guard registry revision、取消、または別の変更 transaction により stale になる, the project context shall 置換開始を拒否し、登録 guard を再評価するよう安定した結果を返す

### Requirement 6: 能力別 port と購読契約

**目的:** 既存 feature の保守者として、shell の具体実装や別 feature の内部 state に依存せず現在 project を利用したい。これにより owner-local integration と公開境界を維持できる。

#### Acceptance Criteria

1. The project context shall snapshot の取得と購読だけを許す read port を提供する
2. The project context shall project 選択、確認、取消、refresh を必要な owner だけへ許す command port として read port から分離する
3. The project context shall change guard の登録と解除だけを許す guard registration port を提供する
4. When consumer が snapshot を購読する, the project context shall 登録後の確定済み変化を generation 順に通知し、解除後は通知しない
5. If 一つの購読 listener または強制切替通知が例外を送出する, the project context shall 他の listener、確定済み snapshot、後続 transaction を破損させない
6. The project context shall feature 内 consumer adapter、feature snapshot、CRUD・restore hook、handoff、application shell composition を公開 port の内部へ取り込まない
7. The project context shall catalog 全体置換の準備、確認、取消、成功または失敗通知だけを許す replacement guard port を、project 選択 command port と guard registration port から分離して提供する

### Requirement 7: 共通 project selector の表示と操作

**目的:** 利用者として、どの業務画面を表示していても現在 project を確認・変更したい。これにより操作対象を見失わず同じ構成を継続して検討できる。

#### Acceptance Criteria

1. While project context が `ready` 状態である, the 共通 project selector shall catalog の全 project 名と現在選択を一つの選択 control に表示する
2. While project context が `empty` 状態である, the 共通 project selector shall project がないことを表示し、project 選択操作を無効にする
3. While project context が `unavailable` 状態である, the 共通 project selector shall project context を利用できないことと再試行操作を表示し、別 project を推測して表示しない
4. While 共通 project selector が開始した選択または再試行が進行中である, the 共通 project selector shall 重複操作を防ぎ、進行中であることを利用者へ伝える
5. When change guard が project 選択の確認を要求する, the 共通 project selector shall 日本語または英語の確認表示から承認または取消を選べるようにする
6. The 共通 project selector shall keyboard だけで project 選択、確認、取消、再試行を操作でき、現在の目的と状態を読み上げ可能な label と status で示す
7. When 表示言語が日本語と英語の間で変わる, the 共通 project selector shall 現在選択と進行中でない context state を維持したまま文言を切り替える
8. When project 名に markup と解釈可能な文字列が含まれる, the 共通 project selector shall その値を text として表示し、実行可能な HTML を生成しない

### Requirement 8: 保存・公開境界と回帰可能性

**目的:** 保守開発者として、横断 context を追加しても既存のデータ所有、公開 import、最小権限、復旧経路を維持したい。これにより新しい共有状態が既存 owner を侵食しない。

#### Acceptance Criteria

1. The project context shall 選択 preference を canonical domain root と backup 交換形式から分離した一つの専用 key にだけ保存する
2. When preference を読み込む, the project context shall 上流の実行時検証規約で version、project ID、未知 key、禁止 payload を検証し、vendor 固有の error を公開しない
3. The project context shall 保存 preference に選択復元に必要な version と project ID 以外の商品、project 内容、draft、URL を含めない
4. When project-context の storage 到達経路を追加する, the 公開境界 gate shall 許可した source、storage area、専用 key 以外のアクセスを negative test とともに拒否する
5. When project-context を feature 外から利用する, the 公開境界 gate shall 通常 consumer を `public.ts`、composition owner を専用 presentation または runtime 入口へ限定し、内部 module の deep import を拒否する
6. The project context shall 既存 feature snapshot の version と shape を変更せず、snapshot 内の `selectedProjectId` を選択 authority または fallback として利用しない
7. If project context が unavailable である, the application shell integration contract shall settings と backup recovery の起動を妨げない
8. When project-context を検証する, the 検証手順 shall 架空の project と保存値だけを用いて unit、contract、DOM、公開境界、production build、core browser E2E、および downstream 横断 E2E で選択一貫性を確認可能にする

### Requirement 9: canonical project lifecycle

**目的:** 構成検討を整理する利用者として、現在 project と同じ場所で project を作成・改名・削除したい。これにより project の選択と lifecycle を一つの一貫した操作対象として扱える。

#### Acceptance Criteria

1. When 利用者が空白だけではない project 名で作成を確定する, the project context shall 新しい project を保存し、成功後の catalog を再検証する
2. When 利用者が既存 project の空白だけではない新しい名前を確定する, the project context shall 同じ project の名前を更新し、成功後の catalog と現在選択を再検証する
3. If 利用者が空白だけの project 名で作成または改名を確定する, the project context shall 入力箇所に修正可能な validation failure を示し、project と現在選択を変更しない
4. When 利用者が project の削除を要求する, the project context shall 対象 project 名と所属する候補への影響を示す一つの確認を表示し、確認前には削除しない
5. When 削除確認を利用者が取り消す, the project context shall project、catalog、現在選択、preference、generation を変更しない
6. When 利用者が project の削除を確認する, the project context shall project とその project に属する candidate/current-build 参照が一つの確定結果として消えるよう削除を一回だけ要求し、成功後の catalog を再検証する
7. When project の作成が空の catalog に対して成功する, the project context shall 作成した project を決定的な現在 project として公開する
8. When 現在 project の改名が成功する, the project context shall 同じ project ID の選択を維持し、更新された名前を公開する
9. When 現在 project の削除が成功する, the project context shall 残る catalog の先頭 project または `empty` 状態へ決定的に移行する
10. If project lifecycle command が保存前に失敗する, the project context shall 安定した failure を表示可能にし、catalog、現在選択、preference、generation を変更せず、失敗した command を自動再実行しない
11. If project lifecycle command の保存は成功したが後続 refresh に失敗する, the project context shall 保存済み command を再実行せず context を `unavailable` として公開し、refresh だけを再試行可能にする
12. While project lifecycle command またはその後続 refresh が進行中である, the project context shall 重複する lifecycle 操作を受け付けず、進行中であることを利用者へ示す

### Requirement 10: project lifecycle presentation と message semantics

**目的:** 利用者として、従来と同じ見た目と操作経路で project を管理したい。これにより責務移管後も候補の検討手順を学び直さずに済む。

#### Acceptance Criteria

1. When project lifecycle の状態または操作結果を表示する, the project context shall 一覧、作成、改名、削除、削除確認、validation、失敗、進行中、再試行を区別する message intent と表示に必要な parameter を descriptor として presentation へ提供する
2. When project lifecycle presentation が既存の host へ接続される, the project context shall layout と CSS を変更せず、現在の project 一覧、作成・改名 control、削除確認の操作契約を提供する
3. When 表示言語が日本語と英語の間で変わる, the project lifecycle presentation shall 入力中の名前、削除確認、現在選択、進行中でない lifecycle state を維持したまま文言を切り替える
4. The project lifecycle presentation shall keyboard だけで project の作成、改名、削除要求、確認、取消、refresh 再試行を操作でき、各入力・状態・確認の目的を読み上げ可能にする
5. When project 名に markup と解釈可能な文字列が含まれる, the project lifecycle presentation shall その値を text として表示し、実行可能な HTML を生成しない
6. The project context shall project lifecycle presentation を候補一覧・候補 editor の state と分離し、独立した project 管理画面または v1.0.0 の新しい情報設計を追加しない
7. When project lifecycle を検証する, the 検証手順 shall 架空の project だけを用いて command contract、state、message intent の発火条件と parameter、descriptor consumption、DOM、公開境界、core browser E2E、および downstream catalog 接続後の横断 E2E を確認可能にする
