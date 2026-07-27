# Brief: transient-feature-surface

出典: GitHub issue [#6](https://github.com/Huruikagi/pc-build-planner/issues/6)（milestone v0.3.0）

## Problem

application shell は「登録済みfeatureは常設ナビゲーションに並ぶ」という単一モデルしか持たない。そのため、`activeTab` を与えるジェスチャーと同じ寿命でだけ提示すべき操作面を表現できず、権限失効後も失敗する操作が残る。

## Current State

`action.onClicked` はside panelを開くだけで、対象タブとジェスチャー世代をpanelへ確実に届ける契約がない。shellには常設ナビへ載らない登録区分、対象タブの遷移・閉鎖に連動した終了、直前の常設featureへ戻る寿命管理もない。

## Desired Outcome

shellが、常設ナビへ並ばず、明示的な起動要求でのみ主表示領域へ現れ、対象タブの失効とともに終了する一過性featureを型付き契約として提供する。Chrome API依存はruntime adapterへ閉じ、登録・配送・寿命・戻り先を決定的に検証できる。

## Approach

`presentation: "persistent" | "transient"` を登録契約へ追加し、`TransientSurfaceController` が一過性面の世代・対象タブ・戻り先を所有する。service workerからpanelへの起動要求とタブ寿命イベントはport経由で注入し、最初の利用者の業務UIは下流spec `product-capture-transient-migration` が所有する。

## Scope

- **In**: 一過性feature登録、常設ナビからの除外、ジェスチャー起動要求、対象タブ固定、遷移・閉鎖・常設選択による終了、戻り先、引き渡し用`conclude`契約、runtime adapter、shell非回帰。
- **Out**: product-captureの状態・UI変更、抽出結果draft、候補管理のpre-edit検証、抽出ロジック、コンテキストメニュー項目の実登録。

## Boundary Candidates

- application shell所有の登録・主表示・寿命契約
- runtime所有のChromeイベント・起動要求配送adapter
- 下流featureが利用する`ActivationId`、`TransientActivationRequest`、`conclude`公開契約

## Out of Boundary

- 商品取り込みUIと抽出状態の移行
- 候補の確認・補正・保存
- 保存データschemaと複数ソース化
- 設定画面その他のナビゲーション変更

## Upstream / Downstream

- **Upstream**: `application-shell`、Manifest V3 runtime、`ui-message-catalog`
- **Downstream**: `product-capture-transient-migration`、`source-price-refresh`、`settings-screen`

## Existing Spec Touchpoints

- **Extends**: `application-shell` の登録・ナビゲーション・typed activation・side panel host契約
- **Adjacent**: `product-page-capture`、`ui-message-catalog`、`settings-screen`

## Constraints

Chrome 116以降、Manifest V3、既存4権限を維持する。workerのメモリや寿命を唯一の根拠にせず、Chrome APIは`src/runtime/`へ閉じる。feature外からは`public.ts`だけを利用し、実サイト由来fixtureを追加しない。
