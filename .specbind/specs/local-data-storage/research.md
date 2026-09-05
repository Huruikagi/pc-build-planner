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

固定リビジョンでは`Store`と`LocalDataRoot`が端末内保存を担い、実拡張E2Eが保存と再読込を確認している。維持意図はこの結果に限定し、より強い保存方式はDesign制約または実装詳細として扱う。

## 調査項目

### どこまでを維持する保存保証とするか

#### 背景

現行実装と旧版文書には原子性、直列化、破損保持などの強い性質があるが、依頼者は保存と再読込だけを求めている。

#### 参照した情報源

- `.specbind/steering/product.md`
- `.specbind/steering/tech.md`
- `src/storage.ts:17-112`
- `src/model.ts:162-184`
- `e2e/parts.spec.ts:142-255`

#### 調査結果

実装はスキーマ検証、書き込みキュー、単一ルート保存を持つ。実拡張E2Eは通常系の保存と再起動後の再読込を裏づける。更新済みSteeringは破損・非対応データの破棄を許容し、原子性、直列化、移行、復旧を必須要件から外している。

#### 変更への影響

Requirementsは端末内保存と再読込だけを利用者向け保証にし、DesignはChrome APIを保存境界へ閉じる構造だけを保持できる。
