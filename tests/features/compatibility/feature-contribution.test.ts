import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";

import { createFeatureRegistry } from "../../../src/application-shell/feature-registry.js";
import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  FoundationError,
  NormalizedAttributes,
  PositiveInteger,
  ProjectId,
  Result,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateQuery,
  ManagementError,
} from "../../../src/features/candidate-management/public.js";
import { createCompatibilityContribution } from "../../../src/features/compatibility/feature-contribution.js";
import type {
  BuildError,
  CurrentBuildQuery,
  CurrentBuildSnapshot,
} from "../../../src/features/current-build/public.js";
import type {
  FoundationDataPort,
  FoundationScopedDataPort,
} from "../../../src/persistence/public.js";
import type {
  ProjectContextReadPort,
  ProjectContextSnapshot,
} from "../../../src/project-context/public.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const buildId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"];
const cpuId = "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const motherboardId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

const candidate = (
  id: CandidatePartId,
  category: CandidatePart["category"],
  normalizedAttributes: NormalizedAttributes,
): CandidatePart => ({
  id,
  projectId,
  category,
  product: {
    name: { original: `架空パーツ${id}`, confirmed: `架空パーツ${id}` },
  },
  sources: [],
  normalizedAttributes,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const parts: readonly CandidatePart[] = [
  candidate(cpuId, "cpu", {
    category: "cpu",
    socket: { original: "元表記", confirmed: "AM5" },
  }),
  candidate(motherboardId, "motherboard", {
    category: "motherboard",
    socket: { original: "元表記", confirmed: "AM5" },
  }),
];

const build: CurrentBuild = {
  id: buildId,
  projectId,
  items: [
    { candidatePartId: cpuId, quantity: 1 as PositiveInteger },
    { candidatePartId: motherboardId, quantity: 1 as PositiveInteger },
  ],
  updatedAt: timestamp,
};

const currentBuildQuery: CurrentBuildQuery = {
  async getByProject(): Promise<Result<CurrentBuildSnapshot, BuildError>> {
    return { ok: true, value: { revision: 1 as never, currentBuild: build } };
  },
};

const candidateQuery: CandidateQuery = {
  async listProjects() {
    throw new Error("not used by feature-contribution tests");
  },
  async listCandidates() {
    return { ok: true, value: [] };
  },
  async listBuildEligible(): Promise<
    Result<readonly CandidatePart[], ManagementError>
  > {
    return { ok: true, value: parts };
  },
  async getCandidateDraft() {
    throw new Error("not used by feature-contribution tests");
  },
};

const compositionContext = {
  data: {
    async query() {
      return { ok: true, value: undefined } as Result<never, FoundationError>;
    },
    async mutate() {
      throw new Error("not used by feature-contribution tests");
    },
  } as unknown as FoundationScopedDataPort,
  fullDataPort: {
    async query() {
      return { ok: true, value: undefined } as Result<never, FoundationError>;
    },
    async mutate() {
      throw new Error("not used by feature-contribution tests");
    },
    async assessReplacement() {
      throw new Error("not used by feature-contribution tests");
    },
    async replaceRoot() {
      throw new Error("not used by feature-contribution tests");
    },
    async runMaintenance() {
      throw new Error("not used by feature-contribution tests");
    },
  } as unknown as FoundationDataPort,
  navigator: {
    async activate() {
      throw new Error("not used by feature-contribution tests");
    },
  },
};

const readyContext = (): {
  readonly read: ProjectContextReadPort;
  readonly subscriptions: () => number;
  readonly releases: () => number;
} => {
  const snapshot: ProjectContextSnapshot = {
    status: "ready",
    generation: 1,
    catalog: [
      { id: projectId, name: "架空プロジェクト", updatedAt: timestamp },
    ],
    selectedProjectId: projectId,
  };
  let subscriptions = 0;
  let releases = 0;
  return {
    read: {
      getSnapshot: () => snapshot,
      subscribe() {
        subscriptions += 1;
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          releases += 1;
        };
      },
    },
    subscriptions: () => subscriptions,
    releases: () => releases,
  };
};

test("合成入口はcompatibility contributionを組み立てshellが解決できる形にする", async () => {
  const contribution = createCompatibilityContribution(compositionContext, {
    currentBuildQuery,
    candidateQuery,
  });

  assert.equal(contribution.key, "compatibility");
  assert.equal(contribution.registration.id, "compatibility");

  const registry = createFeatureRegistry();
  const registered = registry.register(contribution.registration);
  assert.equal(
    registered.ok,
    true,
    "shellのfeature registryが登録を解決できない",
  );
});

test("mountは上流queryから読み取り実際の5規則評価結果を描画する", async () => {
  const context = readyContext();
  const contribution = createCompatibilityContribution(compositionContext, {
    currentBuildQuery,
    candidateQuery,
    projectContext: context.read,
  });
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

  // socketが一致するcpu/motherboardのみ選択済みのためcpu-motherboard-socketは互換性あり、
  // 他4規則は該当カテゴリ不足でunknownとなりcautionへ集約される。
  assert.match(
    container.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.caution")),
  );
  assert.match(container.textContent ?? "", /架空パーツ/);
  assert.equal(context.subscriptions(), 1);

  await act(async () => handle?.unmount());
  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
  assert.equal(context.releases(), 1);
});

test("context未注入時は別projectへfallback評価しない", async () => {
  let buildReads = 0;
  const contribution = createCompatibilityContribution(compositionContext, {
    currentBuildQuery: {
      async getByProject(id) {
        buildReads += 1;
        return currentBuildQuery.getByProject(id);
      },
    },
    candidateQuery,
  });
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

  assert.equal(buildReads, 0);
  assert.equal(container.querySelector("[data-status='idle']") !== null, true);
  await act(async () => handle?.unmount());
});
