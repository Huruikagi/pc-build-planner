# Brief: project-context

## Problem

一つのPC構成を続けて検討する利用者は、候補管理、現在構成、互換性確認などの画面ごとに対象 project を選び直す必要がある。「いま何の構成を検討しているか」が画面間で一貫せず、切替忘れや別 project への操作につながる。取り込みから候補編集へ進む場合も、保存対象 project を明確に把握しにくい。

## Current State

候補管理と現在構成はそれぞれ project 一覧と `selectedProjectId` を所有し、互換性確認は composition 時に一覧先頭の project を選ぶ経路がある。application shell は feature の登録・表示を合成するが、現在 project という業務横断コンテキストは提供していない。project CRUD、候補、現在構成、互換性の各機能自体は既存 spec と公開 API により分離されている。

## Desired Outcome

アプリ全体で「現在選択中の project」を一つだけ持ち、主要画面のどこからでも識別・切替できる。候補、現在構成、互換性、取り込み handoff は同じ選択へ追従し、画面移動や side panel の再オープン後も有効な選択を復元する。project 作成・削除・復元によって参照が変わる場合は決定的に修復し、未保存の編集を黙って破棄しない。

## Approach

専用の `project-context` 境界に、現在 project の snapshot、選択要求、購読、project 一覧更新後の再検証、無効参照の決定的 fallback を持つ state/service と consumer 向け read-only port を設ける。選択 ID は canonical domain root の一部にせず、検証済みの UI preference / state snapshot として保存し、必ず現行 project 一覧に対して再検証してから公開する。

application shell は共通 selector の常設表示と composition を担当するが、project CRUD や候補・構成の意味を所有しない。project CRUD は `project-candidate-management` に残す。各 feature は独自 selector を廃止して context port を利用し、切替前に未保存編集の有無を返せる guard 契約を通じて、利用者の確認または取消を可能にする。

## Scope

- **In**: 現在 project の単一状態、snapshot・subscribe・select・refresh 契約、side panel 再オープン後の復元、存在しない ID の拒否、project 0件・作成・改名・削除・backup復元後の決定的遷移、常設の共通 selector、候補管理・現在構成・互換性・取り込み handoff の追従、独自 selector の撤去、未保存編集の切替 guard、日本語・英語、キーボード・読み上げ対応。
- **Out**: 独立した project 管理画面、project CRUD の業務規則、多数 project の検索・並べ替え・アーカイブ・フォルダ分け、複数 project の同時表示・比較、画面ごとの一時的な別 project、候補・現在構成・互換性の業務ロジック、v1.0.0 の UI 全面刷新。

## Boundary Candidates

- 現在 project ID、検証済み snapshot、購読、選択 transaction、fallback を所有する context state/service。
- feature が shell 具体実装へ依存せず現在 project を読むための consumer port。
- project 切替時に feature-owned draft の存在を申告し、確認・取消を調停する switch guard。
- application shell が所有する共通 selector 表示と composition adapter。

## Out of Boundary

- project-context が project の作成・改名・削除を直接実装すること。
- application shell 内部 state を他 feature が deep import すること。
- 現在 project ID を canonical project aggregate や backup exchange format へ追加すること。
- project 切替時に feature-owned draft の内容を context が解釈、保存、破棄すること。

## Upstream / Downstream

- **Upstream**: `runtime-schema-validation` の検証 primitive、local-data-foundation の検証済み project query、`project-candidate-management` の project CRUD 成功結果、application shell の composition・mount lifecycle、独立 UI preference storage。
- **Downstream**: 候補管理、現在構成、互換性確認、商品取り込みからの候補編集 handoff、#28 の現在構成要約表示、v1.0.0 UI 全面刷新の navigation / workspace 設計。

## Existing Spec Touchpoints

- **Extends**: `application-shell` の常設共通面と composition、`project-candidate-management` の CRUD・pre-edit、`current-build-management` と `compatibility-checking` の project 選択、商品取り込み handoff の保存対象表示。
- **Adjacent**: `local-data-foundation` の project/query と原子的 domain mutation、`backup-restore` 後の refresh、`ui-message-catalog` / `ui-internationalization` の日英表示。domain root の参照整合性と UI 選択の fallback を混同しない。

## Constraints

既存の feature-first、`public.ts` / `worker-public.ts` / `feature-contribution.ts`、application shell 単一 composition owner、React mount/unmount 規約を維持する。選択状態は検証前の storage 値を公開せず、project 一覧との整合確認後にだけ利用する。切替は同時に一つだけを確定し、競合や遅延通知で古い選択へ後退しない。全表示は日本語・英語、キーボード操作、読み上げラベルへ対応し、架空 fixture による unit・contract・DOM・Playwright E2E で検証可能にする。
