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

既存製品バージョン0.5.0で、現在構成の基本的な互換性を確認する振る舞いをSpecとして確立したい。

## 望む結果

利用者が確認した属性だけを使い、互換、不適合、情報不足を根拠と不足側とともに示す責任が維持される。

## 依頼時点の境界

未確認値による断定、高度な物理互換性、性能評価、推薦、利用者の最終判断の代替は含めない。

## 前提と依存

`current-build-management`の採用済み構成を入力にする。固定リビジョン`7c5435306482a6df95045ebd5b3308d4b2e41f9b`を証拠とする。
