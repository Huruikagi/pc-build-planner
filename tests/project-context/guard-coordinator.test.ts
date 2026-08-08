import assert from "node:assert/strict";
import test from "node:test";
import { err, ok, type ProjectId } from "../../src/domain/public.js";
import type { ProjectContextChangeGuard } from "../../src/project-context/contracts.js";
import {
  createProjectChangeGuardCoordinator,
  type ProjectChangeGuardCoordinator,
} from "../../src/project-context/guard-coordinator.js";

const ALPHA = "11111111-1111-4111-8111-111111111111" as ProjectId;
const BRAVO = "22222222-2222-4222-8222-222222222222" as ProjectId;

const createCoordinator = (): {
  coordinator: ProjectChangeGuardCoordinator;
  advance: () => void;
} => {
  let generation = 3;
  return {
    coordinator: createProjectChangeGuardCoordinator({
      getSnapshot: () => ({ generation, selectedProjectId: ALPHA }),
    }),
    advance: () => {
      generation += 1;
    },
  };
};

const guard = (
  id: string,
  decision: "allow" | "confirmation-required",
  observed: string[] = [],
): ProjectContextChangeGuard => ({
  id,
  async evaluate(intent) {
    observed.push(`${id}:${intent.kind}`);
    return ok({ kind: decision });
  },
});

test("2.1: guard は stable ID で登録し、重複拒否と解除・revision を提供する", () => {
  const { coordinator } = createCoordinator();
  const first = coordinator.register(guard("draft-a", "allow"));
  assert.ok(first.ok);
  assert.equal(coordinator.registryRevision(), 1);
  assert.deepEqual(coordinator.register(guard("draft-a", "allow")), {
    ok: false,
    error: { kind: "duplicate-guard" },
  });
  assert.equal(coordinator.registryRevision(), 1);
  if (first.ok) first.value();
  assert.equal(coordinator.registryRevision(), 2);
});

test("2.1: select と replacement は登録順に評価し、一つでも確認が必要なら confirmation を返す", async () => {
  const { coordinator } = createCoordinator();
  const observed: string[] = [];
  coordinator.register(guard("first", "allow", observed));
  coordinator.register(guard("second", "confirmation-required", observed));
  const selection = await coordinator.evaluateSelection({
    kind: "select-project",
    from: ALPHA,
    to: BRAVO,
    cause: "user",
  });
  assert.ok(selection.ok && selection.value.kind === "confirmation-required");
  assert.deepEqual(observed, ["first:select-project", "second:select-project"]);
  const replacement = await coordinator.prepareReplacement();
  assert.ok(
    replacement.ok && replacement.value.kind === "confirmation-required",
  );
  assert.deepEqual(observed.slice(2), [
    "first:replace-catalog",
    "second:replace-catalog",
  ]);
});

test("2.1: confirmation は generation と registry revision に結び付き、cancel と stale を拒否する", async () => {
  const { coordinator, advance } = createCoordinator();
  coordinator.register(guard("draft", "confirmation-required"));
  const pending = await coordinator.evaluateSelection({
    kind: "select-project",
    from: ALPHA,
    to: BRAVO,
    cause: "user",
  });
  assert.ok(pending.ok && pending.value.kind === "confirmation-required");
  if (!pending.ok || pending.value.kind !== "confirmation-required") return;
  assert.deepEqual(coordinator.cancelSelection(pending.value.confirmation.id), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(
    await coordinator.confirmSelection(pending.value.confirmation.id),
    { ok: false, error: { kind: "confirmation-stale" } },
  );
  const again = await coordinator.evaluateSelection({
    kind: "select-project",
    from: ALPHA,
    to: BRAVO,
    cause: "user",
  });
  assert.ok(again.ok && again.value.kind === "confirmation-required");
  advance();
  if (again.ok && again.value.kind === "confirmation-required")
    assert.deepEqual(
      await coordinator.confirmSelection(again.value.confirmation.id),
      { ok: false, error: { kind: "confirmation-stale" } },
    );
});

test("2.1/2.2: forced notifier の例外は隔離しつつ observable な失敗にし、permit は閉じる", async () => {
  const { coordinator } = createCoordinator();
  let notified = 0;
  coordinator.register({
    id: "broken",
    async evaluate() {
      return err({ kind: "guard-failed" });
    },
    notifyForced() {
      notified += 1;
      throw new Error("ignored");
    },
  });
  assert.deepEqual(await coordinator.prepareReplacement(), {
    ok: false,
    error: { kind: "guard-failed" },
  });
  coordinator.unregister("broken");
  coordinator.register({
    id: "notifier",
    async evaluate() {
      return ok({ kind: "allow" });
    },
    notifyForced() {
      notified += 1;
      throw new Error("ignored");
    },
  });
  const prepared = await coordinator.prepareReplacement();
  assert.ok(prepared.ok && prepared.value.kind === "permitted");
  if (!prepared.ok || prepared.value.kind !== "permitted") return;
  assert.deepEqual(coordinator.beginReplacement(prepared.value.permit.id), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(
    await coordinator.completeReplacement(
      prepared.value.permit.id,
      "succeeded",
    ),
    { ok: false, error: { kind: "guard-failed" } },
  );
  assert.equal(notified, 1);
  assert.deepEqual(
    await coordinator.completeReplacement(prepared.value.permit.id, "failed"),
    { ok: false, error: { kind: "permit-already-completed" } },
  );
  assert.deepEqual(
    await coordinator.notifyForcedSelection({
      kind: "select-project",
      from: ALPHA,
      to: BRAVO,
      cause: "user",
    }),
    { ok: false, error: { kind: "guard-failed" } },
  );
  assert.equal(notified, 2);
});

test("2.2: replacement confirmation/permit は cancel、stale、未開始、failed の lifecycle を守る", async () => {
  const { coordinator, advance } = createCoordinator();
  coordinator.register(guard("draft", "confirmation-required"));
  const pending = await coordinator.prepareReplacement();
  assert.ok(pending.ok && pending.value.kind === "confirmation-required");
  if (!pending.ok || pending.value.kind !== "confirmation-required") return;
  assert.deepEqual(
    coordinator.cancelReplacement(pending.value.confirmation.id),
    {
      ok: true,
      value: undefined,
    },
  );
  assert.deepEqual(
    await coordinator.confirmReplacement(pending.value.confirmation.id),
    { ok: false, error: { kind: "confirmation-stale" } },
  );

  coordinator.unregister("draft");
  const permitted = await coordinator.prepareReplacement();
  assert.ok(permitted.ok && permitted.value.kind === "permitted");
  if (!permitted.ok || permitted.value.kind !== "permitted") return;
  assert.deepEqual(
    await coordinator.completeReplacement(permitted.value.permit.id, "failed"),
    { ok: false, error: { kind: "permit-not-started" } },
  );
  advance();
  assert.deepEqual(coordinator.beginReplacement(permitted.value.permit.id), {
    ok: false,
    error: { kind: "permit-stale" },
  });
  assert.deepEqual(coordinator.beginReplacement(permitted.value.permit.id), {
    ok: false,
    error: { kind: "permit-already-completed" },
  });
});
