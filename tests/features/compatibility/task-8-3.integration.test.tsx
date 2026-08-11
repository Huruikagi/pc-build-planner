import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";

import type { FeatureCompositionContext } from "../../../src/application-shell/public.js";
import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  PositiveInteger,
  ProjectId,
  Result,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type { CandidateQuery } from "../../../src/features/candidate-management/public.js";
import { createCompatibilityContribution } from "../../../src/features/compatibility/feature-contribution.js";
import type {
  BuildError,
  CurrentBuildQuery,
  CurrentBuildSnapshot,
} from "../../../src/features/current-build/public.js";
import type {
  ProjectContextReadPort,
  ProjectContextSnapshot,
} from "../../../src/project-context/public.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";

const projectA = "10000000-0000-4000-8000-000000000083" as Uuid as ProjectId;
const projectB = "10000000-0000-4000-8000-000000000084" as Uuid as ProjectId;
const timestamp = "2026-08-11T08:30:00.000Z" as UtcTimestamp;

const part = (
  projectId: ProjectId,
  suffix: string,
  category: CandidatePart["category"],
  socket: string,
): CandidatePart => ({
  id: `30000000-0000-4000-8000-0000000000${suffix}` as Uuid as CandidatePartId,
  projectId,
  category,
  product: {
    name: { original: `架空${suffix}`, confirmed: `架空${suffix}` },
  },
  sources: [],
  normalizedAttributes:
    category === "cpu"
      ? { category, socket: { original: socket, confirmed: socket } }
      : { category, socket: { original: socket, confirmed: socket } },
  createdAt: timestamp,
  updatedAt: timestamp,
});

const partsByProject = new Map<ProjectId, readonly CandidatePart[]>([
  [projectA, [part(projectA, "83", "cpu", "SYN-A")]],
  [
    projectB,
    [
      part(projectB, "84", "cpu", "SYN-B-CPU"),
      part(projectB, "85", "motherboard", "SYN-B-MB"),
    ],
  ],
]);

const buildFor = (
  projectId: ProjectId,
  candidates: readonly CandidatePart[],
): CurrentBuild => ({
  id: `40000000-0000-4000-8000-0000000000${projectId === projectA ? "83" : "84"}` as Uuid as CurrentBuild["id"],
  projectId,
  items: candidates.map((candidate) => ({
    candidatePartId: candidate.id,
    quantity: 1 as PositiveInteger,
  })),
  updatedAt: timestamp,
});

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const clone = <T,>(value: T): T => structuredClone(value);

test("feature contributionはproject切替後のreportだけを表示し、旧要求・購読・上流値を安全に扱う", async () => {
  const contextA: ProjectContextSnapshot = {
    status: "ready",
    generation: 1,
    catalog: [
      { id: projectA, name: "架空A", updatedAt: timestamp },
      { id: projectB, name: "架空B", updatedAt: timestamp },
    ],
    selectedProjectId: projectA,
  };
  const contextB: ProjectContextSnapshot = {
    ...contextA,
    generation: 2,
    selectedProjectId: projectB,
  };
  let snapshot = contextA;
  const candidatesA = partsByProject.get(projectA) ?? [];
  const candidatesB = partsByProject.get(projectB) ?? [];
  const buildSnapshotA: CurrentBuildSnapshot = {
    revision: 1 as never,
    currentBuild: buildFor(projectA, candidatesA),
  };
  const buildSnapshotB: CurrentBuildSnapshot = {
    revision: 1 as never,
    currentBuild: buildFor(projectB, candidatesB),
  };
  const baselines = {
    contextA: clone(contextA),
    contextB: clone(contextB),
    buildA: clone(buildSnapshotA),
    buildB: clone(buildSnapshotB),
    candidatesA: clone(candidatesA),
    candidatesB: clone(candidatesB),
  };
  const assertUpstreamUnchanged = (stage: string): void => {
    assert.deepEqual(
      contextA,
      baselines.contextA,
      `${stage}: context A mutated`,
    );
    assert.deepEqual(
      contextB,
      baselines.contextB,
      `${stage}: context B mutated`,
    );
    assert.deepEqual(
      buildSnapshotA,
      baselines.buildA,
      `${stage}: build A mutated`,
    );
    assert.deepEqual(
      buildSnapshotB,
      baselines.buildB,
      `${stage}: build B mutated`,
    );
    assert.deepEqual(
      candidatesA,
      baselines.candidatesA,
      `${stage}: candidates A mutated`,
    );
    assert.deepEqual(
      candidatesB,
      baselines.candidatesB,
      `${stage}: candidates B mutated`,
    );
  };
  const listeners = new Set<(value: ProjectContextSnapshot) => void>();
  let releases = 0;
  const projectContext: ProjectContextReadPort = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        if (listeners.delete(listener)) releases += 1;
      };
    },
  };

  let resolveA!: (value: Result<CurrentBuildSnapshot, BuildError>) => void;
  const delayedA = new Promise<Result<CurrentBuildSnapshot, BuildError>>(
    (resolve) => {
      resolveA = resolve;
    },
  );
  const buildReads: ProjectId[] = [];
  const currentBuildQuery: CurrentBuildQuery = {
    async getByProject(projectId) {
      buildReads.push(projectId);
      if (projectId === projectA) return delayedA;
      return { ok: true, value: buildSnapshotB };
    },
  };
  const candidateReads: ProjectId[] = [];
  const candidateQuery = {
    async listBuildEligible(projectId: ProjectId) {
      candidateReads.push(projectId);
      return {
        ok: true as const,
        value: projectId === projectA ? candidatesA : candidatesB,
      };
    },
  } as CandidateQuery;

  const contribution = createCompatibilityContribution(
    { projectContext } as FeatureCompositionContext,
    { currentBuildQuery, candidateQuery },
  );
  const container = document.createElement("div");
  let handle:
    | Awaited<ReturnType<typeof contribution.registration.mount>>
    | undefined;
  await act(async () => {
    handle = await contribution.registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  assert.equal(
    container.querySelector("[data-status='loading']") !== null,
    true,
  );

  snapshot = contextB;
  await act(async () => {
    for (const listener of [...listeners]) listener(snapshot);
    await flush();
  });
  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.incompatible")),
  );
  assert.match(container.textContent ?? "", /架空84|架空85/);
  assert.doesNotMatch(container.textContent ?? "", /架空83/);
  assertUpstreamUnchanged("B reflected");

  resolveA({
    ok: true,
    value: buildSnapshotA,
  });
  await act(flush);
  assert.match(container.textContent ?? "", /架空84|架空85/);
  assert.doesNotMatch(container.textContent ?? "", /架空83/);
  assertUpstreamUnchanged("stale A completed");
  assert.deepEqual(buildReads, [projectA, projectB]);
  assert.deepEqual(
    candidateReads,
    [projectB, projectA],
    "開始済みA評価は完了するが、そのreportは最新stateへ反映されない",
  );

  await act(async () => handle?.unmount());
  await act(async () => handle?.unmount());
  assert.equal(listeners.size, 0);
  assert.equal(releases, 1);
  assertUpstreamUnchanged("double unmount completed");
});
