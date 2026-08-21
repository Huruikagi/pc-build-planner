import assert from "node:assert/strict";
import test from "node:test";
import type { LocalDataRoot } from "../../../src/domain/public.js";
import { err, ok } from "../../../src/domain/public.js";
import { createCandidateManagementContribution } from "../../../src/features/candidate-management/feature-contribution.js";
import { createProjectLifecycleHostAdapter } from "../../../src/features/candidate-management/project-lifecycle-host-adapter.js";
import type { FoundationScopedDataPort } from "../../../src/persistence/public.js";
import type { ProjectContextSnapshot } from "../../../src/project-context/public.js";
import { sourceRoot } from "../../fixtures/candidate-source-root.js";

test("13.2: common lifecycle presentation mounts in the candidate host and unmounts once", () => {
  const container = document.createElement("section");
  let mountedContainer: HTMLElement | undefined;
  let unmounts = 0;
  const adapter = createProjectLifecycleHostAdapter({
    mount(target) {
      mountedContainer = target;
      target.dataset.lifecycleMounted = "true";
      return ok({
        unmount() {
          unmounts += 1;
          target.replaceChildren();
        },
      });
    },
  });

  const mounted = adapter.mount(container);

  assert.equal(mounted.ok, true);
  assert.equal(mountedContainer, container);
  if (!mounted.ok) return;
  mounted.value();
  mounted.value();
  assert.equal(unmounts, 1);
});

test("13.2: presentation mount failure is translated without candidate fallback", () => {
  const adapter = createProjectLifecycleHostAdapter({
    mount() {
      return err({ kind: "presentation-failed" });
    },
  });

  assert.deepEqual(adapter.mount(document.createElement("section")), {
    ok: false,
    error: { kind: "project-lifecycle-host-failed" },
  });
});

test("13.2: candidate registration composes the common lifecycle presentation into its host", async () => {
  const projectId = "10000000-0000-4000-8000-000000000071" as never;
  const snapshot: ProjectContextSnapshot = {
    status: "ready" as const,
    generation: 1,
    catalog: [
      {
        id: projectId,
        name: "Fixture project",
        updatedAt: "2026-08-21T00:00:00.000Z" as never,
      },
    ],
    selectedProjectId: projectId,
  };
  let presentationMounts = 0;
  let presentationUnmounts = 0;
  const root: LocalDataRoot = sourceRoot();
  const data = {
    async query<T>(project: (root: LocalDataRoot) => T) {
      return ok(project(root));
    },
    async mutate() {
      throw new Error(
        "lifecycle host composition must not mutate candidate data",
      );
    },
  } as FoundationScopedDataPort;
  const contribution = createCandidateManagementContribution(
    {
      data,
      navigator: { activate: async () => ok(undefined) },
      projectContext: {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
      },
    },
    {
      projectContext: {
        commands: { refresh: async () => ({ ok: true, value: snapshot }) },
        lifecyclePresentation: {
          mount(container) {
            presentationMounts += 1;
            container.dataset.commonLifecycle = "mounted";
            return ok({
              unmount() {
                presentationUnmounts += 1;
              },
            });
          },
        },
      },
    },
  );
  const container = document.createElement("div");
  const handle = await contribution.registration.mount({
    container,
    operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
    reportError: () => {},
  });

  assert.equal(presentationMounts, 1);
  assert.equal(
    container
      .querySelector("[data-region='project-lifecycle-host']")
      ?.getAttribute("data-common-lifecycle"),
    "mounted",
  );
  assert.equal(container.querySelector("[data-region='project-form']"), null);
  assert.equal(container.querySelector("[data-rename-project-id]"), null);
  assert.equal(container.querySelector("[data-delete-project-id]"), null);
  assert.equal(container.querySelector("[data-confirm-deletion]"), null);
  await handle.unmount();
  await handle.unmount();
  assert.equal(presentationUnmounts, 1);
  assert.equal(container.childElementCount, 0);
});

test("13.2: failed candidate load releases the common presentation and acquired subscriptions", async () => {
  let presentationUnmounts = 0;
  let contextSubscriptions = 0;
  let contextReleases = 0;
  let policySubscriptions = 0;
  let policyReleases = 0;
  const contribution = createCandidateManagementContribution(
    {
      data: {
        async query() {
          throw new Error("fixture load failure");
        },
        async mutate() {
          throw new Error("not used");
        },
      } as FoundationScopedDataPort,
      navigator: { activate: async () => ok(undefined) },
      projectContext: {
        getSnapshot: () => ({
          status: "empty",
          generation: 1,
          catalog: [],
          selectedProjectId: null,
        }),
        subscribe() {
          contextSubscriptions += 1;
          return () => {
            contextReleases += 1;
          };
        },
      },
    },
    {
      projectContext: {
        commands: {
          refresh: async () => ({
            ok: true,
            value: {
              status: "empty",
              generation: 1,
              catalog: [],
              selectedProjectId: null,
            },
          }),
        },
        lifecyclePresentation: {
          mount(container) {
            container.dataset.commonLifecycle = "mounted";
            return ok({
              unmount() {
                presentationUnmounts += 1;
              },
            });
          },
        },
      },
    },
  );
  const container = document.createElement("div");

  await assert.rejects(
    contribution.registration.mount({
      container,
      operationPolicy: {
        isAllowed: () => true,
        subscribe() {
          policySubscriptions += 1;
          return () => {
            policyReleases += 1;
          };
        },
      },
      reportError: () => {},
    }),
    /fixture load failure/,
  );

  assert.equal(presentationUnmounts, 1);
  assert.equal(contextSubscriptions, 1);
  assert.equal(contextReleases, 1);
  assert.equal(policySubscriptions, 1);
  assert.equal(policyReleases, 1);
  assert.equal(container.childElementCount, 0);
});
