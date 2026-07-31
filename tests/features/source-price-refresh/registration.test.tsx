import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { cleanup } from "@testing-library/react";
import { act } from "react";
import { createFeatureRegistry } from "../../../src/application-shell/feature-registry.js";
import type {
  ActivationId,
  ApplicationFeatureRegistration,
  FeatureId,
  FeatureMountHandle,
  TargetTabId,
  TransientActivationRequest,
} from "../../../src/application-shell/public.js";
import { createSidePanelHost } from "../../../src/application-shell/side-panel-host.js";
import { createTransientSurfaceController } from "../../../src/application-shell/transient-surface-controller.js";
import {
  type CandidatePartId,
  type CandidateSourceId,
  err,
  ok,
  type Result,
  type UtcTimestamp,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateQuery,
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
  ManagementError,
} from "../../../src/features/candidate-management/public.js";
import type { PagePriceExtractionPort } from "../../../src/features/product-capture/public.js";
import type {
  SourcePriceRefreshError,
  SourcePriceRefreshPublicApi,
  SourcePriceRefreshReceipt,
} from "../../../src/features/source-price-refresh/contracts.js";
import { createSourcePriceRefreshContribution } from "../../../src/features/source-price-refresh/feature-contribution.js";
import { sourcePriceRefreshFeatureId } from "../../../src/features/source-price-refresh/public.js";
import { createSourcePriceRefreshFeatureRegistration } from "../../../src/features/source-price-refresh/registration.js";
import {
  createSourcePriceRefreshState,
  type SourcePriceRefreshState,
  type SourcePriceRefreshWorkflowInput,
} from "../../../src/features/source-price-refresh/state.js";
import type {
  MessageKey,
  MessageResolver,
} from "../../../src/ui-messages/public.js";
import {
  resolverFor,
  SOURCE_LANGUAGE,
} from "../../../src/ui-messages/public.js";

const messages: MessageResolver = resolverFor(SOURCE_LANGUAGE);

const candidateId = "30000000-0000-4000-8000-00000000000a" as CandidatePartId;
const sourceId = "40000000-0000-4000-8000-00000000000a" as CandidateSourceId;
const capturedAt = "2026-07-31T09:30:00.000Z" as UtcTimestamp;
const activationId = "activation-1" as ActivationId;
const tabId = 4242 as TargetTabId;
const persistentId = "fixture-planner" as FeatureId;

type RefreshResult = Result<SourcePriceRefreshReceipt, SourcePriceRefreshError>;

const receipt: SourcePriceRefreshReceipt = {
  candidateId,
  sourceId,
  price: {
    original: "架空表記 48,800円",
    confirmed: { amount: 48800, currency: "JPY" },
  },
  capturedAt,
  isPrimary: true,
};

/** A stand-in for the feature's own public port; this task never exercises it. */
const publicApi: SourcePriceRefreshPublicApi = {
  refresh: {
    matchSource: async () => err({ kind: "no-match" }),
    refreshCapturedPrice: async () => err({ kind: "no-match" }),
  },
};

const mountContext = (container: HTMLElement) => ({
  container,
  operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
  reportError: () => {},
});

const request = (
  overrides: Partial<TransientActivationRequest> = {},
): TransientActivationRequest => ({
  activationId,
  surfaceId: sourcePriceRefreshFeatureId,
  tabId,
  ...overrides,
});

/**
 * Deferred workflow harness. Every state the registration creates is recorded,
 * so teardown (listeners, displayed value) and late callbacks stay observable.
 */
const createWorkflowHarness = () => {
  const started: SourcePriceRefreshWorkflowInput[] = [];
  const settlers: ((result: RefreshResult) => void)[] = [];
  const states: SourcePriceRefreshState[] = [];
  let isCurrent: (value: ActivationId) => boolean = () => true;
  return {
    started,
    states,
    useLifecycle(next: (value: ActivationId) => boolean) {
      isCurrent = next;
    },
    createState(): SourcePriceRefreshState {
      const state = createSourcePriceRefreshState({
        isCurrent: (value) => isCurrent(value),
        runRefresh: async (input) => {
          started.push(input);
          return await new Promise<RefreshResult>((resolve) => {
            settlers.push(resolve);
          });
        },
      });
      states.push(state);
      return state;
    },
    /** Completes the oldest in-flight run, flushing the React work it causes. */
    async settle(result: RefreshResult) {
      const resolve = settlers.shift();
      assert.ok(resolve, "実行中のworkflowが存在する");
      await act(async () => {
        resolve(result);
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    hasPendingRun: () => settlers.length > 0,
  };
};

type WorkflowHarness = ReturnType<typeof createWorkflowHarness>;

const registrationFor = (harness: WorkflowHarness) =>
  createSourcePriceRefreshFeatureRegistration({
    createState: () => harness.createState(),
    publicApi,
  });

/**
 * The React root is owned by the registration rather than by testing-library,
 * so shell-driven mounts are wrapped in `act` exactly as the application shell
 * contract kit does. Component-level rendering stays in `view.test.tsx`.
 */
const mountRegistration = async (
  registration: ApplicationFeatureRegistration<
    SourcePriceRefreshPublicApi,
    never,
    TransientActivationRequest
  >,
  container: HTMLElement,
): Promise<FeatureMountHandle> => {
  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await registration.mount(mountContext(container));
  });
  assert.ok(handle, "mount handleを返す");
  return handle;
};

/**
 * Drains the macrotask the registration schedules its run on. The shell marks
 * an activation current only after the whole mount transition (a microtask
 * chain) has drained, so the start is deliberately one macrotask later.
 */
const flushStart = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

const persistentRegistration = (): ApplicationFeatureRegistration => ({
  id: persistentId,
  presentation: "persistent",
  navigation: { labelKey: "nav.candidates" as MessageKey, order: 0 },
  publicApi: {},
  getAvailability: () => ({ status: "available" }),
  subscribeAvailability: () => () => {},
  async mount(context) {
    const node = context.container.ownerDocument.createElement("p");
    node.dataset.region = "persistent";
    node.textContent = "persistent";
    context.container.replaceChildren(node);
    return {
      async unmount() {
        context.container.replaceChildren();
      },
    };
  },
});

/**
 * Side panel contract fixture: the canonical registry, side panel host and
 * transient surface controller, with one persistent feature to return to. It is
 * the shell-owned path a production side panel takes, minus the production
 * contribution wiring that task 4.4 owns.
 */
const createSidePanelContractFixture = () => {
  const harness = createWorkflowHarness();
  const registration = registrationFor(harness);
  const registry = createFeatureRegistry();
  assert.equal(registry.register(persistentRegistration()).ok, true);
  assert.equal(registry.register(registration).ok, true);
  const container = document.createElement("div");
  const diagnostics: string[] = [];
  const host = createSidePanelHost({
    registry,
    container,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    onStateChange: () => {},
    reportError: (value) => diagnostics.push(value),
  });
  const controller = createTransientSurfaceController({
    host: {
      getSelected: host.getSelected,
      isTransientAvailable: (id) => id === sourcePriceRefreshFeatureId,
      async showTransient(value) {
        const result = await host.showTransient(value);
        return result.ok
          ? ok(undefined)
          : err({ kind: "transition-failed" as const });
      },
      async restorePersistent(preferred, reason) {
        const result = await host.restorePersistent(preferred, reason);
        return result.ok
          ? ok(undefined)
          : err({ kind: "transition-failed" as const });
      },
      async activate() {
        return ok(undefined);
      },
    },
  });
  harness.useLifecycle(controller.isCurrent);
  return {
    harness,
    registration,
    container,
    host,
    controller,
    diagnostics,
    text: () => container.textContent ?? "",
    surfaces: () =>
      container.querySelectorAll("section.source-price-refresh").length,
    async start() {
      await act(async () => {
        await host.start();
        await controller.start();
      });
    },
    async request(value: TransientActivationRequest = request()) {
      let result: Awaited<ReturnType<typeof controller.request>> | undefined;
      await act(async () => {
        result = await controller.request(value);
      });
      assert.ok(result);
      await flushStart();
      return result;
    },
    async run(command: () => Promise<unknown>) {
      await act(async () => {
        await command();
      });
    },
    async dispose() {
      await act(async () => {
        await controller.stop();
        await host.stop();
      });
      registry.dispose?.();
    },
  };
};

const openFixtures: { dispose(): Promise<void> }[] = [];

const openFixture = async () => {
  const fixture = createSidePanelContractFixture();
  openFixtures.push(fixture);
  await fixture.start();
  return fixture;
};

afterEach(async () => {
  cleanup();
  while (openFixtures.length > 0) await openFixtures.pop()?.dispose();
});

test("registrationはnavigationを持たないcanonical transient memberである", () => {
  const registration = registrationFor(createWorkflowHarness());

  assert.equal(registration.id, sourcePriceRefreshFeatureId);
  assert.equal(registration.presentation, "transient");
  assert.equal("navigation" in registration, false);
  assert.equal(registration.navigation, undefined);
  assert.equal(typeof registration.transientActivation.validate, "function");
});

test("常設navigationからも拡張アイコン起動からも価格更新を開始できない", async () => {
  const fixture = await openFixture();

  assert.equal(
    fixture.registration.activation,
    undefined,
    "常設featureからのhandoff activationを受け付けない",
  );
  const selected = await fixture.host.select(sourcePriceRefreshFeatureId);
  assert.equal(selected.ok, false);
  assert.equal(fixture.host.getSelected(), persistentId);
  assert.equal(fixture.harness.started.length, 0);
});

test("有効なactivationはmountだけで自動的にworkflowを開始する", async () => {
  const harness = createWorkflowHarness();
  const registration = registrationFor(harness);
  const container = document.createElement("div");

  const validated = registration.transientActivation.validate(request());
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const accepted = await registration.transientActivation.accept(
    validated.value,
  );
  assert.equal(accepted.ok, true);
  assert.equal(harness.started.length, 0, "受理だけではページへ触れない");

  await mountRegistration(registration, container);
  await flushStart();

  assert.deepEqual(harness.started, [{ activationId, tabId }]);
  assert.match(
    container.textContent ?? "",
    new RegExp(messages("sourcePriceRefresh.runningStatus")),
  );
  assert.equal(
    container.querySelector("button, input, a[href]"),
    null,
    "第二の実行gestureを要求しない",
  );
});

test("不正なactivationIdとtabIdは境界で拒否され実行を開始しない", async () => {
  const harness = createWorkflowHarness();
  const registration = registrationFor(harness);
  const rejected: readonly TransientActivationRequest[] = [
    request({ activationId: "" as ActivationId }),
    request({ tabId: 0 as TargetTabId }),
    request({ tabId: -1 as TargetTabId }),
    request({ tabId: 1.5 as TargetTabId }),
    // Untrusted shell input: the payload can carry a non-numeric tab id.
    request({ tabId: "4242" as unknown as TargetTabId }),
    request({ surfaceId: "other-surface" as FeatureId }),
  ];

  for (const value of rejected)
    assert.equal(
      registration.transientActivation.validate(value).ok,
      false,
      `${String(value.activationId)}/${String(value.tabId)}: 境界検証で拒否する`,
    );

  await assert.rejects(
    registration.mount(mountContext(document.createElement("div"))),
  );
  assert.equal(harness.started.length, 0);
});

test("単一の主表示領域が進行から結果viewへ切り替わる", async () => {
  const fixture = await openFixture();

  const accepted = await fixture.request();
  assert.equal(accepted.ok, true);
  assert.equal(fixture.surfaces(), 1);
  assert.match(
    fixture.text(),
    new RegExp(messages("sourcePriceRefresh.runningStatus")),
  );

  await fixture.harness.settle(ok(receipt));

  assert.equal(fixture.surfaces(), 1);
  assert.match(
    fixture.text(),
    new RegExp(messages("sourcePriceRefresh.succeededStatus")),
  );
  assert.match(
    fixture.text(),
    new RegExp(
      messages("sourcePriceRefresh.priceValue", {
        amount: 48800,
        currency: "JPY",
      }),
    ),
  );
  assert.doesNotMatch(fixture.text(), /persistent/);
});

test("unmountはReact root・subscription・後着callbackを破棄する", async () => {
  const harness = createWorkflowHarness();
  const registration = registrationFor(harness);
  const container = document.createElement("div");
  const validated = registration.transientActivation.validate(request());
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(
    (await registration.transientActivation.accept(validated.value)).ok,
    true,
  );
  const handle = await mountRegistration(registration, container);
  await flushStart();
  const state = harness.states[0];
  assert.ok(state);
  assert.ok(state.listenerCount > 0, "mount中はviewがstateを購読する");

  await act(async () => {
    await handle.unmount();
    await handle.unmount();
  });

  assert.equal(container.textContent, "");
  assert.equal(container.childNodes.length, 0);
  assert.equal(state.listenerCount, 0);
  assert.equal(state.value, null);

  await harness.settle(ok(receipt));

  assert.equal(state.value, null, "後着callbackは何も変えない");
  assert.equal(container.textContent, "");
});

test("開始前にunmountされたactivationは一度も実行を開始しない", async () => {
  const harness = createWorkflowHarness();
  const registration = registrationFor(harness);
  const container = document.createElement("div");
  const validated = registration.transientActivation.validate(request());
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(
    (await registration.transientActivation.accept(validated.value)).ok,
    true,
  );
  // Mount and unmount inside one `act` callback: `mount` only ever awaits
  // microtasks, so the event loop cannot reach its timer phase in between and
  // the scheduled start is provably still pending when `unmount` cancels it.
  await act(async () => {
    const handle = await registration.mount(mountContext(container));
    await handle.unmount();
  });
  await flushStart();

  assert.equal(harness.started.length, 0);
  assert.equal(harness.hasPendingRun(), false);
  assert.equal(container.textContent, "");
});

test("対象tabの失効で一過性面を終了し常設面へ戻す", async () => {
  const fixture = await openFixture();
  await fixture.request();
  const state = fixture.harness.states[0];
  assert.ok(state);

  await fixture.run(() =>
    fixture.controller.dismiss(activationId, "tab-closed"),
  );

  assert.equal(fixture.host.getSelected(), persistentId);
  assert.equal(fixture.surfaces(), 0);
  assert.equal(state.listenerCount, 0);
  assert.equal(state.value, null);

  await fixture.harness.settle(ok(receipt));

  assert.equal(state.value, null);
  assert.equal(fixture.surfaces(), 0);
  assert.match(fixture.text(), /persistent/);
});

test("常設面の選択で一過性面を終了する", async () => {
  const fixture = await openFixture();
  await fixture.request();
  const state = fixture.harness.states[0];
  assert.ok(state);

  await fixture.run(() => fixture.controller.selectPersistent(persistentId));

  assert.equal(fixture.host.getSelected(), persistentId);
  assert.equal(fixture.surfaces(), 0);
  assert.equal(state.value, null);
  assert.deepEqual(fixture.controller.getSnapshot(), { kind: "inactive" });
});

test("contribution factoryはnavigationを持たないUI registrationだけを公開する", () => {
  const managementError: ManagementError = {
    kind: "not-found",
    entity: "candidate",
  };
  const query: CandidateQuery = {
    listProjects: async () => err(managementError),
    listCandidates: async () => err(managementError),
    listBuildEligible: async () => err(managementError),
    getCandidateDraft: async (): Promise<
      Result<CandidateDraft, ManagementError>
    > => err(managementError),
  };
  const catalog: CandidateSourceCatalogPort = {
    listSourceReferences: async () => err(managementError),
    getSourceReference: async () => err(managementError),
  };
  const mutations: CandidateSourceMutationPort = {
    addSource: async () => err(managementError),
    updateSource: async () => err(managementError),
    removeSource: async () => err(managementError),
    setPrimarySource: async () => err(managementError),
  };
  const pagePriceExtraction: PagePriceExtractionPort = {
    extractPrice: async () => err({ kind: "tab-unavailable" }),
  };

  const contribution = createSourcePriceRefreshContribution({
    query,
    catalog,
    mutations,
    pagePriceExtraction,
    transientSurface: {
      isCurrent: () => true,
      dismiss: async () => err({ kind: "not-started" }),
      conclude: async () => err({ kind: "not-started" }),
    },
  });

  assert.equal(contribution.registration.id, sourcePriceRefreshFeatureId);
  assert.equal(contribution.registration.presentation, "transient");
  assert.equal("navigation" in contribution.registration, false);
  assert.equal(
    "workerRegistration" in contribution,
    false,
    "UI contributionはworker registrationを持ち込まない",
  );
  assert.equal(
    typeof contribution.registration.publicApi.refresh.refreshCapturedPrice,
    "function",
  );
});

const featureRoot = new URL(
  "../../../src/features/source-price-refresh/",
  import.meta.url,
);

/**
 * Runtime import edges only. `import type` / `export type` statements are
 * erased before the module reaches any bundle, so they cannot pull React or the
 * DOM into a worker; following them would assert about a graph that never
 * exists at runtime.
 */
const moduleSpecifiers = (source: string): readonly string[] => {
  const runtime = source.replaceAll(
    /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|[A-Za-z_$][\w$]*)\s*from\s*["'][^"']+["']\s*;?/g,
    "",
  );
  return [
    ...[...runtime.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    ),
    ...[...runtime.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    ),
    ...[...runtime.matchAll(/\bimport\s+["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    ),
  ];
};

/** Resolves a repository-relative source specifier back onto its TS source. */
const resolveModule = async (
  base: URL,
  specifier: string,
): Promise<URL | undefined> => {
  const target = new URL(specifier.replace(/\.js$/, ""), base);
  for (const extension of [".ts", ".tsx"]) {
    const candidate = new URL(`${target.pathname}${extension}`, target);
    const found = await readFile(fileURLToPath(candidate), "utf8").then(
      () => candidate,
      () => undefined,
    );
    if (found !== undefined) return found;
  }
  return undefined;
};

test("worker-safeな公開入口からfeature UI・DOM・Reactへ到達しない", async () => {
  const entry = new URL("public.ts", featureRoot);
  const visited = new Set<string>();
  const externals = new Set<string>();
  const queue: URL[] = [entry];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) continue;
    const key = current.href;
    if (visited.has(key)) continue;
    visited.add(key);
    const source = await readFile(fileURLToPath(current), "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        externals.add(specifier);
        continue;
      }
      const resolved = await resolveModule(current, specifier);
      assert.ok(resolved, `${specifier}: 解決できるmoduleである`);
      queue.push(resolved);
    }
  }

  assert.ok(visited.size > 1, "import graphを実際に辿っている");
  for (const specifier of externals)
    assert.doesNotMatch(
      specifier,
      /^react(?:-dom)?(?:\/|$)/,
      `${specifier}: worker-safe entryはReactへ到達しない`,
    );
  for (const uiModule of [
    "view.tsx",
    "react-root.tsx",
    "registration.ts",
    "feature-contribution.ts",
  ])
    assert.equal(
      visited.has(new URL(uiModule, featureRoot).href),
      false,
      `${uiModule}: worker-safe entryからfeature UIへ到達しない`,
    );
});
