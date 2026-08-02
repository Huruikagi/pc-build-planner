# Brief: runtime-schema-validation

## Problem

拡張を保守する開発者は、storage、runtime message、backup、商品取得、feature activation、state snapshot などの信頼境界ごとに、手書きの decoder、型ガード、許容キー検査、型アサーションを重複して保守している。項目追加時に TypeScript 型と実行時検証がずれやすく、不正入力の拒否規則、エラーコード、canonical path の一貫性を維持する負担が増えている。

## Current State

`src/domain/validation.ts` の永続化 root・command・candidate、`src/features/backup-restore/exchange.ts` の backup envelope、`src/features/product-capture/draft-mapper.ts` の capture result、runtime message、activation payload、feature state snapshot などが、`isRecord`、`hasOnlyKeys`、文字列 union 判定、再帰検査を個別実装している。既存の fail-closed、`Result<T, E>`、エラーコード、canonical path、参照整合性検査は確立しているが、shape と型の二重管理が残る。

## Desired Outcome

Zod Mini を runtime dependency として採用し、信頼境界ごとに宣言的な実行時 schema を定義する。共通 primitive とエラー変換を一元化し、可能な箇所では schema から型を推論する一方、既存の公開型、`Result`、エラーコード、canonical path、未知キー・危険 payload・参照切れの拒否を維持する。production bundle が Manifest V3 の CSP と既存の生成物 gate を満たすことを、移行開始前に実証する。

## Approach

Zod Mini の canonical import 入口を一つ設け、どの schema よりも先に `jitless` を設定する。最初に最小 schema を production buildへ含める feasibility gate を実施し、`pnpm validate:artifacts` を含む生成物検査と production 実行 trap により、直接記述だけでなく alias 経由を含む動的 `Function` 呼出しが実行されないことを確認する。gate が通過した場合だけ、共通 primitive、strict object、JSON-safe・禁止 payload、Zod issue から既存エラーへの変換を提供する。

各業務 schema の意味と配置は既存 owner に残し、永続化 root・command・replacement、backup envelope、capture result、runtime message、activation payload、state snapshot の順に段階移行する。aggregate 横断の参照整合性、循環参照、危険 payload の再帰走査などは、エラー精度と可読性を優先し、feature-owned refinement または既存の専用ロジックとして維持する。

## Scope

- **In**: Zod Mini runtime dependency、canonical import と `jitless` 初期化、alias 経由を含む動的 `Function` 呼出しを検出・阻止する MV3/CSP/build feasibility gate、UUID・UTC timestamp・HTTP(S) URL・revision・strict object などの共通 primitive、既存エラー契約への変換、feature-owned schema の配置・公開規約、永続化・backup・capture・runtime/activation/state snapshot の優先境界に対する段階移行、不要な重複型ガードと型アサーションの削除、production bundle size の記録、配布物への runtime dependency license notice。
- **Out**: 保存 schema version や backup format version 自体の変更、既存データの意味・構造変更、UI 入力フォームライブラリ、互換性判定規則の変更、Zod 標準エラーの外部公開、feature API・ディレクトリ構造の全面刷新、全 validator の一括置換。

## Boundary Candidates

- Zod Mini の設定済み canonical import、共通 primitive、JSON-safe helper、既存エラー形式への変換を所有する検証基盤。
- 永続化、backup、capture、runtime、各 feature が自身の意味と公開境界内で所有する schema 群。
- shape 検証後に実行する、aggregate 参照整合性・循環参照・禁止 payload などの意味検証層。

## Out of Boundary

- schema を中央 registry に集約して各 feature の意味を検証基盤へ移すこと。
- feature 外から内部 schema を deep import すること。
- Zod Mini 導入を理由に既存 `Result`、エラーコード、canonical path、atomicity を変更すること。
- CSP/build gate が不合格のまま schema 移行を続行すること。

## Upstream / Downstream

- **Upstream**: local-data-foundation が所有する canonical `Result<T, E>`、validation error code、path 規約、Manifest V3/CSP と生成物検査、Zod Mini の公式 runtime API。
- **Downstream**: `project-context`、#24 の schema version・破損回復、`product-page-capture` の metadata/capture result、backup envelope、runtime message、feature activation、state snapshot の各 schema。

## Existing Spec Touchpoints

- **Extends**: `local-data-foundation`、`backup-restore`、`product-page-capture`、`application-shell` および各 feature の信頼境界検証を、所有権を変えず共通移行規約へ載せる。
- **Adjacent**: `candidate-source-bookmarks`、`project-candidate-management`、`transient-feature-surface`、`ui-internationalization`。公開 `public.ts` / `worker-public.ts` / `feature-contribution.ts` 境界を越えて schema を共有しない。

## Constraints

PC 版 Chrome 116+ Manifest V3、extension pages CSP、TypeScript 7 strict、ESM、Node.js 26、pnpm 11、esbuild に適合すること。Zod Mini も共有 Core の JIT probe 経路を含み得るため、`jitless` 実行だけで安全とみなさず production bundle の静的検査を必須とする。runtime code はすべてローカル同梱し、CSP を弱めない。fixture は架空データだけを使い、`pnpm validate` と導入前後の bundle size 比較を完了条件へ含める。

artifact scanner は文字列上の `new Function` だけを唯一の証拠にせず、constructor alias や将来の bundle 変形を含めて production 実行時に動的 Function 呼出しがないことを検証する。Zod の MIT notice を package/release artifact に含める。snapshot wave では既存 version と shape を維持し、`selectedProjectId` の authority 変更や field 削除を行わない。
