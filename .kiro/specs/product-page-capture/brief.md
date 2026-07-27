# Brief: product-page-capture

> **v0.3.0移行注記（未承認）**: 本briefは実装済みv0.1.0の責務を記録している。`product-capture-transient-migration` が承認された時点で、要件4の簡易確認・補正と要件5のproject選択・保存はcandidate-managementの編集面へ移り、captureは抽出実行と取得根拠の生成だけを所有する。正式な要件改訂はroadmapのExisting Spec Updatesで行う。

## Problem

閲覧中の商品ページからカテゴリ、メーカー、商品名、型番、URL、価格、主要スペックを手作業で転記する負担が大きい。

## Current State

商品候補の保存先となるプロジェクトモデルは計画されているが、ページを読み取り、取得結果を確認・補正して保存する導線はない。

## Desired Outcome

ユーザーが明示的に拡張を実行すると、現在のページから取得可能な情報がローカルで抽出され、サイドパネルの簡易表示または詳細編集を経て、情報が不足したままでも選択したプロジェクトへ保存できる。

## Approach

JSON-LD、OGP等のメタ情報、タイトル・パンくず、表・定義リスト、共通項目名辞書の順で汎用抽出する。ページ由来の値を未信頼入力として正規化・検証し、自動抽出値とユーザー確認値を区別して候補作成契約へ渡す。

## Scope

- **In**: action起点の現在タブ取得、汎用抽出器、抽出元表記、カテゴリ・主要属性の候補化、サイドパネル簡易表示、詳細編集への遷移、プロジェクト選択、未分類保存、権限失効・制限ページ・抽出失敗の扱い。
- **Out**: 常時監視、一括取得、サーバーアクセス、AI、価格履歴、商品画像、実サイトfixture、価格.com専用またはその他サイト別アダプター。

## Boundary Candidates

- ユーザー操作と一時タブ権限
- ページ内の汎用情報抽出
- 抽出結果の確認・補正と候補登録
- 将来のサイト別アダプター差し替え口

## Out of Boundary

- 登録後候補の一覧管理
- 現在構成と互換性判定
- 対象サイトへの正式対応や取得率保証

## Upstream / Downstream

- **Upstream**: local-data-foundation、project-candidate-management。
- **Downstream**: 登録された候補を利用するcurrent-build-management。

## Existing Spec Touchpoints

- **Extends**: なし。
- **Adjacent**: project-candidate-managementの候補作成・編集契約を再利用し、保存ロジックを重複させない。

## Constraints

`activeTab` と `scripting` を基本とし、取り込み操作を権限付与につながる明確なユーザージェスチャーへ結び付ける。DOM処理は注入側で行い、service workerにDOMや長寿命状態を要求しない。リモートコードを使用しない。
