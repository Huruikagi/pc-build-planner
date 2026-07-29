import assert from "node:assert/strict";
import test from "node:test";

import { render, screen, within } from "@testing-library/react";
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

test("source操作、種別上書き、primary切替、削除へDOMから到達できる", async () => {
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
  await user.click(within(sourceSections[1] as HTMLElement).getByRole("radio"));
  await user.click(within(sourceSections[0] as HTMLElement).getByRole("radio"));
  await user.click(
    within(sourceSections[1] as HTMLElement).getByRole("button", {
      name: /ソースを開く/,
    }),
  );
  assert.equal(state.value.editor?.draft.primarySourceId, sourceA);
  assert.equal(state.value.editor?.draft.sources?.[0]?.kind, "manufacturer");
  assert.deepEqual(opened, ["https://maker.invalid/item"]);

  const removePrimary = within(sourceSections[0] as HTMLElement).getByRole(
    "button",
    { name: /ソースを削除/ },
  );
  await user.click(removePrimary);
  assert.match(screen.getByRole("alert").textContent ?? "", /代わりのソース/);
  await user.selectOptions(
    within(sourceSections[0] as HTMLElement).getByRole("combobox", {
      name: /プライマリ/,
    }),
    sourceB,
  );
  await user.click(removePrimary);
  assert.equal(state.value.editor?.draft.sources?.length, 1);
  assert.equal(state.value.editor?.draft.primarySourceId, sourceB);
  await user.click(screen.getByRole("button", { name: /ソースを削除/ }));
  assert.equal(state.value.editor?.draft.sources?.length, 0);
  await user.click(screen.getByRole("button", { name: /ソースを追加/ }));
  assert.equal(state.value.editor?.draft.sources?.length, 1);
  assert.equal(
    state.value.editor?.draft.sources?.[0]?.kind,
    undefined,
    "新規手動sourceは利用者が種別を選ぶまで自動判定可能な状態を保つ",
  );
});

test("不正価格・URLと保存前一覧を保持し、一覧とeditorを日英で安全に描画する", async () => {
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
    assert.equal((url as HTMLInputElement).value, "javascript:alert(1)");
    assert.equal(url.getAttribute("aria-invalid"), "true");
    const describedBy = url.getAttribute("aria-describedby");
    assert.notEqual(describedBy, null);
    assert.match(
      container.querySelector(`#${describedBy}`)?.textContent ?? "",
      /URL|http/i,
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
