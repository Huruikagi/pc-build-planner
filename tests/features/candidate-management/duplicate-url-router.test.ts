import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePartId,
  CandidateSourceId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { createDuplicateUrlRouter } from "../../../src/features/candidate-management/duplicate-url-router.js";
import type {
  AddCandidateSourceInput,
  CandidateSourceMutationPort,
} from "../../../src/features/candidate-management/public.js";
import type {
  SourcePriceRefreshError,
  SourcePriceRefreshPort,
} from "../../../src/features/source-price-refresh/public.js";

const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const sourceId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CandidateSourceId;
const capturedAt = "2026-07-28T00:00:00.000Z" as UtcTimestamp;
const input: AddCandidateSourceInput = {
  candidateId,
  source: {
    id: sourceId,
    pageUrl: "https://shop.example.invalid/item?variant=synthetic",
    siteName: "Example Shop",
    capturedAt,
    kind: "retail",
    price: {
      original: "123.45 credits",
      confirmed: { amount: 123.45, currency: "XTS" },
    },
  },
};

const sourceMutations = (
  addSource: CandidateSourceMutationPort["addSource"],
): CandidateSourceMutationPort => ({
  addSource,
  async updateSource() {
    throw new Error("unexpected updateSource");
  },
  async patchSourcePrice() {
    throw new Error("unexpected patchSourcePrice");
  },
  async removeSource() {
    throw new Error("unexpected removeSource");
  },
  async setPrimarySource() {
    throw new Error("unexpected setPrimarySource");
  },
});

test("unique candidate-scoped URL match refreshes price and never adds source", async () => {
  const calls: string[] = [];
  const refresh: SourcePriceRefreshPort = {
    async matchSource(matchInput) {
      calls.push(`match:${matchInput.scope.kind}`);
      assert.deepEqual(matchInput.scope, { kind: "candidate", candidateId });
      assert.equal(matchInput.pageUrl, input.source.pageUrl);
      return {
        ok: true,
        value: {
          candidateId,
          sourceId,
          normalizedPageUrl: input.source.pageUrl as never,
          isPrimary: true,
        },
      };
    },
    async refreshCapturedPrice(refreshInput) {
      calls.push("refresh");
      assert.deepEqual(refreshInput.target, { candidateId, sourceId });
      assert.equal(refreshInput.price, input.source.price);
      const price = input.source.price;
      assert.ok(price);
      return {
        ok: true,
        value: {
          candidateId,
          sourceId,
          price,
          capturedAt,
          isPrimary: true,
        },
      };
    },
  };
  const router = createDuplicateUrlRouter({
    refresh,
    sourceMutations: sourceMutations(async () => {
      calls.push("add");
      return { ok: true, value: undefined };
    }),
  });

  const result = await router.route(candidateId, input);

  assert.equal(result.ok && result.value.kind, "price-refreshed");
  assert.deepEqual(calls, ["match:candidate", "refresh"]);
});

test("no-match adds the canonical source exactly once", async () => {
  const calls: string[] = [];
  const refresh: SourcePriceRefreshPort = {
    async matchSource() {
      calls.push("match");
      return { ok: false, error: { kind: "no-match" } };
    },
    async refreshCapturedPrice() {
      calls.push("refresh");
      throw new Error("unexpected refresh");
    },
  };
  const router = createDuplicateUrlRouter({
    refresh,
    sourceMutations: sourceMutations(async (actual) => {
      calls.push("add");
      assert.deepEqual(actual, input);
      return { ok: true, value: undefined };
    }),
  });

  const result = await router.route(candidateId, input);

  assert.deepEqual(result, {
    ok: true,
    value: { kind: "source-added", candidateId },
  });
  assert.deepEqual(calls, ["match", "add"]);
});

test("no-match always adds to the selected target rather than an input candidate ID", async () => {
  const untrustedCandidateId =
    "30000000-0000-4000-8000-000000000099" as Uuid as CandidatePartId;
  let addedInput: AddCandidateSourceInput | undefined;
  const router = createDuplicateUrlRouter({
    refresh: {
      async matchSource(matchInput) {
        assert.deepEqual(matchInput.scope, { kind: "candidate", candidateId });
        return { ok: false, error: { kind: "no-match" } };
      },
      async refreshCapturedPrice() {
        throw new Error("unexpected refresh");
      },
    },
    sourceMutations: sourceMutations(async (actual) => {
      addedInput = actual;
      return { ok: true, value: undefined };
    }),
  });

  const result = await router.route(candidateId, {
    ...input,
    candidateId: untrustedCandidateId,
  });

  assert.equal(addedInput?.candidateId, candidateId);
  assert.deepEqual(result, {
    ok: true,
    value: { kind: "source-added", candidateId },
  });
});

test("all non-no-match failures remain failures without fallback", async () => {
  const errors: SourcePriceRefreshError[] = [
    { kind: "ambiguous-match" },
    { kind: "invalid-url" },
    { kind: "ineligible-source" },
    { kind: "stale-target" },
    { kind: "price-unavailable" },
    { kind: "storage" },
  ];
  for (const error of errors) {
    let addCalls = 0;
    const router = createDuplicateUrlRouter({
      refresh: {
        async matchSource() {
          return { ok: false, error };
        },
        async refreshCapturedPrice() {
          throw new Error("unexpected refresh");
        },
      },
      sourceMutations: sourceMutations(async () => {
        addCalls += 1;
        return { ok: true, value: undefined };
      }),
    });

    const result = await router.route(candidateId, input);

    assert.deepEqual(result, {
      ok: false,
      error: { kind: "source-refresh", cause: error },
    });
    assert.equal(addCalls, 0);
  }
});

test("same URL without a price does not refresh or add", async () => {
  let writes = 0;
  const router = createDuplicateUrlRouter({
    refresh: {
      async matchSource() {
        return {
          ok: true,
          value: {
            candidateId,
            sourceId,
            normalizedPageUrl: input.source.pageUrl as never,
            isPrimary: false,
          },
        };
      },
      async refreshCapturedPrice() {
        writes += 1;
        throw new Error("unexpected refresh");
      },
    },
    sourceMutations: sourceMutations(async () => {
      writes += 1;
      return { ok: true, value: undefined };
    }),
  });
  const noPriceInput: AddCandidateSourceInput = {
    ...input,
    source: { ...input.source, price: undefined } as never,
  };

  const result = await router.route(candidateId, noPriceInput);

  assert.deepEqual(result, {
    ok: false,
    error: {
      kind: "source-refresh",
      cause: { kind: "price-unavailable" },
    },
  });
  assert.equal(writes, 0);
});

test("refresh and source-add failures are returned without a second write path", async () => {
  let addCalls = 0;
  const refreshError: SourcePriceRefreshError = { kind: "stale-target" };
  const refreshRouter = createDuplicateUrlRouter({
    refresh: {
      async matchSource() {
        return {
          ok: true,
          value: {
            candidateId,
            sourceId,
            normalizedPageUrl: input.source.pageUrl as never,
            isPrimary: false,
          },
        };
      },
      async refreshCapturedPrice() {
        return { ok: false, error: refreshError };
      },
    },
    sourceMutations: sourceMutations(async () => {
      addCalls += 1;
      return { ok: true, value: undefined };
    }),
  });

  assert.deepEqual(await refreshRouter.route(candidateId, input), {
    ok: false,
    error: { kind: "source-refresh", cause: refreshError },
  });
  assert.equal(addCalls, 0);

  const managementError = { kind: "quota" } as const;
  let refreshCalls = 0;
  const addRouter = createDuplicateUrlRouter({
    refresh: {
      async matchSource() {
        return { ok: false, error: { kind: "no-match" } };
      },
      async refreshCapturedPrice() {
        refreshCalls += 1;
        throw new Error("unexpected refresh");
      },
    },
    sourceMutations: sourceMutations(async () => ({
      ok: false,
      error: managementError,
    })),
  });

  assert.deepEqual(await addRouter.route(candidateId, input), {
    ok: false,
    error: { kind: "source-add", cause: managementError },
  });
  assert.equal(refreshCalls, 0);
});
