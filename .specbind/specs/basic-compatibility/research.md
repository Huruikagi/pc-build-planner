---
type: SpecBind Research
---

# `basic-compatibility` のリサーチ

<!-- specbind:instruction maintain
追記型の活動ログではなく、現在のマイルストーンで有効な入力として維持する。
調査源、調査結果、選択肢、それぞれの調査が支える判断を記録する。リリース後も必要な結論は
Requirements、Design、Contract のいずれかへ移し、当てはまらない節は削除する。
-->

<!-- specbind:instruction consume
これはマイルストーン中だけの補助的な根拠であり、永続的な権威ではない。
Requirements、Design、Contract は、この文書なしで理解できなければならない。
-->

## 要約

固定リビジョンは、現在構成の確認済み属性だけを使う5つの基本規格の3値判定を一つの責任として示す。

## 調査項目

### 基本互換性の維持境界を何が裏付けるか

#### 背景

取得値や欠損から互換性を断定せず、利用者の判断を補助する範囲を定める必要がある。

#### 参照した情報源

- `src/compatibility.ts:19-294`
- `src/compatibility-screen.tsx:93-164`
- `e2e/compatibility.spec.ts:68-219`

#### 調査結果

判定は`confirmed`だけを使い、equalまたはincludedで比較する。欠損や未採用は`unknown`として不足側を示す。不一致を優先し、不一致がなく情報不足があれば`unknown`、すべて一致した場合だけ`compatible`とする。

#### 変更への影響

Requirementsは3値と根拠表示を契約にし、Designは5規則、組合せ評価、集約、現在構成への依存を自己完結して説明する。
