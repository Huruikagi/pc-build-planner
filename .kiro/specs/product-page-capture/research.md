# Research & Design Decisions

## Summary
- **Feature**: `product-page-capture`
- **Discovery Scope**: Extension（上流2仕様への複合統合）
- **Key Findings**:
  - Foundationはページ入力を未信頼として扱い、保存を信頼済み拡張コンテキストのRepositoryに限定する。
  - Candidate managementは`CaptureCandidatePort.createCandidate`を公開し、商品名以外の欠損と未分類を許容する。
  - 抽出処理はDOMを利用できる注入側で完結し、service workerは一時的な調停だけを担う必要がある。
  - `source-price-refresh`は同じ価格順位・正規化・provenanceを必要とするが、現行`public.ts`は空APIであり、内部moduleをdeep importせず固定tab価格を観測するseamがない。

## Research Log

### 上流データ・保存契約
- **Context**: 取り込み側と保存側の責任重複を避ける必要がある。
- **Sources Consulted**: `local-data-foundation`、`project-candidate-management` の requirements/design/tasks。
- **Findings**: `CandidatePart`は`confirmed`、`sourceSnapshot`、`sourceInfo`を分離する。候補作成は単一projectId、商品名必須、任意項目欠損可である。
- **Implications**: 本仕様は永続化を所有せず、確認済み`CandidateDraft`を既存ポートへ渡す。

### Chrome実行境界
- **Context**: 明示操作、一時権限、MV3ライフサイクル制約を両立する必要がある。
- **Sources Consulted**: roadmap、brief、Foundationのruntime設計。
- **Findings**: `activeTab`と`scripting`をactionのユーザージェスチャーに結び付け、DOM解析は注入関数で行う。service workerの長寿命状態へ依存できない。
- **Implications**: action調停、ページ抽出、サイドパネル状態を分離し、要求IDとタブURLを使って古い結果を破棄する。

### 汎用抽出戦略
- **Context**: サイト別アダプターなしで説明可能な抽出を行う。
- **Sources Consulted**: briefで確定した優先順位と公開範囲。
- **Findings**: JSON-LD、OGP等、見出し・パンくず、表・定義リスト、項目名辞書の順が境界条件である。取得元を値ごとに保持する必要がある。
- **Implications**: extractorは複数候補を収集し、deterministicなrankerが採用候補とprovenanceを返す。

### 価格だけを再利用する公開seam
- **Context**: `source-price-refresh`が保存済み販売ページの価格を再取得する際、product-captureと同じ抽出順位・normalizerを再利用し、page URLの出所を保持する必要がある。
- **Sources Consulted**: `source-price-refresh/design.md`、`source-price-refresh/tasks.md`、`product-capture-transient-migration/design.md`、既存`extractor.ts`、`normalizer.ts`、`ranker.ts`、`coordinator.ts`、`chrome-runtime-port.ts`。
- **Findings**:
  - consumerは`extractPrice(TargetTabId)`から`pageUrl`、`capturedAt`、任意の`SourcedValue<MoneyValue>`と6種のtyped failureを期待する。
  - 既存runtimeはpage側`location.href`をpayloadへ載せ、注入前target URLとの不一致を`tab-changed`にできる。
  - 価格の元表記は`NormalizedField.rawValue`、確認値は`normalizedValue: MoneyValue`に既に分離されている。
- **Implications**: 固定tab runtimeと共通payload decoderの上に薄い`PagePriceExtractionAdapter`を追加し、価格候補だけを既存normalizer/rankerへ通す。価格更新、URL identity、永続化はconsumer側へ残す。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 注入関数＋調停サービス | DOM内で抽出し型付き結果だけを返す | MV3制約と最小権限に整合 | ページ遷移競合の管理が必要 | 採用 |
| 常駐content script | 継続的にページを観測 | 再取得が速い | 明示操作・最小権限方針に不適合 | 不採用 |
| サーバー抽出 | URLを外部へ送信 | DOM差異を中央管理可能 | オフライン・プライバシー・scopeに不適合 | 不採用 |

## Design Decisions

### Decision: 候補集合と順位付けを分離する
- **Context**: 同一項目が複数ソースに現れ、取得根拠を残す必要がある。
- **Alternatives Considered**: 最初に見つけた値を採用、サイト別ルール、候補集合をrankerへ渡す。
- **Selected Approach**: extractorが根拠付き候補集合を返し、rankerが固定優先順位で採用する。
- **Rationale**: 決定的にテストでき、将来のサイト別アダプターも候補供給口へ限定できる。
- **Trade-offs**: 中間型は増えるが、採用理由が可視化できる。

### Decision: 保存モデルを増やさない
- **Context**: 取り込み途中状態の永続化はFoundationの容量とスキーマを広げる。
- **Selected Approach**: 抽出セッションはサイドパネル内の一時状態とし、確定時だけ`CaptureCandidatePort`を呼ぶ。
- **Rationale**: service worker寿命への依存を避けつつ、保存責任を上流へ集約できる。
- **Trade-offs**: サイドパネルを閉じた未保存ドラフトは復元しない。

### Decision: 外部抽出ライブラリを導入しない
- **Context**: 必要対象はJSON-LD、meta、DOM表であり、リモートコードは禁止される。
- **Selected Approach**: ブラウザー標準DOM APIと小さな型付き抽出器を同梱する。
- **Rationale**: 対象範囲に対し最小で、CSPとビルド依存を増やさない。

### Decision: price専用抽出器を作らず既存pipelineを投影する
- **Context**: price refreshのためだけにDOM collector、parser、priorityを複製すると通常取り込みと結果がずれる。
- **Alternatives Considered**:
  1. product-capture内部moduleをconsumerがdeep importする — 公開境界違反。
  2. price専用content scriptとparserを新設する — ownershipと規則が二重化する。
  3. product-captureが狭いread-only portを公開する — 採用。
- **Selected Approach**: `PagePriceExtractionPort.extractPrice(TargetTabId)`がpage-derived URL、canonical取得時点、任意の`SourcedValue<MoneyValue>`だけを返す。固定tab解決・注入、payload validation、normalizer、rankerは既存実装を共有し、組立済みinstanceを`ProductCapturePublicApi.pagePriceExtraction`からcomposition rootへ渡す。
- **Rationale**: `source-price-refresh`の型と一致し、通常取り込みと同じ優先順位・元表記・MoneyValueを保証しながら、他の商品fieldとruntime concreteを非公開にできる。
- **Trade-offs**: 有効価格がないページも観測自体は成功するため`price`はoptionalである。更新可否と`price-unavailable`表示はconsumerが判断する。
- **Follow-up**: `product-capture-transient-migration`が固定tab runtime契約を確定した後にadapterを接続し、同specのUI/state/handoff変更は本specへ取り込まない。

## Risks & Mitigations
- ページ遷移後に古い結果が返る — tabId、URL、requestIdを照合して破棄する。
- 悪意ある巨大・実行可能値 — 長さ制限、制御文字除去、URL/価格検証、通常のJSX childによる描画を行う。
- JSON-LD形状の多様性 — 再帰走査を有界化し、未知形状は欠損として扱う。
- 上流契約変更 — `CandidateDraft`、カテゴリ、source contract変更を再検証トリガーにする。
- price port drift — `PagePriceObservation`、error union、固定tab/pageUrl照合、price provenance変更時に`source-price-refresh` consumer contractを再検証する。

## References
- `.kiro/specs/product-page-capture/brief.md`
- `.kiro/steering/roadmap.md`
- `.kiro/specs/local-data-foundation/design.md`
- `.kiro/specs/project-candidate-management/design.md`

### 2026-07-19 React UI方針更新
- **背景**: 抽出確認、根拠表示、補正、project選択、失敗回復の状態分岐を宣言的に扱う必要がある。
- **判断**: `view.tsx`をReact function componentとし、feature固有の`react-root.tsx`で既存`FeatureMountContext`へ接続する。
- **境界**: CaptureState、抽出器、runtime coordinator、portはframework非依存を維持する。ページ由来値は通常のJSX childとし、`dangerouslySetInnerHTML`と`innerHTML`を禁止する。
- **統合**: featureはside panel registration、worker registration、`public.ts`を所有し、共有side panel/service worker入口とroot barrelを編集しない。
- **検証**: React DOMで安全な描画と往復編集を検証し、unmount時の購読解除を確認する。
- **参照**: [React createRoot](https://react.dev/reference/react-dom/client/createRoot)、[Chrome MV3 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)

### 2026-07-20 Typed candidate editor activation追従
- **Sources Consulted**: `application-shell/design.md`、`project-candidate-management/design.md`、`roadmap.md`
- **Findings**: shellはfeature-neutral intentの配送だけを所有し、候補管理は`CandidateEditorPrefill`のruntime検証とstate適用を所有する。
- **Decision**: captureはshell intentを直接構築せず、候補管理の`openCandidateEditor`へ型付きprefillを渡す。保存と詳細編集は同じ`CaptureDraftMapper`規則を再利用する。
- **Implications**: navigation失敗、候補側payload拒否、mount失敗ではCaptureSessionを維持し、保存処理やFoundation mutationを呼ばない。
