import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidatePart,
  CandidatePartId,
  NormalizedAttributes,
  ProjectId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type { CandidateQuery } from "../../../src/features/candidate-management/public.js";
import { createCategoryPolicy } from "../../../src/features/current-build/category-policy.js";
import type {
  BuildService,
  CurrentBuildQuery,
} from "../../../src/features/current-build/contracts.js";
import type { BuildProjectAvailability } from "../../../src/features/current-build/project-context-adapter.js";
import {
  type BuildStateDependencies,
  createBuildState,
} from "../../../src/features/current-build/state.js";
import { createBuildStateSnapshotCodec } from "../../../src/features/current-build/state-snapshot.js";

const timestamp = "2026-07-23T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const otherProjectId =
  "10000000-0000-4000-8000-000000000002" as Uuid as ProjectId;
const cpuCandidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const memoryCandidateId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const foreignCandidateId =
  "30000000-0000-4000-8000-000000000003" as Uuid as CandidatePartId;

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

const createState = async () => {
  const candidates: Pick<CandidateQuery, "listBuildEligible"> = {
    async listBuildEligible(id: ProjectId) {
      return {
        ok: true,
        value:
          id === projectId
            ? [
                candidate(cpuCandidateId),
                candidate(memoryCandidateId, {
                  category: "memory",
                  normalizedAttributes: memoryAttributes,
                }),
              ]
            : [],
      };
    },
  };
  const query: CurrentBuildQuery = {
    async getByProject() {
      return {
        ok: true,
        value: { revision: 0 as Revision, currentBuild: null },
      };
    },
  };
  const service: BuildService = {
    async execute() {
      throw new Error("not used by snapshot tests");
    },
  };
  const dependencies: BuildStateDependencies = {
    candidates,
    query,
    service,
    policy: createCategoryPolicy(),
  };
  const state = createBuildState(dependencies);
  await state.attachProjectContext({
    getCurrent: () => ({ status: "ready", generation: 1, projectId }),
    subscribe: () => () => {},
  });
  return state;
};

test("選択project・カテゴリと未保存数量draftだけをversion付きsnapshotとしてcaptureし、restoreする", async () => {
  const state = await createState();
  state.selectCategory("memory");
  state.setQuantityDraft(memoryCandidateId, "3");
  const codec = createBuildStateSnapshotCodec(state);

  const snapshot = codec.capture(state);
  const restored = codec.restore(snapshot);

  assert.deepEqual(snapshot, {
    version: 1,
    selectedProjectId: projectId,
    selectedCategory: "memory",
    quantityDrafts: { [memoryCandidateId]: "3" },
  });
  assert.deepEqual(restored, { ok: true, value: snapshot });
  assert.equal("projects" in snapshot, false);
  assert.equal("candidates" in snapshot, false);
  assert.equal("currentBuild" in snapshot, false);
  assert.equal("isSaving" in snapshot, false);
});

test("未知version、不正shape、stale project参照、stale candidate参照を識別可能なerrorとして拒否しstateを変更しない", async () => {
  const state = await createState();
  const codec = createBuildStateSnapshotCodec(state);
  const before = state.value;

  assert.deepEqual(codec.restore({ version: 2 }), {
    ok: false,
    error: { kind: "unsupported-version" },
  });
  assert.deepEqual(codec.restore("not-an-object"), {
    ok: false,
    error: { kind: "invalid-shape" },
  });
  assert.deepEqual(
    codec.restore({
      version: 1,
      selectedProjectId: projectId,
      selectedCategory: null,
      quantityDrafts: {},
      unexpected: true,
    }),
    { ok: false, error: { kind: "invalid-shape" } },
  );
  assert.deepEqual(
    codec.restore({
      version: 1,
      selectedProjectId:
        "10000000-0000-4000-8000-000000000099" as Uuid as ProjectId,
      selectedCategory: null,
      quantityDrafts: {},
    }),
    { ok: false, error: { kind: "project-mismatch" } },
  );
  assert.deepEqual(
    codec.restore({
      version: 1,
      selectedProjectId: projectId,
      selectedCategory: null,
      quantityDrafts: { [foreignCandidateId]: "1" },
    }),
    { ok: false, error: { kind: "invalid-reference" } },
  );
  assert.deepEqual(state.value, before);
});

test("不正カテゴリ、不正な数量draft値、安全でない文字列を含むsnapshotはinvalid-shapeとして拒否する", async () => {
  const state = await createState();
  const codec = createBuildStateSnapshotCodec(state);

  assert.deepEqual(
    codec.restore({
      version: 1,
      selectedProjectId: "data:text/html,<script>alert(1)</script>",
      selectedCategory: null,
      quantityDrafts: {},
    }),
    { ok: false, error: { kind: "invalid-shape" } },
  );
  assert.deepEqual(
    codec.restore({
      version: 1,
      selectedProjectId: projectId,
      selectedCategory: "not-a-category",
      quantityDrafts: {},
    }),
    { ok: false, error: { kind: "invalid-shape" } },
  );
  assert.deepEqual(
    codec.restore({
      version: 1,
      selectedProjectId: projectId,
      selectedCategory: null,
      quantityDrafts: { [cpuCandidateId]: 3 },
    }),
    { ok: false, error: { kind: "invalid-shape" } },
  );
  assert.deepEqual(
    codec.restore({
      version: 1,
      selectedProjectId: projectId,
      selectedCategory: null,
      quantityDrafts: { [cpuCandidateId]: "<img src=x onerror=alert(1)>" },
    }),
    { ok: false, error: { kind: "invalid-shape" } },
  );
  assert.deepEqual(
    codec.restore({
      version: 1,
      selectedProjectId: projectId,
      selectedCategory: null,
      quantityDrafts: { "not-a-uuid": "1" },
    }),
    { ok: false, error: { kind: "invalid-shape" } },
  );
});

test("選択解除状態（project・カテゴリともnull）もcapture/restoreできる", async () => {
  const state = await createState();
  const codec = createBuildStateSnapshotCodec(state);

  const emptySnapshot = {
    version: 1 as const,
    selectedProjectId: null,
    selectedCategory: null,
    quantityDrafts: {},
  };

  assert.deepEqual(codec.restore(emptySnapshot), {
    ok: true,
    value: emptySnapshot,
  });
});

test("category切替で表示から外れた候補への数量draftも読込済み候補全体からrestoreできる", async () => {
  const state = await createState();
  state.setQuantityDraft(memoryCandidateId, "2");
  await state.selectCategory("cpu");
  const codec = createBuildStateSnapshotCodec(state);

  assert.equal(
    state.value.candidates.some((c) => c.id === memoryCandidateId),
    false,
    "category絞り込みでmemory候補は表示から外れている",
  );
  const snapshot = codec.capture(state);
  assert.deepEqual(codec.restore(snapshot), { ok: true, value: snapshot });
});

/** 7.4: 共通contextのavailabilityを与えた state を組み立てる。 */
const createContextState = async (availability: BuildProjectAvailability) => {
  const state = await createState();
  await state.attachProjectContext({
    getCurrent: () => availability,
    subscribe: () => () => {},
  });
  return state;
};

const snapshotFor = (id: ProjectId | null, drafts = {}) => ({
  version: 1 as const,
  selectedProjectId: id,
  selectedCategory: "memory" as const,
  quantityDrafts: drafts,
});

test("snapshotのproject IDが現在のready projectと一致する場合だけ画面状態を復元する", async () => {
  const state = await createContextState({
    status: "ready",
    generation: 4,
    projectId,
  });
  const codec = createBuildStateSnapshotCodec(state);

  const snapshot = snapshotFor(projectId, { [memoryCandidateId]: "3" });
  assert.deepEqual(codec.restore(snapshot), { ok: true, value: snapshot });
});

test("現在のready projectと一致しないsnapshotは現在projectを変更せず復元しない", async () => {
  const state = await createContextState({
    status: "ready",
    generation: 4,
    projectId,
  });
  const codec = createBuildStateSnapshotCodec(state);
  const before = state.value;

  assert.deepEqual(codec.restore(snapshotFor(otherProjectId)), {
    ok: false,
    error: { kind: "project-mismatch" },
  });
  assert.equal(state.value.selectedProjectId, projectId);
  assert.deepEqual(state.value, before);
});

for (const status of ["empty", "unavailable"] as const) {
  test(`現在projectが${status}のときはsnapshotで現在projectを決めない`, async () => {
    const state = await createContextState({ status, generation: 5 });
    const codec = createBuildStateSnapshotCodec(state);

    assert.deepEqual(codec.restore(snapshotFor(projectId)), {
      ok: false,
      error: { kind: "project-mismatch" },
    });
    assert.equal(state.value.selectedProjectId, null);
    assert.equal(state.value.projectAvailability, status);
  });
}

test("project一致でも参照できない候補draftはinvalid-referenceとして拒否する", async () => {
  const state = await createContextState({
    status: "ready",
    generation: 4,
    projectId,
  });
  const codec = createBuildStateSnapshotCodec(state);

  assert.deepEqual(
    codec.restore(snapshotFor(projectId, { [foreignCandidateId]: "2" })),
    { ok: false, error: { kind: "invalid-reference" } },
  );
});

test("復元拒否は隔離中draftと永続データを変更しない", async () => {
  const state = await createContextState({
    status: "ready",
    generation: 4,
    projectId,
  });
  state.setQuantityDraft(memoryCandidateId, "5");
  // 強制変更で隔離された draft は復元拒否でも保持される。
  state.draftGuardOwner().notifyForced({
    token: "forced-1",
    from: projectId,
    to: null,
    baseGeneration: 4,
    cause: "catalog-invalidated",
  });
  const isolated = state.value.orphanedDraft;
  const codec = createBuildStateSnapshotCodec(state);

  assert.deepEqual(codec.restore(snapshotFor(otherProjectId)), {
    ok: false,
    error: { kind: "project-mismatch" },
  });
  assert.deepEqual(codec.restore({ version: 3 }), {
    ok: false,
    error: { kind: "unsupported-version" },
  });
  assert.deepEqual(state.value.orphanedDraft, isolated);
});

test("captureはversion 1のshapeを変えずcontext由来のproject IDだけを載せる", async () => {
  const state = await createContextState({
    status: "ready",
    generation: 4,
    projectId,
  });
  state.selectCategory("memory");
  const codec = createBuildStateSnapshotCodec(state);

  assert.deepEqual(codec.capture(state), {
    version: 1,
    selectedProjectId: projectId,
    selectedCategory: "memory",
    quantityDrafts: {},
  });
});
