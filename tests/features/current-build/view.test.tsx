import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { act, cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

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
import {
  defaultMessageResolver,
  MessageProvider,
  resolverFor,
} from "../../../src/ui-messages/public.js";

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
): CandidatePart =>
  ({
    id,
    projectId,
    category: "cpu",
    product: { name: { original: name, confirmed: name } },
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
  const user = userEvent.setup();
  const view = render(<BuildView state={harness.state} />);
  const query = <E extends Element = HTMLElement>(selector: string): E => {
    const element = view.container.querySelector<E>(selector);
    assert.ok(element, `expected element for selector ${selector}`);
    return element;
  };
  return {
    ...view,
    user,
    query,
    text: () => view.container.textContent ?? "",
  };
}

afterEach(cleanup);

test("選択中カテゴリの候補だけを表示し未分類候補や別カテゴリは表示しない", async () => {
  const harness = createHarness();
  const rendered = await renderView(harness);
  await rendered.user.click(rendered.query("[data-category='cpu']"));

  assert.match(rendered.text(), /架空CPU 一号/);
  assert.match(rendered.text(), /架空CPU 二号/);
  assert.doesNotMatch(rendered.text(), /架空メモリ/);
  assert.equal(
    rendered.container.querySelector("[data-category='uncategorized']"),
    null,
    "未分類カテゴリはタブとして表示しない",
  );
});

test("候補なし・構成なしを識別可能に表示する", async () => {
  const harness = createHarness({ eligible: [] });
  const rendered = await renderView(harness);

  assert.match(
    rendered.text(),
    new RegExp(defaultMessageResolver("build.noCandidates")),
  );
  assert.match(
    rendered.text(),
    new RegExp(defaultMessageResolver("build.noCurrentBuild")),
  );
});

test("単一選択カテゴリで候補を選ぶと選択状態になり別候補で置き換えられる", async () => {
  const harness = createHarness();
  const rendered = await renderView(harness);

  await rendered.user.click(
    rendered.query(`[data-select-candidate-id='${cpuCandidateId}']`),
  );

  assert.deepEqual(harness.commands[0], {
    type: "select",
    projectId,
    candidatePartId: cpuCandidateId,
  });

  await rendered.user.click(
    rendered.query(`[data-select-candidate-id='${otherCpuCandidateId}']`),
  );

  assert.deepEqual(harness.commands[1], {
    type: "select",
    projectId,
    candidatePartId: otherCpuCandidateId,
  });
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

  await rendered.user.click(
    rendered.query(`[data-remove-candidate-id='${cpuCandidateId}']`),
  );

  assert.deepEqual(harness.commands[0], {
    type: "remove",
    projectId,
    candidatePartId: cpuCandidateId,
  });
});

test("複数選択カテゴリで候補を追加し数量を確定できる", async () => {
  const harness = createHarness();
  const rendered = await renderView(harness);

  await rendered.user.click(rendered.query("[data-category='memory']"));
  await rendered.user.click(
    rendered.query(`[data-select-candidate-id='${memoryCandidateId}']`),
  );

  assert.deepEqual(harness.commands[0], {
    type: "select",
    projectId,
    candidatePartId: memoryCandidateId,
  });
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

  await rendered.user.click(rendered.query("[data-category='memory']"));

  const quantityInput = rendered.query<HTMLInputElement>(
    `[data-quantity-input='${memoryCandidateId}']`,
  );
  await rendered.user.clear(quantityInput);
  await rendered.user.type(quantityInput, "5");
  await rendered.user.click(
    rendered.query(`[data-confirm-quantity='${memoryCandidateId}']`),
  );

  assert.deepEqual(harness.commands[0], {
    type: "set-quantity",
    projectId,
    candidatePartId: memoryCandidateId,
    quantity: 5,
  });

  await rendered.user.click(
    rendered.query(`[data-remove-candidate-id='${memoryCandidateId}']`),
  );

  assert.deepEqual(harness.commands[1], {
    type: "remove",
    projectId,
    candidatePartId: memoryCandidateId,
  });
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

  await rendered.user.click(rendered.query("[data-category='memory']"));

  const quantityInput = rendered.query<HTMLInputElement>(
    `[data-quantity-input='${memoryCandidateId}']`,
  );
  await rendered.user.clear(quantityInput);
  await rendered.user.type(quantityInput, "0");
  await rendered.user.click(
    rendered.query(`[data-confirm-quantity='${memoryCandidateId}']`),
  );

  assert.equal(harness.commands.length, 0, "不正数量はserviceへ到達しない");
  assert.match(
    rendered.text(),
    new RegExp(defaultMessageResolver("build.invalidQuantity")),
  );
});

test("保存errorを識別可能に表示する", async () => {
  const harness = createHarness({
    serviceResult: () => ({ ok: false, error: { kind: "storage" } }),
  });
  const rendered = await renderView(harness);

  await rendered.user.click(
    rendered.query(`[data-select-candidate-id='${cpuCandidateId}']`),
  );

  assert.match(
    rendered.text(),
    new RegExp(defaultMessageResolver("build.storage")),
  );
});

test("外部文字列を安全なJSX childとして描画しHTML注入を許さない", async () => {
  const unsafeName = "<img src=x onerror=alert(1)> 危険な候補名";
  const harness = createHarness({
    eligible: [candidate(cpuCandidateId, unsafeName)],
  });
  const rendered = await renderView(harness);

  assert.match(rendered.text(), /危険な候補名/);
  assert.equal(rendered.container.querySelector("img"), null);
});

test("独自project selectorを描画せず全カテゴリへ完全な要約を併記する", async () => {
  const unsafeName = "<img src=x onerror=alert(1)> 架空CPU";
  const existingBuild: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const harness = createHarness({
    currentBuild: existingBuild,
    eligible: [candidate(cpuCandidateId, unsafeName)],
  });
  const rendered = await renderView(harness);

  assert.equal(
    rendered.container.querySelector("[data-project-id]"),
    null,
    "project選択authorityをviewへ複製しない",
  );
  const cpu = rendered.query<HTMLButtonElement>("[data-category='cpu']");
  assert.equal(cpu.getAttribute("aria-label"), `CPU: ${unsafeName}`);
  assert.ok((cpu.textContent ?? "").includes(unsafeName));
  assert.equal(rendered.container.querySelector("img"), null);
  assert.equal(
    rendered.query("[data-category='memory']").getAttribute("aria-label"),
    "メモリ: 未選択",
  );
});

test("選択成功と同じstate更新でカテゴリ要約を再描画する", async () => {
  const selectedBuild: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const harness = createHarness({
    serviceResult: () => ({
      ok: true,
      value: { revision: 1 as never, currentBuild: selectedBuild },
    }),
  });
  const rendered = await renderView(harness);

  assert.equal(
    rendered.query("[data-category='cpu']").getAttribute("aria-label"),
    "CPU: 未選択",
  );
  await rendered.user.click(
    rendered.query(`[data-select-candidate-id='${cpuCandidateId}']`),
  );
  assert.equal(
    rendered.query("[data-category='cpu']").getAttribute("aria-label"),
    "CPU: 架空CPU 一号",
  );
});

test("共通contextのemptyとunavailableを区別して表示する", async () => {
  for (const [status, expected] of [
    ["empty", "プロジェクトがありません"],
    ["unavailable", "プロジェクトを利用できません"],
  ] as const) {
    const harness = createHarness();
    await harness.state.attachProjectContext({
      getCurrent: () => ({ status, generation: 1 }),
      subscribe: () => () => {},
    });
    const rendered = await renderView(harness);
    assert.match(rendered.text(), new RegExp(expected));
    rendered.unmount();
  }
});

test("切替確認の保存・破棄・取消と隔離draftの継続案内を描画する", async () => {
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
  act(() => harness.state.setQuantityDraft(memoryCandidateId, "3"));
  let decision: Promise<unknown> | undefined;
  act(() => {
    decision = harness.state.draftGuardOwner().evaluate({
      token: "switch-1",
      from: projectId,
      to: null,
      baseGeneration: 0,
      cause: "user",
    });
  });

  assert.match(rendered.text(), /未保存の数量/);
  assert.ok(rendered.query("[data-switch-save]"));
  assert.ok(rendered.query("[data-switch-discard]"));
  await rendered.user.click(rendered.query("[data-switch-cancel]"));
  await decision;

  act(() => {
    harness.state.draftGuardOwner().notifyForced({
      token: "forced-1",
      from: projectId,
      to: null,
      baseGeneration: 0,
      cause: "backup-restore",
    });
  });
  assert.match(rendered.text(), /隔離して保持/);
  await rendered.user.click(rendered.query("[data-dismiss-orphaned-draft]"));
  assert.doesNotMatch(rendered.text(), /隔離して保持/);
});

test("切替確認の保存と破棄を各ボタンから確定できる", async () => {
  for (const action of ["save", "discard"] as const) {
    const existingBuild: CurrentBuild = {
      id: buildId,
      projectId,
      items: [
        {
          candidatePartId: memoryCandidateId,
          quantity: 2 as PositiveInteger,
        },
      ],
      updatedAt: timestamp,
    };
    const harness = createHarness({
      currentBuild: existingBuild,
      serviceResult: () => ({
        ok: true,
        value: { revision: 1 as never, currentBuild: existingBuild },
      }),
    });
    const rendered = await renderView(harness);
    act(() => harness.state.setQuantityDraft(memoryCandidateId, "3"));
    let decision: Promise<unknown> | undefined;
    act(() => {
      decision = harness.state.draftGuardOwner().evaluate({
        token: `switch-${action}`,
        from: projectId,
        to: null,
        baseGeneration: 0,
        cause: "user",
      });
    });

    await rendered.user.click(rendered.query(`[data-switch-${action}]`));
    assert.deepEqual(await decision, { ok: true, value: "allow" });
    assert.equal(
      rendered.container.querySelector("[data-region='switch-confirmation']"),
      null,
    );
    if (action === "save") {
      assert.equal(harness.commands[0]?.type, "set-quantities");
    } else {
      assert.equal(harness.commands.length, 0);
    }
    rendered.unmount();
  }
});

test("英語でもカテゴリ名と完全な要約をaccessible nameへ残す", async () => {
  const existingBuild: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: memoryCandidateId, quantity: 2 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const harness = createHarness({ currentBuild: existingBuild });
  await harness.state.load();
  const rendered = render(
    <MessageProvider resolver={resolverFor("en")}>
      <BuildView state={harness.state} />
    </MessageProvider>,
  );
  assert.equal(
    rendered.container
      .querySelector("[data-category='memory']")
      ?.getAttribute("aria-label"),
    "Memory: 架空メモリ, quantity 2",
  );
});

test("keyboardでカテゴリを選択してfocusと現在カテゴリを維持する", async () => {
  const harness = createHarness();
  const rendered = await renderView(harness);

  await rendered.user.tab();
  const cpu = rendered.query<HTMLButtonElement>("[data-category='cpu']");
  assert.equal(document.activeElement, cpu);
  await rendered.user.keyboard("{Enter}");

  assert.equal(
    document.activeElement,
    cpu,
    "state更新後も操作中カテゴリへfocusを残す",
  );
  assert.equal(cpu.getAttribute("aria-current"), "page");
  assert.equal(harness.state.value.selectedCategory, "cpu");
});

test("長い要約は省略表示契約を持ち完全な内容をaccessible nameへ残す", async () => {
  const longName = `架空の非常に長いCPU名 ${"長い名称".repeat(40)}`;
  const existingBuild: CurrentBuild = {
    id: buildId,
    projectId,
    items: [
      { candidatePartId: cpuCandidateId, quantity: 1 as PositiveInteger },
    ],
    updatedAt: timestamp,
  };
  const harness = createHarness({
    currentBuild: existingBuild,
    eligible: [candidate(cpuCandidateId, longName)],
  });
  const rendered = await renderView(harness);
  const cpu = rendered.query<HTMLButtonElement>("[data-category='cpu']");
  const visualSummary = cpu.querySelector<HTMLElement>(
    ".current-build__category-summary",
  );

  assert.ok(visualSummary);
  assert.equal(visualSummary.getAttribute("aria-hidden"), "true");
  assert.equal(visualSummary.getAttribute("title"), longName);
  assert.equal(cpu.getAttribute("aria-label"), `CPU: ${longName}`);
  assert.ok(cpu.classList.contains("current-build__category"));
  await rendered.user.click(cpu);
  assert.equal(cpu.getAttribute("aria-current"), "page");
});
