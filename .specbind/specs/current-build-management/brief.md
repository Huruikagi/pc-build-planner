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

既存製品バージョン0.5.0で、候補から現在のPC構成を組み立てる振る舞いをSpecとして確立したい。

## 望む結果

プロジェクトごとの現在構成、候補の採用と解除、正整数数量、カテゴリ別表示、換算を伴わない価格表示が維持される。

## 依頼時点の境界

価格・在庫監視、為替換算、性能評価、組立手順、推薦は含めない。

## 前提と依存

`project-candidate-management`の候補を参照する。固定リビジョン`7c5435306482a6df95045ebd5b3308d4b2e41f9b`を証拠とする。
