import assert from "node:assert/strict";
import test from "node:test";
import type {
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  FeatureId,
} from "../../src/application-shell/contracts.js";
import { isPersistent } from "../../src/application-shell/contracts.js";
import {
  type FeatureContribution,
  featureContributionCatalog,
  getPublicApiContributions,
  getSidePanelContributions,
  getWorkerContributions,
} from "../../src/application-shell/feature-contribution-catalog.js";
import { createSidePanelFeatureContributions } from "../../src/application-shell/side-panel-contributions.js";
import {
  defaultMessageResolver,
  type MessageKey,
  message,
} from "../../src/ui-messages/public.js";

type NavigationMessageKey = Extract<MessageKey, `nav.${string}`>;

const navigationMessage = (key: MessageKey) =>
  message(key as NavigationMessageKey);

const id = (value: string) => value as FeatureId;

function contribution<const TKey extends string, TPublic extends object>(
  key: TKey,
  featureId: string,
  order: number,
  publicApi: TPublic,
  workerRegistration?: ApplicationWorkerRegistration,
): FeatureContribution<TKey, TPublic> {
  const registration: ApplicationFeatureRegistration<TPublic> = {
    id: id(featureId),
    presentation: "persistent",
    navigation: { labelKey: featureId as MessageKey, order },
    publicApi,
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => {},
    async mount() {
      return { async unmount() {} };
    },
  };
  return {
    key,
    registration,
    ...(workerRegistration ? { workerRegistration } : {}),
  };
}

test("worker catalogはworker contributionだけを持つreadonly catalogである", () => {
  assert.deepEqual(featureContributionCatalog, []);
  assert.equal(Object.isFrozen(featureContributionCatalog), true);
  assert.deepEqual(getSidePanelContributions(featureContributionCatalog), []);
  assert.deepEqual(getWorkerContributions(featureContributionCatalog), []);
});

test("side panel contributionは合成contextから実featureを組み立てる", () => {
  const contributions = createSidePanelFeatureContributions({
    data: {
      async query() {
        return { ok: true, value: 0 } as never;
      },
      async mutate() {
        return { ok: true, value: {} } as never;
      },
    },
    fullDataPort: {
      async query() {
        return { ok: true, value: 0 } as never;
      },
      async mutate() {
        return { ok: true, value: {} } as never;
      },
      async assessReplacement() {
        return { ok: true, value: {} } as never;
      },
      async replaceRoot() {
        return { ok: true, value: {} } as never;
      },
      async runMaintenance() {
        return { ok: true, value: {} } as never;
      },
    },
    navigator: {
      async activate() {
        return { ok: true, value: undefined };
      },
    },
  });

  assert.deepEqual(
    contributions.map(({ key }) => key),
    [
      "candidateManagement",
      "currentBuild",
      "productCapture",
      "compatibility",
      "backupRestore",
    ],
  );
  const [candidateManagement, currentBuild, , compatibility] = contributions;
  assert.equal(candidateManagement.registration.id, "candidate-management");
  assert.ok(isPersistent(candidateManagement.registration));
  assert.equal(
    defaultMessageResolver.resolveDescriptor(
      navigationMessage(candidateManagement.registration.navigation.labelKey),
    ),
    defaultMessageResolver("nav.candidateManagement"),
  );
  assert.equal(
    typeof candidateManagement.registration.activation?.validate,
    "function",
  );
  assert.equal(currentBuild.registration.id, "currentBuild");
  assert.ok(isPersistent(currentBuild.registration));
  assert.equal(
    defaultMessageResolver.resolveDescriptor(
      navigationMessage(currentBuild.registration.navigation.labelKey),
    ),
    defaultMessageResolver("nav.currentBuild"),
  );
  assert.equal(
    typeof currentBuild.registration.publicApi.query.getByProject,
    "function",
  );
  assert.equal(compatibility.registration.id, "compatibility");
  assert.ok(isPersistent(compatibility.registration));
  assert.equal(
    defaultMessageResolver.resolveDescriptor(
      navigationMessage(compatibility.registration.navigation.labelKey),
    ),
    defaultMessageResolver("nav.compatibility"),
  );
  assert.equal(
    typeof compatibility.registration.publicApi.query.evaluate,
    "function",
  );
});

test("複数contributionを決定順でside panel・public API入力へ型付き提供する", () => {
  const builds = contribution("builds", "builds", 20, { count: () => 2 });
  const catalog = contribution("catalog", "catalog", 10, {
    find: (partId: string) => `part:${partId}`,
  });
  const alpha = contribution("alpha", "alpha", 20, { ready: true });

  const selected = getSidePanelContributions([builds, catalog, alpha] as const);

  assert.deepEqual(
    selected.map(({ registration }) => registration.id),
    [id("catalog"), id("alpha"), id("builds")],
  );
  const publicEntries = getPublicApiContributions([
    builds,
    catalog,
    alpha,
  ] as const);
  assert.deepEqual(
    publicEntries.map(({ key }) => key),
    ["catalog", "alpha", "builds"],
  );
  const catalogEntry = publicEntries.find((entry) => entry.key === "catalog");
  assert.ok(catalogEntry);
  assert.equal(catalogEntry.publicApi.find("cpu"), "part:cpu");
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(Object.isFrozen(publicEntries), true);
});

test("worker入力はworker registrationだけを同じ決定順で提供する", () => {
  const firstWorker: ApplicationWorkerRegistration = {
    id: id("first"),
    register: () => ({ ok: true, value: () => {} }),
  };
  const secondWorker: ApplicationWorkerRegistration = {
    id: id("second"),
    register: () => ({ ok: true, value: () => {} }),
  };
  const selected = getWorkerContributions([
    contribution("second", "second", 20, {}, secondWorker),
    contribution("ui-only", "ui-only", 15, {}),
    contribution("first", "first", 10, {}, firstWorker),
  ] as const);

  assert.deepEqual(selected, [firstWorker, secondWorker]);
  assert.equal(Object.isFrozen(selected), true);
});

test("一過性contributionをnavigation順へ混入させずbranch-safeに整列する", () => {
  const persistent = contribution("persistent", "persistent", 10, {});
  const transient: FeatureContribution<"transient", object> = {
    key: "transient",
    registration: {
      id: id("transient"),
      presentation: "transient",
      publicApi: {},
      getAvailability: () => ({ status: "available" }),
      subscribeAvailability: () => () => undefined,
      mount: async () => ({ unmount: async () => undefined }),
    },
  };

  assert.deepEqual(
    getSidePanelContributions([transient, persistent]).map(
      ({ registration }) => registration.id,
    ),
    ["persistent", "transient"],
  );
});
