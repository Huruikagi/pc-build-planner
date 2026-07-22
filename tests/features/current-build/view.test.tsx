import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createRoot } from "react-dom/client";

import type {
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  NormalizedAttributes,
  PositiveInteger,
  ProjectId,
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
import { BuildView } from "../../../src/features/current-build/view.js";

const timestamp = "2026-07-23T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const cpuCandidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const otherCpuCandidateId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const memoryCandidateId =
  "30000000-0000-4000-8000-000000000003" as Uuid as CandidatePartId;
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
  name: string,
  overrides: Partial<CandidatePart> = {},
): CandidatePart => ({
  id,
  projectId,
  category: "cpu",
  product: { name: { original: name, confirmed: name } },
  normalizedAttributes: cpuAttributes,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const project = (id: ProjectId, name: string): ProjectSummary => ({
  id,
  name,
  updatedAt: timestamp,
});

interface Harness {
  readonly state: ReturnType<typeof createBuildState>;
  readonly commands: BuildCommand[];
}

const createHarness = (
  options: {
    readonly eligible?: readonly CandidatePart[];
    readonly currentBuild?: CurrentBuild | null;
    readonly serviceResult?: (
      command: BuildCommand,
    ) =>
      | { ok: true; value: CurrentBuildSnapshot }
      | { ok: false; error: BuildError };
  } = {},
): Harness => {
  const eligible = options.eligible ?? [
    candidate(cpuCandidateId, "架空CPU 一号"),
    candidate(otherCpuCandidateId, "架空CPU 二号"),
    candidate(memoryCandidateId, "架空メモリ", {
      category: "memory",
      normalizedAttributes: memoryAttributes,
    }),
  ];
  const currentBuild = options.currentBuild ?? null;
  let revision = 0;
  const commands: BuildCommand[] = [];

  const candidates: CandidateQuery = {
    async listProjects() {
      return { ok: true, value: [project(projectId, "架空PC構成")] };
    },
    async listCandidates() {
      return { ok: true, value: [] };
    },
    async listBuildEligible() {
      return { ok: true, value: eligible };
    },
    async getCandidateDraft() {
      throw new Error("not used by view tests");
    },
  };
  const query: CurrentBuildQuery = {
    async getByProject() {
      return { ok: true, value: { revision: revision as never, currentBuild } };
    },
  };
  const service: BuildService = {
    async execute(command: BuildCommand, _context: BuildMutationContext) {
      commands.push(command);
      const outcome = options.serviceResult?.(command);
      if (outcome !== undefined) return outcome;
      revision += 1;
      return {
        ok: true,
        value: { revision: revision as never, currentBuild },
      };
    },
  };

  const dependencies: BuildStateDependencies = {
    candidates,
    query,
    service,
    policy: createCategoryPolicy(),
  };
  return { state: createBuildState(dependencies), commands };
};

async function renderView(harness: Harness) {
  await harness.state.load();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(<BuildView state={harness.state} />));
  return {
    container,
    rerender: async () => {
      await act(() => root.render(<BuildView state={harness.state} />));
    },
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

test("選択中カテゴリの候補だけを表示し未分類候補や別カテゴリは表示しない", async () => {
  const harness = createHarness();
  const rendered = await renderView(harness);
  const cpuTab = rendered.container.querySelector(
    "[data-category='cpu']",
  ) as HTMLButtonElement;
  await act(async () => cpuTab.click());
  await rendered.rerender();

  assert.match(rendered.container.textContent ?? "", /架空CPU 一号/);
  assert.match(rendered.container.textContent ?? "", /架空CPU 二号/);
  assert.doesNotMatch(rendered.container.textContent ?? "", /架空メモリ/);
  assert.equal(
    rendered.container.querySelector("[data-category='uncategorized']"),
    null,
    "未分類カテゴリはタブとして表示しない",
  );

  await rendered.cleanup();
});

test("候補なし・構成なしを識別可能に表示する", async () => {
  const harness = createHarness({ eligible: [] });
  const rendered = await renderView(harness);

  assert.match(rendered.container.textContent ?? "", /候補がありません/);
  assert.match(rendered.container.textContent ?? "", /現在構成がありません/);

  await rendered.cleanup();
});

test("単一選択カテゴリで候補を選ぶと選択状態になり別候補で置き換えられる", async () => {
  const harness = createHarness();
  const rendered = await renderView(harness);

  const select = rendered.container.querySelector(
    `[data-select-candidate-id='${cpuCandidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => select.click());
  await rendered.rerender();

  assert.deepEqual(harness.commands[0], {
    type: "select",
    projectId,
    candidatePartId: cpuCandidateId,
  });

  const replace = rendered.container.querySelector(
    `[data-select-candidate-id='${otherCpuCandidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => replace.click());
  await rendered.rerender();

  assert.deepEqual(harness.commands[1], {
    type: "select",
    projectId,
    candidatePartId: otherCpuCandidateId,
  });

  await rendered.cleanup();
});

test("単一選択カテゴリで選択済み候補を解除できる", async () => {
  const existingBuild: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const harness = createHarness({ currentBuild: existingBuild });
  const rendered = await renderView(harness);

  const remove = rendered.container.querySelector(
    `[data-remove-candidate-id='${cpuCandidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => remove.click());

  assert.deepEqual(harness.commands[0], {
    type: "remove",
    projectId,
    candidatePartId: cpuCandidateId,
  });

  await rendered.cleanup();
});

test("複数選択カテゴリで候補を追加し数量を確定できる", async () => {
  const harness = createHarness();
  const rendered = await renderView(harness);

  const memoryTab = rendered.container.querySelector(
    "[data-category='memory']",
  ) as HTMLButtonElement;
  await act(async () => memoryTab.click());
  await rendered.rerender();

  const add = rendered.container.querySelector(
    `[data-select-candidate-id='${memoryCandidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => add.click());

  assert.deepEqual(harness.commands[0], {
    type: "select",
    projectId,
    candidatePartId: memoryCandidateId,
  });

  await rendered.cleanup();
});

test("複数選択カテゴリの数量確定と解除が構成へ反映される", async () => {
  const existingBuild: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: memoryCandidateId, quantity: 2 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const harness = createHarness({ currentBuild: existingBuild });
  const rendered = await renderView(harness);

  const memoryTab = rendered.container.querySelector(
    "[data-category='memory']",
  ) as HTMLButtonElement;
  await act(async () => memoryTab.click());
  await rendered.rerender();

  const quantityInput = rendered.container.querySelector(
    `[data-quantity-input='${memoryCandidateId}']`,
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(quantityInput, "5");
    quantityInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  });

  const confirmQuantity = rendered.container.querySelector(
    `[data-confirm-quantity='${memoryCandidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => confirmQuantity.click());

  assert.deepEqual(harness.commands[0], {
    type: "set-quantity",
    projectId,
    candidatePartId: memoryCandidateId,
    quantity: 5,
  });

  const remove = rendered.container.querySelector(
    `[data-remove-candidate-id='${memoryCandidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => remove.click());

  assert.deepEqual(harness.commands[1], {
    type: "remove",
    projectId,
    candidatePartId: memoryCandidateId,
  });

  await rendered.cleanup();
});

test("不正な数量入力は保存前に拒否され識別可能なerrorを示す", async () => {
  const existingBuild: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: memoryCandidateId, quantity: 2 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const harness = createHarness({ currentBuild: existingBuild });
  const rendered = await renderView(harness);

  const memoryTab = rendered.container.querySelector(
    "[data-category='memory']",
  ) as HTMLButtonElement;
  await act(async () => memoryTab.click());
  await rendered.rerender();

  const quantityInput = rendered.container.querySelector(
    `[data-quantity-input='${memoryCandidateId}']`,
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(quantityInput, "0");
    quantityInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  });

  const confirmQuantity = rendered.container.querySelector(
    `[data-confirm-quantity='${memoryCandidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => confirmQuantity.click());
  await rendered.rerender();

  assert.equal(harness.commands.length, 0, "不正数量はserviceへ到達しない");
  assert.match(rendered.container.textContent ?? "", /正整数/);

  await rendered.cleanup();
});

test("保存errorを識別可能に表示する", async () => {
  const harness = createHarness({
    serviceResult: () => ({ ok: false, error: { kind: "storage" } }),
  });
  const rendered = await renderView(harness);

  const select = rendered.container.querySelector(
    `[data-select-candidate-id='${cpuCandidateId}']`,
  ) as HTMLButtonElement;
  await act(async () => select.click());
  await rendered.rerender();

  assert.match(rendered.container.textContent ?? "", /保存領域/);

  await rendered.cleanup();
});

test("外部文字列を安全なJSX childとして描画しHTML注入を許さない", async () => {
  const unsafeName = "<img src=x onerror=alert(1)> 危険な候補名";
  const harness = createHarness({
    eligible: [candidate(cpuCandidateId, unsafeName)],
  });
  const rendered = await renderView(harness);

  assert.match(rendered.container.textContent ?? "", /危険な候補名/);
  assert.equal(rendered.container.querySelector("img"), null);

  await rendered.cleanup();
});
