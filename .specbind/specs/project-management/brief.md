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

利用者は PC 構成の検討単位を分け、作業対象を選び直せる必要がある。

## 望む結果

プロジェクトを作成、選択、改名、削除でき、削除後も選択状態や所属データが矛盾しない。

## スコープの境界

アカウント、共有、複数端末同期、プロジェクト横断の候補ライブラリは扱わない。

## 既知の依存

[local-data-storage](../local-data-storage/brief.md) がプロジェクトを保存できること。
