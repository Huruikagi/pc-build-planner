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
import type {
  CandidateSourceId,
  LocalDataRoot,
  Revision,
} from "../../src/domain/public.js";
import type { RootMutationCommand } from "../../src/persistence/public.js";
import {
  defaultMessageResolver,
  type MessageKey,
  message,
} from "../../src/ui-messages/public.js";
import { sourceRoot } from "../fixtures/candidate-source-root.js";

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
      "settings",
    ],
  );
  const [candidateManagement, currentBuild, productCapture, compatibility] =
    contributions;
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
  assert.equal(productCapture.registration.id, "product-capture");
  assert.equal(productCapture.registration.presentation, "transient");
  assert.equal("navigation" in productCapture.registration, false);
  assert.deepEqual(Object.keys(productCapture).sort(), ["key", "registration"]);
  assert.deepEqual(
    Object.keys(candidateManagement.registration.publicApi).sort(),
    ["createCandidateEditorIntent", "query", "sources"],
  );
  assert.deepEqual(
    Object.keys(candidateManagement.registration.publicApi.sources).sort(),
    ["catalog", "mutations"],
  );
  assert.equal("capture" in candidateManagement.registration.publicApi, false);
  assert.equal(
    "openCandidateEditor" in candidateManagement.registration.publicApi,
    false,
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
  const settings = contributions[4];
  assert.equal(settings.registration.id, "settings");
  assert.ok(isPersistent(settings.registration));
  assert.deepEqual(settings.registration.navigation, {
    labelKey: "nav.settings",
    order: 60,
    icon: "settings",
  });
  assert.deepEqual(settings.registration.publicApi, {});
});

test("production capture compositionは公開lifecycleとintent factoryだけで起動・cleanupする", async () => {
  const lifecycleEvents: unknown[] = [];
  const context = {
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
    transientSurface: {
      isCurrent() {
        lifecycleEvents.push("isCurrent");
        return true;
      },
      async conclude(activationId: unknown, intent: unknown) {
        lifecycleEvents.push({ activationId, intent });
        return { ok: true as const, value: undefined };
      },
    },
  };
  const contributions = createSidePanelFeatureContributions(context as never, {
    tabs: {
      async get(tabId) {
        return {
          id: tabId,
          url: "https://catalog.example.invalid/production-part",
        };
      },
      async create() {
        return {};
      },
    },
    scripting: {
      async executeScript(injection) {
        return injection.files === undefined
          ? [
              {
                result: {
                  pageUrl: "https://catalog.example.invalid/production-part",
                  candidates: [
                    {
                      field: "name",
                      rawValue: "架空 production CPU",
                      source: "heading",
                      sourceLabel: "h1",
                    },
                  ],
                },
              },
            ]
          : [{}];
      },
    },
  });
  const candidateManagement = contributions[0];
  const productCapture = contributions[2];
  const activation = productCapture.registration.activation;
  assert.ok(activation);
  await assert.rejects(
    productCapture.registration.mount({
      container: document.createElement("div"),
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    }),
  );
  assert.deepEqual(lifecycleEvents, []);
  const validated = activation.validate({
    featureId: productCapture.registration.id,
    target: "capture",
    payload: { activationId: "production-activation", tabId: 41 },
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  await activation.activate(validated.value);
  assert.deepEqual(lifecycleEvents, []);

  const container = document.createElement("div");
  const handle = await productCapture.registration.mount({
    container,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });
  assert.equal(
    typeof candidateManagement.registration.publicApi
      .createCandidateEditorIntent,
    "function",
  );
  await new Promise((resolve) => setImmediate(resolve));
  const start = container.querySelector<HTMLButtonElement>(
    "[data-capture-start]",
  );
  assert.ok(start);
  start.click();
  for (
    let attempt = 0;
    attempt < 20 && lifecycleEvents.length < 3;
    attempt += 1
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(lifecycleEvents[0], "isCurrent");
  assert.equal(lifecycleEvents[1], "isCurrent");
  assert.partialDeepStrictEqual(lifecycleEvents[2], {
    activationId: "production-activation",
    intent: {
      featureId: "candidate-management",
      target: "open-candidate-editor",
      payload: {
        draft: {
          category: "uncategorized",
          normalizedAttributes: { category: "uncategorized" },
          product: {
            name: {
              confirmed: "架空 production CPU",
              original: "架空 production CPU",
            },
          },
        },
      },
    },
  });
  const completedEventCount = lifecycleEvents.length;
  await handle.unmount();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycleEvents.length, completedEventCount);
  assert.equal(container.childElementCount, 0);
});

test("side panel compositionはtabs.createを候補再訪portへ注入する", async () => {
  let injectedTabs:
    | { create(details: { readonly url: string }): Promise<unknown> }
    | undefined;
  const context = {
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
  };
  const contributions = createSidePanelFeatureContributions(
    context as never,
    {
      tabs: {
        async get(id) {
          return { id };
        },
        async create({ url }) {
          return { url };
        },
      },
      scripting: {
        async executeScript() {
          return [];
        },
      },
    },
    {
      createSourcePagePort(tabs) {
        injectedTabs = tabs;
        return {
          async open() {
            return { ok: false, error: { kind: "runtime-unavailable" } };
          },
        };
      },
    },
  );
  assert.equal(contributions[0].registration.id, "candidate-management");
  assert.ok(injectedTabs);
  assert.deepEqual(
    await injectedTabs.create({ url: "https://shop.example.invalid/item" }),
    {
      url: "https://shop.example.invalid/item",
    },
  );
});

test("production side panel compositionはcanonical dataをsource catalogとmutationへ接続する", async () => {
  const root: LocalDataRoot = { ...sourceRoot(), revision: 7 as Revision };
  const commands: RootMutationCommand[] = [];
  const data = {
    async query<T>(project: (snapshot: LocalDataRoot) => T) {
      return { ok: true as const, value: project(root) };
    },
    async mutate(command: RootMutationCommand) {
      commands.push(command);
      return { ok: true as const, value: {} as never };
    },
  };
  const contributions = createSidePanelFeatureContributions({
    data,
    fullDataPort: {
      ...data,
      async assessReplacement() {
        return { ok: true as const, value: {} as never };
      },
      async replaceRoot() {
        return { ok: true as const, value: {} as never };
      },
      async runMaintenance() {
        return { ok: true as const, value: {} as never };
      },
    },
    navigator: {
      async activate() {
        return { ok: true as const, value: undefined };
      },
    },
  });
  const api = contributions[0].registration.publicApi.sources;
  const listed = await api.catalog.listSourceReferences({});
  assert.equal(listed.ok && listed.value.length, 2);

  const candidate = root.candidateParts[0];
  const source = candidate?.sources[0];
  assert.ok(candidate && source);
  const updated = await api.mutations.updateSource({
    candidateId: candidate.id,
    source: { ...source, siteName: "更新後の架空販売店" },
  });
  assert.equal(updated.ok, true);
  assert.equal(commands.length, 1);
  const command = commands[0];
  assert.ok(command);
  assert.equal(command.operation.kind, "update");
  assert.equal(command.operation.entity, "candidatePart");
  assert.equal(command.expectedRevision, 7);
  assert.equal(
    (command.operation.value as LocalDataRoot["candidateParts"][number])
      .sources[0]?.siteName,
    "更新後の架空販売店",
  );
  assert.equal(candidate.primarySourceId as CandidateSourceId, source.id);
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
      transientActivation: {
        validate: (request) => ({ ok: true, value: request }),
        accept: async () => ({
          ok: true,
          value: { release: async () => undefined },
        }),
      },
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
