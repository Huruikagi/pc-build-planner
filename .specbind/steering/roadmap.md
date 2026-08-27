---
type: SpecBind Roadmap
milestone_id: 01a04552-9dcd-7bd2-9ced-4c69991fec5c
baseline_revision: 5662e8caf45654c04d13712866d00b878225d1b1
target_release: null
work_items:
  new_specs:
  - spec: local-data-storage
    summary: 単一ローカルデータ root を最小限かつ安全に保存する
  - spec: project-management
    summary: プロジェクトの作成、選択、改名、削除を管理する
    depends_on:
    - spec: local-data-storage
  - spec: candidate-parts
    summary: プロジェクト内の候補パーツ、取得元、確認済み値、重複統合を管理する
    depends_on:
    - spec: local-data-storage
    - spec: project-management
  - spec: page-product-capture
    summary: 閲覧ページから商品情報を安全かつ説明可能に取り込む
    depends_on:
    - spec: candidate-parts
  - spec: current-build
    summary: 候補パーツから現在構成を組み立てて管理する
    depends_on:
    - spec: local-data-storage
    - spec: project-management
    - spec: candidate-parts
  - spec: compatibility-checking
    summary: 現在構成の確認済み属性から基本的な互換性を評価する
    depends_on:
    - spec: candidate-parts
    - spec: current-build
---
# ロードマップ

<!-- specbind:instruction maintain
現在有効なマイルストーン全体の要求と理由を保つ。scopeや順序が変わった場合は説明をその場で
更新する。履歴はGitとリリース済みRoadmapアーカイブが所有する。
-->

<!-- specbind:instruction consume
work itemと依存関係についてはFront Matterが権威を持つ。本文は要求、境界、分解、判断理由を
説明する。
-->

## マイルストーン全体の変更要求

既存の PC Build Planner リポジトリ全体を、確認済みの実装証拠と Steering を基準に6つの
永続的な責務へ採用し、通常の SpecBind ライフサイクルへ接続する。

## 望む結果

ページから取得根拠を保った候補を取り込み、ローカルのプロジェクト内で候補と現在構成を管理し、
確認済み情報だけから基本的な互換性を説明できる現在のプロダクト責務を、独立した Spec として
明文化できる状態にする。

## アプローチと分解判断

責務を、ローカル保存、プロジェクト、候補パーツ、ページ取り込み、現在構成、互換性確認へ分ける。
実行境界やディレクトリの大きさではなく、長期的な所有責務と依存方向を境界にする。

local-data-storage は保存のための最小基盤として扱う。「保存できればよい」を要求の上限とし、
実需要のないバックアップ、復旧、複雑な transaction 層、先回りした抽象化へ広げない。

## スコープの境界

アカウント、バックエンド、複数端末同期、常時監視、サイト固有スクレイピング、AI 推測、
網羅的商品マスター、電力や物理干渉まで含む互換性判定は対象外とする。

salvage 配下の旧実装、履歴資料、ビルド・開発ハーネスなどの支援コードは実装証拠または
設計制約として参照できるが、それ自体を独立した製品責務にはしない。

## 依存関係と順序の理由

保存形式がプロジェクト、候補、現在構成の永続的な形を支え、プロジェクトが候補の所属先になる。
ページ取り込みは候補編集への引き渡しに依存する。現在構成は候補の採用を扱い、互換性確認は
現在構成と候補の確認済み属性を入力にするため、この順序で依存する。

## 制約と未解決事項

既存コードと E2E は観測された振る舞いの証拠であり、意図の権威とはしない。採用の深掘り工程で
各観測を requirement、design、bug、historical constraint、implementation detail、unknown の
いずれかへ利用者と照合する。
