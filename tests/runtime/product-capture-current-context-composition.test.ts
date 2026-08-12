import assert from "node:assert/strict";
import test from "node:test";
import { userEvent } from "@testing-library/user-event";
import { act } from "react";

import { createProductionApplicationComposition } from "../../src/application-shell/application-composition.js";
import type {
  ActivationId,
  TargetTabId,
} from "../../src/application-shell/public.js";
import { createShellPresentation } from "../../src/application-shell/shell-presentation.js";
import {
  createSidePanelFeatureContributions,
  projectCatalogSourceFromSidePanelContributions,
} from "../../src/application-shell/side-panel-contributions.js";
import {
  type LocalDataRoot,
  ok,
  type ProjectId,
  type Revision,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { productCaptureFeatureId } from "../../src/features/product-capture/public.js";
import type {
  BackupRestoreDataPort,
  FoundationScopedDataPort,
} from "../../src/persistence/public.js";
import { sourceRoot } from "../fixtures/candidate-source-root.js";
import { createProductionCaptureChromeFixture } from "../fixtures/product-capture-production.js";

const TAB = 76 as TargetTabId;
const ACTIVATION = "task-7-6-production-context" as ActivationId;
const PAGE = "https://shop.example.invalid/task-7-6";
const PROJECT_A = "10000000-0000-4000-8000-000000000001" as ProjectId;
const PROJECT_B = "10000000-0000-4000-8000-000000000002" as ProjectId;
const TIME = "2026-08-12T00:00:00.000Z" as UtcTimestamp;
const NAME = "SYN current-context CPU";
const STALE_PROJECT = "10000000-0000-4000-8000-000000000099";

const backupRestoreData = {
  assessReplacement: async () => ok({} as never),
  assessRecovery: async () => ok({} as never),
  commit: async () => ok({} as never),
  findPendingFinalization: async () => ok(null),
  finalize: async () => ok({} as never),
} satisfies BackupRestoreDataPort;

function createCurrentContextHandoffHarness(options: {
  readonly projects: LocalDataRoot["projects"];
  readonly failCandidateRemountOnce?: boolean;
}) {
  let canonical: LocalDataRoot = {
    ...sourceRoot(),
    projects: [...options.projects],
    candidateParts: [],
    currentBuilds: [],
  };
  const data: FoundationScopedDataPort = {
    async query(project) {
      return ok(project(canonical));
    },
    async mutate() {
      throw new Error("capture handoff must not persist a candidate");
    },
  };
  const chrome = createProductionCaptureChromeFixture({
    grantedTabId: TAB,
    pageUrl: PAGE,
    candidates: [
      {
        field: "name",
        rawValue: NAME,
        source: "heading",
        sourceLabel: "h1",
        documentOrder: 0,
      },
    ],
  });
  const shellContainer = document.createElement("div");
  document.body.replaceChildren(shellContainer);
  let controller:
    | Parameters<
        NonNullable<
          Parameters<
            typeof createProductionApplicationComposition
          >[0]["createTransientMonitoring"]
        >
      >[0]
    | undefined;
  let projectRefresh: (() => Promise<unknown>) | undefined;
  let maintenanceActive = false;
  let maintenanceGeneration = 0;
  const maintenanceListeners = new Set<(value: never) => void>();
  let candidateMounts = 0;
  const root = createProductionApplicationComposition({
    shellContainer,
    initializeFoundation: async () =>
      ok({
        maintenanceSource: {
          async getSnapshot() {
            return ok({
              generation: maintenanceGeneration,
              revision: canonical.revision,
              active: maintenanceActive,
            } as never);
          },
          subscribe(listener) {
            maintenanceListeners.add(listener);
            return () => maintenanceListeners.delete(listener);
          },
        },
        workerRegistrations: [],
        dataPort: data,
        backupRestoreDataPort: backupRestoreData,
        dispose() {},
      }),
    createContributions(context, dependencies) {
      projectRefresh = dependencies.projectRefresh.refresh;
      const features = createSidePanelFeatureContributions(
        context,
        dependencies,
        chrome.chrome,
      );
      const candidate = features[0];
      const candidateMount = candidate.registration.mount.bind(
        candidate.registration,
      );
      const wrappedCandidate = options.failCandidateRemountOnce
        ? {
            ...candidate,
            registration: {
              ...candidate.registration,
              async mount(input: Parameters<typeof candidateMount>[0]) {
                candidateMounts += 1;
                if (candidateMounts === 2)
                  throw new Error("synthetic candidate remount failure");
                return candidateMount(input);
              },
            },
          }
        : candidate;
      return {
        features: [
          wrappedCandidate,
          features[1],
          features[2],
          features[3],
          features[4],
          features[5],
        ] as typeof features,
        workerRegistrations: [],
      };
    },
    createProjectCatalogSource: projectCatalogSourceFromSidePanelContributions,
    presentation: createShellPresentation(),
    workerContext: { addActionHandler: () => () => {}, reportError() {} },
    reportError() {},
    createTransientMonitoring(value) {
      controller = value;
      return { start: async () => ok(undefined), stop() {} };
    },
  });
  const user = userEvent.setup();
  const flush = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  return {
    shellContainer,
    chrome,
    root,
    replaceProjects(projects: LocalDataRoot["projects"]) {
      canonical = {
        ...canonical,
        revision: (canonical.revision + 1) as Revision,
        projects: [...projects],
      };
    },
    async start() {
      let started: Awaited<ReturnType<typeof root.start>> | undefined;
      await act(async () => {
        started = await root.start();
        await flush();
      });
      assert.equal(started?.ok, true);
      assert.ok(controller);
    },
    async capture() {
      if (controller?.getSnapshot().kind === "inactive") {
        let requested:
          | Awaited<ReturnType<NonNullable<typeof controller>["request"]>>
          | undefined;
        await act(async () => {
          requested = await controller?.request({
            activationId: ACTIVATION,
            surfaceId: productCaptureFeatureId,
            tabId: TAB,
          });
          await flush();
        });
        assert.equal(requested?.ok, true);
      }
      const button = shellContainer.querySelector<HTMLElement>(
        "[data-capture-start], [data-capture-retry]",
      );
      assert.ok(button);
      await act(async () => {
        await user.click(button);
        await flush();
      });
    },
    async select(projectId: ProjectId) {
      const selector = shellContainer.querySelector<HTMLSelectElement>(
        "[data-project-context='select']",
      );
      assert.ok(selector);
      await act(async () => {
        await user.selectOptions(selector, projectId);
        await flush();
      });
    },
    async refresh() {
      assert.ok(projectRefresh);
      await act(async () => {
        await projectRefresh?.();
        await flush();
      });
    },
    async setMaintenance(active: boolean) {
      maintenanceActive = active;
      maintenanceGeneration += 1;
      const snapshot = {
        generation: maintenanceGeneration,
        revision: canonical.revision,
        active,
      } as never;
      await act(async () => {
        for (const listener of maintenanceListeners) listener(snapshot);
        await flush();
      });
    },
    async activateCapture() {
      let requested:
        | Awaited<ReturnType<NonNullable<typeof controller>["request"]>>
        | undefined;
      await act(async () => {
        requested = await controller?.request({
          activationId: ACTIVATION,
          surfaceId: productCaptureFeatureId,
          tabId: TAB,
        });
        await flush();
      });
      assert.equal(requested?.ok, true);
    },
    async activateLegacyProjectIntent(name: string) {
      let activated:
        | Awaited<ReturnType<NonNullable<typeof root.activate>>>
        | undefined;
      await act(async () => {
        activated = await root.activate?.({
          featureId: "candidate-management" as never,
          target: "open-candidate-editor",
          payload: {
            projectId: STALE_PROJECT,
            draft: {
              category: "uncategorized",
              product: { name: { original: name } },
              normalizedAttributes: { category: "uncategorized" },
            },
          },
        });
        await flush();
      });
      assert.equal(activated?.ok, true);
    },
  };
}

const project = (id: ProjectId, name: string) => ({
  id,
  name,
  createdAt: TIME,
  updatedAt: TIME,
});

test("production compositionはcapture時点のcurrent projectだけへ同じdraftをbindする", async () => {
  const h = createCurrentContextHandoffHarness({
    projects: [project(PROJECT_A, "A"), project(PROJECT_B, "B")],
  });
  await h.start();
  await h.select(PROJECT_B);
  await h.capture();

  const name = h.shellContainer.querySelector<HTMLInputElement>(
    "[name='candidate-name']",
  );
  assert.equal(name?.value, NAME);
  assert.match(h.shellContainer.textContent ?? "", /B/);
  assert.deepEqual(h.chrome.observedTabsGet, [TAB]);
  assert.deepEqual(h.chrome.observedInjectionTabs, [TAB, TAB]);
  await act(async () => h.root.stop());
});

test("空catalogのpendingはcanonical refresh後に再抽出なしでcurrent projectへ再開する", async () => {
  const h = createCurrentContextHandoffHarness({ projects: [] });
  await h.start();
  await h.capture();
  assert.ok(h.shellContainer.querySelector("[data-region='project-required']"));
  assert.match(h.shellContainer.textContent ?? "", new RegExp(NAME));

  h.replaceProjects([project(PROJECT_B, "Recovered")]);
  await h.refresh();

  assert.equal(
    h.shellContainer.querySelector("[data-region='project-required']"),
    null,
  );
  assert.equal(
    h.shellContainer.querySelector<HTMLInputElement>("[name='candidate-name']")
      ?.value,
    NAME,
  );
  assert.deepEqual(h.chrome.observedTabsGet, [TAB]);
  assert.deepEqual(h.chrome.observedInjectionTabs, [TAB, TAB]);
  await act(async () => h.root.stop());
});

test("same production rootのlegacy project intentはcurrent contextを変更せずproject-free pendingから回復する", async () => {
  const h = createCurrentContextHandoffHarness({ projects: [] });
  await h.start();
  await h.activateLegacyProjectIntent("SYN legacy project-free draft");

  assert.ok(h.shellContainer.querySelector("[data-region='project-required']"));
  assert.match(
    h.shellContainer.textContent ?? "",
    /SYN legacy project-free draft/,
  );
  assert.equal(h.shellContainer.textContent?.includes(STALE_PROJECT), false);
  assert.equal(
    h.shellContainer.querySelector<HTMLSelectElement>(
      "[data-project-context='select']",
    )?.value,
    "",
  );

  h.replaceProjects([project(PROJECT_B, "Recovered current")]);
  await h.refresh();

  assert.equal(
    h.shellContainer.querySelector("[data-region='project-required']"),
    null,
  );
  assert.equal(
    h.shellContainer.querySelector<HTMLInputElement>("[name='candidate-name']")
      ?.value,
    "SYN legacy project-free draft",
  );
  assert.equal(
    h.shellContainer.querySelector<HTMLSelectElement>(
      "[data-project-context='select']",
    )?.value,
    PROJECT_B,
  );
  assert.deepEqual(h.chrome.observedTabsGet, []);
  assert.deepEqual(h.chrome.observedInjectionTabs, []);
  await act(async () => h.root.stop());
});

test("candidate受理がmaintenanceで拒否されてもsourceを復元し同じdraftだけをretryする", async () => {
  const h = createCurrentContextHandoffHarness({
    projects: [project(PROJECT_A, "A")],
  });
  await h.start();
  await h.activateCapture();
  await h.setMaintenance(true);
  await h.capture();

  assert.match(h.shellContainer.textContent ?? "", /operation-blocked/);
  assert.ok(h.shellContainer.querySelector("[data-capture-retry]"));
  await h.setMaintenance(false);
  await h.capture();

  assert.equal(
    h.shellContainer.querySelector<HTMLInputElement>("[name='candidate-name']")
      ?.value,
    NAME,
  );
  assert.deepEqual(h.chrome.observedTabsGet, [TAB]);
  assert.deepEqual(h.chrome.observedInjectionTabs, [TAB, TAB]);
  await act(async () => h.root.stop());
});

test("candidate target mountの原子的失敗はcaptureへrollbackし再抽出なしでretryする", async () => {
  const h = createCurrentContextHandoffHarness({
    projects: [project(PROJECT_A, "A")],
    failCandidateRemountOnce: true,
  });
  await h.start();
  await h.capture();

  assert.match(h.shellContainer.textContent ?? "", /target-mount-failed/);
  assert.ok(h.shellContainer.querySelector("[data-capture-retry]"));
  await h.capture();

  assert.equal(
    h.shellContainer.querySelector<HTMLInputElement>("[name='candidate-name']")
      ?.value,
    NAME,
  );
  assert.deepEqual(h.chrome.observedTabsGet, [TAB]);
  assert.deepEqual(h.chrome.observedInjectionTabs, [TAB, TAB]);
  await act(async () => h.root.stop());
});
