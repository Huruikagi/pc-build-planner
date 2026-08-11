import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

import type {
  Availability,
  FeatureMountHandle,
} from "../../../src/application-shell/contracts.js";
import type {
  CandidatePart,
  CandidatePartId,
  NormalizedAttributes,
  ProjectId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type { CandidateQuery } from "../../../src/features/candidate-management/public.js";
import { createCategoryPolicy } from "../../../src/features/current-build/category-policy.js";
import type {
  BuildCommand,
  BuildMutationContext,
  BuildService,
  CurrentBuildQuery,
} from "../../../src/features/current-build/contracts.js";
import type { CurrentBuildProjectContextAdapter } from "../../../src/features/current-build/project-context-adapter.js";
import { createCurrentBuildFeatureRegistration as createCurrentBuildFeatureRegistrationImpl } from "../../../src/features/current-build/registration.js";
import {
  type BuildStateDependencies,
  createBuildState,
} from "../../../src/features/current-build/state.js";
import { actWrappedRegistrationFactory } from "../../act-wrapped-registration.js";
import { collectFeatureContractViolations } from "../../contracts/application-shell-contract-kit.js";

const createCurrentBuildFeatureRegistration = actWrappedRegistrationFactory(
  createCurrentBuildFeatureRegistrationImpl,
);

const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const memoryCandidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;

const memoryAttributes = {
  category: "memory",
  memoryStandard: { original: "架空規格", confirmed: "SYN-DDR" },
} satisfies NormalizedAttributes;

const memoryCandidate: CandidatePart = {
  id: memoryCandidateId,
  projectId,
  category: "memory",
  product: { name: { original: "架空メモリ", confirmed: "架空メモリ" } },
  sources: [],
  normalizedAttributes: memoryAttributes,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const buildCandidateQuery = (): Pick<CandidateQuery, "listBuildEligible"> => ({
  async listBuildEligible() {
    return { ok: true, value: [memoryCandidate] };
  },
});

const buildQuery = (): CurrentBuildQuery => ({
  async getByProject() {
    return { ok: true, value: { revision: 0 as Revision, currentBuild: null } };
  },
});

const buildService = (): BuildService => ({
  async execute(_command: BuildCommand, _context: BuildMutationContext) {
    throw new Error("not used by registration tests");
  },
});

const createTestState = () => {
  const dependencies: BuildStateDependencies = {
    candidates: buildCandidateQuery(),
    query: buildQuery(),
    service: buildService(),
    policy: createCategoryPolicy(),
  };
  return createBuildState(dependencies);
};

const readyProjectContext = (): CurrentBuildProjectContextAdapter => ({
  getCurrent: () => ({ status: "ready", generation: 1, projectId }),
  subscribe: () => () => {},
  registerDraftGuard: () => ({ ok: true, value: () => {} }),
});

test("現在構成registrationはshell契約へ公開queryとoperation policyを注入する", async () => {
  const query = {} as CurrentBuildQuery;
  const observed: { readAllowed?: boolean; mutationAllowed?: boolean } = {};
  const availabilityListeners = new Set<(value: Availability) => void>();
  const registration = createCurrentBuildFeatureRegistration({
    query,
    subscribeAvailability(listener) {
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
    mount: async ({ operationPolicy, container }) => {
      observed.readAllowed = operationPolicy.isAllowed("read");
      observed.mutationAllowed = operationPolicy.isAllowed("mutation");
      container.textContent = "Current build";
      const handle: FeatureMountHandle = {
        async unmount() {
          container.textContent = "";
        },
      };
      return handle;
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

test("React rootはopaque snapshotを復元し、captureとunmountを一度だけ行う", async () => {
  const sourceState = createTestState();
  const sourceRegistration = createCurrentBuildFeatureRegistration({
    query: buildQuery(),
    state: sourceState,
    projectContext: readyProjectContext(),
  });
  const sourceContainer = document.createElement("div");
  const sourceHandle = await sourceRegistration.mount({
    container: sourceContainer,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });
  // Unsaved screen selections are what capture must preserve.
  await act(() => {
    sourceState.selectCategory("memory");
    sourceState.setQuantityDraft(memoryCandidateId, "3");
  });
  const captured = await sourceHandle.captureState?.();
  assert.equal(captured?.ok, true);
  await sourceHandle.unmount();
  await sourceHandle.unmount();

  const targetState = createTestState();
  const targetRegistration = createCurrentBuildFeatureRegistration({
    query: buildQuery(),
    state: targetState,
    projectContext: readyProjectContext(),
  });
  const targetContainer = document.createElement("div");
  const targetHandle = await targetRegistration.mount({
    container: targetContainer,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
    restoredState: captured?.ok ? captured.value : undefined,
  });
  assert.equal(targetState.value.selectedProjectId, projectId);
  assert.equal(targetState.value.selectedCategory, "memory");
  assert.deepEqual(targetState.value.quantityDrafts, {
    [memoryCandidateId]: "3",
  });
  await targetHandle.unmount();
  assert.equal(targetContainer.textContent, "");

  const rejectedState = createTestState();
  const rejectedHandle = await createCurrentBuildFeatureRegistration({
    query: buildQuery(),
    state: rejectedState,
    projectContext: readyProjectContext(),
  }).mount({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
    restoredState: { version: 99 },
  });
  assert.equal(rejectedState.value.selectedCategory, null);
  assert.deepEqual(rejectedState.value.displayError, {
    code: "snapshot-restore-failed",
  });
  await rejectedHandle.unmount();
});

test("snapshotなしの再mountは前回の未保存カテゴリ・数量draft・表示errorを持ち越さない", async () => {
  // A single state instance outlives both mounts, as in production composition.
  const state = createTestState();
  const registration = createCurrentBuildFeatureRegistration({
    query: buildQuery(),
    state,
    projectContext: readyProjectContext(),
  });
  const policy = { isAllowed: () => true, subscribe: () => () => {} };

  const first = await registration.mount({
    container: document.createElement("div"),
    operationPolicy: policy,
    reportError: () => {},
  });
  await act(() => {
    state.selectCategory("memory");
    state.setQuantityDraft(memoryCandidateId, "9");
  });
  await first.unmount();

  // Navigating back is not a rollback, so the previous screen must not reappear.
  const second = await registration.mount({
    container: document.createElement("div"),
    operationPolicy: policy,
    reportError: () => {},
  });

  assert.equal(state.value.selectedCategory, null);
  assert.deepEqual(state.value.quantityDrafts, {});
  assert.equal(state.value.displayError, null);
  assert.equal(state.value.selectedProjectId, projectId);
  await second.unmount();
});

test("mountできるstateを持たないregistrationはmountを成功と偽らない", async () => {
  const registration = createCurrentBuildFeatureRegistration({
    query: buildQuery(),
  });
  const container = document.createElement("div");

  await assert.rejects(
    registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    }),
    /no build state to mount/,
  );
  assert.equal(container.textContent, "");
  assert.equal(registration.activation, undefined);
});

test("project contextなしのoptional mount pathはunavailableとしてfail closedする", async () => {
  const state = createTestState();
  const handle = await createCurrentBuildFeatureRegistration({
    query: buildQuery(),
    state,
  }).mount({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });

  assert.equal(state.value.projectAvailability, "unavailable");
  assert.equal(state.value.selectedProjectId, null);
  assert.deepEqual(state.value.candidates, []);
  assert.equal(state.value.mutationsDisabled, true);
  await handle.unmount();
});

test("mountはguard登録後にcontext authorityを読み込み、その後snapshotを検査する", async () => {
  const state = createTestState();
  const events: string[] = [];
  const originalAttach = state.attachProjectContext.bind(state);
  const originalApply = state.applySnapshot.bind(state);
  state.attachProjectContext = async (context) => {
    events.push("context:attach");
    await originalAttach(context);
    events.push("context:loaded");
  };
  state.applySnapshot = (snapshot) => {
    events.push("snapshot:apply");
    originalApply(snapshot);
  };
  const adapter: CurrentBuildProjectContextAdapter = {
    getCurrent: () => ({ status: "ready", generation: 1, projectId }),
    subscribe: () => () => events.push("context:release"),
    registerDraftGuard: () => {
      events.push("guard:register");
      return { ok: true, value: () => events.push("guard:release") };
    },
  };
  const registration = createCurrentBuildFeatureRegistration({
    query: buildQuery(),
    state,
    projectContext: adapter,
  });

  const handle = await registration.mount({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
    restoredState: {
      version: 1,
      selectedProjectId: projectId,
      selectedCategory: "memory",
      quantityDrafts: {},
    },
  });

  assert.deepEqual(events.slice(0, 4), [
    "guard:register",
    "context:attach",
    "context:loaded",
    "snapshot:apply",
  ]);
  await handle.unmount();
  await handle.unmount();
  assert.equal(events.filter((event) => event === "guard:release").length, 1);
  assert.equal(events.filter((event) => event === "context:release").length, 1);
});

test("guard登録に失敗したmountはcontextを接続せず失敗する", async () => {
  const state = createTestState();
  let subscriptions = 0;
  const adapter: CurrentBuildProjectContextAdapter = {
    getCurrent: () => ({ status: "ready", generation: 1, projectId }),
    subscribe: () => {
      subscriptions += 1;
      return () => {};
    },
    registerDraftGuard: () => ({
      ok: false,
      error: { kind: "guard-registration-failed" },
    }),
  };

  await assert.rejects(
    createCurrentBuildFeatureRegistration({
      query: buildQuery(),
      state,
      projectContext: adapter,
    }).mount({
      container: document.createElement("div"),
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    }),
    /draft guard/i,
  );
  assert.equal(subscriptions, 0);
});
