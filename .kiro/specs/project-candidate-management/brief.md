# Brief: project-candidate-management

## Problem

ユーザーは複数サイトで見つけたパーツ候補をPC構成の検討単位ごとに整理したいが、現在はスプレッドシートへ手作業で転記している。

## Current State

プロジェクトと候補パーツの概念は要求文書に定義されているが、作成・編集・削除やカテゴリ別表示を行う管理機能はない。

## Desired Outcome

ユーザーがプロジェクトを管理し、欠損を許容する候補パーツをプロジェクトへ直接所属させ、カテゴリ別に確認・編集・削除できる。未分類の商品も後から補正して利用可能にできる。商品取り込みからproject未解決または空名の編集内容を受け取った場合も、保存可能な候補と混同せず常設画面へ保持し、project作成後または入力補正後に同じ編集を継続できる。

## Approach

管理画面にプロジェクトと候補パーツの垂直スライスを実装する。共通項目とカテゴリ別の正規化属性を分け、抽出元表記とユーザー確認値を保持したまま、カテゴリ変更や再編集を安全に行う。

## Scope

- **In**: プロジェクトCRUD、候補パーツCRUD、カテゴリ別一覧、未分類管理、共通項目とカテゴリ別互換性属性の詳細編集、価格と取得日時、欠損値、削除確認、project未解決・空名pre-editの受理とsession内保持、編集開始と保存時の検証段階分離。
- **Out**: ページからの自動抽出、現在構成への選択、互換性結果、共通パーツライブラリ、プロジェクト複製・ステータス、商品画像。

## Boundary Candidates

- プロジェクトのライフサイクル
- 候補パーツとカテゴリ分類
- 共通項目・正規化属性・元表記の編集
- 解決前pre-edit draft、project解決、保存可能なcanonical draftへの遷移

## Out of Boundary

- 候補を現在構成へ採用する選択ルール
- 抽出精度やサイト固有解析
- 候補の自動推薦と横断比較

## Upstream / Downstream

- **Upstream**: local-data-foundation。
- **Downstream**: product-page-capture、product-capture-transient-migration、current-build-management、candidate-source-bookmarks、duplicate-product-merge、backup-restore。

## Existing Spec Touchpoints

- **Extends**: なし。
- **Adjacent**: product-page-captureは候補作成契約を利用し、current-build-managementは候補参照契約を利用する。

## Constraints

商品は単一プロジェクトへ直接所属し、各項目は欠損可能とする。未分類は現在構成に利用できない。共通項目はカテゴリ変更時にも失わない。
