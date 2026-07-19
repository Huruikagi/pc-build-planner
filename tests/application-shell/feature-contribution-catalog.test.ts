import assert from "node:assert/strict";
import test from "node:test";
import type {
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  FeatureId,
} from "../../src/application-shell/contracts.js";
import {
  type FeatureContribution,
  featureContributionCatalog,
  getPublicApiContributions,
  getSidePanelContributions,
  getWorkerContributions,
} from "../../src/application-shell/feature-contribution-catalog.js";

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
    navigation: { label: featureId, order },
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

test("production catalogはplaceholderを持たないreadonlyな空catalogである", () => {
  assert.deepEqual(featureContributionCatalog, []);
  assert.equal(Object.isFrozen(featureContributionCatalog), true);
  assert.deepEqual(getSidePanelContributions(featureContributionCatalog), []);
  assert.deepEqual(getWorkerContributions(featureContributionCatalog), []);
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
