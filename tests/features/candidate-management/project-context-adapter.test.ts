import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { createProjectContextAdapter } from "../../../src/features/candidate-management/project-context-adapter.js";
import type {
  ProjectContextChangeGuard,
  ProjectContextSnapshot,
} from "../../../src/project-context/public.js";

const projectId = "10000000-0000-4000-8000-000000000061" as Uuid as ProjectId;

test("adapterはreadyだけを候補管理の作業対象とし、refresh結果へ追従する", async () => {
  let snapshot: ProjectContextSnapshot = {
    status: "empty",
    generation: 1,
    catalog: [],
    selectedProjectId: null,
  };
  const listeners = new Set<(snapshot: ProjectContextSnapshot) => void>();
  let refreshes = 0;
  const adapter = createProjectContextAdapter({
    read: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    commands: {
      async refresh() {
        refreshes += 1;
        snapshot = {
          status: "ready",
          generation: 2,
          catalog: [
            {
              id: projectId,
              name: "架空",
              updatedAt: "2026-08-10T00:00:00.000Z" as UtcTimestamp,
            },
          ],
          selectedProjectId: projectId,
        };
        for (const listener of listeners) listener(snapshot);
        return { ok: true as const, value: snapshot };
      },
    },
  });

  assert.deepEqual(adapter.getCurrentProject(), { status: "unresolved" });
  assert.deepEqual(await adapter.refresh?.(), {
    ok: true,
    value: { status: "resolved", projectId },
  });
  assert.equal(refreshes, 1);
  assert.deepEqual(adapter.getCurrentProject(), {
    status: "resolved",
    projectId,
  });
});

test("guardはdirty時だけ確認を要求し、通常確定とforced通知を分離して冪等に解除する", async () => {
  let registered: ProjectContextChangeGuard | undefined;
  let releases = 0;
  let dirty = false;
  const discarded: string[] = [];
  const preserved: Array<ProjectId | null> = [];
  const adapter = createProjectContextAdapter({
    read: {
      getSnapshot: () => ({
        status: "ready",
        generation: 3,
        catalog: [
          {
            id: projectId,
            name: "架空",
            updatedAt: "2026-08-10T00:00:00.000Z" as UtcTimestamp,
          },
        ],
        selectedProjectId: projectId,
      }),
      subscribe: () => () => {},
    },
    commands: {
      refresh: async () => ({
        ok: true as const,
        value: {
          status: "empty" as const,
          generation: 4,
          catalog: [],
          selectedProjectId: null,
        },
      }),
    },
    guards: {
      register(guard) {
        registered = guard;
        return {
          ok: true as const,
          value: () => {
            releases += 1;
          },
        };
      },
    },
    draftGuard: {
      isDirty: () => dirty,
      discardConfirmedSwitch: (from, to) => discarded.push(`${from}:${to}`),
      preserveForcedSwitch: (from) => preserved.push(from),
    },
  });

  const started = adapter.start();
  assert.equal(started.ok, true);
  assert.ok(registered);
  assert.deepEqual(
    await registered.evaluate({
      kind: "select-project",
      from: projectId,
      to: projectId,
      cause: "user",
    }),
    { ok: true, value: { kind: "allow" } },
  );
  dirty = true;
  assert.deepEqual(
    await registered.evaluate({
      kind: "select-project",
      from: projectId,
      to: projectId,
      cause: "user",
    }),
    { ok: true, value: { kind: "confirmation-required" } },
  );
  await registered.notifyForced?.({
    kind: "select-project",
    from: projectId,
    to: projectId,
    cause: "user",
  });
  await registered.notifyForced?.({
    kind: "replace-catalog",
    from: projectId,
    cause: "backup-restore",
  });
  assert.equal(discarded.length, 1);
  assert.deepEqual(preserved, [projectId]);
  if (started.ok) {
    started.value();
    started.value();
  }
  assert.equal(releases, 1);
});

test("guard登録失敗は判別可能なstart errorになる", () => {
  const adapter = createProjectContextAdapter({
    read: {
      getSnapshot: () => ({
        status: "empty",
        generation: 1,
        catalog: [],
        selectedProjectId: null,
      }),
      subscribe: () => () => {},
    },
    commands: {
      refresh: async () => ({
        ok: true as const,
        value: {
          status: "empty" as const,
          generation: 1,
          catalog: [],
          selectedProjectId: null,
        },
      }),
    },
    guards: {
      register: () => ({
        ok: false as const,
        error: { kind: "duplicate-guard" as const },
      }),
    },
    draftGuard: {
      isDirty: () => false,
      discardConfirmedSwitch: () => {},
      preserveForcedSwitch: () => {},
    },
  });
  assert.deepEqual(adapter.start(), {
    ok: false,
    error: { kind: "guard-registration-failed" },
  });
});
