# Research & Design Decisions

## Summary
- **Feature**: `backup-restore`
- **Discovery Scope**: Extension / Complex Integration
- **Key Findings**:
  - Foundationは全データを単一の`LocalDataRoot`として検証・保存し、候補所属と現在構成参照の整合性を既に保証する。
  - バックアップ交換形式は保存スキーマと別版にし、復元時だけ現行`LocalDataRoot`へ変換すれば内部変更をファイルへ直接露出せずに済む。
  - Web標準のFile、Blob、TextEncoderと既存Repository境界で要件を満たせるため、新規ライブラリは不要である。

## Research Log

### 上流保存契約と参照整合性
- **Context**: 全データの範囲と安全な置換単位を確定した。
- **Sources Consulted**: `local-data-foundation`、`project-candidate-management`、`current-build-management`のrequirements、design、tasks、research、およびroadmap。
- **Findings**: `LocalDataRoot`は`schemaVersion`、`projects`、`parts`、`currentBuilds`を持つ。Repositoryは読取検証、直列更新、容量判定を所有し、候補と構成は同じプロジェクト内だけを参照する。
- **Implications**: 復元は個別CRUDの繰り返しではなく、検証済みルートの単一置換としてRepositoryへ追加する。候補・構成の業務規則を再実装しない。

### extension pageでのファイル処理
- **Context**: MV3 service workerの寿命へ依存しない入出力方法を確認した。
- **Sources Consulted**: roadmapとbriefのランタイム制約、既存side panel設計、Web標準File/Blob API。
- **Findings**: side panelはDOMとユーザー操作を保持でき、Fileを`text()`で読み、Blobとobject URLでダウンロードを開始できる。交換データをservice workerメモリへ保持する必要はない。
- **Implications**: FileGatewayはUI境界に限定し、永続化や検証を担当させない。処理中のドラフトは非永続のstateだけに置く。

### 容量と原子的置換
- **Context**: 事前容量判定と失敗時の既存データ保持を両立する。
- **Sources Consulted**: Foundationの`StoragePort`、Repository容量契約、10MB制約。
- **Findings**: 保存ルートは単一キーであり、一回の書込へ集約できる。JSON UTF-8バイト数を事前算出し、基盤の容量判定と書込エラー正規化を再利用できる。
- **Implications**: `replaceRoot`は直列化区間で再検証、容量判定、一回のwriteを行う。個別エンティティを先に削除・追加しない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 交換形式Mapper + RestoreService | ファイル形式変換と復元調整を分離 | 保存モデルを非公開化し検証可能 | 変換契約の版管理が必要 | 採用 |
| 保存ルートをそのままJSON化 | 内部値を直接入出力 | 実装が短い | 保存スキーマ変更が交換互換性を破る | 不採用 |
| 個別CRUDで復元 | エンティティを順次追加 | 既存APIだけを利用可能 | 部分復元と順序依存が生じる | 不採用 |
| 外部JSON Schemaライブラリ | 宣言的に形式検証 | 標準化しやすい | 現行検証との二重化、新規依存 | MVPでは不採用 |

## Design Decisions

### Decision: 交換形式版と保存スキーマ版を分離する
- **Context**: 内部保存の移行周期と、利用者が保管するファイルの互換性期間は異なる。
- **Alternatives Considered**: 保存ルート直列化、独立した交換Envelope。
- **Selected Approach**: `BackupEnvelope`へ`formatVersion`、`createdAt`、`data`を置き、Mapperが現行保存ルートと相互変換する。
- **Rationale**: ファイル契約を安定させ、旧交換形式の移行を保存移行と独立して扱える。
- **Trade-offs**: 形式変更時に交換Migrationが必要になる。
- **Follow-up**: fixtureで往復同値性と旧形式変換を検証する。

### Decision: 原子的置換をRepositoryの明示契約にする
- **Context**: 個別CRUDでは途中失敗時に混在状態が残る。
- **Alternatives Considered**: UIでロールバック、個別CRUD、単一ルート置換。
- **Selected Approach**: 検証済み`LocalDataRoot`だけを受ける`replaceRoot`をRepositoryへ追加し、一括書込する。
- **Rationale**: 保存所有境界内で直列化、容量、検証、失敗正規化を一貫させられる。
- **Trade-offs**: Foundation公開契約の追加となり、上流回帰テストが必要になる。
- **Follow-up**: 書込失敗前後の保存値同一性を統合テストする。

### Decision: 新規依存を追加しない
- **Context**: JSON解析、UTF-8サイズ算出、ファイル生成はブラウザ標準で可能である。
- **Alternatives Considered**: JSON Schema validator、zipライブラリ、Web標準API。
- **Selected Approach**: `JSON.parse`の結果を`unknown`として自前の交換Validatorへ渡し、File、Blob、TextEncoderを用いる。
- **Rationale**: CSP、同梱コード、サイズ制約を維持し、既存実行時検証パターンと整合する。
- **Trade-offs**: Validatorの網羅テストが不可欠になる。
- **Follow-up**: prototype pollution対象キーや過剰ネストを含む不正fixtureを追加する。

## Risks & Mitigations
- 交換形式と保存契約のドリフト — Mapperの往復テストと全カテゴリfixtureで検出する。
- 大きなファイルによるメモリ圧迫 — 保存上限に基づくファイルサイズ上限を読取前に確認し、処理中操作を抑止する。
- 復元と管理操作の競合 — Repository直列化とRestoreStateの操作ロックを併用する。
- 機密的な商品情報の露出 — エラーはpathと分類だけを返し、値をログ・画面へ含めない。

## References
- `.kiro/steering/roadmap.md` — 依存順、10MB制約、共有シーム。
- `.kiro/specs/local-data-foundation/design.md` — 保存ルート、Validator、Repository、StoragePort契約。
- `.kiro/specs/project-candidate-management/design.md` — プロジェクト・候補所有境界。
- `.kiro/specs/current-build-management/design.md` — 現在構成と候補参照契約。
