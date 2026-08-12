# Brief: project-context

## Problem

一つのPC構成を続けて検討する利用者は、候補管理、現在構成、互換性確認などの画面ごとに対象 project を選び直す必要がある。「いま何の構成を検討しているか」が画面間で一貫せず、切替忘れや別 project への操作につながる。取り込みから候補編集へ進む場合も、保存対象 project を明確に把握しにくい。

## Current State

候補管理と現在構成はそれぞれ project 一覧と `selectedProjectId` を持つ snapshot を所有し、互換性確認は composition 時に一覧先頭の project を選ぶ経路がある。application shell は feature の登録・表示を合成するが、現在 project という業務横断コンテキストは提供していない。既存 snapshot は `runtime-schema-validation` で現在の version と shape のまま同等性検証する計画であり、project CRUD、feature state、handoff、restore、composition の owner は既に分離されている。

## Desired Outcome

アプリ全体で「現在選択中の project」を一つだけ持つ core contract と service が提供され、検証済み catalog に基づいて side panel の再オープン後も有効な選択を復元する。共通 selector は core の presentation contribution として利用でき、各既存 feature は owner-local adapter を通じて同じ選択へ追従する。project 作成・削除・復元に伴う通知は owner から受け、core は決定的に再検証するが、feature 内 state・snapshot・draft・CRUD・restore・handoff・shell wiring は所有しない。

## Approach

専用の `project-context` 境界に、現在 project snapshot、catalog projection、選択・再検証 transaction、購読、決定的 fallback、generation、guard protocol、UI preference、共通 selector と公開 port を設ける。選択 ID は canonical domain root や backup 交換形式へ含めず、専用 preference key から `unknown` として読み、現行 catalog で検証した後だけ公開する。catalog 読取失敗時は `unavailable` snapshot を公開し、shell や backup recovery の起動を失敗させない。

`project-context` は selector component と composition 専用 presentation adapter までを提供する。application shell は singleton、selector slot、能力別 port 注入、共有 runtime を所有する。候補管理、現在構成、互換性、backup、product-capture migration は自分の adapter、snapshot、guard、lifecycle、handoff と E2E を既存 spec 更新として所有する。既存 snapshot の `selectedProjectId` は shape を維持した非権威的 metadata とし、context の選択を上書きする用途には使わない。

## Scope

- **In**: 現在 project の単一 snapshot、catalog projection、subscribe・select・refresh 契約、専用 UI preference の復元と修復、存在しない ID の拒否、project 0件・一覧置換後の決定的 fallback、競合抑止、guard 登録・調停 protocol、共通 selector component と presentation contribution、`ready | empty | unavailable` 状態、日英文言、キーボード・読み上げ対応、public import と preference storage の境界 gate、core unit・contract・DOM・横断 E2E。
- **Out**: application shell の slot・singleton composition・feature port 注入、feature 内 consumer adapter、既存 feature snapshot の変更、project CRUD hook、backup restore hook、handoff の保存先解決、候補・現在構成・互換性の state/view、既存 feature の selector 撤去と E2E、独立 project 管理画面、多数 project の検索・並べ替え・アーカイブ、複数 project の同時表示、v1.0.0 の UI 全面刷新。

## Boundary Candidates

- 現在 project ID、検証済み snapshot、catalog、購読、選択・再検証 transaction、fallback と generation を所有する context state/service。
- feature が shell 具体実装へ依存せず現在 project を読むための read-only port と、owner が lifecycle 成功後に refresh する command port。
- project 切替時に feature-owned draft の存在と処理結果だけを申告し、内容を解釈せず確認・取消・強制変更通知を調停する switch guard protocol。
- 共通 selector component、日英 message、composition owner が slot へ配置するための presentation contribution。
- canonical root と分離した preference schema/store、および key-scoped storage allowlist と public import を守る boundary gate。

## Out of Boundary

- project-context が project の作成・改名・削除を直接実装すること。
- application shell、candidate、current-build、compatibility、backup、product-capture の内部ファイルや owner-local test を変更すること。
- application shell 内部 state を他 feature が deep import すること。
- 現在 project ID を canonical project aggregate や backup exchange format へ追加すること。
- project 切替時に feature-owned draft の内容を context が解釈、保存、破棄すること。
- legacy snapshot field の version bump・削除、handoff payload の保存先決定、restore transaction の実行。

## Upstream / Downstream

- **Upstream**: `runtime-schema-validation` の configured schema 入口・共通 primitive・強化された CSP gate、local-data-foundation の絞り込み済み project query、既存 application shell の contribution lifecycle、UI preference storage の既存規約。
- **Downstream**: `project-candidate-management`、`current-build-management`、`compatibility-checking`、`backup-restore`、`product-capture-transient-migration` の owner-local integration、最後に `application-shell` の production wiring、#28 の現在構成要約、v1.0.0 workspace 設計。

## Existing Spec Touchpoints

- **Extends**: 新規 core 境界であり既存 feature 内部を直接拡張しない。既存 owner が利用できる project snapshot・guard・selector contribution の公開契約を追加する。
- **Adjacent**: `application-shell` は composition と selector slot、`project-candidate-management` は CRUD・draft・handoff、`current-build-management` は build state・snapshot、`compatibility-checking` は評価 lifecycle、`backup-restore` は replacement lifecycle、local-data-foundation は canonical query と原子的整合性を所有する。`ui-message-catalog` / `ui-internationalization` の公開規約を利用するが意味や言語 state を所有しない。

## Constraints

既存の feature-first、`public.ts` / `worker-public.ts` / `feature-contribution.ts`、application shell 単一 composition owner、React mount/unmount 規約を維持する。選択状態は検証前の storage 値を公開せず、project catalog との整合確認後にだけ利用する。preference store は専用 key に限定し、storage boundary gate と negative test を同時に更新する。context 初期化失敗は `unavailable` として表現し、settings と backup recovery の起動を妨げない。切替は同時に一つだけを確定し、競合や遅延通知で古い選択へ後退しない。既存 snapshot の version/shape や feature 内 `selectedProjectId` をこの spec で変更しない。全表示は日本語・英語、キーボード操作、読み上げラベルへ対応し、架空 fixture による unit・contract・DOM・Playwright E2E で検証可能にする。

## Change Brief: 2026-08-03 backup restore replacement guard

### Problem

backup restore は全 catalog を置換する前に feature-owned draft への影響を確認する必要があるが、現行 guard protocol は別 project への利用者起点選択だけを扱う。`select` を流用すると置換後 catalog が未確定であり、同一 project 選択や全 project 消失を正しく表現できない。

### In Scope

- guard 対象を project 選択と catalog 全体置換の判別可能な change intent へ一般化する。
- catalog 置換前に登録 guard を評価し、許可または一つの opaque confirmation request を返す公開 capability を追加する。
- 取消、stale、guard failure では snapshot、preference、generation を変更せず、downstream owner が置換 ticket を保持して再試行できるようにする。
- 確認済み置換の commit 後に、登録 guard へ draft 破棄を確定できる forced notification を送る lifecycle を定義する。

### Out of Scope

- backup file の検証、置換 transaction、RecoveryDataPort、復元結果 UI、復元後 refresh の実装。
- feature-owned draft の内容、保存、破棄処理。
- application shell の production wiring と backup section composition。

### Boundary Impact

`project-context` が guard registry と confirmation authority を引き続き単独所有し、backup-restore は新しい置換 guard capability の consumer となる。project 選択 command と catalog 置換 preparation は能力別 port として分離し、通常 consumer へ不要な権限を渡さない。

## Change Brief: v0.5.0

### Problem

projectの選択・切替・guardは`project-context`が所有する一方、作成・改名・削除のcontract、state、確認、message namespaceはcandidate-managementが所有し、同一概念のlifecycleが二つのmoduleへ分断されている。

### Current State

本specはproject catalog projection、current selection、preference、refresh、change guard、共通selectorを所有し、project CRUDを明示的に対象外としている。candidate-managementがproject lifecycleを実装し、成功後にcontext refreshを呼ぶ。

### Desired Outcome

projectの作成・改名・削除、削除確認、成功後refresh、project関連message namespaceを`project-context`がcanonical ownerとして提供する。削除に伴うcandidate/current-build参照修復のalgorithmはfoundationに残し、candidate-managementはcandidate管理とdraft guardだけを所有する。

### Scope

- **In**: ProjectLifecyclePort/service/state、作成・改名・削除command、削除確認、最小data port、成功後refresh・失敗時非refresh、project関連message namespace、既存見た目を保つpresentation接続、contract/DOM/E2E。
- **Out**: layout・CSS変更、独立project管理画面、候補一覧/編集の情報設計、reference repair algorithm、保存形式変更、v1.0.0 UI刷新。

### Boundary Impact

- **Extends**: current project contextへproject lifecycleのcanonical ownershipを追加する。
- **Preserves**: selection preference、fallback、guard、generation、共通selector、foundationの原子的削除と参照修復。
- **Adjacent**: `project-candidate-management`はproject lifecycleを手放してcurrent contextのconsumerとなり、foundationはroot transaction内の参照整合を維持する。

### Dependencies

- **Upstream**: v0.4.0 `project-context` core contract。
- **Downstream**: `project-candidate-management`の責務縮小、v1.0.0画面カタログ採取。

### Source

- Milestone v0.5.0、GitHub Issue #44。

## Change Brief: v0.5.0-boundary-reconciliation

### Problem

project lifecycleのcanonical ownership拡張が、意味contractだけでなくja/en catalog key/valueの物理ownershipまで含み、`ui-message-catalog`と重複している。

### Current State

更新済みrequirements/design/tasksはproject lifecycle command/stateと同時に`projectContext.lifecycle.*` catalog追加・parityを本specの成果物にしている。

### Desired Outcome

本specはproject lifecycleのcommand、state、確認、成功/失敗、messageの意味・発火条件・descriptor利用を所有し、物理catalog file、翻訳値、具体MessageKey集約、parityは`ui-message-catalog`へ委譲する。

### Scope

- **In**: lifecycle service/state、意味contract、必要message intentとparameter、descriptor consumer、既存presentation接続、成功後refresh。
- **Out**: ja/en catalog file/key/valueの実装、catalog aggregation/parity、layout/CSS、foundation参照修復、保存形式。

### Boundary Impact

- **Extends**: lifecycle messageを発火するsemantic producer contractを明確化する。
- **Preserves**: project lifecycle、selection、guard、generation、既存見た目と利用者挙動。
- **Adjacent**: `ui-message-catalog`が物理catalogとparityを、`application-shell`が確定した公開portのcompositionだけを所有する。

### Dependencies

- **Upstream**: none。
- **Downstream**: `spec:ui-message-catalog`、`spec:project-candidate-management`、`spec:application-shell`。

### Source

- v0.5.0 `$kiro-spec-update-batch` final review（2026-08-12）。
