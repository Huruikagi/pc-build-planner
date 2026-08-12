# Research & Design Decisions

## Summary

- **Feature**: `project-context`
- **Discovery Scope**: Extension / Light Integration Update
- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **Key Findings**:
  - 既存 guard は `from` / `to` project を前提とする利用者選択専用で、catalog 全体置換を表現できない。
  - backup 側に独自 guard registry を作ると draft protection authority が分裂するため、project-context の既存 coordinator を change intent へ一般化する。
  - root 置換と project-context refresh は downstream owner に残し、project-context は置換前許可と置換結果通知だけを能力別 port として公開する。
  - project CRUD、削除確認、成功後 refresh、project 関連 message は現在 candidate-management の service/state/view/catalog に分散しており、selection authority との lifecycle owner 分裂が実装上も確認できた。
  - project 削除時の candidate/current-build 参照修復は foundation の `referenceRepairPolicy` と root mutation pipeline に既に閉じているため、project-context は最小 data port から削除を一回要求するだけで repair algorithm を取り込まない。
  - lifecycle message の canonical seam は、project-context が意味・発火条件・parameter descriptor を生成し、`ui-message-catalog` が ja/en の物理 key/value、descriptor-to-key adapter、aggregation、parity を所有する形に分離する必要がある。

## Research Log

### Backup restore の置換前 guard seam

- **Context**: `backup-restore` 4.7–4.8 は全データ置換前の未保存編集確認を要求する。
- **Sources Consulted**: `.kiro/specs/backup-restore/requirements.md`、`.kiro/specs/project-context/{brief,requirements,design}.md`、`.kiro/steering/roadmap.md`。
- **Findings**: `ProjectContextCommandPort.select` は target project を必要とし、同一選択では guard を呼ばない。全 catalog 消失や置換後 target 未確定を表現できない。
- **Implications**: `select` の疑似呼び出しを禁止し、`replace-catalog` intent と専用 replacement guard port を追加する。

### Authority と commit point

- **Context**: guard 確認と root 置換の責任を混在させず、失敗時に backup ticket を保持する必要がある。
- **Sources Consulted**: project-context の capability port / transaction 規約、local-data-foundation の recovery boundary、backup-restore の復元要件。
- **Findings**: project-context は draft 判断と confirmation authority を所有するが、置換候補、Foundation fence、commit 結果を所有しない。root write 成功後の refresh 失敗は置換失敗ではない。
- **Implications**: lifecycle を `prepare → confirm → begin → downstream commit → complete → refresh` とし、success completion だけ forced notification を送る。refresh は別 transaction とする。

### Change Brief v0.5.0 の project lifecycle owner 移管

- **Context**: project の選択・guard・preference は project-context、作成・改名・削除・確認・message は candidate-management にあり、同一概念の authority が分裂している。
- **Sources Consulted**: `.kiro/specs/project-context/{brief,requirements,design,tasks}.md`、`.kiro/specs/project-candidate-management/brief.md`、`src/project-context/*`、`src/features/candidate-management/{contracts,service,state,view,project-context-adapter,feature-contribution}.ts*`、`src/persistence/reference-repair-policy.ts`、日英 message catalog、関連 steering。
- **Findings**:
  - candidate service の project mutation は name trim、ID/timestamp 生成、foundation mutation error mapping を行い、state が削除確認と成功後 context refresh を所有している。
  - project-context は既に catalog、selection transaction、read/command/guard/replacement capability と selector presentation を持ち、project lifecycle の public authority を追加できる安定した境界である。
  - foundation は project delete と同じ root transaction で所属 candidate と current build を除去する。参照修復を project-context へ移すと single write authority と原子的整合性を壊す。
  - 現行 project form と削除確認は candidate view 内にあるため、project-context は同じ操作・DOM意味を提供する mountable presentation contract を所有し、candidate-management 側の host 接続と旧 UI 撤去は downstream Change Brief に残す必要がある。
- **Implications**: `ProjectLifecyclePort`、`ProjectLifecycleService`、framework-independent state、lifecycle presentation、key 非依存の lifecycle message descriptor を追加し、data access は project mutation と query に絞った port へ限定する。保存成功後だけ context refresh を実行し、refresh failure は mutation replay ではなく retry-only recovery にする。

### Change Brief v0.5.0-boundary-reconciliation の message ownership

- **Context**: `v0.5.0` の更新案は lifecycle の semantic producer と ja/en 物理 catalog の双方を project-context の成果物にし、`ui-message-catalog` の単一 catalog ownership と重複していた。
- **Sources Consulted**: `.kiro/specs/project-context/brief.md` の最新 Change Brief、`.kiro/steering/roadmap.md`、`.kiro/specs/ui-message-catalog/brief.md`、UI message の公開境界と既存 catalog 構造。
- **Findings**: lifecycle service/state は、どの状態で何を表示し、どの project 名や operation/error category を渡すかを知る。一方、locale ごとの key/value、placeholder mapping、aggregation、parity は message catalog owner が知る責務である。
- **Implications**: project-context は判別可能な message intent と必要 parameter、descriptor 発火 test、resolver consumer port だけを所有する。物理 `MessageKey`、ja/en file、translation value、descriptor-to-key mapping、catalog parity は `ui-message-catalog` の downstream task とする。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 既存 coordinator の intent 一般化 | 選択と置換を判別共用体で扱う | authority と登録を一元維持 | 公開契約とテスト更新が必要 | 採用 |
| backup-owned guard registry | backup が draft owner を直接登録 | backup 内で完結 | 二重登録、authority 分裂 | 不採用 |
| `select` の流用 | 現在または仮 target を選択する | 新port不要 | 同一選択・全消失・未確定targetを誤表現 | 不採用 |

## Design Decisions

### Decision: change intent を判別共用体にする

- **Context**: guard が判断する変更理由を増やしつつ、draft 内容や downstream payload を漏らさない。
- **Alternatives Considered**: 選択専用型の拡張、別 registry、判別共用体。
- **Selected Approach**: `select-project | replace-catalog` の `ProjectContextChangeIntent` を一つの coordinator が評価する。
- **Rationale**: registry、confirmation、stale 判定、forced notification の意味を一元化できる。
- **Trade-offs**: downstream guard は未知 intent を型安全に扱う更新が必要になる。
- **Follow-up**: candidate/current-build adapter の exhaustive switch contract を更新する。

### Decision: replacement guard を独立 capability port にする

- **Context**: backup owner だけが catalog 置換 lifecycle を開始できる必要がある。
- **Alternatives Considered**: command port へ混在、guard registration port へ混在、専用 port。
- **Selected Approach**: `prepare/confirm/cancel/begin/complete` だけを公開する専用 port を提供する。
- **Rationale**: read、project選択、guard登録、置換準備の権限を最小化できる。
- **Trade-offs**: production composition に個別 injection が一つ増える。
- **Follow-up**: boundary test で通常 consumer と settings への漏出を拒否する。

### Decision: completeはpermit閉鎖を通知より先に確定する

- **Context**: root write成功後のforced notificationが失敗しても、開始済みpermitを残して通常操作や次の復元を閉塞させてはならない。
- **Alternatives Considered**: 通知成功後にpermitを閉じる、通知失敗時にcomplete再試行を要求する、terminal close後にbest-effort通知する。
- **Selected Approach**: `complete`はoutcomeにかかわらずpermitをterminal closedへ遷移させ、その後に`succeeded`だけを通知する。通知失敗結果でもpermitは閉鎖済みとする。
- **Rationale**: downstream commitの不可逆性とguard lifecycleを一致させ、通知系の障害を排他状態へ伝播させない。
- **Trade-offs**: 通知の再配送は行わないため、各draft ownerは次回load/refreshでも置換後状態へ収束できる必要がある。
- **Follow-up**: notifier failure後のpermit再利用拒否、次のprepare成功、通常操作非閉塞をcontract testで固定する。

### Decision: project lifecycle を project-context の独立 capability として追加する

- **Context**: current selection の read/command port へ CRUD を混在させると、通常 consumer に不要な mutation 権限が広がる。
- **Alternatives Considered**: selection command port へ追加、candidate service の委譲を維持、独立 lifecycle port。
- **Selected Approach**: project-context が `ProjectLifecyclePort` と service/state を所有し、selection command、guard registration、replacement guard とは別 capability として公開する。
- **Rationale**: canonical owner を統一しつつ interface segregation と既存 consumer の互換性を維持できる。
- **Trade-offs**: runtime composition と downstream candidate host に新しい capability injection が必要になる。
- **Follow-up**: public boundary negative test で read-only consumer、replacement owner、candidate consumer が不要な lifecycle/data capability へ到達できないことを固定する。

### Decision: project mutation と reference repair を分離したまま保つ

- **Context**: project deletion は candidate/current-build 参照修復を必要とするが、algorithm の canonical owner は foundation である。
- **Alternatives Considered**: project-context で cascade を再実装、削除後イベントで別 write、foundation の root mutation を最小 data port から一回要求。
- **Selected Approach**: project-context は project query/mutation だけの最小 port を使い、foundation が同じ root transaction 内で削除と参照修復を確定する。
- **Rationale**: single write authority、原子性、保存形式、既存 repair policy を維持できる。
- **Trade-offs**: lifecycle contract test は synthetic data port と foundation adapter contract の両方を検証する必要がある。
- **Follow-up**: project delete failure、conflict、maintenance、quota、成功後 refresh failure を再実行なしで検証する。

### Decision: presentation owner、message catalog owner、既存配置 host を分離する

- **Context**: lifecycle state/control/message semantics は project-context へ移す一方、物理 catalog は `ui-message-catalog` に一元化し、v0.5.0 では layout・CSS と独立管理画面を変更しない。
- **Alternatives Considered**: shell に新しい管理画面を追加、candidate view に state/message を残す、project-context が物理 catalog まで所有する、semantic descriptor と catalog adapter を分離する。
- **Selected Approach**: project-context が lifecycle presentation、message intent/parameter descriptor、resolver consumer portを所有し、既存位置へ mount できる host-neutral contribution を提供する。`ui-message-catalog` が descriptor-to-key adapter と ja/en 物理 catalogを提供し、downstream candidate spec が旧 implementation を撤去して host を接続する。
- **Rationale**: lifecycle の意味 authority と catalog の物理 ownership を重ねず、利用者の見た目と操作順を維持して UI 全面刷新を吸収しない。
- **Trade-offs**: project-context 単独の DOM/core E2E は synthetic resolver を使い、物理 catalog parity と production 横断 E2E は downstream 接続後に再検証する。
- **Follow-up**: descriptor 発火 contract と parameter、DOM の form/rename/delete confirmation/keyboard/language switch/markup-like name、downstream catalog adapter の parity をそれぞれの owner で固定する。

## Risks & Mitigations

- permit と downstream commit の間の stale 変化 — `begin` で generation と registry revision を再検証し、一回だけ開始可能にする。
- root write 成功後の refresh 失敗を rollback と誤認 — success completion と refresh を別 transaction・別結果として扱う。
- notifier failure による成功済み置換の誤失敗・permit残留 — terminal closeを先に確定し、forced notificationをbest effortで隔離する。
- context unavailable 時に recovery が起動不能 — replacement prepare は `from: null` で利用可能にし、settings/backup の到達性を snapshot status に依存させない。
- lifecycle 保存成功後の refresh failure で command を再送して重複 mutation する — mutation receipt と refresh recovery を分離し、retry は refresh だけに限定する。
- project lifecycle と candidate state が再び共同所有になる — lifecycle state/message semantics/presentation は project-context に閉じ、candidate-management は host 接続と draft guard だけを残す。
- lifecycle message の意味と物理 catalog が再び共同所有になる — project-context の descriptor contract と `ui-message-catalog` の descriptor-to-key adapterを別 task/boundary とし、catalog file・key/value・parity を project-context の変更対象から除外する。
- project delete repair の再実装で root 整合性が分裂する — 最小 data port から foundation mutation を一回呼び、repair algorithm と保存形式は foundation に残す。

## References

- `.kiro/specs/backup-restore/requirements.md` — 復元前guard、ticket保持、復元後refresh要件。
- `.kiro/specs/local-data-foundation/design.md` — recovery commit と通常query回復の責任境界。
- `.kiro/steering/roadmap.md` — owner-local restore hook と composition dependency。
- `.kiro/specs/project-candidate-management/brief.md` — v0.5.0 の downstream 責務縮小と host 接続境界。
- `src/features/candidate-management/{contracts,service,state,view}.ts*` — 移管前の project lifecycle、確認、refresh、presentation の実装 seam。
- `src/persistence/reference-repair-policy.ts` — project delete と candidate/current-build 参照修復の foundation ownership。
