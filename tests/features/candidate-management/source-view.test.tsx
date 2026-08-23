import assert from "node:assert/strict";
import test from "node:test";

import { render, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type {
  CandidatePartId,
  CandidateSource,
  CandidateSourceId,
  ProjectId,
  RequestId,
  Revision,
  Uuid,
} from "../../../src/domain/public.js";
import type {
  CandidateDraft,
  CandidateManagementQuery,
  CandidateManagementService,
} from "../../../src/features/candidate-management/contracts.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import { ManagementView } from "../../../src/features/candidate-management/view.js";
import {
  MessageProvider,
  resolverFor,
} from "../../../src/ui-messages/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidateId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const sourceA =
  "40000000-0000-4000-8000-000000000001" as Uuid as CandidateSourceId;
const sourceB =
  "40000000-0000-4000-8000-000000000002" as Uuid as CandidateSourceId;
const malicious = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

const draft = {
  projectId,
  category: "uncategorized",
  product: { name: { original: "架空候補" } },
  normalizedAttributes: { category: "uncategorized" },
  sources: [
    {
      id: sourceA,
      pageUrl: `https://shop.invalid/${encodeURIComponent(malicious)}`,
      siteName: malicious,
      capturedAt: "2026-07-28T00:00:00.000Z",
      price: { original: null, confirmed: { amount: 12000, currency: "JPY" } },
      kind: "retail",
    },
    {
      id: sourceB,
      pageUrl: "https://maker.invalid/item",
      siteName: "架空メーカー",
      kind: "manufacturer",
    },
  ],
  primarySourceId: sourceA,
} as CandidateDraft;

const query: CandidateManagementQuery = {
  async listProjects() {
    return {
      ok: true,
      value: [
        {
          id: projectId,
          name: "架空",
          updatedAt: "2026-07-28T00:00:00.000Z" as never,
        },
      ],
    };
  },
  async listCandidates() {
    return {
      ok: true,
      value: [
        {
          id: candidateId,
          projectId,
          category: "uncategorized",
          name: { original: "架空候補" },
          primarySource: draft.sources?.[0] as CandidateSource,
          price: draft.sources?.[0]?.price as NonNullable<
            CandidateSource["price"]
          >,
          hasMissingDetails: false,
          updatedAt: "2026-07-28T00:00:00.000Z" as never,
        },
      ],
    };
  },
  async listBuildEligible() {
    return { ok: true, value: [] };
  },
  async getCandidateDraft() {
    return { ok: true, value: draft as never };
  },
};

async function setup(language: "ja" | "en" = "ja") {
  const opened: string[] = [];
  const state = createManagementState({
    query,
    service: {} as CandidateManagementService,
    sourcePage: {
      async open(url) {
        opened.push(url);
        return { ok: true, value: undefined };
      },
    },
    currentProject: {
      getCurrentProject: () => ({ status: "resolved", projectId }),
      subscribe: () => () => {},
    },
    createMutationContext: () => ({
      requestId: "20000000-0000-4000-8000-000000000001" as Uuid as RequestId,
      expectedRevision: 0 as Revision,
    }),
  });
  await state.load();
  state.beginEdit(candidateId, draft);
  const user = userEvent.setup();
  const rendered = render(
    <MessageProvider resolver={resolverFor(language)}>
      <ManagementView state={state} />
    </MessageProvider>,
  );
  return { ...rendered, opened, state, user };
}

test("canonical port未注入時のkind変更試行は既存retail sourceを変更せずDOMにもretailを表示する", async () => {
  const { container, opened, state, user } = await setup();
  const sourceRegion = container.querySelector(
    '[data-region="candidate-sources"]',
  ) as HTMLElement;
  const sourceSections = sourceRegion.querySelectorAll("[data-source-id]");
  await user.selectOptions(
    within(sourceSections[0] as HTMLElement).getByRole("combobox", {
      name: /販売ページ/,
    }),
    "manufacturer",
  );
  await user.click(
    within(sourceSections[1] as HTMLElement).getByRole("button", {
      name: /ソースを開く/,
    }),
  );
  assert.equal(state.value.editor?.draft.primarySourceId, sourceA);
  assert.equal(state.value.editor?.draft.sources?.[0]?.kind, "retail");
  assert.equal(
    (
      within(sourceSections[0] as HTMLElement).getByRole("combobox", {
        name: /販売ページ/,
      }) as HTMLSelectElement
    ).value,
    "retail",
    "canonical port未注入のfail-closed結果を既存値の再表示として利用者が確認できる",
  );
  assert.deepEqual(opened, ["https://maker.invalid/item"]);
});

test("canonical port未注入時のunsafe URL試行は既存safe URLを保持して日英DOMへ再表示する", async () => {
  for (const language of ["ja", "en"] as const) {
    const { container, opened, state, unmount, user } = await setup(language);
    const source = container.querySelector(
      `[data-source-id="${sourceA}"]`,
    ) as HTMLElement;
    await user.click(
      container.querySelector(
        `[data-open-primary-source-id="${sourceA}"]`,
      ) as HTMLButtonElement,
    );
    assert.deepEqual(opened, [draft.sources?.[0]?.pageUrl]);
    const price = within(source).getByRole("textbox", {
      name: language === "ja" ? "価格" : "Price",
    });
    await user.type(price, "x");
    assert.equal((price as HTMLInputElement).value, "12000x");
    assert.equal(
      state.value.editor?.draft.sources?.[0]?.price?.confirmed?.amount,
      12000,
    );
    assert.equal(price.getAttribute("aria-invalid"), "true");
    assert.notEqual(price.getAttribute("aria-describedby"), null);
    assert.match(
      container.querySelector('[data-region="candidate-list"]')?.textContent ??
        "",
      language === "ja" ? /販売ページ/ : /Retail page/,
    );
    const url = within(source).getByRole("textbox", {
      name: language === "ja" ? "取得元URL" : "Source URL",
    });
    await user.clear(url);
    await user.type(url, "javascript:alert(1)");
    assert.equal(
      state.value.editor?.draft.sources?.[0]?.pageUrl,
      draft.sources?.[0]?.pageUrl,
    );
    assert.equal(
      (url as HTMLInputElement).value,
      draft.sources?.[0]?.pageUrl,
      "canonical port未注入のfail-closed結果を既存safe URLの再表示として利用者が確認できる",
    );
    assert.match(
      container.querySelector('[data-region="candidate-list"]')?.textContent ??
        "",
      /架空候補/,
    );
    assert.equal(
      (
        within(source).getByRole("textbox", {
          name: language === "ja" ? "ソース" : "Sources",
        }) as HTMLInputElement
      ).value,
      malicious,
    );
    assert.equal(container.querySelector("script"), null);
    assert.equal(container.querySelector("img"), null);
    unmount();
  }
});
