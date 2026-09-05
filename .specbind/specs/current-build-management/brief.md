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

既存バージョン1.0.0で、検討中の候補から現在採用する構成を選ぶ責任をSpecとして確立したい。

## 望む結果

利用者はプロジェクト内の候補を採用・解除し、正整数の数量とともに現在構成として保持できる。候補削除時は構成の参照も残さない。

## 前提と依存

採用対象と表示情報は`project-candidate-management`が所有する候補を利用する。
