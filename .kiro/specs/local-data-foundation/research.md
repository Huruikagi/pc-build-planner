# Research & Design Decisions

## Summary
- **Feature**: `local-data-foundation`
- **Discovery Scope**: New Feature（full discovery）
- **Key Findings**:
  - 現在はNode.js、pnpm、Biomeだけがあり、`src/`、manifest、型検査、build、test基盤は未作成である。
  - `chrome.storage.local` はChrome 114以降10MBだが既定ではcontent scriptからも利用できるため、起動時に`TRUSTED_CONTEXTS`へ制限する必要がある。
  - Storage APIは比較交換トランザクションを提供しない。全mutationを単一のservice worker write authorityへ集約し、永続revision、要求ID、保守世代、owner fencingをcommit直前に再検証する必要がある。
  - foundationはmanifestとデータruntime登録契約を所有し、共有service worker composition入口は後続`application-shell`へ委譲する。

## Research Log

### 現行コードベースと所有境界
- **Context**: greenfieldの実装範囲とroadmap更新後のcanonical ownerを確認した。
- **Sources Consulted**: `package.json`、`.kiro/steering/{product,tech,structure,roadmap}.md`、対象specのrequirements/design/tasks
- **Findings**: application sourceは未実装である。最新roadmapはroot runtime、side panel、feature compositionをapplication shellへ、共通`Result<T, E>`、保存primitive、write authority、参照修復をfoundationへ割り当てている。
- **Implications**: foundationは`src/runtime/service-worker.ts`やroot `src/index.ts`を作らず、worker registration portとadapterを公開する。manifestは背景workerなしでも読み込める最小MV3骨格としてfoundationが所有し、application shellが後続でcomposition設定を追加する。

### Chrome Storage APIと容量
- **Context**: 容量、アクセス制御、書込失敗の契約を確定する必要がある。
- **Sources Consulted**: Chrome Storage API公式資料（2026-05-05更新）
- **Findings**: `storage.local.QUOTA_BYTES`は10,485,760 bytesで、キー長とJSON直列化後の値を含めて計測される。超過更新はPromiseをrejectする。`getBytesInUse()`で使用量を取得できる。既定ではcontent scriptにも公開されるが、Chrome 102以降は`setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})`で制限できる。
- **Implications**: 固定値だけでなく実行時`QUOTA_BYTES`を上限根拠にし、警告閾値は設定可能な比率として扱う。事前見積りと書込rejectの両方を`CapacityStatus`/`quota-exceeded`へ正規化する。

### MV3 service workerと排他
- **Context**: 書込直列化と保守leaseをworkerメモリだけへ置けるか確認した。
- **Sources Consulted**: Extension service worker lifecycle、service worker migration公式資料
- **Findings**: workerは必要時に起動・休止し、global変数は停止時に失われる。永続状態はStorage API等をsource of truthにする必要がある。
- **Implications**: in-memory queueは同一worker instance内の順序付けだけに使用する。rootの`revision`、処理済みrequest ID、maintenance generation/owner/leaseを永続化し、各commit直前に再読込してfenceを検証する。全consumerはregistration port経由で同一authorityへルーティングする。

### MV3コードとCSP
- **Context**: 未パッケージ拡張の実行制約を確認した。
- **Sources Consulted**: Manifest V3、extension security、manifest CSP公式資料
- **Findings**: MV3は同梱コードを前提とし、remote hosted codeと任意文字列実行を制限する。minimum Chrome versionをmanifestで宣言できる。
- **Implications**: `minimum_chrome_version: "116"`を設定し、remote code、`eval`、`new Function`、inline JavaScriptをbuild検査で拒否する。

### 検証・移行・置換
- **Context**: unknownな保存値とバックアップ候補を安全に扱う必要がある。
- **Sources Consulted**: 要件、TypeScript型消去、単一root方式の制約
- **Findings**: compile-time型だけではstorage/JSONを検証できない。10MB以内の単一rootは参照整合性の全体検証と一括`set`に適する。
- **Implications**: boundary inputは`unknown`として検証し、`assessReplacement`は副作用なし、`replaceRoot`は評価tokenとmaintenance fenceを要求する。移行は純粋な`N -> N+1`連鎖とする。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| Ports and adapters + single write authority | domain契約をChrome APIから分離し、mutationを一つのauthorityへ集約 | 型安全、テスト容易、整合性境界が明確 | worker message contractが必要 | 採用 |
| 各featureからStorage API直接利用 | featureごとにread-modify-write | 初期コードが少ない | lost update、検証・排他の分散 | 不採用 |
| エンティティ別キー | project/part/buildを分割保存 | 小さい部分更新 | Chrome Storageに複数キーtransactionがなく参照整合性が複雑 | MVPでは不採用 |
| 外部schema library | 宣言的runtime validation | 型と検証の重複を削減可能 | 未導入toolchainへの依存追加 | 実装開始時に最新版適合性を再評価。設計はlibrary非依存 |

## Design Decisions

### Decision: 単一バージョン付きrootとrevision
- **Context**: 参照整合性、競合検出、全体置換を同じ境界で扱う。
- **Alternatives Considered**: entity別キー、event store、単一root。
- **Selected Approach**: `LocalDataRoot`を一つのstorage keyに保存し、`schemaVersion`と単調増加`revision`を持たせる。
- **Rationale**: MVP容量内で全体検証、候補変更とCurrentBuild修復、置換を一つのcommitへ閉じられる。
- **Trade-offs**: 全体再直列化コスト。10MB近傍の性能を測定し、分割時は全dependent specを再検証する。

### Decision: 単一write authorityと永続fencing
- **Context**: Storage APIにCASがなく、複数extension contextからのread-modify-writeはlost updateを起こし得る。
- **Alternatives Considered**: consumer側mutex、成功後イベントによる修復、service worker authority。
- **Selected Approach**: application shellがcompositionする単一worker authorityへ全mutationを送る。authorityはrequest ID、expected revision、maintenance generation/ownerを検証し、参照修復後のrootだけをcommitする。
- **Rationale**: mutation ownershipを一つに保ち、中間invalid rootを公開しない。
- **Trade-offs**: shellとのruntime integration contractがP0依存になる。foundationはregistration factoryを所有し、root workerは所有しない。

### Decision: 保守leaseはgenerationとownerでfenceする
- **Context**: 復元中の通常write、worker再生成、stale ownerを拒否する。
- **Selected Approach**: 永続`MaintenanceState`にgeneration、ownerId、lease期限、revisionを保存し、置換を含む全commit直前に再検証する。
- **Rationale**: worker memoryを正とせず、古いownerのwriteを判別可能に拒否できる。
- **Trade-offs**: lease期限切れ回復が必要。時刻だけで所有権を再利用せず、新generation取得を必須にする。

### Decision: 参照修復policyをfoundationが所有する
- **Context**: 候補削除・カテゴリ変更とCurrentBuild修復を別writeにするとinvalidな中間rootが生じる。
- **Selected Approach**: generic `mutateRoot` pipeline内でfoundation-owned `ReferenceRepairPolicy`を適用し、全体検証後に一度だけcommitする。
- **Rationale**: foundationは業務選択規則を持たず、保存参照の構造的不変条件だけを維持できる。

### Decision: canonical Resultを自作し、実装は最小化する
- **Context**: 全featureで同じ失敗契約が必要である。
- **Selected Approach**: `Result<T, E>`とfoundation error unionを`src/domain/result.ts`で所有する。Chrome以外のadapter、同期、export I/Oは実装しない。
- **Rationale**: 小さい安定契約で追加runtime依存を避ける。

## Risks & Mitigations
- authorityを迂回した直接write — `TRUSTED_CONTEXTS`、公開port限定、import境界test、禁止API scanで抑止する。
- commit直前のstale maintenance owner — 永続cursor再読込とgeneration/owner/revision一致を必須にする。
- 容量見積り差 — `getBytesInUse`と直列化見積りに加え、実write rejectを正規化し既存rootを保持する。
- root全体書換性能 — 10MB近傍でread/validate/repair/writeを計測し、閾値超過時だけstorage設計を再検討する。
- migration/validation失敗による上書き — source値を変更せず、current root検証成功後だけ明示mutationで保存する。

## References
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage/) — 10MB quota、`getBytesInUse`、access level、write failure
- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — worker停止とglobal state消失
- [Migrate to a service worker](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers) — persistent stateの利用
- [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) — MV3 runtimeと同梱コード
- [Improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security) — remote code、動的評価、CSP制約
