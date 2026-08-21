import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type {
  CandidatePartId,
  ProjectId,
  Uuid,
} from "../../../src/domain/public.js";
import type { DuplicateDecisionState } from "../../../src/features/candidate-management/duplicate-merge-state.js";
import { DuplicateMergeView } from "../../../src/features/candidate-management/duplicate-merge-view.js";
import {
  MessageProvider,
  resolverFor,
} from "../../../src/ui-messages/public.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const firstId =
  "30000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;
const secondId =
  "30000000-0000-4000-8000-000000000002" as Uuid as CandidatePartId;
const draft = {
  projectId,
  category: "cpu" as const,
  product: {
    name: { original: "draft" },
    notes: { original: "SYN-SAVED-PAYLOAD-MUST-STAY-HIDDEN" },
  },
  normalizedAttributes: { category: "cpu" as const },
  sources: [
    {
      id: "40000000-0000-4000-8000-000000000001" as never,
      pageUrl: "https://secret.example.invalid/private/product?token=SYN",
      kind: "retail" as const,
    },
  ],
};
const deciding = {
  status: "deciding",
  draft,
  matches: [
    {
      candidateId: firstId,
      confidence: "high",
      evidence: { kind: "model-number" },
      summary: {
        id: firstId,
        projectId,
        category: "cpu",
        name: {
          original: '<img src=x onerror="alert(1)"><script>危険</script>',
        },
        manufacturer: {
          original: '<a href="javascript:alert(1)">メーカー</a>',
        },
        modelNumber: { original: "MODEL-1</dd><script>alert(2)</script>" },
        hasMissingDetails: false,
        updatedAt: "2026-07-22T00:00:00.000Z" as never,
      },
    },
    {
      candidateId: secondId,
      confidence: "supporting",
      evidence: { kind: "manufacturer-name" },
      summary: {
        id: secondId,
        projectId,
        category: "uncategorized",
        name: { original: "第二候補" },
        hasMissingDetails: true,
        updatedAt: "2026-07-22T00:00:00.000Z" as never,
      },
    },
  ],
} satisfies Extract<DuplicateDecisionState, { status: "deciding" }>;

afterEach(cleanup);

for (const language of ["ja", "en"] as const)
  test(`${language}: 順位付き候補を安全に描画し、選択まで統合を無効化する`, async () => {
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    let selected: CandidatePartId | undefined;
    let merged = 0;
    const user = userEvent.setup();
    const view = render(
      <MessageProvider resolver={resolverFor(language)}>
        <DuplicateMergeView
          state={deciding}
          onCancel={() => {}}
          onMerge={() => {
            merged += 1;
          }}
          onRetry={() => {}}
          onSaveNew={() => {}}
          onSelect={(id) => {
            selected = id;
          }}
        />
      </MessageProvider>,
    );
    const merge = screen.getByRole("button", {
      name: resolverFor(language)("candidate.duplicate.actions.merge"),
    });
    assert.equal((merge as HTMLButtonElement).disabled, true);
    assert.equal(view.container.querySelector("script"), null);
    assert.equal(view.container.querySelector("img"), null);
    assert.equal(view.container.querySelector("a"), null);
    assert.match(view.container.textContent ?? "", /<script>危険<\/script>/);
    assert.doesNotMatch(view.container.textContent ?? "", /https:\/\//);
    assert.doesNotMatch(
      view.container.textContent ?? "",
      /SYN-SAVED-PAYLOAD-MUST-STAY-HIDDEN/,
    );
    const radios = screen.getAllByRole("radio");
    assert.equal(radios.length, 2);
    assert.match(radios[0]?.closest("li")?.textContent ?? "", /MODEL-1/);
    await user.click(radios[1] as HTMLElement);
    assert.equal(selected, secondId);

    view.rerender(
      <MessageProvider resolver={resolverFor(language)}>
        <DuplicateMergeView
          state={{ ...deciding, selectedCandidateId: secondId }}
          onCancel={() => {}}
          onMerge={() => {
            merged += 1;
          }}
          onRetry={() => {}}
          onSaveNew={() => {}}
          onSelect={(id) => {
            selected = id;
          }}
        />
      </MessageProvider>,
    );
    await user.click(
      screen.getByRole("button", {
        name: resolverFor(language)("candidate.duplicate.actions.merge"),
      }),
    );
    assert.equal(merged, 1);
    assert.deepEqual(logged, []);
    console.error = originalError;
  });

for (const language of ["ja", "en"] as const)
  test(`${language}: 失敗理由と取消・再試行・明示新規保存を同じ操作契約で提示する`, async () => {
    const user = userEvent.setup();
    let cancelled = 0;
    let retried = 0;
    let savedNew = 0;
    render(
      <MessageProvider resolver={resolverFor(language)}>
        <DuplicateMergeView
          state={{
            status: "failed",
            draft,
            matches: deciding.matches,
            error: { kind: "stale-decision" },
          }}
          onCancel={() => {
            cancelled += 1;
          }}
          onMerge={() => {}}
          onRetry={() => {
            retried += 1;
          }}
          onSaveNew={() => {
            savedNew += 1;
          }}
          onSelect={() => {}}
        />
      </MessageProvider>,
    );
    assert.ok(screen.getByRole("alert"));
    await user.click(
      screen.getByRole("button", {
        name: resolverFor(language)("candidate.duplicate.actions.retry"),
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: resolverFor(language)("candidate.duplicate.actions.saveNew"),
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: resolverFor(language)("common.cancel"),
      }),
    );
    assert.deepEqual(
      { cancelled, retried, savedNew },
      { cancelled: 1, retried: 1, savedNew: 1 },
    );
  });

test("新規保存・取消・再試行をuser-eventで一度だけ親へ通知する", async () => {
  const user = userEvent.setup();
  let savedNew = 0;
  let cancelled = 0;
  let retried = 0;
  const view = render(
    <MessageProvider resolver={resolverFor("ja")}>
      <DuplicateMergeView
        state={deciding}
        onCancel={() => {
          cancelled += 1;
        }}
        onMerge={() => {}}
        onRetry={() => {
          retried += 1;
        }}
        onSaveNew={() => {
          savedNew += 1;
        }}
        onSelect={() => {}}
      />
    </MessageProvider>,
  );
  await user.click(
    screen.getByRole("button", {
      name: resolverFor("ja")("candidate.duplicate.actions.saveNew"),
    }),
  );
  await user.click(
    screen.getByRole("button", { name: resolverFor("ja")("common.cancel") }),
  );
  assert.equal(savedNew, 1);
  assert.equal(cancelled, 1);

  view.rerender(
    <MessageProvider resolver={resolverFor("ja")}>
      <DuplicateMergeView
        state={{
          status: "failed",
          draft,
          matches: deciding.matches,
          error: { kind: "stale-decision" },
        }}
        onCancel={() => {
          cancelled += 1;
        }}
        onMerge={() => {}}
        onRetry={() => {
          retried += 1;
        }}
        onSaveNew={() => {
          savedNew += 1;
        }}
        onSelect={() => {}}
      />
    </MessageProvider>,
  );
  await user.click(
    screen.getByRole("button", {
      name: resolverFor("ja")("candidate.duplicate.actions.retry"),
    }),
  );
  assert.equal(retried, 1);
  assert.equal(deciding.draft, draft);
});

for (const language of ["ja", "en"] as const)
  test(`${language}: source validationは修正対象のURL fieldを表示する`, () => {
    const view = render(
      <MessageProvider resolver={resolverFor(language)}>
        <DuplicateMergeView
          fieldErrors={{ "sources[0].pageUrl": "invalid-url" }}
          state={{
            status: "failed",
            draft,
            matches: deciding.matches,
            error: {
              kind: "source-route",
              cause: {
                kind: "source-add",
                cause: {
                  kind: "candidate-validation",
                  fields: { "source.pageUrl": "invalid-url" },
                },
              },
            },
          }}
          onCancel={() => {}}
          onMerge={() => {}}
          onRetry={() => {}}
          onSaveNew={() => {}}
          onSelect={() => {}}
        />
      </MessageProvider>,
    );

    const fieldError = view.container.querySelector(
      '[data-field-error="sources[0].pageUrl"]',
    );
    assert.ok(fieldError);
    assert.match(fieldError.textContent ?? "", /URL/i);
  });
