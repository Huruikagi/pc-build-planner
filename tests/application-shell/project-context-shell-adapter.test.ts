import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectContextShellAdapter } from "../../src/application-shell/project-context-shell-adapter.js";
import { ok, type ProjectId } from "../../src/domain/public.js";
import type { ProjectContextPresentationContribution } from "../../src/project-context/presentation-contribution.js";
import type {
  ProjectContextReadPort,
  ProjectContextSnapshot,
} from "../../src/project-context/public.js";

const projectId = "11111111-1111-4111-8111-111111111111" as ProjectId;

test("10.1/10.2: selectorを専用slotへ一度だけmountし、snapshotを単調にavailabilityへ投影してcleanupする", () => {
  let listener:
    | ((snapshot: ReturnType<ProjectContextReadPort["getSnapshot"]>) => void)
    | undefined;
  let unmounts = 0;
  let unsubscribes = 0;
  const snapshots: readonly [
    ProjectContextSnapshot,
    ProjectContextSnapshot,
    ProjectContextSnapshot,
  ] = [
    {
      status: "ready" as const,
      generation: 2,
      catalog: [
        {
          id: projectId,
          name: "架空",
          updatedAt: "2026-01-01T00:00:00Z" as never,
        },
      ] as const,
      selectedProjectId: projectId,
    },
    {
      status: "empty" as const,
      generation: 3,
      catalog: [] as const,
      selectedProjectId: null,
    },
    {
      status: "unavailable" as const,
      generation: 4,
      selectedProjectId: null,
      reason: "catalog-unavailable",
    },
  ];
  let current: ProjectContextSnapshot = snapshots[0];
  const read: ProjectContextReadPort = {
    getSnapshot: () => current,
    subscribe(next) {
      listener = next;
      return () => {
        unsubscribes += 1;
        listener = undefined;
      };
    },
  };
  const presentation: ProjectContextPresentationContribution = {
    mount(container) {
      assert.equal(container.dataset.slot, "project");
      return ok({
        unmount: () => {
          unmounts += 1;
        },
      });
    },
  };
  const observed: unknown[] = [];
  const container = document.createElement("div");
  container.dataset.slot = "project";
  const result = createProjectContextShellAdapter().mount({
    container,
    read,
    commands: {} as never,
    presentation,
    publishAvailability: (value) => observed.push(value),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  current = snapshots[1];
  listener?.(current);
  listener?.({ ...snapshots[0], generation: 1 } as ProjectContextSnapshot);
  current = snapshots[2];
  listener?.(current);
  assert.deepEqual(observed, [
    { status: "available", projectId, generation: 2 },
    { status: "unavailable", reason: "empty", generation: 3 },
    {
      status: "unavailable",
      reason: "context-unavailable",
      generation: 4,
    },
  ]);
  result.value.stop();
  result.value.stop();
  assert.equal(unmounts, 1);
  assert.equal(unsubscribes, 1);
});

test("10.1: cleanup失敗時は未解放resourceだけを次のstopで再試行する", () => {
  let unsubscribeAttempts = 0;
  let unmountAttempts = 0;
  const read: ProjectContextReadPort = {
    getSnapshot: () => ({
      status: "empty",
      generation: 1,
      catalog: [],
      selectedProjectId: null,
    }),
    subscribe() {
      return () => {
        unsubscribeAttempts += 1;
        if (unsubscribeAttempts === 1) throw new Error("unsubscribe failed");
      };
    },
  };
  const presentation: ProjectContextPresentationContribution = {
    mount() {
      return ok({
        unmount() {
          unmountAttempts += 1;
        },
      });
    },
  };
  const mounted = createProjectContextShellAdapter().mount({
    container: document.createElement("div"),
    read,
    commands: {} as never,
    presentation,
    publishAvailability() {},
  });
  assert.equal(mounted.ok, true);
  if (!mounted.ok) return;

  assert.throws(() => mounted.value.stop(), AggregateError);
  assert.equal(unsubscribeAttempts, 1);
  assert.equal(unmountAttempts, 1);

  mounted.value.stop();
  assert.equal(unsubscribeAttempts, 2);
  assert.equal(unmountAttempts, 1);
  mounted.value.stop();
  assert.equal(unsubscribeAttempts, 2);
  assert.equal(unmountAttempts, 1);
});
