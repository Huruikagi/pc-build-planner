import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { act, cleanup, render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type {
  ProjectId,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import {
  createCandidateActivation,
  createCandidateEditorIntent,
} from "../../../src/features/candidate-management/activation.js";
import type {
  CandidateManagementQuery,
  CandidateManagementService,
  UnresolvedCandidateEditorPrefill,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import { ManagementView } from "../../../src/features/candidate-management/view.js";
import { createCaptureDraftMapper } from "../../../src/features/product-capture/draft-mapper.js";
import {
  MessageProvider,
  resolverFor,
  type SupportedLanguage,
} from "../../../src/ui-messages/public.js";

afterEach(cleanup);

const projectId = "10000000-0000-4000-8000-000000000025" as Uuid as ProjectId;
const timestamp = "2026-07-28T00:00:00.000Z" as UtcTimestamp;
const unsafeExtractedName = '<img src=x onerror="pageValue()"> 架空GPU';

const pendingPrefill: UnresolvedCandidateEditorPrefill = {
  draft: {
    category: "gpu",
    product: {
      name: { original: unsafeExtractedName },
      manufacturer: { original: "架空メーカー" },
      modelNumber: { original: "SYNTH-9000" },
    },
    normalizedAttributes: { category: "gpu" },
  },
  captureDiagnostics: [
    { field: "name", reason: "too-long" },
    { field: "price", reason: "invalid-format" },
    { field: "specification", reason: "unresolvable" },
  ],
};

const pendingQuery: CandidateManagementQuery = {
  async listProjects() {
    return {
      ok: true,
      value: [{ id: projectId, name: "created", updatedAt: timestamp }],
    };
  },
  async listCandidates() {
    return { ok: true, value: [] };
  },
  async getCandidateDraft() {
    throw new Error("not used");
  },
  async listBuildEligible() {
    throw new Error("not used");
  },
};

const candidateService: CandidateManagementService = {
  async createCandidate() {
    throw new Error("not used");
  },
  async updateCandidate() {
    throw new Error("not used");
  },
  async deleteCandidate() {
    throw new Error("not used");
  },
};

const renderPending = (language: SupportedLanguage) => {
  const state = createManagementState({
    query: pendingQuery,
    service: candidateService,
    createMutationContext: () => {
      throw new Error("pending view does not mutate candidate data");
    },
    currentProject: {
      getCurrentProject: () => ({ status: "unresolved" }),
      subscribe: () => () => {},
    },
  });
  state.holdPendingPreEdit(pendingPrefill);
  const user = userEvent.setup();
  const view = render(
    <MessageProvider resolver={resolverFor(language)}>
      <ManagementView state={state} />
    </MessageProvider>,
  );
  const query = <E extends Element = HTMLElement>(selector: string): E => {
    const element = view.container.querySelector<E>(selector);
    assert.ok(element, `expected element for selector ${selector}`);
    return element;
  };
  return { ...view, query, state, user };
};

for (const language of ["ja", "en"] as const) {
  test(`${language}: pending pre-edit は project 必要理由と抽出済み内容を表示する`, () => {
    const messages = resolverFor(language);
    const view = renderPending(language);

    assert.match(
      view.container.textContent ?? "",
      new RegExp(messages("candidate.projectRequiredReason")),
    );
    assert.match(view.container.textContent ?? "", /架空GPU/);
    assert.match(view.container.textContent ?? "", /架空メーカー/);
    assert.match(view.container.textContent ?? "", /SYNTH-9000/);
    assert.equal(view.container.querySelector("img"), null);
    const diagnostics = view.query("[data-region='capture-diagnostics']");
    assert.match(
      diagnostics.textContent ?? "",
      new RegExp(messages("candidate.captureDiagnosticFields.name")),
    );
    assert.match(
      diagnostics.textContent ?? "",
      new RegExp(messages("candidate.captureDiagnosticFields.price")),
    );
    assert.doesNotMatch(
      diagnostics.textContent ?? "",
      /rawValue|pageValue|onerror/,
    );
    assert.equal(
      view.query("[data-cancel-pending-pre-edit]").textContent,
      messages("common.cancel"),
    );
  });

  test(`${language}: pending pre-edit の取消は保持内容を閉じる`, async () => {
    const view = renderPending(language);

    await view.user.click(view.query("[data-cancel-pending-pre-edit]"));

    assert.equal(view.state.value.pendingPreEdit, null);
    assert.equal(
      view.container.querySelector("[data-region='project-required']"),
      null,
    );
  });
}

test("dynamic spec rejectionをmapperからunknown activation経由で既存project editorへ安全に1件だけ渡す", async () => {
  const state = createManagementState({
    query: {
      ...pendingQuery,
      async listProjects() {
        return {
          ok: true,
          value: [{ id: projectId, name: "existing", updatedAt: timestamp }],
        };
      },
      async listCandidates() {
        return { ok: true, value: [] };
      },
    },
    service: candidateService,
    createMutationContext: () => {
      throw new Error("dynamic diagnostic view does not mutate candidate data");
    },
    currentProject: {
      getCurrentProject: () => ({ status: "resolved", projectId }),
      subscribe: () => () => {},
    },
  });
  await state.load();
  const mapped = createCaptureDraftMapper().toEditorPrefill({
    requestId: "20000000-0000-4000-8000-000000000099",
    tabId: 1,
    pageUrl: "https://example.invalid/item",
    capturedAt: timestamp,
    draft: { fields: [], missingCoreFields: [] },
    rejectedFields: [
      { field: "spec:leading", reason: "unresolvable" },
      { field: "spec:another-label", reason: "unresolvable" },
    ],
  });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.deepEqual(mapped.value.captureDiagnostics, [
    { field: "specification", reason: "unresolvable" },
  ]);
  const activation = createCandidateActivation(state);
  const validated = activation.validate(
    createCandidateEditorIntent(mapped.value),
  );
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal((await activation.activate(validated.value)).ok, true);
  assert.deepEqual(
    state.value.editor?.mode === "create"
      ? state.value.editor.captureDiagnostics
      : undefined,
    [{ field: "specification", reason: "unresolvable" }],
  );
  assert.equal(
    "captureDiagnostics" in (state.value.editor?.draft ?? {}),
    false,
  );
  const view = render(
    <MessageProvider resolver={resolverFor("en")}>
      <ManagementView state={state} />
    </MessageProvider>,
  );
  const diagnostics = view.container.querySelector(
    "[data-region='capture-diagnostics']",
  );
  assert.ok(diagnostics);
  assert.equal(diagnostics.querySelectorAll("li").length, 1);
  assert.match(diagnostics.textContent ?? "", /Specification/);
  assert.doesNotMatch(
    diagnostics.textContent ?? "",
    /leading|nested|another-label/,
  );
});

const otherProjectId =
  "10000000-0000-4000-8000-000000000026" as Uuid as ProjectId;

const projectListQuery: CandidateManagementQuery = {
  ...pendingQuery,
  async listProjects() {
    return {
      ok: true,
      value: [
        { id: projectId, name: "架空の既存プロジェクト", updatedAt: timestamp },
        {
          id: otherProjectId,
          name: "架空の別プロジェクト",
          updatedAt: timestamp,
        },
      ],
    };
  },
  async listCandidates() {
    return { ok: true, value: [] };
  },
};

/** Projects exist, but the current context is unresolved until it recovers. */
const renderRecoverablePending = async (language: SupportedLanguage) => {
  const listeners = new Set<() => void>();
  let current: ProjectId | null = null;
  const state = createManagementState({
    query: projectListQuery,
    service: candidateService,
    createMutationContext: () => {
      throw new Error("回復経路で candidate を変更してはならない");
    },
    currentProject: {
      getCurrentProject: () =>
        current === null
          ? { status: "unresolved" as const }
          : { status: "resolved" as const, projectId: current },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  await state.load();
  state.attachCurrentProject();
  state.holdPendingPreEdit(pendingPrefill);
  const user = userEvent.setup();
  const view = render(
    <MessageProvider resolver={resolverFor(language)}>
      <ManagementView state={state} />
    </MessageProvider>,
  );
  return {
    ...view,
    state,
    user,
    async recover(projectId: ProjectId) {
      await act(async () => {
        current = projectId;
        for (const listener of listeners) listener();
      });
    },
    stop: () => state.releaseCurrentProject(),
  };
};

for (const language of ["ja", "en"] as const) {
  test(`${language}: project が存在する pending は context の理由を提示し独自selectorを表示しない`, async () => {
    const messages = resolverFor(language);
    const view = await renderRecoverablePending(language);

    assert.match(
      view.container.textContent ?? "",
      new RegExp(messages("candidate.projectRequiredContextReason")),
    );
    assert.equal(
      view.container.querySelector("[data-region='pending-project-choice']"),
      null,
    );
    assert.ok(view.container.querySelector("[data-cancel-pending-pre-edit]"));
    view.stop();
  });

  test(`${language}: 共通contextの選択は再抽出せず同じ pre-edit の editor へ切り替える`, async () => {
    const messages = resolverFor(language);
    const view = await renderRecoverablePending(language);

    await view.recover(otherProjectId);

    assert.equal(
      view.container.querySelector("[data-region='project-required']"),
      null,
    );
    assert.equal(
      view.container
        .querySelector("form[data-region='candidate-form']")
        ?.getAttribute("aria-label"),
      messages("candidate.editorFormTitle"),
    );
    assert.equal(
      view.container.querySelector<HTMLInputElement>(
        "input[name='candidate-name']",
      )?.value,
      unsafeExtractedName,
    );
    assert.equal(view.state.value.editor?.projectId, otherProjectId);
    view.stop();
  });

  test(`${language}: current context の回復後は capture へ戻らず同じ pre-edit の editor を表示する`, async () => {
    const view = await renderRecoverablePending(language);

    await view.recover(projectId);

    assert.equal(
      view.container.querySelector("[data-region='project-required']"),
      null,
    );
    assert.equal(
      view.container.querySelector<HTMLInputElement>(
        "input[name='candidate-name']",
      )?.value,
      unsafeExtractedName,
    );
    assert.equal(view.state.value.editor?.projectId, projectId);
    assert.equal(view.state.value.pendingPreEdit, null);
    view.stop();
  });

  test(`${language}: project が0件の pending は作成理由だけを示し選択操作を出さない`, () => {
    const messages = resolverFor(language);
    const view = renderPending(language);

    assert.match(
      view.container.textContent ?? "",
      new RegExp(messages("candidate.projectRequiredReason")),
    );
    assert.equal(
      view.container.querySelector("[data-region='pending-project-choice']"),
      null,
    );
  });
}
