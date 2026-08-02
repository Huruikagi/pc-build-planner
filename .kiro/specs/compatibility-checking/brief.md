# Brief: compatibility-checking

## Problem

現在の構成を作っても、基本規格の不一致や必要情報の不足を手作業で確認する必要があり、見落としや断定し過ぎが起こり得る。

## Current State

判定対象と結果区分は要求文書に定義されているが、確認済み属性を使う決定的な判定エンジンと結果UIはない。

## Desired Outcome

現在の構成に選択されたパーツだけを対象に、5種類の基本互換性を評価し、「あり」「なし」「注意事項あり」「情報不足で判定不能」を根拠とともに表示できる。

## Approach

ユーザーが確認した正規化属性だけを入力とする副作用のないルールエンジンを構築する。各ルールは適用条件、必要属性、結果、説明を返し、欠損値を非互換と誤認せず判定不能として扱う。

## Scope

- **In**: CPUとマザーボードのソケット、マザーボードとメモリのDDR規格、CPUクーラーとCPUソケット、ケースとマザーボードフォームファクタ、ケースと電源フォームファクタの判定、4区分の結果、根拠表示、複数選択時の対象展開。
- **Out**: GPU長、クーラー高、電源容量、コネクター、M.2、BIOS、性能ボトルネック、候補全組み合わせの総当たり、自動修正。

## Boundary Candidates

- 正規化規格値と互換性ルール
- 現在構成から判定対象への展開
- 判定結果と根拠の表示モデル

## Out of Boundary

- ページ表記から正規化値を抽出する処理
- 候補や現在構成の編集
- 不確実な条件を互換性あり・なしと断定すること

## Upstream / Downstream

- **Upstream**: current-build-management、project-candidate-managementで確認された正規化属性。
- **Downstream**: 管理画面の構成確認、および将来の高度な互換性ルール。

## Existing Spec Touchpoints

- **Extends**: なし。
- **Adjacent**: current-build-managementは入力となる選択状態を所有し、本specはその評価だけを所有する。

## Constraints

自動抽出の未確認値だけを根拠に断定しない。必要属性が欠ける場合は判定不能とし、ユーザーが次に補うべき情報を明確にする。

## Change Brief: v0.4.0

### Problem

互換性確認がアプリ共通の現在projectを参照せず、composition時の一覧先頭など独自の対象解決に依存すると、利用者が候補・現在構成で操作しているprojectと異なる構成を評価する危険がある。

### Current State

本specは現在構成と確認済み候補属性から互換性を評価するが、評価対象projectをcomposition時のone-shot resolverや一覧先頭fallbackで決める経路がある。project切替後に同じ選択へ追従するowner-local購読、null・unavailable状態、遅延評価抑止が定義されていない。

### Desired Outcome

互換性確認はowner-local adapterでproject-contextを購読し、検証済み現在選択を唯一の評価対象とする。project切替時は対象構成と結果を一貫して更新し、古い評価完了を表示しない。projectが存在しない、未選択、context unavailable、現在構成が空の場合は推測で別projectを選ばず、識別可能で再試行可能な状態を表示する。

### Scope

- **In**: owner-local project-context consumer adapter、one-shot resolver・一覧先頭fallbackの撤去、現在project切替への購読、stale評価結果の抑止、project 0件・未選択・context unavailable・構成なしの状態、retry、日英・アクセシビリティ・feature-owned contract/DOM/E2E。
- **Out**: project-context core、project selector・fallback・preference、application shellのproduction wiring、project CRUD、互換性ルールの追加・変更、自動修正、候補全組み合わせ評価。

### Boundary Impact

- **Extends**: `compatibility-checking`のcontext consumer adapter、評価入力解決、project切替時の結果generationとlifecycle。
- **Preserves**: 確認済み正規化属性だけを使う純粋rule、4区分、情報不足を非互換としない判断、候補・構成を変更しないread-only性。
- **Adjacent**: `project-context`が現在選択を、`current-build-management`が選択パーツ・数量とcontext追従を、`project-candidate-management`が候補属性を、application shellがport注入を所有する。

### Dependencies

- **Upstream**: `project-context` core contract、`current-build-management` updateの共通選択追従。
- **Downstream**: application shellのproduction wiring、v1.0.0 UI刷新へ渡す一貫したworkspace体験。

### Source

- Milestone v0.4.0 roadmap `compatibility-checking` update、GitHub Issue #29。
