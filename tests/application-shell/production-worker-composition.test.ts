import assert from "node:assert/strict";
import test from "node:test";
import type {
  FeatureId,
  WorkerRegistrationContext,
} from "../../src/application-shell/contracts.js";
import type { FeatureContribution } from "../../src/application-shell/feature-contribution-catalog.js";
import { createProductionWorkerComposition } from "../../src/application-shell/production-worker-composition.js";
import type {
  FoundationRuntimeContribution,
  WorkerMessageTarget,
} from "../../src/persistence/public.js";

const target: WorkerMessageTarget = { addHandler: () => () => {} };
const context: WorkerRegistrationContext = {
  addActionHandler: () => () => {},
  reportError() {},
};

const fixture = (
  options: {
    init?: "fail";
    foundation?: "fail";
    catalog?: "fail";
    empty?: boolean;
  } = {},
) => {
  const events: string[] = [];
  const foundation: FoundationRuntimeContribution = {
    maintenanceSource: {
      getSnapshot: async () => ({
        ok: true,
        value: { generation: 0, revision: 0, active: false } as never,
      }),
      subscribe: () => () => {},
    },
    dataPort: {
      query: async () => ({ ok: true, value: {} as never }),
      mutate: async () => ({ ok: true, value: {} as never }),
    },
    fullDataPort: {
      query: async () => ({ ok: true, value: {} as never }),
      mutate: async () => ({ ok: true, value: {} as never }),
      assessReplacement: async () => ({ ok: true, value: {} as never }),
      replaceRoot: async () => ({ ok: true, value: {} as never }),
      runMaintenance: async () => ({ ok: true, value: {} as never }),
    },
    workerRegistration: {
      async register() {
        events.push("foundation:register");
        return options.foundation === "fail"
          ? { ok: false, error: { code: "invalid-target" } }
          : {
              ok: true,
              value: () => {
                events.push("foundation:remove");
              },
            };
      },
    },
    dispose() {
      events.push("foundation:dispose");
    },
  };
  const catalog: readonly FeatureContribution[] = options.empty
    ? []
    : [
        {
          key: "feature",
          registration: {
            id: "feature" as FeatureId,
            navigation: { label: "Feature", order: 1 },
            publicApi: {},
            getAvailability: () => ({ status: "available" }),
            subscribeAvailability: () => () => {},
            async mount() {
              return { async unmount() {} };
            },
          },
          workerRegistration: {
            id: "feature" as FeatureId,
            register() {
              events.push("catalog:register");
              return options.catalog === "fail"
                ? {
                    ok: false,
                    error: { kind: "invalid_registration", detail: "failed" },
                  }
                : { ok: true, value: () => events.push("catalog:remove") };
            },
          },
        },
      ];
  const composition = createProductionWorkerComposition({
    initializeFoundation: async () => {
      events.push("foundation:init");
      return options.init === "fail"
        ? { ok: false, error: { code: "invalid-platform" } }
        : { ok: true, value: foundation };
    },
    foundationTarget: target,
    catalog,
    workerContext: context,
  });
  return { composition, events };
};

test("foundation、handler、catalogの順で起動し逆順に停止する", async () => {
  const { composition, events } = fixture();
  assert.deepEqual(await composition.start(), { ok: true, value: undefined });
  await composition.stop();
  await composition.stop();
  assert.deepEqual(events, [
    "foundation:init",
    "foundation:register",
    "catalog:register",
    "catalog:remove",
    "foundation:remove",
    "foundation:dispose",
  ]);
});

test("空catalogでも成功する", async () => {
  const { composition, events } = fixture({ empty: true });
  assert.equal((await composition.start()).ok, true);
  await composition.stop();
  assert.deepEqual(events, [
    "foundation:init",
    "foundation:register",
    "foundation:remove",
    "foundation:dispose",
  ]);
});

for (const failure of ["init", "foundation", "catalog"] as const)
  test(`${failure} failureを型付き失敗へ正規化してrollbackする`, async () => {
    const { composition, events } = fixture({ [failure]: "fail" });
    const result = await composition.start();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "startup_failed");
    assert.deepEqual(
      events,
      failure === "init"
        ? ["foundation:init"]
        : failure === "foundation"
          ? ["foundation:init", "foundation:register", "foundation:dispose"]
          : [
              "foundation:init",
              "foundation:register",
              "catalog:register",
              "foundation:remove",
              "foundation:dispose",
            ],
    );
  });

test("concurrent startはsingle-flightになる", async () => {
  const { composition, events } = fixture();
  const one = composition.start();
  const two = composition.start();
  assert.equal(one, two);
  await Promise.all([one, two]);
  assert.equal(events.filter((e) => e === "foundation:init").length, 1);
  await composition.stop();
});

test("遅延registration中のstopはcatalogを開始せず完了resourceを解放する", async () => {
  const events: string[] = [];
  let release!: () => void;
  let registrationStarted!: () => void;
  const deferred = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enteredRegistration = new Promise<void>((resolve) => {
    registrationStarted = resolve;
  });
  const foundation: FoundationRuntimeContribution = {
    maintenanceSource: {
      getSnapshot: async () => ({
        ok: true,
        value: { generation: 0, revision: 0, active: false } as never,
      }),
      subscribe: () => () => {},
    },
    dataPort: {
      query: async () => ({ ok: true, value: {} as never }),
      mutate: async () => ({ ok: true, value: {} as never }),
    },
    fullDataPort: {
      query: async () => ({ ok: true, value: {} as never }),
      mutate: async () => ({ ok: true, value: {} as never }),
      assessReplacement: async () => ({ ok: true, value: {} as never }),
      replaceRoot: async () => ({ ok: true, value: {} as never }),
      runMaintenance: async () => ({ ok: true, value: {} as never }),
    },
    workerRegistration: {
      async register() {
        events.push("foundation:register");
        registrationStarted();
        await deferred;
        return {
          ok: true as const,
          value: () => {
            events.push("foundation:remove");
          },
        };
      },
    },
    dispose() {
      events.push("foundation:dispose");
    },
  };
  const composition = createProductionWorkerComposition({
    initializeFoundation: async () => ({ ok: true, value: foundation }),
    foundationTarget: target,
    catalog: fixture().composition ? [] : [],
    workerContext: context,
  });
  const starting = composition.start();
  await enteredRegistration;
  const stopping = composition.stop();
  release();
  const result = await starting;
  await stopping;
  assert.equal(result.ok, false);
  assert.deepEqual(events, [
    "foundation:register",
    "foundation:remove",
    "foundation:dispose",
  ]);
});
