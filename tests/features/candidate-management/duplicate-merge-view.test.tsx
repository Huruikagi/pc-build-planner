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
  product: { name: { original: "draft" } },
  normalizedAttributes: { category: "cpu" as const },
  sources: [],
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
        name: { original: "<script>危険</script>" },
        manufacturer: { original: "メーカー" },
        modelNumber: { original: "MODEL-1" },
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
    assert.match(view.container.textContent ?? "", /<script>危険<\/script>/);
    assert.doesNotMatch(view.container.textContent ?? "", /https:\/\//);
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
  });

test("失敗時は取消・再試行・明示新規保存を提示する", () => {
  render(
    <MessageProvider resolver={resolverFor("ja")}>
      <DuplicateMergeView
        state={{
          status: "failed",
          draft,
          matches: deciding.matches,
          error: { kind: "stale-decision" },
        }}
        onCancel={() => {}}
        onMerge={() => {}}
        onRetry={() => {}}
        onSaveNew={() => {}}
        onSelect={() => {}}
      />
    </MessageProvider>,
  );
  assert.ok(
    screen.getByRole("button", {
      name: resolverFor("ja")("candidate.duplicate.actions.retry"),
    }),
  );
  assert.ok(
    screen.getByRole("button", {
      name: resolverFor("ja")("candidate.duplicate.actions.saveNew"),
    }),
  );
  assert.ok(
    screen.getByRole("button", { name: resolverFor("ja")("common.cancel") }),
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
