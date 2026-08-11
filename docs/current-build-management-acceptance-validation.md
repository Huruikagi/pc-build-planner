# Current Build Management 受入検証

`current-build-management` の53件の受入基準と、それを回帰検証する自動suiteの対応表。テストはすべて架空データを使用する。

## Canonical validation

- CI相当: `pnpm validate:ci`
- browser harnessを含む全検証: `pnpm validate`
- production build: `pnpm build`
- runtime smoke: `node --import tsx --test tests/tooling/build-smoke.test.ts`

## 追跡表

| 基準 | 主な自動検証 |
| --- | --- |
| 1.1 | `state.test.ts` のcontext ready切替、`current-build-flow.integration.test.tsx` |
| 1.2 | `state.test.ts` のcategory絞込み、`view.test.tsx` |
| 1.3 | `category-policy.test.ts`、`view.test.tsx` の未分類非表示 |
| 1.4 | `query.test.ts` の空結果、`view.test.tsx` の空表示 |
| 1.5 | `state.test.ts` のempty/unavailable、`view.test.tsx` |
| 1.6 | `project-context-adapter.test.ts` のno fallback、`view.test.tsx` のno selector |
| 2.1 | `category-policy.test.ts` のcanonical網羅 |
| 2.2 | `service.test.ts` のsingle select、`current-build.spec.ts` |
| 2.3 | `service.test.ts` のsingle replace |
| 2.4 | `service.test.ts` のsingle remove、`view.test.tsx` |
| 2.5 | `category-policy.test.ts` のsingle quantity拒否、`view.test.tsx` |
| 3.1 | `category-policy.test.ts` のcanonical網羅 |
| 3.2 | `service.test.ts` のmultiple add、`current-build.spec.ts` |
| 3.3 | `service.test.ts` のquantity update、`current-build.spec.ts` |
| 3.4 | `service.test.ts` のinvalid quantity、`view.test.tsx` |
| 3.5 | `service.test.ts` のmultiple remove、`current-build.spec.ts` |
| 3.6 | `service.test.ts` のduplicate prevention |
| 4.1 | `reference-repair.integration.test.ts` のcategory change |
| 4.2 | `reference-repair.integration.test.ts` のsingle conflict preservation |
| 4.3 | `reference-repair.integration.test.ts` のuncategorize |
| 4.4 | `reference-repair.integration.test.ts` のcandidate delete |
| 4.5 | `query.integration.test.ts` のmissing/foreign reference |
| 5.1 | `service.test.ts` のcommit系、`current-build-flow.integration.test.tsx` |
| 5.2 | `query.integration.test.ts` の再表示、`current-build.spec.ts` の再起動 |
| 5.3 | `service.test.ts` の保存失敗、`state.test.ts` |
| 5.4 | `query.integration.test.ts` のcorrupt/unsupported、`state.test.ts` |
| 5.5 | `state.test.ts` の二重送信抑止 |
| 6.1 | `query.test.ts` の0または1構成、`public.test.ts` |
| 6.2 | `query.test.ts` のcanonical ID/quantity、`public-api-consumer.ts` |
| 6.3 | `query.integration.test.ts` のcommit後再照会 |
| 6.4 | `public-api-consumer.ts` の読取shape型検査 |
| 7.1 | `state.test.ts` のdraftなしallow |
| 7.2 | `state.test.ts` のconfirmation開始、`view.test.tsx` |
| 7.3 | `state.test.ts` のsave分岐 |
| 7.4 | `state.test.ts` のvalidation/save failure |
| 7.5 | `state.test.ts` のdiscard分岐 |
| 7.6 | `state.test.ts` のcancel分岐 |
| 7.7 | `project-context-adapter.test.ts` のforced通知、`state.test.ts` の隔離draft |
| 7.8 | `project-context-adapter.test.ts` のstale、`state.test.ts` |
| 8.1 | `state-snapshot.test.ts` のversion 1 exact shape |
| 8.2 | `state-snapshot.test.ts` のproject一致検査 |
| 8.3 | `state-snapshot.test.ts` のmatching restore、`registration.test.tsx` |
| 8.4 | `state-snapshot.test.ts` のmismatch/empty/unavailable |
| 8.5 | `state-snapshot.test.ts` のinvalid/version/reference拒否 |
| 9.1 | `category-summary.test.ts` のcanonical全カテゴリ、`view.test.tsx` |
| 9.2 | `category-summary.test.ts` のsingle summary |
| 9.3 | `category-summary.test.ts` のmultiple names/quantities |
| 9.4 | `category-summary.test.ts` のempty summary |
| 9.5 | `view.test.tsx` の成功直後再描画、`current-build.spec.ts` |
| 9.6 | `view.test.tsx` の長文省略契約 |
| 9.7 | `category-summary.test.ts`/`view.test.tsx` の日英、`english-ui.spec.ts` |
| 9.8 | `view.test.tsx` のkeyboard/accessible name、`current-build.spec.ts` |
| 9.9 | `view.test.tsx` のmarkup風名称、`category-summary.test.ts` |

## 判定方法

53件の行がすべて存在し、上記のcanonical validation、production build、runtime smokeが成功した場合に、本featureの受入検証を合格とする。
