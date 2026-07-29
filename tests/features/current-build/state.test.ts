import assert from "node:assert/strict";
import test from "node:test";

import type { OperationPolicy } from "../../../src/application-shell/public.js";
import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  NormalizedAttributes,
  PositiveInteger,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateQuery,
  ProjectSummary,
} from "../../../src/features/candidate-management/public.js";
import { createCategoryPolicy } from "../../../src/features/current-build/category-policy.js";
import type {
  BuildCommand,
  BuildError,
  BuildMutationContext,
  BuildService,
  CurrentBuildQuery,
  CurrentBuildSnapshot,
} from "../../../src/features/current-build/contracts.js";
import {
  type BuildStateDependencies,
  createBuildState,
} from "../../../src/features/current-build/state.js";

const timestamp = "2026-07-23T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const otherProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const cpuCandidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const memoryCandidateId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const buildId =
  "40000000-0000-4000-8000-000000000001" as Uuid as CurrentBuild["id"];

const cpuAttributes = {
  category: "cpu",
  socket: { original: "架空ソケット", confirmed: "SYN-1" },
} satisfies NormalizedAttributes;

const memoryAttributes = {
  category: "memory",
  memoryStandard: { original: "架空規格", confirmed: "SYN-DDR" },
} satisfies NormalizedAttributes;

const candidate = (
  id: CandidatePartId,
  overrides: Partial<CandidatePart> = {},
): CandidatePart =>
  ({
    id,
    projectId,
    category: "cpu",
    product: { name: { original: "架空CPU", confirmed: "架空CPU" } },
    sources: [],
    normalizedAttributes: cpuAttributes,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }) as CandidatePart;

const project = (id: ProjectId, name: string): ProjectSummary => ({
  id,
  name,
  updatedAt: timestamp,
});

type BuildByProject = Readonly<
  Record<string, { revision: number; currentBuild: CurrentBuild | null }>
>;

interface HarnessOptions {
  readonly projects?: readonly ProjectSummary[];
  readonly eligibleByProject?: Readonly<
    Record<string, readonly CandidatePart[]>
  >;
  readonly buildByProject?: BuildByProject;
  readonly query?: CurrentBuildQuery;
  readonly service?: BuildService;
  readonly serviceResult?: (
    command: BuildCommand,
  ) =>
    | { ok: true; value: CurrentBuildSnapshot }
    | { ok: false; error: BuildError };
  readonly operationPolicy?: OperationPolicy;
}

interface Harness {
  readonly state: ReturnType<typeof createBuildState>;
  readonly serviceCalls: {
    readonly command: BuildCommand;
    readonly context: BuildMutationContext;
  }[];
  readonly queryCalls: ProjectId[];
}

const defaultQuery = (buildByProject: BuildByProject): CurrentBuildQuery => ({
  async getByProject(id: ProjectId) {
    const entry = buildByProject[id];
    if (entry === undefined)
      return {
        ok: true,
        value: { revision: 0 as Revision, currentBuild: null },
      };
    return {
      ok: true,
      value: {
        revision: entry.revision as Revision,
        currentBuild: entry.currentBuild,
      },
    };
  },
});

const createHarness = (options: HarnessOptions = {}): Harness => {
  const projects = options.projects ?? [project(projectId, "架空PC構成")];
  const eligibleByProject = options.eligibleByProject ?? {
    [projectId]: [
      candidate(cpuCandidateId),
      candidate(memoryCandidateId, {
        category: "memory",
        normalizedAttributes: memoryAttributes,
      }),
    ],
  };
  const buildByProject: BuildByProject = options.buildByProject ?? {
    [projectId]: { revision: 0, currentBuild: null },
  };
  const queryCalls: ProjectId[] = [];
  const serviceCalls: {
    command: BuildCommand;
    context: BuildMutationContext;
  }[] = [];

  const candidates: CandidateQuery = {
    async listProjects() {
      return { ok: true, value: projects };
    },
    async listCandidates() {
      return { ok: true, value: [] };
    },
    async listBuildEligible(id: ProjectId) {
      return { ok: true, value: eligibleByProject[id] ?? [] };
    },
    async getCandidateDraft() {
      throw new Error("not used by state tests");
    },
  };

  const innerQuery = options.query ?? defaultQuery(buildByProject);
  const query: CurrentBuildQuery = {
    async getByProject(id: ProjectId) {
      queryCalls.push(id);
      return innerQuery.getByProject(id);
    },
  };

  const service: BuildService =
    options.service ??
    ({
      async execute(command: BuildCommand, context: BuildMutationContext) {
        serviceCalls.push({ command, context });
        const outcome = options.serviceResult?.(command);
        if (outcome !== undefined) return outcome;
        return {
          ok: true,
          value: {
            revision: (context.expectedRevision + 1) as Revision,
            currentBuild: null,
          },
        };
      },
    } satisfies BuildService);

  const dependencies: BuildStateDependencies = {
    candidates,
    query,
    service,
    policy: createCategoryPolicy(),
    createRequestId: () =>
      "20000000-0000-4000-8000-000000000001" as Uuid as RequestId,
    ...(options.operationPolicy === undefined
      ? {}
      : { operationPolicy: options.operationPolicy }),
  };

  return { state: createBuildState(dependencies), serviceCalls, queryCalls };
};

test("loadはプロジェクトを取得し最初のプロジェクトの候補と現在構成を読み込む", async () => {
  const { state } = createHarness();

  await state.load();

  assert.equal(state.value.selectedProjectId, projectId);
  assert.equal(state.value.projects.length, 1);
  assert.equal(state.value.candidates.length, 2);
  assert.equal(state.value.currentBuild, null);
  assert.equal(state.value.isLoading, false);
  assert.equal(state.value.displayError, null);
});

test("既存の選択projectがまだ存在する場合はloadで維持される（feature再表示の再照会）", async () => {
  const { state, queryCalls } = createHarness({
    projects: [
      project(projectId, "架空PC構成"),
      project(otherProjectId, "架空別構成"),
    ],
  });
  await state.load();
  await state.selectProject(otherProjectId);
  queryCalls.length = 0;

  await state.load();

  assert.equal(state.value.selectedProjectId, otherProjectId);
  assert.deepEqual(queryCalls, [otherProjectId]);
});

test("selectProjectはプロジェクト切替時に候補と現在構成を再照会する", async () => {
  const existingBuild: CurrentBuild = {
    id: buildId,
    projectId: otherProjectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { state, queryCalls } = createHarness({
    projects: [
      project(projectId, "架空PC構成"),
      project(otherProjectId, "架空別構成"),
    ],
    eligibleByProject: {
      [projectId]: [candidate(cpuCandidateId)],
      [otherProjectId]: [
        candidate(cpuCandidateId, { projectId: otherProjectId }),
      ],
    },
    buildByProject: {
      [projectId]: { revision: 0, currentBuild: null },
      [otherProjectId]: { revision: 3, currentBuild: existingBuild },
    },
  });
  await state.load();

  await state.selectProject(otherProjectId);

  assert.equal(state.value.selectedProjectId, otherProjectId);
  assert.deepEqual(state.value.currentBuild, existingBuild);
  assert.deepEqual(queryCalls, [projectId, otherProjectId]);
});

test("selectCategoryは追加queryなしで読込済み候補をカテゴリで絞り込む", async () => {
  const { state, queryCalls } = createHarness();
  await state.load();
  const callsAfterLoad = queryCalls.length;

  await state.selectCategory("memory");

  assert.equal(state.value.candidates.length, 1);
  assert.equal(state.value.candidates[0]?.category, "memory");
  assert.equal(queryCalls.length, callsAfterLoad);
});

test("executeの成功はcommit後snapshotへ置換しrevisionを更新する", async () => {
  const committedBuild: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { state, serviceCalls } = createHarness({
    serviceResult: () => ({
      ok: true,
      value: { revision: 1 as Revision, currentBuild: committedBuild },
    }),
  });
  await state.load();

  await state.execute({
    type: "select",
    projectId,
    candidatePartId: cpuCandidateId,
  });

  assert.equal(serviceCalls.length, 1);
  assert.equal(serviceCalls[0]?.context.expectedRevision, 0);
  assert.deepEqual(state.value.currentBuild, committedBuild);
  assert.equal(state.value.isSaving, false);
  assert.equal(state.value.savingCommand, null);
  assert.equal(state.value.displayError, null);
});

test("executeの失敗は直前の構成を保持し再試行可能な理由を示す", async () => {
  const { state } = createHarness({
    serviceResult: () => ({ ok: false, error: { kind: "quota" } }),
  });
  await state.load();
  const before = state.value.currentBuild;

  await state.execute({
    type: "select",
    projectId,
    candidatePartId: cpuCandidateId,
  });

  assert.deepEqual(state.value.currentBuild, before);
  assert.equal(state.value.isSaving, false);
  assert.equal(state.value.displayError?.code, "quota");
  assert.equal(
    state.value.mutationsDisabled,
    false,
    "quotaは再試行可能で操作を無効化しない",
  );
});

test("executeの競合失敗は直前の構成を保持し再読込を示すerrorとなる", async () => {
  const { state } = createHarness({
    serviceResult: () => ({ ok: false, error: { kind: "conflict" } }),
  });
  await state.load();
  const before = state.value.currentBuild;

  await state.execute({
    type: "select",
    projectId,
    candidatePartId: cpuCandidateId,
  });

  assert.deepEqual(state.value.currentBuild, before);
  assert.equal(state.value.displayError?.code, "conflict");
  assert.equal(state.value.mutationsDisabled, false);
});

test("保存中は同一featureからの操作を二重送信せずserviceを一度だけ呼ぶ", async () => {
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let callCount = 0;
  const service: BuildService = {
    async execute(_command, context) {
      callCount += 1;
      await gate;
      return {
        ok: true,
        value: {
          revision: (context.expectedRevision + 1) as Revision,
          currentBuild: null,
        },
      };
    },
  };
  const { state } = createHarness({ service });
  await state.load();

  const first = state.execute({
    type: "select",
    projectId,
    candidatePartId: cpuCandidateId,
  });
  assert.equal(state.value.isSaving, true);
  const second = state.execute({
    type: "select",
    projectId,
    candidatePartId: memoryCandidateId,
  });

  releaseGate?.();
  await Promise.all([first, second]);

  assert.equal(callCount, 1, "isSaving中の追加executeはserviceへ到達しない");
  assert.equal(state.value.isSaving, false);
});

test("破損データによるexecute失敗は変更操作を無効化する", async () => {
  const { state } = createHarness({
    serviceResult: () => ({ ok: false, error: { kind: "corrupt-data" } }),
  });
  await state.load();

  await state.execute({
    type: "select",
    projectId,
    candidatePartId: cpuCandidateId,
  });

  assert.equal(state.value.mutationsDisabled, true);
  assert.equal(state.value.displayError?.code, "corrupt-data");
});

test("読込時の破損・非対応・利用不能errorは構成変更を無効化する", async () => {
  const query: CurrentBuildQuery = {
    async getByProject() {
      return { ok: false, error: { kind: "storage" } };
    },
  };
  const { state } = createHarness({ query });

  await state.load();

  assert.equal(state.value.mutationsDisabled, true);
  assert.equal(state.value.displayError?.code, "storage");
});

test("setQuantityDraftはcommit済み構成に触れず数量draftだけを更新する", async () => {
  const { state } = createHarness();
  await state.load();

  state.setQuantityDraft(memoryCandidateId, "3");

  assert.equal(state.value.quantityDrafts[memoryCandidateId], "3");
  assert.equal(state.value.currentBuild, null);
});

test("数量変更の成功はcommit済み構成へ反映しdraftを解消する", async () => {
  const committedBuild: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: memoryCandidateId, quantity: 3 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const { state } = createHarness({
    serviceResult: () => ({
      ok: true,
      value: { revision: 1 as Revision, currentBuild: committedBuild },
    }),
  });
  await state.load();
  state.setQuantityDraft(memoryCandidateId, "3");

  await state.execute({
    type: "set-quantity",
    projectId,
    candidatePartId: memoryCandidateId,
    quantity: 3,
  });

  assert.equal(state.value.quantityDrafts[memoryCandidateId], undefined);
  assert.deepEqual(state.value.currentBuild, committedBuild);
});

test("operationPolicyがmutationを禁止すると変更操作が無効化される", async () => {
  const policy: OperationPolicy = {
    isAllowed: () => false,
    subscribe: () => () => {},
  };
  const { state } = createHarness({ operationPolicy: policy });

  await state.load();

  assert.equal(state.value.mutationsDisabled, true);
});
