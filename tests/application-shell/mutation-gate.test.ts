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
    message: "maintenance",
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
    message: "maintenance",
  });
  assert.equal(gate.isAllowed("mutation"), false);
  assert.equal(gate.isAllowed("read"), true);

  maintenance.setSnapshot({
    status: "inactive",
    cursor: { generation: 2, revision: 3 },
  });
  assert.equal(gate.isAllowed("mutation"), true);
});
