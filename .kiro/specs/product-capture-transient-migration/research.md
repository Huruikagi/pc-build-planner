# 調査・設計判断: product-capture-transient-migration

## Summary

- **Feature**: `product-capture-transient-migration`
- **Discovery Scope**: Extension（light discovery）
- **Key Findings**:
  - 一過性表示面の寿命と原子的handoffはapplication-shellが既に公開portとして所有しており、product-captureは固定tab実行と結果準備だけへ縮小できる。
  - candidate-managementにはproject未解決draftを受理するvalidation、pending pre-edit、project作成後の再開経路が存在し、保存時のcanonical validationと分離できる。
  - `activeTab`は明示的user gestureで一時付与され、navigationまたはtab closeで失効する。`tabs.Tab.url`は権限や読み込み状態により欠落し得るため、固定tabでもURL欠落時は注入前にfail closedする必要がある。

## Research Log

### 既存extension pointと責務境界

- **Context**: 常設featureであったproduct-captureを、上流のtransient surfaceへ統合する変更範囲を特定した。
- **Sources Consulted**: `src/application-shell/public.ts`、`transient-surface-ports.ts`、`src/features/product-capture/*`、`src/features/candidate-management/*`、`side-panel-contributions.ts`
- **Findings**:
  - shellはactivation generation、固定`TargetTabId`、lease、`isCurrent`、`conclude`、rollback restoreを所有する。
  - product-captureのproduction contributionはruntime、`TransientSurfaceLifecyclePort`、candidate editor intent factoryの3依存で構成できる。
  - candidate-managementのcanonical公開APIは`query`、`createCandidateEditorIntent`、`sources: { catalog, mutations }`であり、captureはindexed access typeでintent factory facetだけを参照できる。
- **Implications**: shell contractやcandidate-management公開型をconsumer側で再定義せず、cross-feature importは各`public.ts`に限定する。

### 解決前draftとvalidation段階

- **Context**: project未選択・不存在と空の商品名を、保存可能draftと混同せず編集開始へ渡す必要がある。
- **Sources Consulted**: `candidate-management/contracts.ts`、`pre-edit-validation.ts`、`activation.ts`、`state.ts`、domain validator
- **Findings**:
  - `UnresolvedCandidateDraft`は`projectId`を持たず、構造検証では空の商品名を許容する。
  - 改訂後要件ではhandoff payloadがproject IDを持たず、candidate-managementはproject-contextが返す検証済みcurrent projectだけへbindする。current contextが未選択または利用不能なら、project一覧の先頭へfallbackせず`pendingPreEdit`として受理する。
  - 保存時だけ既存`validateCandidatePartContent`相当のcanonical規則が空名を拒否する。
  - legacyまたは未信頼payloadにproject情報が含まれても保存先決定には使用せず、current contextを変更しない。project未解決契約として扱う。
- **Implications**: pre-edit受理成功をhandoff成功と定義し、editor完成や保存成功をproduct-captureの終了条件にしない。現行の一覧先頭fallbackとoptional `projectId`は移行対象になる。

### 固定tab、権限、出所照合

- **Context**: active tabの再解決による別tab注入と、権限失効後の不完全なURL照合を防ぐ。
- **Sources Consulted**: Chrome公式`activeTab` documentation、Chrome公式Tabs API reference、`chrome-runtime-port.ts`、`coordinator.ts`、`security.md`
- **Findings**:
  - `activeTab`はaction等のuser gestureによりcurrent tabへ一時的host accessを付与し、navigationまたはcloseで失効する。
  - `activeTab`と`scripting`の組合せで固定tabへのscript injectionが可能であり、恒久host permissionは不要である。
  - `tabs.Tab.url`はoptionalであり、権限がなければ取得できず、読み込み中は空になり得る。
  - page由来`pageUrl`と注入前に取得したtab URLの一致確認は、tab IDやrequest IDだけでは代替できない。
- **Implications**: `tabs.query`でactive tabを再取得せず、activationで固定されたIDへの`tabs.get`、非空URL確認、injection、page URL照合の順で処理する。

### rollback世代と結果寿命

- **Context**: target activationまたはmount失敗時に、抽出結果を失わず同じhandoffを再試行する必要がある。
- **Sources Consulted**: `product-capture/state.ts`、`registration.ts`、application-shell transient controller tests
- **Findings**:
  - shellはsource snapshot取得後にleaseを解放し、失敗時にsourceをrestoreする。
  - capture snapshotに必要なのはactivation ID、tab ID、request generation、handoff-in-flight generationだけである。
  - page URL、HTML、抽出値、intent payloadをrollback snapshotへ含める必要はない。
  - candidate-managementが受理したpending pre-editはcapture終了とは独立し、同一side-panel document session内で保持できる。
- **Implications**: captureは受理または原子的終了失敗時だけ検証済みintentをfailed stateへ保持し、新activation・成功・surface終了で破棄する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| shell-owned transient lifecycle + feature ports | shellが寿命と遷移、featureが業務処理を所有する | 原子的handoff、型安全、責務が明確 | 上流contract変更時に再検証が必要 | 採用 |
| capture-owned navigation and save | captureがproject選択、editor遷移、保存まで所有する | 単一画面で完結 | 責務重複、rollback迂回、保存authority漏洩 | 不採用 |
| unsaved draft persistence | pending draftをstorageへ保存する | panel close後も復元可能 | schema、破棄policy、migration責務を追加 | 本spec外 |

## Design Decisions

### Decision: captureを実行専用の一過性featureにする

- **Context**: 抽出対象tabの寿命と、確認・補正・保存の寿命を分離する。
- **Alternatives Considered**:
  1. shellの一過性portを採用する。
  2. capture独自navigationと保存経路を維持する。
- **Selected Approach**: `presentation: "transient"`のcanonical registrationを使い、状態を`idle | extracting | failed`へ限定する。
- **Rationale**: shellをlifecycle owner、candidate-managementを編集・保存ownerとして既存境界に一致する。
- **Trade-offs**: cross-feature handoff testが必要になるが、重複する保存・project選択UIを除去できる。
- **Follow-up**: registration exact-shape、navigation key不在、production compositionをcontract testで固定する。

### Decision: project未解決pre-editをcandidate-managementが先に受理する

- **Context**: projectが0件でもcapture終了後に再抽出なしで編集を再開する。
- **Alternatives Considered**:
  1. pending pre-editを候補管理session stateへ保持する。
  2. no-projectをhandoff失敗としてcaptureへ留める。
  3. default projectを自動作成する。
- **Selected Approach**: candidate-managementが解決前draftを受理し、project作成結果のIDでcanonical draftへ解決する。
- **Rationale**: current contextとproject lifecycleのownerを変えず、明示的なproject作成を維持できる。
- **Trade-offs**: panel document破棄後の復元は保証しない。
- **Follow-up**: project作成成功、失敗、取消、新activation競合、session cleanupを検証する。

### Decision: platform-native権限と既存validatorを採用する

- **Context**: 新しい依存や重複validatorを導入せず、最小権限と型安全を維持する。
- **Alternatives Considered**:
  1. Chrome `activeTab` / `scripting`と既存domain validationを再利用する。
  2. 恒久host permission、外部schema library、capture専用保存validatorを追加する。
- **Selected Approach**: platform APIとcanonical domain/candidate contractsを採用し、新規依存を追加しない。
- **Rationale**: MV3/CSP、公開境界、単一write authorityに整合する。
- **Trade-offs**: 権限失効時は再度icon操作が必要になる。
- **Follow-up**: permission、artifact、boundary gateをproduction構成で実行する。

## Risks & Mitigations

- stale callbackが新activationを汚染する — activation IDと内部generationをruntime呼出前・完了後・handoff完了後に照合する。
- handoff失敗で抽出結果を失う — 検証済みintentとrollback generationを保持し、同一世代だけ再試行可能にする。
- stale project情報がcurrent contextを上書きする — project IDをhandoff契約から除外し、legacy入力に含まれても保存先決定へ使用しない。解決は検証済みcurrent contextだけへ限定する。
- URL欠落時に出所照合を迂回する — injection前に`permission-lost`へfail closedする。
- feature境界が再び広がる — public API exact-shape、deep-import、legacy symbol、navigation keyの機械gateを維持する。

## References

- [Chrome Extensions activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) — 一時権限の付与条件、許可能力、navigation/closeによる失効。
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) — `tabs.Tab.url`のoptional性と権限条件。
- `.kiro/steering/tech.md` — MV3、型安全、テスト基盤。
- `.kiro/steering/security.md` — threat model、最小権限、fail closed、ログ制約。
- `.kiro/specs/transient-feature-surface/design.md` — 上流transient lifecycleとatomic handoff契約。
