import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type {
  CandidatePartId,
  CandidateSourceCatalogPort,
  CandidateSourceId,
  CandidateSourceMutationPort,
} from "../../../src/candidate-sources/public.js";
import { candidateSourcePageUrlPath } from "../../../src/domain/public.js";
import type {
  CandidateManagementQuery,
  CandidateManagementService,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import { ManagementView } from "../../../src/features/candidate-management/view.js";

const candidateId = "85000000-0000-4000-8000-000000000001" as CandidatePartId;
const sourceId = "85000000-0000-4000-8000-000000000002" as CandidateSourceId;
const query = {
  async getCandidateDraft() {
    return {
      ok: true as const,
      value: {
        projectId: "85000000-0000-4000-8000-000000000003",
        category: "uncategorized" as const,
        product: { name: { original: "架空候補" } },
        sources: [{ id: sourceId, pageUrl: "https://example.test/source" }],
        primarySourceId: sourceId,
        normalizedAttributes: { category: "uncategorized" as const },
      },
    };
  },
} as unknown as CandidateManagementQuery;

const renderCanonicalError = async (
  error:
    | {
        readonly kind: "source-validation";
        readonly path: string;
        readonly reason: string;
      }
    | {
        readonly kind: "source-identity-failure";
        readonly reason: "invalid-url";
      },
) => {
  const state = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences() {
          return {
            ok: true,
            value: [{ candidateId, sourceId, isPrimary: true }],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {
        async updateSource() {
          return { ok: false, error };
        },
      } as unknown as CandidateSourceMutationPort,
    },
  });
  await state.startEdit(candidateId);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() => root.render(<ManagementView state={state} />));
  await act(() =>
    state.updateEditorSource({
      id: sourceId,
      pageUrl: "unsafe value",
    }),
  );
  return { container, root, state };
};

test("canonical source-validationのfield path/reasonを既存source DOM errorへ表示する", async () => {
  const rendered = await renderCanonicalError({
    kind: "source-validation",
    path: "source.pageUrl",
    reason: "invalid-url",
  });
  assert.deepEqual(rendered.state.value.fieldErrors, {
    [candidateSourcePageUrlPath(0)]: "invalid-url",
  });
  assert.equal(
    rendered.container
      .querySelector('[name="source-0-url"]')
      ?.getAttribute("aria-invalid"),
    "true",
  );
  assert.notEqual(rendered.container.querySelector('[role="alert"]'), null);
  await act(() => rendered.root.unmount());
});

test("canonical source identity failureのreasonをURL fieldとDOMへ表示する", async () => {
  const rendered = await renderCanonicalError({
    kind: "source-identity-failure",
    reason: "invalid-url",
  });
  assert.deepEqual(rendered.state.value.fieldErrors, {
    [candidateSourcePageUrlPath(0)]: "invalid-url",
  });
  assert.deepEqual(rendered.state.value.sourceEditorError, {
    kind: "source-identity-failure",
    reason: "invalid-url",
  });
  assert.equal(
    rendered.container
      .querySelector('[name="source-0-url"]')
      ?.getAttribute("aria-invalid"),
    "true",
  );
  assert.notEqual(rendered.container.querySelector('[role="alert"]'), null);
  await act(() => rendered.root.unmount());
});

test("2件目update失敗は操作前sourceを保持しcanonical field/source errorを対象inputへ表示する", async () => {
  const secondSourceId =
    "85000000-0000-4000-8000-000000000004" as CandidateSourceId;
  const state = createManagementState({
    query: {
      async getCandidateDraft(_candidateId: CandidatePartId) {
        return {
          ok: true as const,
          value: {
            projectId: "85000000-0000-4000-8000-000000000003",
            category: "uncategorized" as const,
            product: { name: { original: "架空候補" } },
            sources: [
              { id: sourceId, pageUrl: "https://example.test/source" },
              { id: secondSourceId, pageUrl: "https://example.test/second" },
            ],
            primarySourceId: sourceId,
            normalizedAttributes: { category: "uncategorized" as const },
          },
        };
      },
    } as unknown as CandidateManagementQuery,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences() {
          return {
            ok: true,
            value: [
              { candidateId, sourceId, isPrimary: true },
              { candidateId, sourceId: secondSourceId, isPrimary: false },
            ],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {
        async updateSource() {
          return {
            ok: false,
            error: {
              kind: "source-validation",
              path: "candidate.sources[1].pageUrl",
              reason: "invalid-url",
            },
          };
        },
      } as unknown as CandidateSourceMutationPort,
    },
  });
  await state.startEdit(candidateId);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() => root.render(<ManagementView state={state} />));
  await act(() =>
    state.updateEditorSource({ id: secondSourceId, pageUrl: "unsafe second" }),
  );

  assert.equal(
    state.value.editor?.draft.sources?.[0]?.pageUrl,
    "https://example.test/source",
  );
  assert.equal(
    state.value.editor?.draft.sources?.[1]?.pageUrl,
    "https://example.test/second",
  );
  assert.deepEqual(state.value.sourceEditorError, {
    kind: "source-validation",
    path: "candidate.sources[1].pageUrl",
    reason: "invalid-url",
  });
  assert.equal(
    container
      .querySelector('[name="source-0-url"]')
      ?.getAttribute("aria-invalid"),
    null,
  );
  assert.equal(
    container
      .querySelector('[name="source-1-url"]')
      ?.getAttribute("aria-invalid"),
    "true",
  );
  await act(() => root.unmount());
});

test("add失敗は操作前source listを保持しcanonical field/source errorを表示する", async () => {
  const addedSourceId =
    "85000000-0000-4000-8000-000000000005" as CandidateSourceId;
  const state = createManagementState({
    query,
    service: {} as CandidateManagementService,
    createMutationContext: () => ({
      requestId: "unused" as never,
      expectedRevision: 0,
    }),
    sourceEditor: {
      catalog: {
        async listSourceReferences() {
          return {
            ok: true,
            value: [{ candidateId, sourceId, isPrimary: true }],
          };
        },
      } as unknown as CandidateSourceCatalogPort,
      mutations: {
        async addSource() {
          return {
            ok: false,
            error: {
              kind: "source-validation",
              path: "candidate.sources[1].pageUrl",
              reason: "invalid-url",
            },
          };
        },
      } as unknown as CandidateSourceMutationPort,
    },
  });
  await state.startEdit(candidateId);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(() => root.render(<ManagementView state={state} />));
  await act(() =>
    state.addEditorSource({ id: addedSourceId, pageUrl: "unsafe add" }),
  );

  assert.equal(
    state.value.editor?.draft.sources?.[0]?.pageUrl,
    "https://example.test/source",
  );
  assert.equal(state.value.editor?.draft.sources?.[1], undefined);
  assert.deepEqual(state.value.sourceEditorError, {
    kind: "source-validation",
    path: "candidate.sources[1].pageUrl",
    reason: "invalid-url",
  });
  assert.deepEqual(state.value.fieldErrors, {
    "sources[1].pageUrl": "invalid-url",
  });
  assert.equal(
    container
      .querySelector('[name="source-0-url"]')
      ?.getAttribute("aria-invalid"),
    null,
  );
  assert.equal(container.querySelector('[name="source-1-url"]'), null);
  assert.notEqual(
    container.querySelector('[role="alert"]'),
    null,
    "field対象が未追加でもsource failureをglobal alertとして利用者へ表示する",
  );
  await act(() => root.unmount());
});
