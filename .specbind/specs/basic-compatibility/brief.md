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

既存バージョン1.0.0の基本的な互換性確認を、利用者の判断を代替しないSpecとして確立したい。

## 望む結果

現在構成の確認済み属性だけから5つの基本規格を根拠付きで判定し、情報不足を不適合として扱わない。

## 前提と依存

判定対象は`current-build-management`が保持する採用候補であり、未採用候補や自動取得されたままの値は使わない。
