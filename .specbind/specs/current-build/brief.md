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

候補パーツを集めるだけでなく、検討中の現在構成として採用した組み合わせを管理したい。

## 望む結果

プロジェクト内の候補を現在構成へ採用・解除し、必要な数量を管理できる。候補やプロジェクトを
削除した後も、現在構成に無効な参照を残さない。

## スコープの境界

構成の自動生成、複数構成の比較履歴、利用者に代わるパーツ選定は扱わない。

## 既知の依存

[local-data-storage](../local-data-storage/brief.md)、
[project-management](../project-management/brief.md)、
[candidate-parts](../candidate-parts/brief.md)。
