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
import { createCompatibilityFeatureRegistration } from "../../../src/features/compatibility/registration.js";
import { createCompatibilityState } from "../../../src/features/compatibility/state.js";
import { collectFeatureContractViolations } from "../../contracts/application-shell-contract-kit.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

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

test("registrationはshell契約とread-only operation policyへ適合する", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const state = createCompatibilityState({ query });
  const observed: { readAllowed?: boolean; mutationAllowed?: boolean } = {};
  const availabilityListeners = new Set<(value: Availability) => void>();

  const registration = createCompatibilityFeatureRegistration({
    query,
    state,
    getProjectId: () => projectId,
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
  assert.equal(registration.navigation.label, "互換性確認");
});

test("mountはgetProjectIdが返すprojectで評価しViewを描画する", async () => {
  const query = queryReturning({ ok: true, value: reportOf("incompatible") });
  const state = createCompatibilityState({ query });
  const registration = createCompatibilityFeatureRegistration({
    query,
    state,
    getProjectId: () => projectId,
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
  assert.match(container.textContent ?? "", /互換性なし/);
  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
});

test("getProjectIdがnullを返せば評価せずidleのまま描画する", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const state = createCompatibilityState({ query });
  const registration = createCompatibilityFeatureRegistration({
    query,
    state,
    getProjectId: () => null,
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
  const state = createCompatibilityState({ query });
  const registration = createCompatibilityFeatureRegistration({
    query,
    state,
    getProjectId: () => projectId,
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
  await act(async () => handle?.unmount());
});

test("unmountはReact rootの解除を一度だけ行いcontainerを空にする", async () => {
  const query = queryReturning({ ok: true, value: reportOf("compatible") });
  const state = createCompatibilityState({ query });
  const registration = createCompatibilityFeatureRegistration({
    query,
    state,
    getProjectId: () => projectId,
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
  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
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
