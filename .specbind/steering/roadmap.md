---
type: SpecBind Roadmap
milestone_id: 01a062dc-3cf1-75b0-8894-8d58ae4d418b
baseline_revision: 7c5435306482a6df95045ebd5b3308d4b2e41f9b
baseline_version: 0.5.0
target_release: null
work_items:
  reverse_specs:
  - spec: local-data-storage
    summary: 端末内の単一データルートを保存・読出し・最低限検証する。
  - spec: project-candidate-management
    summary: プロジェクトと候補パーツ、取得元、重複候補と統合を管理する。
    depends_on:
    - spec: local-data-storage
  - spec: page-capture
    summary: 利用者操作によるページ情報の抽出、検証、正規化、一時状態と候補下書きへの引渡しを管理する。
    depends_on:
    - spec: project-candidate-management
  - spec: current-build-management
    summary: プロジェクトごとの現在構成、候補の採用と解除、数量、価格合計を管理する。
    depends_on:
    - spec: project-candidate-management
  - spec: basic-compatibility
    summary: 確認済み属性だけを使う基本互換性判定と、互換・不適合・情報不足の根拠表示を管理する。
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

固定リビジョンに存在するリポジトリ全体のコードとテストを証拠として、既存製品バージョン0.5.0の維持すべき振る舞いと技術境界を初回Specとして確立する。既存実装をそのまま正とせず、Steeringと利用者が確認した責任境界を永続的な契約へ移す。

## 望む結果

<!-- specbind:instruction maintain
このマイルストーン全体が完了したとき、利用者またはプロジェクトに成立している結果を記載する。
個々のwork itemの完了条件を列挙しない。
-->

製品の現在の能力が、端末内保存、プロジェクトと候補の管理、ページ取り込み、現在構成、基本互換性という5つの責任として説明でき、後続変更が実装ではなくRequirements、Design、Contractを基準に判断できる状態にする。

## アプローチと分解判断

<!-- specbind:instruction maintain
依頼を複数のSpecまたはDirect work itemへ分けた境界と、その分解で一緒に届ける理由を記載する。
分解に追加説明が不要な単一work itemの場合はこの節を削除する。
-->

端末内の保存境界、利用者が編集する検討情報、未信頼なWebページとの境界、採用済み構成、構成から導く判定は、それぞれ変更理由と失敗の扱いが異なるため独立したSpecとする。App shell、i18n、UI共通部、ビルドと実拡張E2Eは複数Specを組み立てて検証する横断責任として扱い、独立した製品Specにはしない。

`local-data-storage`は「保存できればいい」を基準とする最小責任に限定する。単一ルートの保存、読出し、最低限の検証、失敗通知だけを維持し、バックアップ、復元、同期、複雑なトランザクション、参照修復、先回りした抽象化を所有しない。

## スコープの境界

<!-- specbind:instruction maintain
このdeliveryに含めるものと、隣接するが含めないものをマイルストーン全体の粒度で記載する。
各Spec内の詳細な責任境界はRequirementsに置く。
-->

リポジトリ全体の現行製品コード、Chrome Manifest V3の実行入口、ローカルデータ形状、画面を通した利用者操作、実拡張E2Eを証拠に含める。凍結済みの過去文書は履歴的な補助資料に限り、現在の仕様権威にしない。Tasks、実装変更、依存関係変更、設定変更、Steering変更、リリース、タグ、公開は行わない。

## 依存関係と順序の理由

<!-- specbind:instruction maintain
Front Matterが示す依存関係や順序のうち、自明でない理由、共有する前提、並行化できない境界を
説明する。依存がなく順序にも判断がない場合はこの節を削除する。
-->

候補管理は端末内保存を利用する。ページ取り込みは候補下書きを候補管理へ渡し、現在構成は候補を採用する。基本互換性は現在構成に採用された候補の確認済み属性だけを入力にする。このため、Designは保存、候補管理、ページ取り込みと現在構成、基本互換性の順で依存境界を確立する。

## 制約と未解決事項

<!-- specbind:instruction maintain
マイルストーン全体に効く期限、外部条件、未確定の判断と、それが次の作業を止める条件を記載する。
合致する制約や未解決事項がない場合はこの節を削除する。
-->

証拠の固定リビジョンは`7c5435306482a6df95045ebd5b3308d4b2e41f9b`とする。実装、テスト、依存関係、設定、Steeringが変わった場合は結果を再基準化せず、このリバース確立を停止する。境界を止める未解決事項はない。疑わしい実装上の不整合は確定バグや現在の作業スコープとせず、保留指摘へ記録する。
