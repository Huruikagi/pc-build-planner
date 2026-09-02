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

固定リビジョンは、利用者操作時だけのページアクセス、未信頼入力の検証・正規化、一時状態、未確定下書きへの引渡しを独立した境界として示す。

## 調査項目

### ページ境界を何が裏付けるか

#### 背景

任意ページのDOMやメッセージを候補管理へ直接到達させない境界を定める必要がある。

#### 参照した情報源

- `manifest.json:7-23`
- `src/service-worker.ts:16-88`
- `src/capture/protocol.ts:15-107`
- `src/capture/extract.ts:282-299`
- `src/capture/normalize.ts:20-198`
- `src/capture/rules.ts:13-28`
- `e2e/capture.spec.ts:62-253`

#### 調査結果

恒久的なhost permissionはなく、拡張アイコン操作時だけ`activeTab`と`scripting`を使う。payloadはスキーマ、件数、長さ、形式で検証され、取り込み状態はsessionへ置かれる。取得不能や制限ページは理由を示し、結果は確認前の下書きとして渡される。

#### 変更への影響

Requirementsは利用者起点、非確定、理由付き失敗を所有する。Designはservice worker、classic content script、Zod境界、session状態、候補下書きへのseamを明記する。
