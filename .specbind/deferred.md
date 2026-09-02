---
type: Deferred Findings
---

# Deferred findings

- Spec: `local-data-storage`
  - Source revision: `c645c753949b10c16201bf03bb0e98eaf3fd4f92`
  - Reconfirmed at source revision: `7c5435306482a6df95045ebd5b3308d4b2e41f9b`
  - Locator: `src/model.ts:108-116,122-150,166-173`
  - Claim: `localDataRootSchema` は現在構成のプロジェクトごとの一意性、候補参照の整合性、取得元の primary の個数を検証しないため、構造上は妥当でも製品の不変条件を外れた保存値を破損として検出できない疑いがある。

- Spec: `project-candidate-management`
  - Source revision: `c645c753949b10c16201bf03bb0e98eaf3fd4f92`
  - Reconfirmed at source revision: `7c5435306482a6df95045ebd5b3308d4b2e41f9b`
  - Locator: `src/model.ts:122-131`; `src/parts.ts:32-39,169-193,240-245`
  - Claim: 自動取得値と確認済み値を分離する方針に対し、候補名は単一の文字列で保存され、取り込み下書きの元表記が永続化されないため、候補名だけ元表記と確認済み値の区別を維持できない疑いがある。

- Spec: `current-build-management`
  - Source revision: `7c5435306482a6df95045ebd5b3308d4b2e41f9b`
  - Locator: `src/build.ts:112-138`; `src/build-screen.tsx:247-255`
  - Claim: 異なる通貨を換算せず合算しない意図に対し、金額を加算して最初の通貨で表示し、混在警告だけを添えるため、異通貨の合計を単一通貨の金額として示す疑いがある。
