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

固定リビジョンは、プロジェクトごとの現在構成、候補の採用と解除、数量、カテゴリ別表示、価格表示を一つの責任として示す。

## 調査項目

### 現在構成の維持境界を何が裏付けるか

#### 背景

候補管理と互換性判定の間で、採用済み集合を所有する境界を定める必要がある。

#### 参照した情報源

- `src/build.ts:18-139`
- `src/build-screen.tsx:167-313`
- `src/parts.ts:96-104`
- `src/projects.ts:32-44`
- `e2e/build.spec.ts:51-147`

#### 調査結果

同じ候補を重複採用せず、数量は正整数だけを保存する。候補やプロジェクトの削除は構成参照も除く。価格はプライマリ取得元と数量から導くが、異通貨を合算しない意図と表示実装に疑いがある。

#### 変更への影響

Requirementsは異通貨を単一通貨の合計として示さないことを維持し、Designは候補参照と互換性入力のseamを明記する。現実装の疑いは`.specbind/deferred.md`へ記録済みである。
