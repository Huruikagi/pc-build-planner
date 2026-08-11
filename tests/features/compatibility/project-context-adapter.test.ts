import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import {
  type CompatibilityProjectAvailability,
  createCompatibilityProjectContextAdapter,
} from "../../../src/features/compatibility/project-context-adapter.js";
import type {
  ProjectContextReadPort,
  ProjectContextSnapshot,
} from "../../../src/project-context/public.js";

const projectA = "10000000-0000-4000-8000-0000000000a1" as Uuid as ProjectId;
const projectB = "10000000-0000-4000-8000-0000000000b2" as Uuid as ProjectId;

const ready = (
  generation: number,
  selectedProjectId: ProjectId,
): ProjectContextSnapshot => ({
  status: "ready",
  generation,
  catalog: [
    {
      id: selectedProjectId,
      name: "架空プロジェクト",
      updatedAt: "2026-08-11T00:00:00.000Z" as UtcTimestamp,
    },
  ],
  selectedProjectId,
});

const empty = (generation: number): ProjectContextSnapshot => ({
  status: "empty",
  generation,
  catalog: [],
  selectedProjectId: null,
});

const unavailable = (generation: number): ProjectContextSnapshot => ({
  status: "unavailable",
  generation,
  selectedProjectId: null,
  reason: "catalog-unavailable",
});

const createContextHarness = (initial: ProjectContextSnapshot) => {
  let snapshot = initial;
  const listeners = new Set<(value: ProjectContextSnapshot) => void>();
  const read: ProjectContextReadPort = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    read,
    get subscriberCount() {
      return listeners.size;
    },
    publish(next: ProjectContextSnapshot) {
      snapshot = next;
      for (const listener of [...listeners]) listener(next);
    },
    republish() {
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
};

test("ready snapshotは検証済みproject IDとgenerationだけを射影する", () => {
  const context = createContextHarness(ready(4, projectA));
  const adapter = createCompatibilityProjectContextAdapter(context.read);

  assert.deepEqual(adapter.getCurrent(), {
    status: "ready",
    generation: 4,
    projectId: projectA,
  });
});

test("empty snapshotは代替projectを選ばず独立状態として射影する", () => {
  const context = createContextHarness(empty(5));
  const adapter = createCompatibilityProjectContextAdapter(context.read);

  assert.deepEqual(adapter.getCurrent(), { status: "empty", generation: 5 });
});

test("unavailable snapshotは代替projectを選ばず独立状態として射影する", () => {
  const context = createContextHarness(unavailable(6));
  const adapter = createCompatibilityProjectContextAdapter(context.read);

  assert.deepEqual(adapter.getCurrent(), {
    status: "unavailable",
    generation: 6,
  });
});

test("購読は同一snapshotだけを抑止し、新generationの同一projectを通知する", () => {
  const context = createContextHarness(ready(7, projectA));
  const adapter = createCompatibilityProjectContextAdapter(context.read);
  const observed: CompatibilityProjectAvailability[] = [];
  const unsubscribe = adapter.subscribe((value) => observed.push(value));

  context.republish();
  context.publish(ready(8, projectA));
  context.publish(ready(9, projectB));
  context.publish(ready(3, projectA));
  context.publish(empty(10));
  context.publish(unavailable(11));

  assert.deepEqual(observed, [
    { status: "ready", generation: 8, projectId: projectA },
    { status: "ready", generation: 9, projectId: projectB },
    { status: "empty", generation: 10 },
    { status: "unavailable", generation: 11 },
  ]);

  unsubscribe();
});

test("unsubscribeは冪等で、解除後の通知をconsumerへ渡さない", () => {
  const context = createContextHarness(ready(1, projectA));
  const adapter = createCompatibilityProjectContextAdapter(context.read);
  const observed: CompatibilityProjectAvailability[] = [];
  const unsubscribe = adapter.subscribe((value) => observed.push(value));

  unsubscribe();
  unsubscribe();
  context.publish(ready(2, projectB));

  assert.deepEqual(observed, []);
  assert.equal(context.subscriberCount, 0);
});
