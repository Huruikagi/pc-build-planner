import assert from "node:assert/strict";
import test from "node:test";

import type {
  Availability,
  FeatureMountHandle,
} from "../../../src/application-shell/contracts.js";
import type { ProjectId, Revision, Uuid } from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateManagementService,
  CandidateQuery,
  CaptureCandidatePort,
} from "../../../src/features/candidate-management/contracts.js";
import { createCandidateFeatureRegistration } from "../../../src/features/candidate-management/registration.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import type { FoundationScopedDataPort } from "../../../src/persistence/public.js";
import { collectFeatureContractViolations } from "../../contracts/application-shell-contract-kit.js";

test("候補管理registrationはshell契約へmount依存とoperation policyを注入する", async () => {
  const data = {} as FoundationScopedDataPort;
  const query = {} as CandidateQuery;
  const capture = {} as CaptureCandidatePort;
  const observed: {
    data?: FoundationScopedDataPort;
    readAllowed?: boolean;
    mutationAllowed?: boolean;
  } = {};
  const availabilityListeners = new Set<(value: Availability) => void>();
  const registration = createCandidateFeatureRegistration({
    data,
    query,
    capture,
    subscribeAvailability(listener) {
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
    mount: async ({ data: mountedData, operationPolicy, container }) => {
      observed.data = mountedData;
      observed.readAllowed = operationPolicy.isAllowed("read");
      observed.mutationAllowed = operationPolicy.isAllowed("mutation");
      container.textContent = "Candidate management";
      const handle: FeatureMountHandle = {
        async unmount() {
          container.textContent = "";
        },
      };
      return handle;
    },
  });

  assert.equal(registration.publicApi.query, query);
  assert.equal(registration.publicApi.capture, capture);
  const violations = await collectFeatureContractViolations(registration, {
    emitAvailability: () => {
      for (const listener of availabilityListeners)
        listener({ status: "available" });
    },
  });

  assert.deepEqual(violations, []);
  assert.equal(observed.data, data);
  assert.equal(observed.readAllowed, true);
  assert.equal(observed.mutationAllowed, true);
});

test("React rootはopaque snapshotを復元し、captureとunmountを一度だけ行う", async () => {
  const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
  const draft = {
    projectId,
    category: "uncategorized" as const,
    product: { name: { original: "未保存の架空候補" } },
    normalizedAttributes: { category: "uncategorized" as const },
  } satisfies CandidateDraft;
  const query = {
    async listProjects() {
      return {
        ok: true as const,
        value: [
          {
            id: projectId,
            name: "架空プロジェクト",
            updatedAt: "2026-07-22T00:00:00.000Z" as never,
          },
        ],
      };
    },
    async listCandidates() {
      return { ok: true as const, value: [] };
    },
    async listBuildEligible() {
      return { ok: true as const, value: [] };
    },
    async getCandidateDraft() {
      return {
        ok: false as const,
        error: { kind: "not-found" as const, entity: "candidate" as const },
      };
    },
  } satisfies CandidateQuery;
  const state = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as never,
      expectedRevision: 0 as Revision,
    }),
  });
  await state.load();
  state.beginCreate(draft);
  const sourceRegistration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    capture: {} as CaptureCandidatePort,
    state,
  });
  const sourceContainer = document.createElement("div");
  const sourceHandle = await sourceRegistration.mount({
    container: sourceContainer,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });
  const captured = await sourceHandle.captureState?.();
  assert.equal(captured?.ok, true);
  await sourceHandle.unmount();
  await sourceHandle.unmount();

  const restoredState = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as never,
      expectedRevision: 0 as Revision,
    }),
  });
  const targetRegistration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    capture: {} as CaptureCandidatePort,
    state: restoredState,
  });
  const targetContainer = document.createElement("div");
  const targetHandle = await targetRegistration.mount({
    container: targetContainer,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
    restoredState: captured?.ok ? captured.value : undefined,
  });
  assert.deepEqual(restoredState.value.editor, {
    mode: "create",
    projectId,
    draft,
  });
  await targetHandle.unmount();
  assert.equal(targetContainer.textContent, "");

  const rejectedState = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as never,
      expectedRevision: 0 as Revision,
    }),
  });
  const rejectedHandle = await createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    capture: {} as CaptureCandidatePort,
    state: rejectedState,
  }).mount({
    container: document.createElement("div"),
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
    restoredState: { version: 99 },
  });
  assert.equal(rejectedState.value.editor, null);
  assert.deepEqual(rejectedState.value.displayError, {
    code: "snapshot-restore-failed",
  });
  await rejectedHandle.unmount();
});

test("mountできるstateを持たないregistrationはmountを成功と偽らない", async () => {
  const registration = createCandidateFeatureRegistration({
    data: {} as FoundationScopedDataPort,
    query: {} as CandidateQuery,
    capture: {} as CaptureCandidatePort,
  });
  const container = document.createElement("div");

  await assert.rejects(
    registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    }),
    /no management state to mount/,
  );
  // A rejected mount must not leave placeholder content behind.
  assert.equal(container.textContent, "");
  assert.equal(registration.activation, undefined);
});
