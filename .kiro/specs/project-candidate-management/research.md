# Research & Design Decisions

## Summary
- **Feature**: `project-candidate-management`
- **Discovery Scope**: Extension / light discovery
- **Key Findings**:
  - 上流は`LocalDataRoot`、`CandidatePart`、カテゴリ判別共用体、検証済みRepositoryを公開する。
  - 候補は単一プロジェクトへ所属し、プロジェクト削除は上流Repositoryが所属データを同一更新内で除去する。
  - 新規外部依存は不要で、業務サービスとサイドパネルUIを上流ポートへ接続する最小構成が適切である。

## Research Log

### 上流契約と拡張点
- **Sources Consulted**: `local-data-foundation/requirements.md`、`design.md`、`research.md`
- **Findings**: 下流は公開ドメイン契約とRepositoryだけへ依存する。保存失敗は判別可能な`Result`で返り、候補の元表記と確認値は別フィールドである。
- **Implications**: 本機能はChrome Storageを直接操作せず、管理固有の入力検証、カテゴリ変更、表示状態を所有する。

### UIホストと境界
- **Sources Consulted**: `roadmap.md`、feature brief、上流File Structure Plan
- **Findings**: ロードマップはChrome 116以降のMV3サイドパネルを想定する。ページ抽出と構成選択は別specである。
- **Implications**: サイドパネル入口と管理画面を追加し、取り込み・構成UIは含めない。

## Architecture Pattern Evaluation

| Option | Strengths | Risks | Decision |
|---|---|---|---|
| Feature service + UI | 業務規則と表示を分離し後続契約を共有可能 | 小規模な層追加 | 採用 |
| UIからRepository直接操作 | 実装が短い | 規則とエラー変換が分散 | 不採用 |

## Design Decisions

### Decision: 単一の管理サービス
- プロジェクトと候補は同じ集約ルートで更新されるため、一つのサービスがコマンド検証とRepository連携を担う。
- 将来用途向けの汎用CRUDフレームワークは導入しない。

### Decision: カテゴリ変更時の属性を明示変換
- 共通項目と元表記を保持し、カテゴリ固有の確認属性は新カテゴリの形へ初期化する。
- 旧カテゴリ属性を新カテゴリ属性へ推測変換しない。

## Risks & Mitigations
- 上流型の変更 — 公開エントリポイントだけに依存し、形状変更を再検証トリガーにする。
- 編集途中の保存失敗 — フォーム状態を永続状態と分離し、成功時のみ一覧を更新する。
- 未分類の下流利用 — 参照契約で分類済み候補だけを返す。
