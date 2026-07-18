# Research & Design Decisions

## Summary
- **Feature**: `local-data-foundation`
- **Discovery Scope**: New Feature
- **Key Findings**:
  - 現在の実装はNode.js設定のみで、拡張ランタイムとTypeScript基盤は未作成である。
  - Chrome 116以降のMV3では永続状態をservice workerメモリに置かず、`chrome.storage.local` を信頼済みコンテキストに限定する必要がある。
  - 後続specの並行実装には、ドメイン型、検証、保存ポートを先に安定させることが重要である。

## Research Log

### 現行コードベース
- **Context**: 新規基盤が既存パターンを拡張するか確認した。
- **Sources Consulted**: `package.json`、リポジトリ構造、`docs/requirements.md`、`.kiro/steering/roadmap.md`
- **Findings**: Biomeとpnpm指定以外にビルド、型検査、テスト、拡張ファイルは存在しない。
- **Implications**: ランタイム設定とテスト基盤を明示的な初期タスクにする。

### Chrome MV3とStorage制約
- **Context**: 実行寿命、保存容量、アクセス制御を設計する必要がある。
- **Sources Consulted**: Chrome Extensions公式ドキュメントのManifest V3、Storage API、service worker lifecycle、content security policy
- **Findings**: service workerは停止し得る。`storage.local` は既定で約10MBで、アクセスレベルを信頼済みコンテキストへ制限できる。MV3は拡張同梱コードを前提とする。
- **Implications**: 保存処理は呼出しごとに永続領域を読み、アクセスレベルを起動時に制限し、容量を事前評価する。

### 検証と移行方式
- **Context**: 保存済みJSONを型だけで信頼できない。
- **Sources Consulted**: TypeScriptの型消去特性、既存依存関係、要件の将来移行制約
- **Findings**: 実行時検証が不可欠。初期基盤では小さなスキーマのため、外部ライブラリ追加より明示的な検証関数と判別共用体が適する。
- **Implications**: 型と検証器を同じドメイン境界に置き、移行レジストリは連続バージョンのみ許可する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| ポートとアダプター | ドメイン契約と保存APIをChromeアダプターから分離 | テスト可能、後続機能と将来移行に強い | ファイル数が増える | 採用。ただし単一保存実装に過剰な抽象層は追加しない |
| Storage API直接利用 | 各機能がChrome APIを直接呼ぶ | 初期実装が短い | 検証・容量・移行が分散 | 不採用 |
| 外部スキーマライブラリ | 宣言的な実行時検証 | 記述量を削減 | CSP・バンドル・依存更新面が増える | 初期版では不採用、複雑化時に再評価 |

## Design Decisions

### Decision: 単一のバージョン付き保存ルート
- **Context**: 参照整合性と原子的な更新を保つ必要がある。
- **Alternatives Considered**: エンティティ別キー、単一ルートドキュメント。
- **Selected Approach**: スキーマバージョン、プロジェクト、候補、構成を一つの保存ルートで管理する。
- **Rationale**: MVP規模と10MB制約では全体検証と一括置換が簡潔で、部分更新による参照破損を避けられる。
- **Trade-offs**: データ増大時の全体書換コスト。容量・性能測定を継続する。

### Decision: 結果型で失敗を公開
- **Context**: Chrome API、検証、容量、移行の失敗を利用側が区別する必要がある。
- **Selected Approach**: 例外を境界外へ漏らさず、判別可能な`Result`とエラーコードを返す。
- **Rationale**: 後続UIが回復可能な案内を選べ、テストも安定する。

### Decision: 一般化は契約に限定
- **Context**: 将来Webアプリや同期へ移行できるが、現時点で実装しない。
- **Selected Approach**: 保存ポートと直列化可能なドメイン契約を汎用化し、Chrome以外のアダプター、同期、エクスポートは作らない。
- **Rationale**: 現要件を満たす最小構成で下流依存を安定させる。

## Risks & Mitigations
- 保存ルート全体の書換競合 — リポジトリ内の直列化キューと更新時再検証で軽減する。
- 破損データの自動上書き — 読取検証失敗時は書換せずエラーとして隔離する。
- 容量見積りと実書込差 — `getBytesInUse`による事前確認に加え、書込エラーも容量失敗へ正規化する。
- 下流が型を迂回 — Chrome APIを直接importしない依存方向と公開エントリポイントを定める。

## References
- [Chrome Extensions Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) — MV3実行モデル
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) — 容量とアクセスレベル
- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — メモリ寿命制約
- [Manifest CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) — 実行コード制約
