import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { act } from "react";

import {
  ok,
  type ProjectId,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { createProjectCatalogProjection } from "../../src/project-context/catalog.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextPresentationContribution } from "../../src/project-context/presentation-contribution.js";
import { createProjectContextPublicApi } from "../../src/project-context/public.js";
import { createProjectContextService } from "../../src/project-context/service.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;

afterEach(() => document.body.replaceChildren());

const createApi = async () => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([
          {
            id: A,
            name: "架空A",
            updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
          },
        ]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  return createProjectContextPublicApi({ service });
};

test("3.3: contribution は exact container に一つだけ mount し、unmount 後に再mountできる", async () => {
  const api = await createApi();
  const container = document.createElement("div");
  document.body.append(container);
  let activeSubscriptions = 0;
  const read = {
    getSnapshot: api.read.getSnapshot,
    subscribe(listener: Parameters<typeof api.read.subscribe>[0]) {
      activeSubscriptions += 1;
      const unsubscribe = api.read.subscribe(listener);
      return () => {
        activeSubscriptions -= 1;
        unsubscribe();
      };
    },
  };
  const contribution = createProjectContextPresentationContribution({
    read,
    commands: api.commands,
  });

  let mounted: ReturnType<typeof contribution.mount> | undefined;
  await act(() => {
    mounted = contribution.mount(container);
  });
  const mountedResult = mounted;
  if (mountedResult === undefined || !mountedResult.ok)
    assert.fail("mount should succeed");
  assert.ok(container.querySelector("[data-project-context='selector']"));
  assert.equal(activeSubscriptions, 1);
  const duplicate = contribution.mount(container);
  assert.deepEqual(duplicate, {
    ok: false,
    error: { kind: "presentation-failed" },
  });

  await act(() => {
    mountedResult.value.unmount();
    mountedResult.value.unmount();
  });
  assert.equal(container.childElementCount, 0);
  assert.equal(activeSubscriptions, 0);

  let remounted: ReturnType<typeof contribution.mount> | undefined;
  await act(() => {
    remounted = contribution.mount(container);
  });
  const remountedResult = remounted;
  if (remountedResult === undefined || !remountedResult.ok)
    assert.fail("remount should succeed");
  assert.equal(activeSubscriptions, 1);
  await act(() => remountedResult.value.unmount());
  assert.equal(activeSubscriptions, 0);
});
