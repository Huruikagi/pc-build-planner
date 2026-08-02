# Brief: current-build-management

## Problem

候補を集めるだけでは、実際に採用するパーツの組み合わせが分からず、構成として整理したり互換性チェックの対象を確定したりできない。

## Current State

プロジェクト内に複数候補を保持する要求はあるが、カテゴリ別の現在選択と数量を管理する機能はない。

## Desired Outcome

ユーザーがプロジェクト内の候補から現在の構成を選び、カテゴリごとの単一・複数選択ルールと同一商品の数量を正しく管理できる。

## Approach

プロジェクトに現在構成の選択状態を持たせ、候補IDへの参照として保存する。カテゴリ定義に選択方式を集約し、候補のカテゴリ変更・削除時にも参照整合性を保つ管理画面を提供する。

## Scope

- **In**: カテゴリ別候補表示、単一選択、複数商品の選択、同一商品の数量、選択解除、未分類の選択禁止、候補変更・削除時の整合性、現在構成の永続化。
- **Out**: 複数構成案、プロジェクト複製、候補比較、自動構成生成、互換性ルールと結果表示。

## Boundary Candidates

- カテゴリごとの選択数ポリシー
- 現在構成の参照モデル
- 候補ライフサイクルとの参照整合性

## Out of Boundary

- 候補パーツ自体の詳細編集
- 選択内容の互換性評価
- 購入状態やプロジェクト状態の管理

## Upstream / Downstream

- **Upstream**: local-data-foundation、project-candidate-management。
- **Downstream**: compatibility-checking、backup-restore。

## Existing Spec Touchpoints

- **Extends**: なし。
- **Adjacent**: project-candidate-managementが候補の所有者であり、本specは選択参照と数量だけを所有する。

## Constraints

CPU、CPUクーラー、マザーボード、電源、ケースは単一選択を基本とする。メモリ、GPU、ストレージ、ケースファン、拡張カード、その他は複数選択と数量を許可する。未分類は選択不可とする。

## Change Brief: v0.4.0

### Problem

現在構成が独自のproject選択を持つため、候補管理や互換性確認と作業対象がずれ得る。また、カテゴリボタンにはカテゴリ名しか表示されず、構成全体で採用中のパーツを確認するには各カテゴリを一つずつ開く必要がある。

### Current State

本specはproject別の候補・現在構成、カテゴリ選択、数量、参照整合性を管理する。画面stateはeligible candidateと現在構成itemsを保持しているが、共通project-contextへ追従せず、カテゴリ入口に選択パーツの要約を表示していない。

### Desired Outcome

現在構成はproject-contextの現在選択へ一貫して追従する。各カテゴリボタンには選択中パーツ名、複数商品と数量、または未選択が表示され、選択・置換・数量変更・解除・project切替の結果が即時反映される。

### Scope

- **In**: 独自project selectorの撤去、project-contextへの追従、カテゴリボタン上の単一選択要約、複数商品・数量の識別可能な要約、未選択表示、長い名称の安全な省略、即時更新、日英・キーボード・読み上げ対応、DOM/E2E回帰検証。
- **Out**: project-contextの所有・永続化、候補詳細編集、現在構成の選択規則変更、複数構成案、候補比較、v1.0.0の全面UI刷新。

### Boundary Impact

- **Extends**: `current-build-management`のproject入力portと、既存現在構成から導出するカテゴリ要約表示。
- **Preserves**: 単一・複数選択、数量、未分類禁止、参照修復、互換性結果を構成へ保存しない既存規則。
- **Adjacent**: `project-context`が現在選択を所有し、`project-candidate-management`が候補名・分類を所有し、compatibilityは構成の評価だけを所有する。

### Dependencies

- **Upstream**: `project-context`、application shellのcontext composition。
- **Downstream**: `compatibility-checking`の同一project評価、v1.0.0 UI刷新へ渡す構成俯瞰要件。

### Source

- Milestone v0.4.0 roadmap `current-build-management` update、GitHub Issues #28・#29。
