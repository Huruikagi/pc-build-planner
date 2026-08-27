---
type: SpecBind Brief
---

# ブリーフ

<!-- specbind:instruction maintain
依頼された変更を依頼者自身の言葉で捉え、短く保つ。同じ変更に関する追加要望は、
新しい文書を作らずこのブリーフに統合する。
-->

<!-- specbind:instruction consume
これは依頼の文脈であって権威ある scope ではない。scope は Requirements が所有し、
この文書は fingerprint の対象外である。
-->

## 課題

利用者が見つけた PC パーツをプロジェクト内の候補として残し、不確かな取得値を確認・補正しながら
比較できる必要がある。

## 望む結果

候補を手入力、編集、削除できる。取得元の表記と利用者が確認した値を分離し、欠損や未分類も
正常な状態として保存する。重複の可能性は示すが、統合は利用者が明示的に選ぶ。

## スコープの境界

網羅的な商品マスター、自動的な商品同一性の断定、プロジェクト横断ライブラリは扱わない。

## 既知の依存

[local-data-storage](../local-data-storage/brief.md) と
[project-management](../project-management/brief.md)。
