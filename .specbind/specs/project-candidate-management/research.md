---
type: SpecBind Research
---

# `project-candidate-management` のリサーチ

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

固定リビジョンはプロジェクト、候補、取得元、重複統合を一つの利用者責任として実装している。欠損と未確認を保持する意図は確認済みで、商品名必須だけが維持意図と異なる。

## 調査項目

### 不完全な候補をどこまで保存できるべきか

#### 背景

製品文書はURLだけの候補を認める一方、現在のモデル、フォーム、E2Eは商品名を必須にしているため、維持する意味の確認が必要だった。

#### 参照した情報源

- `.specbind/steering/product.md`
- `README.md:8-10`
- `docs/reverse/requirements.md:45-50`
- `src/model.ts:122-134`
- `src/part-editor.tsx:157-163`
- `e2e/parts.spec.ts:142-255`
- `e2e/duplicates.spec.ts:64-195`

#### 調査結果

依頼者は、商品名が取れなくてもURLなど分かっている情報だけで一旦保存できる意図を確認した。現在の必須検証はこの意図と異なり、保留指摘として扱う。未分類、未確認、型番なし、複数取得元、利用者選択による重複統合は実装とE2Eの証拠がある。

#### 変更への影響

RequirementsはURLだけの候補保存を含める。Designは現在実装との差を正当化せず、将来の是正対象を契約から分離する。
