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
