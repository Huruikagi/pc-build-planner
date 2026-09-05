---
type: SpecBind Research
---

# `page-capture` のリサーチ

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

固定リビジョンは拡張アイコン、service worker、content script、Side Panelを通る一時的な取り込み経路を持ち、実拡張E2Eが主要な成功・失敗・引き渡しを確認している。

## 調査項目

### 取り込み境界が維持する利用者挙動は何か

#### 背景

Chrome実行文脈の分割や抽出関数の構造ではなく、利用者に維持する意味を確定する必要があった。

#### 参照した情報源

- `.specbind/steering/product.md`
- `.specbind/steering/tech.md`
- `manifest.json:8-17`
- `src/service-worker.ts:17-88`
- `src/capture/protocol.ts:15-107`
- `src/capture/normalize.ts:101-198`
- `e2e/capture.spec.ts:62-235`

#### 調査結果

明示操作時だけの権限、ページ入力の検証、取得済み項目と棄却理由、制限ページと空ページの失敗、プロジェクト未解決時の下書き保持に証拠がある。不正メッセージで失敗状態へ遷移しない可能性は保留指摘とする。

#### 変更への影響

Requirementsは利用者起点、未信頼入力、理由提示、下書き保持を定める。Designは3つのChrome実行文脈とsession状態の分離を説明できる。
