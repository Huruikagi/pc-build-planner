import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";

import type { Availability } from "../../../src/application-shell/contracts.js";
import type {
  ProjectId,
  Result,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CompatibilityError,
  CompatibilityQuery,
  CompatibilityReport,
} from "../../../src/features/compatibility/contracts.js";
import { createCompatibilityProjectContextAdapter } from "../../../src/features/compatibility/project-context-adapter.js";
import { createCompatibilityFeatureRegistration } from "../../../src/features/compatibility/registration.js";
import { createCompatibilityState } from "../../../src/features/compatibility/state.js";
import type {
  ProjectContextReadPort,
  ProjectContextSnapshot,
} from "../../../src/project-context/public.js";
import {
  defaultMessageResolver,
  type MessageKey,
  message,
} from "../../../src/ui-messages/public.js";
import { collectFeatureContractViolations } from "../../contracts/application-shell-contract-kit.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

type NavigationMessageKey = Extract<MessageKey, `nav.${string}`>;

const navigationMessage = (key: MessageKey) =>
  message(key as NavigationMessageKey);

const reportOf = (
  status: CompatibilityReport["status"],
): CompatibilityReport => ({
  projectId,
  buildUpdatedAt: timestamp,
  status,
  results: [],
});

const queryReturning = (
  result: Result<CompatibilityReport, CompatibilityError>,
): CompatibilityQuery & { readonly calls: ProjectId[] } => {
  const calls: ProjectId[] = [];
  return {
    calls,
    async evaluate(id: ProjectId) {
      calls.push(id);
      return result;
    },
  };
};

const allowAll = { isAllowed: () => true, subscribe: () => () => {} };

const stateWithReadyContext = (query: CompatibilityQuery) => {
  const snapshot: ProjectContextSnapshot = {
    status: "ready",
    generation: 1,
    catalog: [
      { id: projectId, name: "架空プロジェクト", updatedAt: timestamp },
    ],
    selectedProjectId: projectId,
  };
  let subscriptions = 0;
  let releases = 0;
  const read: ProjectContextReadPort = {
    getSnapshot: () => snapshot,
    subscribe() {
      subscriptions += 1;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        releases += 1;
      };
    },
  };
  return {
    state: createCompatibilityState({
      query,
      projectContext: createCompatibilityProjectContextAdapter(read),
    }),
    subscriptions: () => subscriptions,
    releases: () => releases,
  };
};

test("registrationはshell契約とread-only operation policyへ適合する", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const state = createCompatibilityState({ query });
  const observed: { readAllowed?: boolean; mutationAllowed?: boolean } = {};
  const availabilityListeners = new Set<(value: Availability) => void>();

  const registration = createCompatibilityFeatureRegistration({
    query,
    state,
    subscribeAvailability(listener) {
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
    mount: async ({ operationPolicy, container }) => {
      observed.readAllowed = operationPolicy.isAllowed("read");
      observed.mutationAllowed = operationPolicy.isAllowed("mutation");
      container.textContent = "Compatibility";
      return {
        async unmount() {
          container.textContent = "";
        },
      };
    },
  });

  assert.equal(registration.publicApi.query, query);
  const violations = await collectFeatureContractViolations(registration, {
    emitAvailability: (availability) => {
      for (const listener of availabilityListeners) listener(availability);
    },
  });

  assert.deepEqual(violations, []);
  assert.equal(observed.readAllowed, true);
  assert.equal(observed.mutationAllowed, true);
});

test("registrationはcompatibility識別子とラベルを持つ", () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const registration = createCompatibilityFeatureRegistration({ query });

  assert.equal(registration.id, "compatibility");
  assert.equal(
    defaultMessageResolver.resolveDescriptor(
      navigationMessage(registration.navigation.labelKey),
    ),
    defaultMessageResolver("nav.compatibility"),
  );
});

test("mountはcontext購読を開始して現在projectを評価しViewを描画する", async () => {
  const query = queryReturning({ ok: true, value: reportOf("incompatible") });
  const context = stateWithReadyContext(query);
  const registration = createCompatibilityFeatureRegistration({
    query,
    state: context.state,
  });
  const container = document.createElement("div");

  let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: allowAll,
      reportError: () => {},
    });
  });

  assert.deepEqual(query.calls, [projectId]);
  assert.equal(context.subscriptions(), 1);
  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.incompatible")),
  );
  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
  assert.equal(context.releases(), 1);
});

test("context adapterが無ければ評価せずidleのまま描画する", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const state = createCompatibilityState({ query });
  const registration = createCompatibilityFeatureRegistration({
    query,
    state,
  });
  const container = document.createElement("div");

  let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: allowAll,
      reportError: () => {},
    });
  });

  assert.deepEqual(query.calls, []);
  assert.equal(container.querySelector("[data-status='idle']") !== null, true);
  await act(async () => handle?.unmount());
});

test("読取が許可されないoperation policyでは評価しない", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const context = stateWithReadyContext(query);
  const registration = createCompatibilityFeatureRegistration({
    query,
    state: context.state,
  });
  const container = document.createElement("div");

  let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: { isAllowed: () => false, subscribe: () => () => {} },
      reportError: () => {},
    });
  });

  assert.deepEqual(query.calls, []);
  assert.equal(context.subscriptions(), 0);
  await act(async () => handle?.unmount());
});

test("unmountはReact rootの解除を一度だけ行いcontainerを空にする", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const context = stateWithReadyContext(query);
  const registration = createCompatibilityFeatureRegistration({
    query,
    state: context.state,
  });
  const container = document.createElement("div");

  let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: allowAll,
      reportError: () => {},
    });
  });
  assert.notEqual(container.textContent, "");

  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
  assert.equal(context.releases(), 1);
  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
  assert.equal(context.releases(), 1);
});

test("mountできるstateを持たないregistrationはmountを成功と偽らない", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const registration = createCompatibilityFeatureRegistration({ query });
  const container = document.createElement("div");

  await assert.rejects(
    registration.mount({
      container,
      operationPolicy: allowAll,
      reportError: () => {},
    }),
    /no compatibility state to mount/,
  );
  assert.equal(container.textContent, "");
});

test("context購読開始が失敗したmountは作成済みReact rootを解放する", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const state = createCompatibilityState({
    query,
    projectContext: {
      getCurrent: () => ({ status: "ready", generation: 1, projectId }),
      subscribe() {
        throw new Error("fixture subscribe failure");
      },
    },
  });
  const registration = createCompatibilityFeatureRegistration({ query, state });
  const container = document.createElement("div");

  await act(async () => {
    await assert.rejects(
      registration.mount({
        container,
        operationPolicy: allowAll,
        reportError: () => {},
      }),
      /fixture subscribe failure/,
    );
  });
  assert.equal(container.textContent, "");
});

test("context購読解除も失敗するpartial mountでReact root cleanupを継続する", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const snapshot: ProjectContextSnapshot = {
    status: "ready",
    generation: 1,
    catalog: [
      { id: projectId, name: "架空プロジェクト", updatedAt: timestamp },
    ],
    selectedProjectId: projectId,
  };
  let snapshotReads = 0;
  const state = createCompatibilityState({
    query,
    projectContext: createCompatibilityProjectContextAdapter({
      getSnapshot() {
        snapshotReads += 1;
        if (snapshotReads > 1) throw new Error("fixture snapshot failure");
        return snapshot;
      },
      subscribe() {
        return () => {
          throw new Error("fixture release failure");
        };
      },
    }),
  });
  const registration = createCompatibilityFeatureRegistration({ query, state });
  const container = document.createElement("div");

  await act(async () => {
    await assert.rejects(
      registration.mount({
        container,
        operationPolicy: allowAll,
        reportError: () => {},
      }),
      /fixture release failure/,
    );
  });
  assert.equal(container.textContent, "");
});
