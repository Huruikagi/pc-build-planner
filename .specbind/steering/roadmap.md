---
type: SpecBind Roadmap
milestone_id: 01a07399-7949-7dd2-82df-a537e736301a
baseline_revision: c092c64cb0983abf0be75eae2c3eeacb3285a9b0
target_release: v1.1.0
work_items:
  new_specs:
  - spec: site-extraction-authoring
    summary: 規約確認ポリシーを含むサイト固有抽出の生成・検証・登録・再生成Skill
  spec_updates:
  - spec: page-capture
    summary: Intel Core Ultra・AMD Zen 5デスクトップCPUのメーカー固有抽出
    depends_on:
    - spec: site-extraction-authoring
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

GitHub Milestone #8「v1.1.0」の要求として、メーカーサイト固有の抽出と、その追加・再生成を反復可能にする開発用Skillを一緒に届ける。既存の抽出規約ポリシーはソースリセット時に削除されているため、その策定も今回の開発用Skillの責務へ含める。

## 望む結果

<!-- specbind:instruction maintain
マイルストーン全体が完了したとき、利用者またはプロジェクトに成立している結果を記載する。
個々のwork itemの完了条件を列挙しない。
-->

メーカーの商品ページから候補情報を補完でき、サイト改修時も、可否判断を含む一貫した手順で抽出ロジックを保守できる。

## アプローチと分解判断

<!-- specbind:instruction maintain
依頼を複数のSpecまたはDirect work itemへ分けた境界と、その分解で一緒に届ける理由を記載する。
分解に追加説明が不要な単一work itemの場合はこの節を削除する。
-->

既存のpage-captureは利用者起点のページ取得、入力検証、未確認結果の引き渡しを所有するため、製品のサイト固有抽出もこの境界を更新する。開発用Skillの規約確認・生成・検証・登録・再生成は独立した継続責務としてsite-extraction-authoringに分ける。Steeringが定めるCapture境界、実拡張E2E、ローカル完結性を維持する。Issueの旧ファイル名や構造は実装指定として固定せず、現行の所有境界に合わせてDesignで具体化する。

## スコープの境界

<!-- specbind:instruction maintain
このdeliveryに含めるものと、隣接するが含めないものをマイルストーン全体の粒度で記載する。
各Spec内の詳細な責任境界はRequirementsに置く。
-->

初回サンプルはIntel Core UltraとAMD Zen 5世代のコンシューマー向けデスクトップCPU。基本の取得項目は商品名、メーカー、CPU分類、ソケットとし、ページに明記されない値は推測で埋めない。具体的なSKUと代表ページはRequirementsで選定する。サーバー・モバイル向け製品や全メーカーへの対応は初回の対象に含めない。汎用抽出へのフォールバックと取得元表示を含める。価格やその他属性への拡大は今回の承認範囲に含めない。

## 依存関係と順序の理由

<!-- specbind:instruction maintain
Front Matterが示す依存関係や順序のうち、自明でない理由、共有する前提、並行化できない境界を
説明する。依存がなく順序にも判断がない場合はこの節を削除する。
-->

site-extraction-authoringの生成Skillを用いてpage-captureの対象サイトを追加する順序とする。生成側は製品側の抽出境界と整合させ、製品実行時の依存として開発用Skillを持ち込まない。

## 制約と未解決事項

<!-- specbind:instruction maintain
マイルストーン全体に効く期限、外部条件、未確定の判断と、それが次の作業を止める条件を記載する。
合致する制約や未解決事項がない場合はこの節を削除する。
-->

規約確認ポリシーは既存のIssue #14の成果物を前提にせず、生成の許可・停止条件と判断不能時の扱いを新規SpecのRequirementsで定め、確認手順・判断記録・生成工程への組み込み方をDesignで具体化する。対象ページや規約判断は後続の計画で確定し、現時点で特定サイトへの生成許可を意味しない。v1.1.0は出典Milestoneの名称であり、リリースバージョンの機械的なバインドはReleaseが所有する。

## Source Collectionと振り分け

<!-- specbind:instruction maintain
Discoveryが明示的なSource Collectionを使った場合、provider、プロジェクト相対の
collection locator、全項目のdisposition、関係するwork item、振り分け理由を保つ。
コレクションが無い場合はこの節を省略する。
-->

Provider: GitHub Milestone。Repository: Huruikagi/pc-build-planner（ID: 1303939675、https://github.com/Huruikagi/pc-build-planner）。
Collection: https://github.com/Huruikagi/pc-build-planner/milestone/8 、number=8、title=v1.1.0、state=open、observed updated_at=2026-09-05T21:50:17Z。
全1ページ、Issue 2件（open 2 / closed 0）を取得。非Issue、重複、除外、未取得、範囲未解決の項目はない。

| Source Item | 観測状態・更新日時 | disposition・対応先・理由 |
| --- | --- | --- |
| [#15 開発ツール: ページ指定でサイト固有抽出ロジックを生成する  スキルを作る](https://github.com/Huruikagi/pc-build-planner/issues/15) | open / 2026-09-05T21:50:13Z | included / site-extraction-authoring / 規約確認、構造解析、生成、フィクスチャ・テスト、登録、再生成を開発用Skillとして維持する |
| [#16 メーカーサイト向けのサイト固有抽出ロジック（高優先度ドメイン別 collector）](https://github.com/Huruikagi/pc-build-planner/issues/16) | open / 2026-09-05T21:50:17Z | included / page-capture / メーカー固有抽出、汎用へのフォールバック、取得元表示を既存の取得責務へ追加する |

2026-09-06の会話で、ポリシーを新規Spec内で策定すること、上記CPU世代と取得項目、2つの作業と依存関係を提案し、利用者が「OK」と承認した。Issue本文中の#8、#11、#14は関連情報であり、今回取得したSource Collectionや追加作業として扱わない。以後はBriefに捕捉した要求を使用し、GitHubの後日編集で承認済み範囲を再解釈しない。
