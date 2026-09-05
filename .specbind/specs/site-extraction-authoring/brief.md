---
type: SpecBind Brief
---

# `site-extraction-authoring` のブリーフ

<!-- specbind:instruction maintain
依頼された変更を依頼者自身の言葉で捉え、短く保つ。同じ変更に関する追加要望は、
新しい文書を作らずこのブリーフに統合する。
-->

<!-- specbind:instruction consume
これは依頼の文脈であって権威ある scope ではない。scope は Requirements が所有し、
この文書は fingerprint の対象外である。
-->

## 課題

<!-- specbind:instruction maintain
依頼者が解決したい問題、現在困っていること、または得たい機会を依頼時点の言葉で記載する。
解決策や実装方法を先回りして混ぜない。
-->

サイト固有抽出はサイト改修に伴う保守が重い。対象ページを指定して追加・再生成できる反復可能なエージェントSkillを開発ツールとして持ちたい。

## 望む結果

<!-- specbind:instruction maintain
この変更が成功したと依頼者が判断できる結果を記載する。Requirementsの受け入れ基準へ
展開する前の依頼文脈であり、ここで網羅的な振る舞いの契約を作らない。
-->

規約確認、ページ構造解析、既存抽出境界に沿った生成、保存HTMLフィクスチャとテスト、登録までを扱えるようにする。生成できない場合は停止し、判断を記録する。既存の汎用抽出を壊さず、サイトごとに保守できる生成物を得る。

## 依頼時点の境界

<!-- specbind:instruction maintain
依頼者が明示した含むもの、含まないもの、変更してよい範囲を記載する。DiscoveryやRequirementsで
確定したscopeを逆輸入しない。望む結果から明らかで、追加の境界がない場合はこの節を削除する。
-->

規約確認ポリシーはソースリセットで消えているため、本Specと一緒に策定する。許可・停止条件と判断不能時の扱いはRequirements、確認手順・判断記録・工程への組み込みはDesignで定める。製品の実行時機能はpage-captureが所有し、本Specは開発用Skillの継続責務を所有する。初回の適用例はIntel Core UltraとAMD Zen 5世代のコンシューマー向けデスクトップCPUで、商品名・メーカー・CPU分類・ソケットを基本とする。

## 前提と依存

<!-- specbind:instruction maintain
依頼時点で示された前提、他の変更、外部判断、期限など、この依頼の扱いに影響するものを記載する。
合致する前提や依存がない場合はこの節を削除する。
-->

Issueが前提に挙げる既存ポリシーの存在には依存しない。本Skillを用いてpage-captureへ対象サイトを追加する。SteeringのCapture境界と実拡張E2Eを維持し、開発用生成手順を製品実行時へ持ち込まない。Issue内の旧パスやcollector/rankerの名称は依頼時の案であり、現行契約との接続はDesignで定める。

## 入力資料

<!-- specbind:instruction maintain
依頼者が示した資料、またはDiscoveryが明示的なSource Collectionを使った場合、このSpecに
関係する正確なURLかプロジェクト相対pathと、各資料が関係する理由だけを保つ。コレクション
全体の振り分けとSpec横断の対応はRoadmapに保つ。入力資料がない場合はこの節を削除する。
-->

[Issue #15「開発ツール: ページ指定でサイト固有抽出ロジックを生成する  スキルを作る」](https://github.com/Huruikagi/pc-build-planner/issues/15)。Huruikagi/pc-build-planner（repository ID: 1303939675）、Milestone #8「v1.1.0」、観測状態open、updated_at=2026-09-05T21:50:13Z。生成・再生成の工程、規約確認、フィクスチャと回帰検証、生成物の登録という依頼の根拠。

2026-09-06の会話で、削除済みポリシーを本Specに含め、許可・停止条件をRequirementsで、手順をDesignで定める案と作業範囲全体が承認された。以後の計画はこの取得済み文脈を使い、GitHubを再取得して承認を再解釈しない。
