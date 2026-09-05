---
type: SpecBind Research
---

# `current-build-management` のリサーチ

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

固定リビジョンの純粋なルート変換と実拡張E2Eは、採用、解除、数量変更、候補削除との整合、再読込を裏づける。

## 調査項目

### 現在構成が所有する意味は何か

#### 背景

候補管理や互換性判定と分離し、現在構成自身が維持する操作と整合性を確定する必要があった。

#### 参照した情報源

- `.specbind/steering/product.md`
- `src/build.ts:18-138`
- `src/build-screen.tsx:167-304`
- `e2e/build.spec.ts:51-147`

#### 調査結果

プロジェクトごとの採用パーツ、同一カテゴリの複数採用、正整数数量、不正値の非保存、解除、候補削除時の参照除去に証拠がある。画面配置や即時確定の具体操作はDesign上の選択である。

#### 変更への影響

Requirementsは構成の意味と数量制約を定め、Designは候補ID参照とUI操作を自己完結して説明できる。
