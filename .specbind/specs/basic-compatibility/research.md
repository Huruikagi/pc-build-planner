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

固定リビジョンの純粋評価と実拡張E2Eは、確認済み属性だけを使う5つの基本規格と、根拠付き三値判定を裏づける。

## 調査項目

### 基本互換性として維持する判定は何か

#### 背景

高度な性能・物理評価を含めず、現在製品が所有する基本規格と情報不足の扱いを確定する必要があった。

#### 参照した情報源

- `.specbind/steering/product.md`
- `src/compatibility.ts:19-295`
- `e2e/compatibility.spec.ts:68-217`

#### 調査結果

CPUとマザーボードのソケット、マザーボードとメモリの規格、CPUクーラー対応ソケット、ケース対応マザーボード規格、ケース対応電源規格の5ルールがある。`confirmed`だけを読み、不一致、適合、情報不足を区別して根拠を返す。

#### 変更への影響

Requirementsは5ルールと集約結果を定め、Designは純粋評価と不足理由の構造を説明できる。
