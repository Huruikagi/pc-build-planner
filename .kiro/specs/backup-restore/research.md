# Research & Design Decisions

## Summary
- **Feature**: `backup-restore`
- **Discovery Scope**: Extension / Light Integration Update
- **Key Findings**:
  - Foundationは全データを単一の`LocalDataRoot`として検証・保存し、候補所属と現在構成参照の整合性を既に保証する。
  - バックアップ交換形式は保存スキーマと別版にし、復元時だけ現行`LocalDataRoot`へ変換すれば内部変更をファイルへ直接露出せずに済む。
  - Web標準のFile、Blob、TextEncoderと既存Foundation公開portで要件を満たせるため、新規ライブラリは不要である。

## Research Log

### 上流保存契約と参照整合性
- **Context**: 全データの範囲と安全な置換単位を確定した。
- **Sources Consulted**: `local-data-foundation`、`project-candidate-management`、`current-build-management`のrequirements、design、tasks、research、およびroadmap。
- **Findings**: `LocalDataRoot`は`schemaVersion`、`projects`、`parts`、`currentBuilds`を持つ。Repositoryは読取検証、直列更新、容量判定を所有し、候補と構成は同じプロジェクト内だけを参照する。
- **Implications**: 復元は個別CRUDの繰り返しではなく、Foundationが既に公開する`assessReplacement`、`replaceRoot`、`runMaintenance`を消費する。Repositoryへ新しい書込経路を追加せず、候補・構成の業務規則を再実装しない。

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

### Decision: Foundationの既存原子的置換契約を消費する
- **Context**: 個別CRUDでは途中失敗時に混在状態が残る。
- **Alternatives Considered**: UIでロールバック、個別CRUD、単一ルート置換。
- **Selected Approach**: 保存root候補を`unknown`として既存`FoundationDataPort.assessReplacement`へ渡し、maintenance fence取得後に既存`replaceRoot`で一括置換する。
- **Rationale**: 保存所有境界内の既存実装で直列化、容量、検証、失敗正規化を一貫させられる。
- **Trade-offs**: Foundationのassessment token、revision、maintenance generationへ正確に追従する必要がある。
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

### 2026-07-27 settings-screen統合のlight discovery
- **Context**: GitHub issue #19に対応し、独立ナビゲーションから設定画面内区画へ配置だけを変更する既存仕様更新。
- **Sources Consulted**: `.kiro/specs/settings-screen/{brief,requirements,design,tasks}.md`、更新済み`.kiro/specs/application-shell/{requirements,design,tasks}.md`、`ui-internationalization`、`ui-message-catalog`、既存`src/features/backup-restore/`、全steering。
- **Findings**: `settings-screen`は正確な公開境界として`BackupRestoreSectionMount.mount(context: FeatureMountContext): Promise<FeatureMountHandle>`を定義し、composition ownerだけがfactoryへ完全`FoundationDataPort`を渡す。settingsはsection handleだけを保持し、backup state、service、maintenance capabilityを所有しない。現行実装の`registration.ts`と`feature-contribution.ts`、`nav.backupRestore`は移行対象である一方、exchange、service、state、file gateway、React viewは再利用できる。
- **Decision**: `backup-restore`は独立feature registration/contributionを廃止し、`section-mount.ts`と`public.ts`から正確な`BackupRestoreSectionMount`とfactoryだけを公開する。設定layout、navigation、言語区画、shell compositionは`settings-screen`/`application-shell`へ委ねる。
- **Risks & Mitigations**: composition切替中の二重表示は旧registrationと新sectionを同時にproduction catalogへ載せない統合gateで防ぐ。部分mount失敗と二重cleanupはsection contract testで固定する。言語変更による不要な再mountとbackup state喪失はsettings側のstable host contractで検証し、backup側は通常のhandle lifecycleだけを提供する。
- **Synthesis**: 新しい抽象化や依存は不要で、既存feature mount lifecycleをsection境界として再利用するのが最小変更である。交換形式、maintenance generation、atomic restore、分類済みerror、公開操作の意味は一切変更しない。

### 2026-07-19 React UI方針更新
- **背景**: export、file選択、preview、置換確認、処理中lock、結果表示を一貫した画面状態として扱う必要がある。
- **判断**: `view.tsx`をReact function componentとし、feature固有の`react-root.tsx`で既存`FeatureMountContext`へ接続する。
- **境界**: BackupRestoreState、service、交換契約、FileGatewayはframework非依存を維持する。表示値は通常のJSX childとし、`dangerouslySetInnerHTML`と`innerHTML`を禁止する。
- **統合**: featureは`public.ts`と`section-mount.ts`から埋め込み可能なmount契約だけを公開し、独立registration/contributionはsettings composition切替後に削除する。共有side panel runtime、settings registration、HTML host、root barrelは編集しない。復元時はFoundationの永続maintenance fenceを取得し、shellは同じ状態のread-only projectionから全feature mutationを抑止する。
- **検証**: React DOM表示、確認操作、Blob URLとReact rootのcleanupを統合testで確認する。
- **参照**: [React createRoot](https://react.dev/reference/react-dom/client/createRoot)、[Chrome MV3 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
