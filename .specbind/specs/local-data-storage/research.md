---
type: SpecBind Research
---

# `local-data-storage` のリサーチ

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

固定リビジョンの実装と実拡張E2Eは、単一ルートを読出し、形を検証し、変更を直列化して保存する最小責任を裏付ける。将来移行、復旧、参照修復は維持する意味に含めない。

## 調査項目

### 最小保存責任を何が裏付けるか

#### 背景

過去の過剰設計を繰り返さず、「保存できればいい」をRequirementsとDesignへ渡す必要がある。

#### 参照した情報源

- `src/storage.ts:1-112`
- `src/model.ts:162-183`
- `src/side-panel.tsx:13-21`
- `e2e/parts.spec.ts:142-253`
- `e2e/build.spec.ts:51-87`

#### 調査結果

`Store`は未初期化、構造破損、保存先利用不能を区別し、root単位の書込みをキューで直列化する。E2Eは実際の`chrome.storage.local`への保存と再読込み後の復元を確認する。コードはtransaction runner、lock、recovery制御を持ち込まない意図を明記する。

#### 変更への影響

Requirementsは正常データの保存・読出しと非破壊的な失敗に限定し、Designは単一root、検証、直列化だけを永続化する。参照整合性検証の疑いは`.specbind/deferred.md`へ記録済みで、責任拡大の根拠にしない。
