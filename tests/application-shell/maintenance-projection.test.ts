import assert from "node:assert/strict";
import test from "node:test";

import { createMaintenanceProjection } from "../../src/application-shell/maintenance-projection.js";
import type { MaintenanceSnapshot } from "../../src/persistence/public.js";

const snapshot = (
  generation: number,
  revision: number,
  active: boolean,
): MaintenanceSnapshot => ({
  generation: generation as MaintenanceSnapshot["generation"],
  revision: revision as MaintenanceSnapshot["revision"],
  active,
});

test("新しいcursorを辞書順に適用し現行世代の終了を反映する", () => {
  const projection = createMaintenanceProjection();

  assert.equal(projection.accept(snapshot(1, 4, true)), "applied");
  assert.deepEqual(projection.getSnapshot(), {
    status: "active",
    cursor: { generation: 1, revision: 4 },
    message: "メンテナンス中です。変更操作は利用できません。",
  });
  assert.equal(projection.accept(snapshot(1, 5, false)), "applied");
  assert.deepEqual(projection.getSnapshot(), {
    status: "inactive",
    cursor: { generation: 1, revision: 5 },
  });
});

test("古い世代、古いrevision、同一cursorの重複を無視して後退しない", () => {
  const projection = createMaintenanceProjection();
  projection.accept(snapshot(2, 8, false));

  assert.equal(projection.accept(snapshot(1, 99, true)), "stale_ignored");
  assert.equal(projection.accept(snapshot(2, 7, true)), "stale_ignored");
  assert.equal(projection.accept(snapshot(2, 8, true)), "stale_ignored");
  assert.deepEqual(projection.getSnapshot(), {
    status: "inactive",
    cursor: { generation: 2, revision: 8 },
  });
});

test("世代前進はrevisionが小さくても適用する", () => {
  const projection = createMaintenanceProjection();
  projection.accept(snapshot(4, 20, false));

  assert.equal(projection.accept(snapshot(5, 1, true)), "applied");
  assert.deepEqual(projection.getSnapshot().cursor, {
    generation: 5,
    revision: 1,
  });
});

test("不正cursorを安定した契約違反として拒否し状態を維持する", () => {
  const projection = createMaintenanceProjection();
  projection.accept(snapshot(2, 3, true));

  for (const invalid of [
    snapshot(-1, 4, false),
    snapshot(3, -1, false),
    snapshot(3.5, 4, false),
    snapshot(3, Number.NaN, false),
  ]) {
    assert.throws(
      () => projection.accept(invalid),
      new TypeError(
        "maintenance cursor must contain non-negative finite integers",
      ),
    );
  }
  assert.equal(projection.getSnapshot().status, "active");
});

test("購読者例外を隔離し解除を冪等にする", () => {
  const projection = createMaintenanceProjection();
  const received: string[] = [];
  projection.subscribe(() => {
    received.push("throwing");
    throw new Error("external callback detail");
  });
  const unsubscribe = projection.subscribe((state) =>
    received.push(`${state.status}:${state.cursor.generation}`),
  );

  projection.accept(snapshot(1, 1, true));
  unsubscribe();
  unsubscribe();
  projection.accept(snapshot(1, 2, false));

  assert.deepEqual(received, ["throwing", "active:1", "throwing"]);
});
