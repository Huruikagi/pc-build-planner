# Research & Design Decisions

## Summary
- **Feature**: `product-page-capture`
- **Discovery Scope**: Extension（上流2仕様への複合統合）
- **Key Findings**:
  - Foundationはページ入力を未信頼として扱い、保存を信頼済み拡張コンテキストのRepositoryに限定する。
  - Candidate managementは`CaptureCandidatePort.createCandidate`を公開し、商品名以外の欠損と未分類を許容する。
  - 抽出処理はDOMを利用できる注入側で完結し、service workerは一時的な調停だけを担う必要がある。

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

## Risks & Mitigations
- ページ遷移後に古い結果が返る — tabId、URL、requestIdを照合して破棄する。
- 悪意ある巨大・実行可能値 — 長さ制限、制御文字除去、URL/価格検証、text node描画を行う。
- JSON-LD形状の多様性 — 再帰走査を有界化し、未知形状は欠損として扱う。
- 上流契約変更 — `CandidateDraft`、カテゴリ、source contract変更を再検証トリガーにする。

## References
- `.kiro/specs/product-page-capture/brief.md`
- `.kiro/steering/roadmap.md`
- `.kiro/specs/local-data-foundation/design.md`
- `.kiro/specs/project-candidate-management/design.md`
