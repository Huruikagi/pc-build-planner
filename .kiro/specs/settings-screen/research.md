# Research & Design Decisions

## Summary

- **Feature**: `settings-screen`
- **Discovery Scope**: Extension（既存shell、ui-language、backup-restoreを再配置する統合変更）
- **Key Findings**:
  - `LanguageSelectControl`は状態を所有しない薄い公開UIで、`ui-language/public.ts`経由の再利用だけで言語の意味・保存経路を変更せず移設できる。
  - backup-restoreの業務状態・交換形式・maintenance制御はfeature内に閉じている。`backup-restore`が実装する公開mount portをsettingsが受け入れれば、settingsは配置とhost lifecycleだけを所有できる。
  - `backupRestore` feature idはshell document内の選択とテスト識別子にだけ使われ、永続化モデルには格納されていない。常設feature idを`settings`へ変更しても利用者データ移行は不要である。
  - 上流`transient-feature-surface`は`ApplicationFeatureRegistration`を判別共用体として確定した。settingsは`presentation: "persistent"`と`navigation: { labelKey: "nav.settings", order: 60, icon: "settings" }`を必ず明示する常設branchとして登録する。
  - semantic message要件とconsumer位置はsettingsが所有する一方、exact key、ja/en値、namespace、placeholder、parity、fallback、legacy key削除は`ui-message-catalog`だけが所有する。

## Research Log

### 言語コントロールの移設可能性

- **Context**: shellヘッダからsettingsへ移しても、言語解決・保存・再mount防止を維持できるかを確認した。
- **Sources Consulted**:
  - `src/ui-language/public.ts`
  - `src/ui-language/language-select.ts`
  - `src/ui-language/react.ts`
  - `.kiro/specs/ui-internationalization/requirements.md`
  - `.kiro/specs/ui-internationalization/design.md`
- **Findings**:
  - `LanguageSelectControl`は`useLanguage()`の共有storeを参照し、ローカルstateを持たない。
  - 言語変更は同じReact treeの再描画で反映され、feature registrationやmount lifecycleを介さない。
  - `LanguageProvider`は各feature rootに既に配置され、保存・初期解決は`ui-language`が所有する。
- **Implications**:
  - settings rootは公開`LanguageSelectControl`を配置するだけでよい。
  - 言語変更時にsettings registrationを再mountしないこと、埋め込みbackup rootのhost DOMを同一identityで保持することを統合テストで固定する。

### backup-restoreの埋め込み境界

- **Context**: 独立featureを設定画面の区画へ移しつつ、交換形式・復元状態・maintenance leaseをsettingsへ漏らさない方法を比較した。
- **Sources Consulted**:
  - `src/features/backup-restore/feature-contribution.ts`
  - `src/features/backup-restore/registration.ts`
  - `src/features/backup-restore/react-root.tsx`
  - `src/features/backup-restore/view.tsx`
  - `.kiro/specs/backup-restore/requirements.md`
  - `.kiro/steering/structure.md`
- **Findings**:
  - 現行registrationだけが`FoundationDataPort`からstate/service/file gatewayを組み立て、React rootをmountする。
  - viewは`data-region="export"`と`data-region="restore"`を既に持ち、画面内区画として再利用できる。
  - feature横断の内部component importは禁止されるが、`public.ts`の型付きport利用は許可される。
- **Implications**:
  - `backup-restore` task 6.1が`BackupRestoreSectionMount`を実装・公開し、既存registrationのstate構築とroot lifecycleをadapterへ移す。
  - settingsは完成済みmount objectを受け取り`mount(context)`だけを呼び、backupのfactory、state、service、file、FoundationDataPortを解釈しない。
  - settingsのunmount時はbackup sectionを先にunmountし、その後settings rootを解放する。
  - settings composition切替後の旧registration／contribution削除は`backup-restore` task 6.2が所有する。

### shell状態とapplication-shell要件8の再定義

- **Context**: 「全状態で直接切り替え可能」という既存要件と、コントロールを一つの設定画面へ集約する要求が衝突する。
- **Sources Consulted**:
  - `.kiro/specs/application-shell/requirements.md` 要件8
  - `src/application-shell/shell-view.tsx`
  - `src/application-shell/contracts.ts`
  - `tests/application-shell/shell-view.test.tsx`
- **Findings**:
  - loadingではnavigation自体が描画されず、startup errorではsettings registrationが利用可能とは限らない。
  - feature-localなReact error boundaryではnavigationが残るため、settingsへ移動できる。
  - maintenanceは選択中featureを保持しnavigationも利用できるため、settings内の言語変更を継続できる。
- **Implications**:
  - 直接操作保証はready・maintenance・feature-local failureへ限定する。
  - loading・startup errorは無効なselectを残さず、`設定 / Settings`という言語非依存の発見手掛かりと回復操作を提示する。
  - application-shell要件8とui-internationalization要件1.1/1.5の既存文書を、この到達性契約へ改訂する。

### 常設ナビゲーションとfeature id

- **Context**: `backupRestore`を維持するか、画面の意味に合わせて`settings`へ変更するかを判断した。
- **Sources Consulted**:
  - `src/application-shell/side-panel-contributions.ts`
  - `src/application-shell/feature-contribution-catalog.ts`
  - `src/application-shell/side-panel-host.ts`
  - `src/domain/`、`src/persistence/`のfeature id検索結果
  - `.kiro/specs/transient-feature-surface/design.md`
  - `.kiro/specs/product-capture-transient-migration/design.md`
- **Findings**:
  - feature idはshellのメモリ内選択、root API key、contract test、E2E locatorに現れるが、`LocalDataRoot`やstorageへ保存されない。
  - backup-restoreの公開APIは空であり、production consumerは存在しない。
  - 上流移行後、product-captureは登録されたままtransientとなり常設navigationから除外される。
- **Implications**:
  - 常設登録は`settings`へ変更し、catalog ownerが公開するsettings navigation label keyとorder 60を使用する。
  - settingsはapplication composition、root API参照、旧E2E locatorをsettings経路へ切り替える。backup-owned独立登録／公開surfaceはbackup task 6.2、legacy navigation keyはcatalog task 7.2が削除する。
  - schema migrationは不要だが、composition/public contract snapshotとbuild smokeを意図的に更新する。

### 技術・依存確認

- **Context**: 新しいライブラリまたはruntime前提が必要かを確認した。
- **Sources Consulted**:
  - `.kiro/steering/tech.md`
  - `package.json`
  - `src/application-shell/react-shell-root.tsx`
- **Findings**:
  - React 19.2.7、React DOM 19.2.7、TypeScript 7.0.2が固定され、`flushSync`の既存利用例がある。
  - 同期render後に埋め込みhostを取得し、backup mount完了までfeature mountを成功扱いしない構成が既存依存だけで実現できる。
  - 新規package、権限、storage key、schema、runtime messageは不要である。
- **Implications**:
  - 外部Web調査は不要。既存stackと公開契約だけを採用する。
  - build、CSP、manifest権限集合は変更しない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Decision |
|---|---|---|---|---|
| backup実装をsettingsへ移動 | service、state、viewをsettings内部へ移す | 単一React rootにしやすい | backup所有権を壊し、交換形式変更と配置変更を混在させる | 不採用 |
| backup React componentを公開 | `BackupRestoreView`を`public.ts`から直接renderする | UI構成が短い | feature間component importを導入し、state構築責務も漏れる | 不採用 |
| 公開section mount port | backupがstate/rootを所有し、settingsはhostとlifecycleだけを合成する | 公開境界、独立テスト、既存業務契約を維持 | nested React rootのmount順とcleanupを明示する必要がある | 採用 |
| `backupRestore` idを維持 | ラベルだけsettingsへ変更する | locator変更が少ない | 画面意味とidが乖離し、将来設定項目の所有者が不明瞭 | 不採用 |
| `settings` idへ変更 | 画面・navigation・公開keyを同じ概念へ統一する | 境界が明瞭 | contract snapshotとE2E更新が必要 | 採用 |

## Design Decisions

### Decision: settingsは画面合成だけを所有する

- **Context**: 言語とbackupは別々のcanonical ownerを持つ。
- **Alternatives Considered**:
  1. 両方の業務ロジックをsettingsへ移す。
  2. settingsが公開UI／mount契約を合成する。
- **Selected Approach**: settingsは`LanguageSelectControl`と`BackupRestoreSectionMount`だけを組み合わせ、意味・保存・復元を解釈しない。
- **Rationale**: vertical sliceとpublic-only依存を維持し、配置変更を業務変更から分離できる。
- **Trade-offs**: 2つのReact rootを協調cleanupする必要がある。
- **Follow-up**: mount失敗、途中unmount、言語変更中のhost identityを統合テストで確認する。

### Decision: メッセージの意味とcatalog dataを分離する

- **Context**: settingsは新しい画面・区画・例外案内を要求するが、catalogは既に単一のcanonical ownerを持つ。
- **Alternatives Considered**:
  1. settings specがexact key、ja/en値、namespace、parity taskまで所有する。
  2. settingsはsemantic message要件・consumer位置・observable guidanceだけを定め、catalog dataは`ui-message-catalog`へ委ねる。
- **Selected Approach**: 2。settings viewとshell surfaceは`ui-messages/public.ts`の型付きkey／resolverだけを利用し、catalog migration task 6.1／6.2の成果を受け入れる。
- **Rationale**: key／値／placeholder／fallback／削除checkpointの共同所有をなくし、consumer layout変更とcatalog data変更を独立に検証できる。
- **Trade-offs**: settings実装はcatalog 6.1／6.2完了を明示的な外部前提にする。
- **Follow-up**: catalog ownerのparity／dead-key gateをsettings完全検証でも再実行するが、settingsはcatalog filesを編集しない。

### Decision: 埋め込みmountをfeature mountの成功条件に含める

- **Context**: effectで遅延mountすると、backup section失敗後もshellがsettingsを正常mount済みと判断する。
- **Alternatives Considered**:
  1. settings viewのeffectから非同期mountする。
  2. settings rootを同期renderし、hostを取得してからbackup mountをawaitする。
- **Selected Approach**: `flushSync`でsettings layoutを描画し、backup mount成功後にだけ`FeatureMountHandle`を返す。
- **Rationale**: shellの既存mount失敗・rollback契約をそのまま利用できる。
- **Trade-offs**: root adapterがrender順を明示的に管理する。
- **Follow-up**: backup mount失敗時にsettings rootとDOMが残らないことを検証する。

### Decision: exceptional shell stateは発見可能性へ要件を緩和する

- **Context**: loading/startup errorではsettingsをmountできないため、直接選択保証は実現不能である。
- **Alternatives Considered**:
  1. headerに例外時だけselectを残す。
  2. 設定画面へ完全集約し、到達不能時は二言語の場所案内を出す。
- **Selected Approach**: 通常・maintenance・feature failureはsettingsへの実到達、loading/startup errorは`設定 / Settings`案内と回復操作に分ける。
- **Rationale**: 無効な操作を提示せず、ヘッダ占有を解消しながら操作場所を失わせない。
- **Trade-offs**: 起動完了前や致命的起動失敗中には直接切り替えられない。
- **Follow-up**: application-shellとui-internationalizationの既存要件・設計・テスト期待値を同時に改訂する。

### Decision: 新規依存・汎用設定schemaを導入しない

- **Context**: 将来設定項目を想定した抽象化は現要件に不要である。
- **Alternatives Considered**:
  1. 設定項目registry、設定schema、汎用section pluginを新設する。
  2. 現在の2区画を明示的に合成する。
- **Selected Approach**: settings layout、language control、backup section mountの最小構成に限定する。
- **Rationale**: build-vs-adoptと簡素化の観点で、既存公開契約が要件を満たす。
- **Trade-offs**: 3つ目の設定項目追加時はsettings viewと依存を明示的に拡張する。
- **Follow-up**: 新規項目が別feature所有となる場合にのみsection portの一般化を再検討する。

## Risks & Mitigations

- backup mount前後の例外でReact rootまたはDOMが残る — mountを直列化し、取得済みresourceだけを逆順cleanupするテストを置く。
- 言語変更でbackup hostが置換されstateが失われる — host要素を安定したkey・同一DOMで保持し、確認状態と選択ファイルの非破棄を統合テストする。
- 上流transient migrationとのtuple／navigation競合 — 上流完了を実装前提にし、persistent判定後のcomposition snapshotを更新する。
- `backupRestore`文字列の取り残しで二重navigationや古いlocatorが残る — settingsはcomposition／root API／E2E consumerを検査し、backup task 6.2とcatalog task 7.2のowner別gateを再検証する。
- bilingual hintが通常の翻訳規則と競合する — settingsは「設定 / Settings」と回復操作が判別できるobservable guidanceだけを要求し、ja/en値とfallbackはcatalog ownerのparity検証へ委ねる。

## References

- `.kiro/steering/product.md` — サイドパネルとローカルファーストの製品境界
- `.kiro/steering/tech.md` — React、TypeScript、mount lifecycle、検証フロー
- `.kiro/steering/structure.md` — feature公開入口とcomposition owner
- `.kiro/steering/security.md` — CSP、権限、未信頼文字列、ログ制約
- `.kiro/steering/testing.md` — node:test、testing-library、Playwrightの配置
- `.kiro/specs/transient-feature-surface/design.md` — persistent/transient登録契約
- `.kiro/specs/product-capture-transient-migration/design.md` — 上流の常設navigation変更
