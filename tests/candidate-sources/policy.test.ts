import assert from "node:assert/strict";
import test from "node:test";
import { candidateSourcePolicy } from "../../src/candidate-sources/public.js";
import type {
  CandidateSource,
  CandidateSourceId,
  CandidateSourceState,
} from "../../src/domain/public.js";

const id = (value: string) => value as CandidateSourceId;
const firstSource = {
  id: id("11111111-1111-4111-8111-111111111111"),
  pageUrl: "https://shop.invalid/first",
} satisfies CandidateSource;
const pricedSource = {
  id: id("22222222-2222-4222-8222-222222222222"),
  pageUrl: "https://shop.invalid/priced",
  price: { original: "20 credits", confirmed: { amount: 20, currency: "USD" } },
} satisfies CandidateSource;

test("sourceなしと1:N追加を許可し最初のsourceだけをprimaryにする", () => {
  const empty = { sources: [] } satisfies CandidateSourceState;
  const first = candidateSourcePolicy.add(empty, firstSource);
  assert.deepEqual(first, {
    ok: true,
    value: { sources: [firstSource], primarySourceId: firstSource.id },
  });
  assert.deepEqual(empty, { sources: [] });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = candidateSourcePolicy.add(first.value, pricedSource);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.value.primarySourceId, firstSource.id);
  assert.deepEqual(second.value.sources, [firstSource, pricedSource]);
});

test("更新とprimary切替は対象以外と入力を変更しない", () => {
  const state = {
    sources: [firstSource, pricedSource],
    primarySourceId: firstSource.id,
  } satisfies CandidateSourceState;
  const updatedSource = { ...pricedSource, siteName: "Fictional Parts" };
  const updated = candidateSourcePolicy.update(state, updatedSource);
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.value.sources[0], firstSource);
  assert.equal(state.sources[1], pricedSource);
  const switched = candidateSourcePolicy.setPrimary(
    updated.value,
    pricedSource.id,
  );
  assert.equal(switched.ok, true);
  if (!switched.ok) return;
  assert.equal(switched.value.primarySourceId, pricedSource.id);
  assert.equal(switched.value.sources, updated.value.sources);
});

test("代表値はprimaryだけから導出し価格欠損をfallbackしない", () => {
  const state = {
    sources: [firstSource, pricedSource],
    primarySourceId: firstSource.id,
  } satisfies CandidateSourceState;
  assert.deepEqual(candidateSourcePolicy.derive(state), {
    pageUrl: firstSource.pageUrl,
  });
  assert.deepEqual(candidateSourcePolicy.derive({ sources: [] }), {});
});

test("primary削除にはreplacementを要求し最後のsource削除は候補を残せる", () => {
  const state = {
    sources: [firstSource, pricedSource],
    primarySourceId: firstSource.id,
  } satisfies CandidateSourceState;
  assert.deepEqual(candidateSourcePolicy.remove(state, firstSource.id), {
    ok: false,
    error: { kind: "replacement-required" },
  });
  const removed = candidateSourcePolicy.remove(
    state,
    firstSource.id,
    pricedSource.id,
  );
  assert.deepEqual(removed, {
    ok: true,
    value: { sources: [pricedSource], primarySourceId: pricedSource.id },
  });
  assert.deepEqual(state.sources, [firstSource, pricedSource]);
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.deepEqual(
    candidateSourcePolicy.remove(removed.value, pricedSource.id),
    {
      ok: true,
      value: { sources: [] },
    },
  );
});
