import assert from "node:assert/strict";
import test from "node:test";
import { waitFor } from "@testing-library/dom";
import { act } from "react";
import {
  ok,
  type ProjectId,
  type RequestId,
  type Revision,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import type { FoundationScopedDataPort } from "../../src/persistence/public.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextRuntime } from "../../src/project-context/runtime.js";

test("8.1: runtime factory は注入 adapter から lifecycle capability と presentation を組み立てる", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111" as ProjectId;
  let projects: never[] = [];
  let mutationCalls = 0;
  let idCalls = 0;
  const foundation = {
    async query(select) {
      return ok(select({ revision: 0 as Revision, projects } as never));
    },
    async mutate(command) {
      mutationCalls += 1;
      if (command.operation.kind === "create") {
        projects = [...projects, command.operation.value as never];
      }
      return ok({ revision: 1 as Revision, replayed: false });
    },
  } as FoundationScopedDataPort;
  const runtime = createProjectContextRuntime({
    catalog: {
      async list() {
        return ok(projects);
      },
    },
    preference: createInMemoryProjectPreferencePort(),
    foundation,
    messages: { resolve: ({ intent }) => intent },
    createProjectId: () => {
      idCalls += 1;
      return projectId;
    },
    createRequestId: () => "99999999-9999-4999-8999-999999999999" as RequestId,
    now: () => "2026-08-13T00:00:00.000Z" as UtcTimestamp,
  });
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.api.lifecycle), true);
  assert.equal(typeof runtime.lifecyclePresentation.mount, "function");
  assert.equal((await runtime.initialize()).ok, true);
  const container = document.createElement("div");
  let mounted:
    | ReturnType<typeof runtime.lifecyclePresentation.mount>
    | undefined;
  act(() => {
    mounted = runtime.lifecyclePresentation.mount(container);
  });
  assert.ok(mounted);
  assert.equal(mounted.ok, true);
  let created:
    | Awaited<ReturnType<typeof runtime.api.lifecycle.create>>
    | undefined;
  await act(async () => {
    created = await runtime.api.lifecycle.create("Shared synthetic project");
  });
  assert.ok(created);
  assert.equal(created.ok, true);
  assert.equal(mutationCalls, 1);
  assert.equal(idCalls, 1);
  assert.equal(runtime.api.read.getSnapshot().selectedProjectId, projectId);
  await waitFor(() =>
    assert.match(container.textContent ?? "", /Shared synthetic project/),
  );
  const mountedResult = mounted;
  if (mountedResult.ok) act(() => mountedResult.value.unmount());
});
