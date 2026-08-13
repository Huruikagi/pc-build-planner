import assert from "node:assert/strict";
import test from "node:test";
import {
  createChromeExclusiveLockAdapter,
  type ChromeLocksApi,
} from "../../src/chrome/locks-adapter.js";

const createStub = () => {
  const tails = new Map<string, Promise<void>>();
  const requests: Array<{ readonly name: string; readonly mode: string }> = [];
  const api: ChromeLocksApi = {
    async request(name, options, callback) {
      requests.push({ name, mode: options.mode });
      const previous = tails.get(name) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(name, current);
      await previous;
      try {
        return await callback();
      } finally {
        release();
        if (tails.get(name) === current) tails.delete(name);
      }
    },
  };
  return { api, requests };
};

test("consumer指定の一つのidentityをexclusive modeで要求する", async () => {
  const stub = createStub();
  const lock = createChromeExclusiveLockAdapter(stub.api, "synthetic-root-write");

  assert.deepEqual(await lock.runExclusive(async () => 42), {
    ok: true,
    value: 42,
  });
  assert.deepEqual(stub.requests, [
    { name: "synthetic-root-write", mode: "exclusive" },
  ]);
});

test("同名の複数clientを直列化して同時holderを一件に限定する", async () => {
  const stub = createStub();
  const first = createChromeExclusiveLockAdapter(stub.api, "shared-root");
  const second = createChromeExclusiveLockAdapter(stub.api, "shared-root");
  let holders = 0;
  let maximumHolders = 0;
  let releaseFirst = () => {};
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const firstRequest = first.runExclusive(async () => {
    holders += 1;
    maximumHolders = Math.max(maximumHolders, holders);
    await firstMayFinish;
    holders -= 1;
    return "first";
  });
  const secondRequest = second.runExclusive(async () => {
    holders += 1;
    maximumHolders = Math.max(maximumHolders, holders);
    holders -= 1;
    return "second";
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximumHolders, 1);
  releaseFirst();
  assert.deepEqual(await Promise.all([firstRequest, secondRequest]), [
    { ok: true, value: "first" },
    { ok: true, value: "second" },
  ]);
  assert.equal(maximumHolders, 1);
});

test("callback throw後にlockを解放して次requestを進める", async () => {
  const stub = createStub();
  const first = createChromeExclusiveLockAdapter(stub.api, "shared-root");
  const second = createChromeExclusiveLockAdapter(stub.api, "shared-root");
  const callbackFailure = new Error("synthetic callback failure");

  await assert.rejects(
    first.runExclusive(async () => {
      throw callbackFailure;
    }),
    (cause) => cause === callbackFailure,
  );
  assert.deepEqual(await second.runExclusive(async () => "continued"), {
    ok: true,
    value: "continued",
  });
});

test("platform failureをstable lock-unavailableへ正規化しcallbackを実行しない", async () => {
  let callbackCalls = 0;
  const lock = createChromeExclusiveLockAdapter(
    {
      async request() {
        throw { privatePlatformValue: "must-not-leak" };
      },
    },
    "shared-root",
  );

  assert.deepEqual(
    await lock.runExclusive(async () => {
      callbackCalls += 1;
      return "unreachable";
    }),
    { ok: false, error: { code: "lock-unavailable" } },
  );
  assert.equal(callbackCalls, 0);
});

test("platform failureとcallback値をconsoleへ出力しない", async () => {
  const calls: unknown[][] = [];
  const methods = ["debug", "error", "info", "log", "warn"] as const;
  const originals = Object.fromEntries(
    methods.map((method) => [method, console[method]]),
  ) as Record<(typeof methods)[number], typeof console.log>;
  for (const method of methods) {
    console[method] = (...values: unknown[]) => calls.push([method, ...values]);
  }

  try {
    const secret = { root: "private-root" };
    const lock = createChromeExclusiveLockAdapter(
      {
        async request() {
          throw { cause: "platform-secret", secret };
        },
      },
      "shared-root",
    );
    assert.deepEqual(await lock.runExclusive(async () => secret), {
      ok: false,
      error: { code: "lock-unavailable" },
    });
    assert.deepEqual(calls, []);
  } finally {
    for (const method of methods) console[method] = originals[method];
  }
});
