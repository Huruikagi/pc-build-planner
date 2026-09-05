---
type: SpecBind Roadmap
milestone_id: 01a06f90-3083-7ae0-aa4d-5a8377aca49d
baseline_revision: bb8dc73f92bb48a861544b0617639308944fc09c
baseline_version: 1.0.0
target_release: null
work_items:
  reverse_specs:
  - spec: local-data-storage
    summary: 端末内への保存と再読込を担う最小の永続化境界を確立する。
  - spec: project-candidate-management
    summary: プロジェクトと不完全な候補、取得元、重複統合の管理境界を確立する。
    depends_on:
    - spec: local-data-storage
  - spec: page-capture
    summary: 利用者起点のページ取り込みと未信頼入力境界を確立する。
    depends_on:
    - spec: project-candidate-management
  - spec: current-build-management
    summary: 候補から現在構成と数量を管理する境界を確立する。
    depends_on:
    - spec: project-candidate-management
  - spec: basic-compatibility
    summary: 確認済み属性だけによる基本互換性判定境界を確立する。
    depends_on:
    - spec: current-build-management
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

<!-- specbind:instruction maintain
このマイルストーンを1つのdeliveryとして扱う理由と、複数のwork itemに共通する要求を記載する。
各SpecのRequirementsやFront Matterのwork item一覧を複製しない。
-->

既存バージョン1.0.0を表す固定リビジョン`bb8dc73f92bb48a861544b0617639308944fc09c`のコード、E2E、製品文書を証拠として、リポジトリ全体の維持意図をSpecとして確立する。コードとテストは証拠であり、自動的な仕様権威にはしない。

## 望む結果

<!-- specbind:instruction maintain
マイルストーン全体が完了したとき、利用者またはプロジェクトに成立している結果を記載する。
個々のwork itemの完了条件を列挙しない。
-->

既存製品の責任境界、利用者に対する維持要件、構造上の継ぎ目、受け入れ証拠が、Requirements、Design、Contractとして自己完結している。これは既存版のベースライン確立であり、実装変更や新しいリリースではない。

## アプローチと分解判断

<!-- specbind:instruction maintain
依頼を複数のSpecまたはDirect work itemへ分けた境界と、その分解で一緒に届ける理由を記載する。
分解に追加説明が不要な単一work itemの場合はこの節を削除する。
-->

責任は、共有する端末内保存、プロジェクトと候補の管理、ページからの取り込み、現在構成、基本互換性判定の持続的な境界に分ける。UI、Chrome実行環境、国際化、ビルド、E2Eは複数境界を横断するDesignまたは検証制約であり、独立した製品責任にはしない。

端末内保存が保証するのは保存と再読込までとする。破損・非対応データは破棄して初期状態へ戻してよく、原子的置換、書き込み直列化、移行、復旧、バックアップ、同期は維持要件にしない。候補管理は、商品名が取得できなくてもURLなど取得できた情報だけで一旦保存し、後から補正できることを維持する。

## スコープの境界

<!-- specbind:instruction maintain
このdeliveryに含めるものと、隣接するが含めないものをマイルストーン全体の粒度で記載する。
各Spec内の詳細な責任境界はRequirementsに置く。
-->

Chrome Manifest V3拡張として現在提供している製品挙動、永続データ、実行境界、利用者向けUI、実拡張E2Eを対象にする。商品カタログ、価格・在庫監視、推薦、高度な互換性判定、バックエンド、アカウント、同期、外部AI、他ブラウザー、Chrome Web Store公開、バックアップ、復元は含めない。旧版要件、凍結済み画面・デザイン資料、開発・リリース・SpecBind運用自体は現在の製品契約にしない。

## 依存関係と順序の理由

<!-- specbind:instruction maintain
Front Matterが示す依存関係や順序のうち、自明でない理由、共有する前提、並行化できない境界を
説明する。依存がなく順序にも判断がない場合はこの節を削除する。
-->

候補管理は共有保存境界を利用する。ページ取り込みと現在構成は候補管理へ結果または参照を渡す。基本互換性判定は現在構成に採用された候補の確認済み属性だけを読む。物理的な共有ファイルや一時session storageはDesign上の継ぎ目であり、追加の意味上の依存にはしない。

## 制約と未解決事項

<!-- specbind:instruction maintain
マイルストーン全体に効く期限、外部条件、未確定の判断と、それが次の作業を止める条件を記載する。
合致する制約や未解決事項がない場合はこの節を削除する。
-->

固定リビジョンを変更せず、Tasks、実装修正、依存関係変更、設定変更、Steering変更、リリースを行わない。現在実装と維持意図の差は保留指摘として記録し、逆確立のスコープへ混ぜない。意味を止める未解決事項はない。
