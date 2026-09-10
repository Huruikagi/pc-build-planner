---
type: SpecBind Brief
---

# `current-build-management` のブリーフ

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

現在構成画面は共有の日英翻訳を利用しているが、Contractで共有資産の利用者として宣言されていない。翻訳資産の共有化に合わせ、この画面も同じ管理条件で保守できるようにしたい。

## 望む結果

<!-- specbind:instruction maintain
この変更が成功したと依頼者が判断できる結果を記載する。Requirementsの受け入れ基準へ
展開する前の依頼文脈であり、ここで網羅的な振る舞いの契約を作らない。
-->

現在構成画面の文言の意味と表示条件を本Specで保ちながら、共有翻訳資産を利用する関係がDesignとContractに明記される。

## 依頼時点の境界

<!-- specbind:instruction maintain
依頼者が明示した含むもの、含まないもの、変更してよい範囲を記載する。DiscoveryやRequirementsで
確定したscopeを逆輸入しない。望む結果から明らかで、追加の境界がない場合はこの節を削除する。
-->

候補の採用・解除・数量管理・候補削除との整合という既存の振る舞いは維持する。共有ファイルの単独所有や翻訳専用Spec、新たな実装順の依存は追加しない。

## 前提と依存

<!-- specbind:instruction maintain
依頼時点で示された前提、他の変更、外部判断、期限など、この依頼の扱いに影響するものを記載する。
合致する前提や依存がない場合はこの節を削除する。
-->

共有翻訳の条件はプロジェクトの共有Contractが管理し、各機能の文言の意味は各Specが保つ。これはSteeringの機能ごとの責務を保つための既存Spec更新である。

## 入力資料

<!-- specbind:instruction maintain
依頼者が示した資料、またはDiscoveryが明示的なSource Collectionを使った場合、このSpecに
関係する正確なURLかプロジェクト相対pathと、各資料が関係する理由だけを保つ。コレクション
全体の振り分けとSpec横断の対応はRoadmapに保つ。入力資料がない場合はこの節を削除する。
-->
2026-09-11の会話で、利用者が本Specの追加とRequirements／Designの委任承認、全体Contract Reviewの再実施を承認した。外部Source Collectionの追加はない。
