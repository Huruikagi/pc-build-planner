import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateSource,
  CandidateSourceId,
  CandidateSourceState,
} from "../../../src/domain/public.js";
import { candidateSourcePolicy } from "../../../src/features/candidate-management/source-collection.js";

const id = (value: string) => value as CandidateSourceId;
const a = {
  id: id("11111111-1111-4111-8111-111111111111"),
  pageUrl: "https://shop.invalid/a",
} satisfies CandidateSource;
const b = {
  id: id("22222222-2222-4222-8222-222222222222"),
  pageUrl: "https://shop.invalid/b",
  price: { original: "$20", confirmed: { amount: 20, currency: "USD" } },
} satisfies CandidateSource;

test("追加・更新・primary切替は入力を変更せず新しいstateを返す", () => {
  const empty = { sources: [] } satisfies CandidateSourceState;
  const first = candidateSourcePolicy.add(empty, a);
  assert.deepEqual(first, {
    ok: true,
    value: { sources: [a], primarySourceId: a.id },
  });
  assert.deepEqual(empty, { sources: [] });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = candidateSourcePolicy.add(first.value, b);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const updated = candidateSourcePolicy.update(second.value, {
    ...b,
    siteName: "Example",
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  const primary = candidateSourcePolicy.setPrimary(updated.value, b.id);
  assert.equal(primary.ok, true);
  if (!primary.ok) return;
  assert.equal(primary.value.primarySourceId, b.id);
  assert.equal(primary.value.sources[0], a);
});

test("削除規則とprimaryだけからの代表値導出を守る", () => {
  const state = {
    sources: [a, b],
    primarySourceId: a.id,
  } satisfies CandidateSourceState;
  assert.deepEqual(candidateSourcePolicy.derive(state), { pageUrl: a.pageUrl });
  assert.deepEqual(candidateSourcePolicy.remove(state, a.id), {
    ok: false,
    error: { kind: "replacement-required" },
  });
  const replaced = candidateSourcePolicy.remove(state, a.id, b.id);
  assert.equal(replaced.ok, true);
  if (!replaced.ok) return;
  const last = candidateSourcePolicy.remove(replaced.value, b.id);
  assert.deepEqual(last, { ok: true, value: { sources: [] } });
});

test("全rule errorと非primary削除を判別し更新対象以外を維持する", () => {
  const empty = { sources: [] } satisfies CandidateSourceState;
  assert.deepEqual(candidateSourcePolicy.update(empty, a), {
    ok: false,
    error: { kind: "source-not-found" },
  });
  assert.deepEqual(candidateSourcePolicy.remove(empty, a.id), {
    ok: false,
    error: { kind: "source-not-found" },
  });
  assert.deepEqual(candidateSourcePolicy.setPrimary(empty, a.id), {
    ok: false,
    error: { kind: "source-not-found" },
  });
  const state = {
    sources: [a, b],
    primarySourceId: a.id,
  } satisfies CandidateSourceState;
  assert.deepEqual(candidateSourcePolicy.add(state, a), {
    ok: false,
    error: { kind: "duplicate-source" },
  });
  assert.deepEqual(
    candidateSourcePolicy.update(state, { ...a, siteName: "Updated" }),
    {
      ok: true,
      value: {
        sources: [{ ...a, siteName: "Updated" }, b],
        primarySourceId: a.id,
      },
    },
  );
  assert.deepEqual(candidateSourcePolicy.remove(state, a.id, a.id), {
    ok: false,
    error: { kind: "invalid-replacement" },
  });
  assert.deepEqual(candidateSourcePolicy.remove(state, b.id), {
    ok: true,
    value: { sources: [a], primarySourceId: a.id },
  });
  assert.deepEqual(
    candidateSourcePolicy.setPrimary(
      state,
      id("99999999-9999-4999-8999-999999999999"),
    ),
    { ok: false, error: { kind: "source-not-found" } },
  );
});
