# Research & Design Decisions

## Summary

- **Feature**: `project-context`
- **Discovery Scope**: Extension / Light Integration Update
- **Key Findings**:
  - 既存 guard は `from` / `to` project を前提とする利用者選択専用で、catalog 全体置換を表現できない。
  - backup 側に独自 guard registry を作ると draft protection authority が分裂するため、project-context の既存 coordinator を change intent へ一般化する。
  - root 置換と project-context refresh は downstream owner に残し、project-context は置換前許可と置換結果通知だけを能力別 port として公開する。

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

## Risks & Mitigations

- permit と downstream commit の間の stale 変化 — `begin` で generation と registry revision を再検証し、一回だけ開始可能にする。
- root write 成功後の refresh 失敗を rollback と誤認 — success completion と refresh を別 transaction・別結果として扱う。
- notifier failure による成功済み置換の誤失敗・permit残留 — terminal closeを先に確定し、forced notificationをbest effortで隔離する。
- context unavailable 時に recovery が起動不能 — replacement prepare は `from: null` で利用可能にし、settings/backup の到達性を snapshot status に依存させない。

## References

- `.kiro/specs/backup-restore/requirements.md` — 復元前guard、ticket保持、復元後refresh要件。
- `.kiro/specs/local-data-foundation/design.md` — recovery commit と通常query回復の責任境界。
- `.kiro/steering/roadmap.md` — owner-local restore hook と composition dependency。
