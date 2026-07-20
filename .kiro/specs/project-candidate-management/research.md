# Research & Design Decisions

## Summary
- **Feature**: `project-candidate-management`
- **Discovery Scope**: Extension / light discovery
- **Key Findings**:
  - 上流は`LocalDataRoot`、`CandidatePart`、カテゴリ判別共用体、検証済みRepositoryを公開する。
  - 候補は単一プロジェクトへ所属し、プロジェクト削除は上流Repositoryが所属データを同一更新内で除去する。
  - 新規外部依存は不要で、業務サービスとサイドパネルUIを上流ポートへ接続する最小構成が適切である。
  - 最新Foundationは候補変更とCurrentBuild参照修復を同一root mutationで完了し、application shellはfeature-neutralなtyped activationを配送する。

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

### 2026-07-19 React UI方針更新
- **背景**: 一覧、カテゴリ切替、複数フォーム、削除確認、失敗時ドラフト保持を標準DOMで管理すると描画とcleanupの見通しが悪化する。
- **判断**: `view.tsx`をReact function componentとし、feature固有の`react-root.tsx`で既存`FeatureMountContext`へ接続する。
- **境界**: ManagementState、service、port、CSS所有権は維持し、React固有型をdomain契約へ漏らさない。外部文字列は通常のJSX childとし、`dangerouslySetInnerHTML`と`innerHTML`を禁止する。
- **統合**: featureは`public.ts`とregistration moduleを所有し、共有side panel runtime、HTML host、root barrelを編集しない。
- **検証**: 利用者視点のReact DOM testとmount/unmount cleanup testを追加する。
- **参照**: [React createRoot](https://react.dev/reference/react-dom/client/createRoot)、[React TypeScript](https://react.dev/learn/typescript)

### 2026-07-20 上流契約追従
- **Sources Consulted**: `local-data-foundation/design.md`、`application-shell/design.md`、`roadmap.md`、`cross-spec-review.md`
- **Findings**: Foundationは`FoundationDataPort.mutate`内で参照修復、root検証、revision更新、単一保存を行う。shellはfeature ID、target、`unknown` payloadを配送し、対象featureがpayloadを検証する。
- **Implications**: 候補管理はRepository直接writeと成功後のbuild reconcileを要求せず、`RootMutationCommand`の利用側になる。候補編集prefillは`public.ts`の型付きAPIとregistrationのruntime validatorを対にする。
- **Decision**: `openCandidateEditor`はDOMやhostを直接操作せず`ShellNavigator`へintentを渡す。`CandidateDraft`は`sourceInfo`と`sourceSnapshot`を別フィールドとして正式公開する。
- **Risk Mitigation**: activation payload、project存在、targetを適用前に検証し、失敗時は入力元と候補管理双方の既存stateを保持する。

### 2026-07-20 Shell rollback snapshot契約への追従
- **Sources Consulted**: `application-shell/requirements.md`、`application-shell/design.md`、activation lifecycle review findings
- **Findings**: shellはfeature固有stateを復元できないため、cross-feature activationの入力元はopaque state snapshotを提供する必要がある。cleanup失敗時はshellがtarget handleを保持し、sourceを同時にmountしない。
- **Decision**: 候補管理は選択、未保存draft、確認ダイアログ、表示エラーをfeature-local snapshotとしてcapture／restoreする。永続root、request、購読、React objectはsnapshot対象外とする。
- **Implications**: state snapshotのruntime validationはcandidate managementが所有し、shellへ候補値やフォーム構造を漏らさない。restore不能時は保存済みデータを変えず初期表示へ退避する。
