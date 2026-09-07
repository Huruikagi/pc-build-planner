import { expect, test } from "@playwright/test";

import { removeCandidateReferences } from "../src/build.js";
import { mergeIntoPart } from "../src/duplicates.js";
import {
  createInitialRoot,
  type LocalDataRoot,
  localDataRootSchema,
} from "../src/model.js";
import {
  deletePart,
  draftFromCaptureHandoff,
  draftFromPart,
  registerCandidateDeletionReferenceCleanup,
  savePart,
} from "../src/parts.js";
import { deleteProject, selectProject } from "../src/projects.js";
import { createMemoryStorageDriver, Store } from "../src/storage.js";

const withProject = (): LocalDataRoot => ({
  ...createInitialRoot(),
  selectedProjectId: "project-1",
  projects: [
    {
      id: "project-1",
      name: "SYN 候補変換",
      createdAt: "2026-09-06T00:00:00.000Z",
    },
  ],
});

const capturedCpuDraft = () =>
  draftFromCaptureHandoff({
    originals: {
      name: "SYN CPU Original",
      manufacturer: "SYN Maker",
      modelNumber: "SYN-CPU-1",
      category: "Processors",
    },
    capturedAttributeCategory: "cpu",
    attributes: { socket: "Socket AM5", unknown: "discard me" },
    source: {
      url: "https://pcbp.test/cpu/syn-1",
      kind: "retail",
      capturedAt: "2026-09-06T00:00:00.000Z",
      price: { amount: 50000, currency: "JPY" },
    },
  });

test("候補管理所有の受入入力を未確認の下書きへ変換する", () => {
  const draft = capturedCpuDraft();

  expect(draft.name).toBe("");
  expect(draft.manufacturer).toBe("");
  expect(draft.modelNumber).toBe("");
  expect(draft.category).toBe("uncategorized");
  expect(draft.originals).toEqual({
    name: "SYN CPU Original",
    manufacturer: "SYN Maker",
    modelNumber: "SYN-CPU-1",
  });
  expect(draft.originalCategory).toBe("Processors");
  expect(draft.capturedAttributeCategory).toBe("cpu");
  expect(draft.originalAttributes).toEqual({ socket: "Socket AM5" });
  expect(draft.sources).toMatchObject([
    {
      url: "https://pcbp.test/cpu/syn-1",
      kind: "retail",
      capturedAt: "2026-09-06T00:00:00.000Z",
      price: { amount: 50000, currency: "JPY" },
      primary: true,
    },
  ]);
  expect(draft.sources[0]?.id).toMatch(/^[0-9a-f-]{36}$/u);
});

test("URL-only候補を保存し、再編集できる", () => {
  const draft = draftFromCaptureHandoff({
    originals: {
      name: null,
      manufacturer: null,
      modelNumber: null,
      category: null,
    },
    capturedAttributeCategory: null,
    attributes: {},
    source: {
      url: "https://pcbp.test/url-only",
      kind: "retail",
      capturedAt: "2026-09-06T00:00:00.000Z",
      price: null,
    },
  });
  const first = savePart(draft, "project-1")(withProject());
  const saved = first.candidateParts[0];

  expect(saved?.name).toBeNull();
  expect(saved?.category).toBe("uncategorized");
  expect(saved?.sources[0]?.url).toBe("https://pcbp.test/url-only");
  expect(localDataRootSchema.safeParse(first).success).toBe(true);
  if (saved === undefined) throw new Error("saved candidate is unavailable");
  expect(() =>
    savePart(draftFromPart(saved), "project-1")(first),
  ).not.toThrow();
});

test("属性元表記を保存し、確認済み投影を自動変更しない", () => {
  const first = savePart(capturedCpuDraft(), "project-1")(withProject());
  const saved = first.candidateParts[0];

  expect(saved).toMatchObject({
    category: "uncategorized",
    originalCategory: "Processors",
    capturedAttributeCategory: "cpu",
    name: { original: "SYN CPU Original" },
    attributes: { socket: { original: "Socket AM5" } },
  });
  expect(saved?.name?.confirmed).toBeUndefined();
  expect(saved?.attributes.socket?.confirmed).toBeUndefined();
  expect(localDataRootSchema.safeParse(first).success).toBe(true);

  if (saved === undefined) throw new Error("saved candidate is unavailable");
  const recategorized = savePart(
    { ...draftFromPart(saved), category: "cpu" },
    "project-1",
  )(first);
  expect(recategorized.candidateParts[0]?.category).toBe("cpu");
  expect(
    recategorized.candidateParts[0]?.attributes.socket?.confirmed,
  ).toBeUndefined();

  const confirmed = savePart(
    {
      ...draftFromPart(recategorized.candidateParts[0] ?? saved),
      attributes: { socket: "AM5" },
    },
    "project-1",
  )(recategorized);
  expect(confirmed.candidateParts[0]?.attributes.socket).toEqual({
    original: "Socket AM5",
    confirmed: "AM5",
  });
});

test("重複統合は確認済み値を保ち、最新の取得元表記と取得元を残す", () => {
  const existing = savePart(
    {
      ...capturedCpuDraft(),
      name: "確認済み CPU",
      category: "cpu",
      attributes: { socket: "AM5" },
    },
    "project-1",
  )(withProject());
  const target = existing.candidateParts[0];
  if (target === undefined) throw new Error("saved candidate is unavailable");

  const incoming = draftFromCaptureHandoff({
    originals: {
      name: "SYN CPU Latest",
      manufacturer: "SYN Maker Latest",
      modelNumber: "SYN-CPU-1",
      category: "Processors",
    },
    capturedAttributeCategory: "cpu",
    attributes: { socket: "Socket AM5 Latest" },
    source: {
      url: "https://pcbp.test/cpu/syn-latest",
      kind: "retail",
      capturedAt: "2026-09-06T01:00:00.000Z",
      price: null,
    },
  });
  const merged = mergeIntoPart(target.id, incoming)(existing);
  const part = merged.candidateParts[0];

  expect(part?.name).toEqual({
    original: "SYN CPU Latest",
    confirmed: "確認済み CPU",
  });
  expect(part?.attributes.socket).toEqual({
    original: "Socket AM5 Latest",
    confirmed: "AM5",
  });
  expect(part?.sources).toHaveLength(2);
  expect(localDataRootSchema.safeParse(merged).success).toBe(true);
});

test("同一URLの再取り込みも確認済み値を保ち、元表記と取得元を更新する", () => {
  const existing = savePart(
    {
      ...capturedCpuDraft(),
      name: "確認済み CPU",
      category: "cpu",
      attributes: { socket: "AM5" },
    },
    "project-1",
  )(withProject());
  const target = existing.candidateParts[0];
  if (target === undefined) throw new Error("saved candidate is unavailable");

  const refreshed = mergeIntoPart(
    target.id,
    draftFromCaptureHandoff({
      originals: {
        name: "SYN CPU Refreshed",
        manufacturer: "SYN Maker Refreshed",
        modelNumber: "SYN-CPU-1",
        category: "Processors",
      },
      capturedAttributeCategory: "cpu",
      attributes: { socket: "Socket AM5 Refreshed" },
      source: {
        url: "https://pcbp.test/cpu/syn-1#new-fragment",
        kind: "retail",
        capturedAt: "2026-09-06T02:00:00.000Z",
        price: { amount: 51000, currency: "JPY" },
      },
    }),
  )(existing);
  const part = refreshed.candidateParts[0];

  expect(part?.name).toEqual({
    original: "SYN CPU Refreshed",
    confirmed: "確認済み CPU",
  });
  expect(part?.attributes.socket).toEqual({
    original: "Socket AM5 Refreshed",
    confirmed: "AM5",
  });
  expect(part?.sources).toHaveLength(1);
  expect(part?.sources[0]).toMatchObject({
    id: target.sources[0]?.id,
    primary: true,
    url: "https://pcbp.test/cpu/syn-1#new-fragment",
    capturedAt: "2026-09-06T02:00:00.000Z",
    price: { amount: 51000, currency: "JPY" },
  });
  expect(localDataRootSchema.safeParse(refreshed).success).toBe(true);
});

test("登録がない候補削除は候補だけを除く", () => {
  const root = savePart(capturedCpuDraft(), "project-1")(withProject());
  const candidateId = root.candidateParts[0]?.id;
  if (candidateId === undefined) throw new Error("candidate id is unavailable");

  const next = deletePart(candidateId)(root);
  expect(next.candidateParts).toEqual([]);
  expect(next.currentBuilds).toEqual(root.currentBuilds);
});

test("存在しないプロジェクトへの選択と候補保存で参照整合を壊さない", () => {
  const root = withProject();
  expect(selectProject("missing-project")(root)).toBe(root);
  expect(() => savePart(capturedCpuDraft(), "missing-project")(root)).toThrow(
    "candidate project does not exist",
  );
  expect(localDataRootSchema.safeParse(root).success).toBe(true);
});

test("候補削除は登録変換を候補除去より先に一度適用する", () => {
  const root = savePart(capturedCpuDraft(), "project-1")(withProject());
  const candidateId = root.candidateParts[0]?.id;
  if (candidateId === undefined) throw new Error("candidate id is unavailable");
  const withReference: LocalDataRoot = {
    ...root,
    currentBuilds: [
      { projectId: "project-1", items: [{ partId: candidateId, quantity: 1 }] },
    ],
  };
  const observations: boolean[] = [];
  const unregister = registerCandidateDeletionReferenceCleanup(
    (current, deletingId) => {
      observations.push(
        current.candidateParts.some((part) => part.id === deletingId),
      );
      return removeCandidateReferences(current, deletingId);
    },
  );

  try {
    const next = deletePart(candidateId)(withReference);
    expect(observations).toEqual([true]);
    expect(next.candidateParts).toEqual([]);
    expect(next.currentBuilds[0]?.items).toEqual([]);
  } finally {
    unregister();
  }
});

test("登録変換が失敗すると保存対象の候補を残す", async () => {
  const root = savePart(capturedCpuDraft(), "project-1")(withProject());
  const candidateId = root.candidateParts[0]?.id;
  if (candidateId === undefined) throw new Error("candidate id is unavailable");
  const store = new Store(createMemoryStorageDriver(root));
  const unregister = registerCandidateDeletionReferenceCleanup(() => {
    throw new Error("SYN cleanup failure");
  });

  try {
    await expect(store.mutate(deletePart(candidateId))).rejects.toThrow(
      "SYN cleanup failure",
    );
    const persisted = await store.read();
    expect(persisted).toEqual({ ok: true, value: root });
  } finally {
    unregister();
  }
});

test("プロジェクト削除は所属候補ごとに整理してから候補を除く", () => {
  const first = savePart(capturedCpuDraft(), "project-1")(withProject());
  const secondDraft = {
    ...capturedCpuDraft(),
    sources: [
      {
        ...(capturedCpuDraft().sources[0] ?? {
          id: "source-2",
          kind: "retail" as const,
          capturedAt: "2026-09-06T00:00:00.000Z",
          price: null,
          primary: true,
        }),
        id: "source-2",
        url: "https://pcbp.test/cpu/syn-2",
      },
    ],
  };
  const root = savePart(secondDraft, "project-1")(first);
  const candidateIds = root.candidateParts.map(({ id }) => id);
  const observed: string[] = [];
  const unregister = registerCandidateDeletionReferenceCleanup(
    (current, candidateId) => {
      expect(current.candidateParts.some(({ id }) => id === candidateId)).toBe(
        true,
      );
      observed.push(candidateId);
      return current;
    },
  );

  try {
    const next = deleteProject("project-1")(root);
    expect(observed).toEqual(candidateIds);
    expect(next.projects).toEqual([]);
    expect(next.candidateParts).toEqual([]);
    expect(next.selectedProjectId).toBeNull();
  } finally {
    unregister();
  }
});

test("プロジェクト削除の登録変換が失敗すると保存対象を変えない", async () => {
  const root = savePart(capturedCpuDraft(), "project-1")(withProject());
  const store = new Store(createMemoryStorageDriver(root));
  const unregister = registerCandidateDeletionReferenceCleanup(() => {
    throw new Error("SYN project cleanup failure");
  });

  try {
    await expect(store.mutate(deleteProject("project-1"))).rejects.toThrow(
      "SYN project cleanup failure",
    );
    const persisted = await store.read();
    expect(persisted).toEqual({ ok: true, value: root });
  } finally {
    unregister();
  }
});
