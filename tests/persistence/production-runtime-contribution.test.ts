import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeProductionFoundationRuntimeContribution } from "../../src/persistence/public.js";
import { createInitialRoot } from "../../src/persistence/schema.js";

const installGlobal = (key: "chrome" | "navigator", value: unknown) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  return () => {
    if (original) Object.defineProperty(globalThis, key, original);
    else Reflect.deleteProperty(globalThis, key);
  };
};

test("公開production factoryはglobal platformと固定policyをfoundation内で解決する", async () => {
  let restrictions = 0;
  let handler:
    | ((message: unknown, caller: unknown) => Promise<unknown>)
    | undefined;
  const root = createInitialRoot();
  const restoreChrome = installGlobal("chrome", {
    storage: {
      local: {
        QUOTA_BYTES: 10 * 1024 * 1024,
        async get() {
          return { localDataRoot: root };
        },
        async set() {},
        async getBytesInUse() {
          return 100;
        },
        async setAccessLevel() {
          restrictions += 1;
        },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
  });
  const restoreNavigator = installGlobal("navigator", {
    locks: {
      async request<T>(
        _name: string,
        _options: unknown,
        callback: () => Promise<T>,
      ) {
        return callback();
      },
    },
  });
  try {
    const result = await initializeProductionFoundationRuntimeContribution();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(restrictions, 1);
    const registration = await result.value.workerRegistration.register({
      addHandler(next) {
        handler = next;
        return () => {
          handler = undefined;
        };
      },
    });
    assert.equal(registration.ok, true);
    assert.ok(handler);
    assert.deepEqual(
      await handler?.({ kind: "query-root" }, { kind: "content-script" }),
      {
        ok: false,
        error: { code: "caller-denied" },
      },
    );
    assert.equal(
      (
        (await handler(
          { kind: "query-root" },
          { kind: "trusted-extension" },
        )) as { ok: boolean }
      ).ok,
      true,
    );
    await result.value.dispose();
    await result.value.dispose();
  } finally {
    restoreNavigator();
    restoreChrome();
  }
});

test("global欠落とgetter例外は副作用前にinvalid-platformとなる", async () => {
  let restrictions = 0;
  const restoreChrome = installGlobal("chrome", {
    storage: {
      local: {
        get QUOTA_BYTES() {
          throw new Error("secret");
        },
        async get() {
          return {};
        },
        async set() {},
        async getBytesInUse() {
          return 0;
        },
        async setAccessLevel() {
          restrictions += 1;
        },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
  });
  const restoreNavigator = installGlobal("navigator", {
    locks: { request() {} },
  });
  try {
    assert.deepEqual(
      await initializeProductionFoundationRuntimeContribution(),
      {
        ok: false,
        error: { code: "invalid-platform" },
      },
    );
    assert.equal(restrictions, 0);
  } finally {
    restoreNavigator();
    restoreChrome();
  }
});

test("Chrome global欠落はinvalid-platformとなる", async () => {
  const restoreChrome = installGlobal("chrome", undefined);
  const restoreNavigator = installGlobal("navigator", {
    locks: { request() {} },
  });
  try {
    assert.deepEqual(
      await initializeProductionFoundationRuntimeContribution(),
      { ok: false, error: { code: "invalid-platform" } },
    );
  } finally {
    restoreNavigator();
    restoreChrome();
  }
});
