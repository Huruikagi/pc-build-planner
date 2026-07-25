import assert from "node:assert/strict";
import test from "node:test";

import type {
  MaintenancePresentationPort,
  ShellMaintenanceState,
} from "../../src/application-shell/contracts.js";
import { createMutationGate } from "../../src/application-shell/mutation-gate.js";

const cursor = { generation: 1, revision: 1 } as const;

function createMaintenancePort(
  initial: ShellMaintenanceState,
): MaintenancePresentationPort & {
  setSnapshot(next: ShellMaintenanceState): void;
} {
  let current = initial;

  return {
    getSnapshot: () => current,
    subscribe: () => () => undefined,
    setSnapshot(next) {
      current = next;
    },
  };
}

test("inactive中はreadとmutationを許可する", () => {
  const maintenance = createMaintenancePort({ status: "inactive", cursor });
  const gate = createMutationGate(maintenance);

  assert.equal(gate.isAllowed("read"), true);
  assert.equal(gate.isAllowed("mutation"), true);
});

test("active中はmutationだけを拒否してreadを維持する", () => {
  const maintenance = createMaintenancePort({
    status: "active",
    cursor,
    message: { key: "maintenance" },
  });
  const gate = createMutationGate(maintenance);

  assert.equal(gate.isAllowed("read"), true);
  assert.equal(gate.isAllowed("mutation"), false);
});

test("判定時の最新maintenance snapshotへ操作分類を写像する", () => {
  const maintenance = createMaintenancePort({ status: "inactive", cursor });
  const gate = createMutationGate(maintenance);

  assert.equal(gate.isAllowed("mutation"), true);

  maintenance.setSnapshot({
    status: "active",
    cursor: { generation: 2, revision: 2 },
    message: { key: "maintenance" },
  });
  assert.equal(gate.isAllowed("mutation"), false);
  assert.equal(gate.isAllowed("read"), true);

  maintenance.setSnapshot({
    status: "inactive",
    cursor: { generation: 2, revision: 3 },
  });
  assert.equal(gate.isAllowed("mutation"), true);
});

function createNotifyingPort(initial: ShellMaintenanceState) {
  let current = initial;
  const listeners = new Set<(state: ShellMaintenanceState) => void>();
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const port: MaintenancePresentationPort = {
    getSnapshot: () => current,
    subscribe(listener) {
      subscribeCalls += 1;
      listeners.add(listener);
      return () => {
        unsubscribeCalls += 1;
        listeners.delete(listener);
      };
    },
  };
  return {
    port,
    emit(next: ShellMaintenanceState) {
      current = next;
      for (const listener of [...listeners]) listener(next);
    },
    subscribeCalls: () => subscribeCalls,
    unsubscribeCalls: () => unsubscribeCalls,
  };
}

test("mount中のmutation可否の変化だけを購読者へ通知する", () => {
  const maintenance = createNotifyingPort({ status: "inactive", cursor });
  const gate = createMutationGate(maintenance.port);
  const notifications: boolean[] = [];
  const unsubscribe = gate.subscribe(() =>
    notifications.push(gate.isAllowed("mutation")),
  );

  maintenance.emit({
    status: "active",
    cursor: { generation: 2, revision: 2 },
    message: { key: "maintenance" },
  });
  // Still active: the allowed set did not change, so no notification.
  maintenance.emit({
    status: "active",
    cursor: { generation: 2, revision: 3 },
    message: { key: "maintenance" },
  });
  maintenance.emit({
    status: "inactive",
    cursor: { generation: 2, revision: 4 },
  });

  assert.deepEqual(notifications, [false, true]);
  unsubscribe();
});

test("gateはprojection購読を最初の購読で接続し最後の解除で切断する", () => {
  const maintenance = createNotifyingPort({ status: "inactive", cursor });
  const gate = createMutationGate(maintenance.port);

  assert.equal(maintenance.subscribeCalls(), 0);
  const first = gate.subscribe(() => {});
  const second = gate.subscribe(() => {});
  assert.equal(maintenance.subscribeCalls(), 1);

  first();
  first();
  assert.equal(maintenance.unsubscribeCalls(), 0);
  second();
  assert.equal(maintenance.unsubscribeCalls(), 1);
  // Re-subscribing after a full release reconnects exactly once.
  gate.subscribe(() => {});
  assert.equal(maintenance.subscribeCalls(), 2);
});

test("購読者の例外は他の購読者とgateの進行を妨げない", () => {
  const maintenance = createNotifyingPort({ status: "inactive", cursor });
  const gate = createMutationGate(maintenance.port);
  const seen: string[] = [];
  gate.subscribe(() => {
    throw new Error("feature listener failed");
  });
  gate.subscribe(() => seen.push("second"));

  maintenance.emit({
    status: "active",
    cursor: { generation: 3, revision: 1 },
    message: { key: "maintenance" },
  });

  assert.deepEqual(seen, ["second"]);
  assert.equal(gate.isAllowed("mutation"), false);
});
