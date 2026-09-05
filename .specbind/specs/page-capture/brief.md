---
type: SpecBind Brief
---

# `page-capture` のブリーフ

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

メーカーの商品ページでは汎用の構造化データ抽出だけで商品情報やスペックを取りきれない。メーカー固有の情報を補完し、利用者が由来を確認しながら候補を検討できるようにしたい。

## 望む結果

<!-- specbind:instruction maintain
この変更が成功したと依頼者が判断できる結果を記載する。Requirementsの受け入れ基準へ
展開する前の依頼文脈であり、ここで網羅的な振る舞いの契約を作らない。
-->

対象メーカーにだけ適用する固有抽出を追加し、適切な固有値を優先しながら、取得できない場合や固有処理の破損時は汎用抽出へフォールバックする。固有抽出由来であることを表示し、サイトごとの保存HTMLフィクスチャと回帰検証によって保守できるようにする。

## 依頼時点の境界

<!-- specbind:instruction maintain
依頼者が明示した含むもの、含まないもの、変更してよい範囲を記載する。DiscoveryやRequirementsで
確定したscopeを逆輸入しない。望む結果から明らかで、追加の境界がない場合はこの節を削除する。
-->

初回サンプルはIntel Core UltraとAMD Zen 5世代のコンシューマー向けデスクトップCPU。基本の取得項目は商品名、メーカー、CPU分類、ソケットで、ページに明記されない値は推測で埋めない。具体的なSKUと代表ページはRequirementsで選定する。Issueが挙げる価格や他のスペック全般への拡大は今回の承認対象に含めない。

## 前提と依存

<!-- specbind:instruction maintain
依頼時点で示された前提、他の変更、外部判断、期限など、この依頼の扱いに影響するものを記載する。
合致する前提や依存がない場合はこの節を削除する。
-->

site-extraction-authoringで策定する規約確認ポリシーと生成Skillを用いて追加する。既存page-captureの利用者起点の取得、入力検証、未確認結果の引き渡しという所有責務を更新する。Steeringのローカル完結、利用者起点アクセス、未確認値と確認済み値の分離、実拡張E2Eを維持する。ドメイン照合の粒度、項目ごとの優先度、配置は現行契約を踏まえてDesignで定め、Issue内の旧アーキテクチャをそのまま採用しない。

## 入力資料

<!-- specbind:instruction maintain
依頼者が示した資料、またはDiscoveryが明示的なSource Collectionを使った場合、このSpecに
関係する正確なURLかプロジェクト相対pathと、各資料が関係する理由だけを保つ。コレクション
全体の振り分けとSpec横断の対応はRoadmapに保つ。入力資料がない場合はこの節を削除する。
-->

[Issue #16「メーカーサイト向けのサイト固有抽出ロジック（高優先度ドメイン別 collector）」](https://github.com/Huruikagi/pc-build-planner/issues/16)。Huruikagi/pc-build-planner（repository ID: 1303939675）、Milestone #8「v1.1.0」、観測状態open、updated_at=2026-09-05T21:50:17Z。メーカー固有抽出、汎用抽出へのフォールバック、取得元表示、サイト別フィクスチャと保守の依頼の根拠。

2026-09-06の会話で、利用者が初回CPU世代を指定し、基本取得項目、代表ページをRequirementsで選定すること、および作業範囲全体が承認された。既存ポリシーは削除済みであり、新規Spec内で策定する。以後の計画はこの取得済み文脈を使い、GitHubを再取得して承認を再解釈しない。
