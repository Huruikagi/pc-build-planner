# Brief: local-data-foundation

## Problem

後続機能が共有できる、安全で移行可能なChrome拡張の実行基盤とローカルデータ契約がまだない。基盤が曖昧なままでは、各機能が異なるモデルや保存方法を持ち、データ破損や将来の移行困難を招く。

## Current State

要求文書と最小限のNode.js設定だけがあり、Chrome拡張のmanifest、実装、データモデル、保存層は存在しない。

## Desired Outcome

Chrome 116以降のManifest V3拡張として読み込め、プロジェクト、候補パーツ、現在構成、正規化属性、出典情報を一貫したバージョン付きモデルで安全に保存・取得できる。

## Approach

拡張の骨格と共有ドメイン型を定義し、`chrome.storage.local` を隠蔽する検証付きリポジトリを提供する。ストレージを信頼済みコンテキストに限定し、容量確認、エラー処理、スキーマバージョンと移行境界を最初から設ける。

## Scope

- **In**: MV3 manifestと拡張骨格、共有ドメインモデル、IDと日時の規約、バージョン付き保存スキーマ、検証付きCRUD基盤、容量監視、ストレージアクセス制限、架空データによる基盤テスト。
- **Out**: 個別管理画面、商品ページ抽出、構成選択、互換性ルール、JSONファイル入出力、サイト別アダプター。

## Boundary Candidates

- 拡張ランタイムと権限設定
- ドメインモデルと永続化リポジトリ
- 入力検証とスキーマ移行

## Out of Boundary

- ページDOMや実サイト固有構造の解釈
- ユーザー向けの業務操作UI
- `unlimitedStorage` を前提とした無制限保存

## Upstream / Downstream

- **Upstream**: `docs/requirements.md`、Chrome Manifest V3とStorage APIの制約。
- **Downstream**: project-candidate-management、product-page-capture、current-build-management、compatibility-checking、backup-restore。

## Existing Spec Touchpoints

- **Extends**: なし。
- **Adjacent**: すべての後続specがこのデータ契約を利用するが、各機能固有のルールは所有しない。

## Constraints

Chrome 116以降、既定10MB上限、生HTML・画像の保存禁止、service workerメモリへの永続状態依存禁止、content scriptからのストレージ直接アクセス禁止、MV3 CSP準拠。
