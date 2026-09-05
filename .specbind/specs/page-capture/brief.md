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

既存バージョン1.0.0のページ取り込みを、利用者起点の未信頼入力境界としてSpecに確立したい。

## 望む結果

利用者が拡張アイコンを操作したときだけ表示中ページから候補情報を取得し、出典と元表記、取り込めない理由を示す。プロジェクトが未作成でも下書きを失わず、確認前の値を確定値として扱わない。

## 前提と依存

取り込み結果は`project-candidate-management`の候補編集へ引き渡す。
