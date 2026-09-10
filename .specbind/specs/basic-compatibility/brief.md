---
type: SpecBind Brief
---

# `basic-compatibility` のブリーフ

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

翻訳ファイル全体が互換性機能の単独所有となっており、他機能の文言更新もこのSpecに所属するように見える。共有資産として扱いたい。

## 望む結果

<!-- specbind:instruction maintain
この変更が成功したと依頼者が判断できる結果を記載する。Requirementsの受け入れ基準へ
展開する前の依頼文脈であり、ここで網羅的な振る舞いの契約を作らない。
-->

翻訳ファイルの単独所有を外し、共有Contractを利用する宣言へ移す。互換性機能自身の文言の意味と必要性は本Specで維持する。

## 依頼時点の境界

<!-- specbind:instruction maintain
依頼者が明示した含むもの、含まないもの、変更してよい範囲を記載する。DiscoveryやRequirementsで
確定したscopeを逆輸入しない。望む結果から明らかで、追加の境界がない場合はこの節を削除する。
-->

互換性の判定規則や表示動作は変更しない。日英の翻訳ファイルを共有化し、翻訳専用Specや他機能との新たな実装順の依存は追加しない。

## 前提と依存

<!-- specbind:instruction maintain
依頼時点で示された前提、他の変更、外部判断、期限など、この依頼の扱いに影響するものを記載する。
合致する前提や依存がない場合はこの節を削除する。
-->

共有ContractはプロジェクトのDirect項目で準備する。Steeringの機能ごとの責任分担を保ち、共有ファイルの管理を特定機能の責務としない。

## 入力資料

<!-- specbind:instruction maintain
依頼者が示した資料、またはDiscoveryが明示的なSource Collectionを使った場合、このSpecに
関係する正確なURLかプロジェクト相対pathと、各資料が関係する理由だけを保つ。コレクション
全体の振り分けとSpec横断の対応はRoadmapに保つ。入力資料がない場合はこの節を削除する。
-->
2026-09-11の会話で、共有Contractへの移行範囲を利用者が承認した。外部Source Collectionの追加はない。
