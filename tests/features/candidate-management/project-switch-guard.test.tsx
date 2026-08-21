import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import {
  ok,
  type ProjectId,
  type RequestId,
  type Revision,
  type UtcTimestamp,
  type Uuid,
} from "../../../src/domain/public.js";
import type { CandidateDraft } from "../../../src/features/candidate-management/contracts.js";
import { createProjectContextAdapter } from "../../../src/features/candidate-management/project-context-adapter.js";
import { createManagementState } from "../../../src/features/candidate-management/state.js";
import { ManagementView } from "../../../src/features/candidate-management/view.js";
import { createProjectCatalogProjection } from "../../../src/project-context/catalog.js";
import { createInMemoryProjectPreferencePort } from "../../../src/project-context/preference-store.js";
import { createProjectContextPublicApi } from "../../../src/project-context/public.js";
import { ProjectSelector } from "../../../src/project-context/selector.js";
import { createProjectContextService } from "../../../src/project-context/service.js";
import { resetUiLanguageForTest } from "../../../src/ui-language/store.js";
import { renderWithLanguage } from "../../ui-language/render-with-language.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;
const B = "22222222-2222-4222-8222-222222222222" as ProjectId;

afterEach(() => {
  cleanup();
  resetUiLanguageForTest();
});

test("10.2: dirty候補は共通確認の取消で保持され、確定時だけ破棄される", async () => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([
          {
            id: A,
            name: "架空A",
            updatedAt: "2026-08-10T00:00:00Z" as UtcTimestamp,
          },
          {
            id: B,
            name: "架空B",
            updatedAt: "2026-08-10T00:00:00Z" as UtcTimestamp,
          },
        ]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  const api = createProjectContextPublicApi({ service });
  let state: ReturnType<typeof createManagementState> | undefined;
  const adapter = createProjectContextAdapter({
    read: api.read,
    commands: api.commands,
    guards: api.guards,
    draftGuard: {
      isDirty: () => state?.hasDirtyProjectDraft() ?? false,
      discardConfirmedSwitch: (from, to) =>
        state?.discardDraftForConfirmedSwitch(from, to),
      preserveForcedSwitch: (from) =>
        state?.preserveDraftAfterForcedSwitch(from),
    },
  });
  state = createManagementState({
    currentProject: adapter,
    query: {
      async listProjects() {
        return ok([
          {
            id: A,
            name: "架空A",
            updatedAt: "2026-08-10T00:00:00Z" as UtcTimestamp,
          },
          {
            id: B,
            name: "架空B",
            updatedAt: "2026-08-10T00:00:00Z" as UtcTimestamp,
          },
        ]);
      },
      async listCandidates(input) {
        return ok([
          {
            id: (input.projectId === A
              ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
              : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") as Uuid,
            projectId: input.projectId,
            category: "uncategorized" as const,
            name: { original: input.projectId === A ? "A候補" : "B候補" },
            hasMissingDetails: true,
            updatedAt: "2026-08-10T00:00:00Z" as UtcTimestamp,
          },
        ] as never);
      },
      async listBuildEligible() {
        return ok([]);
      },
      async getCandidateDraft() {
        return {
          ok: false as const,
          error: {
            code: "validation" as const,
            reason: "entity-not-found" as const,
            message: "candidate",
          },
        };
      },
    },
    service: {} as never,
    createMutationContext: () => ({
      requestId: "33333333-3333-4333-8333-333333333334" as Uuid as RequestId,
      expectedRevision: 0 as Revision,
    }),
  });
  const started = adapter.start();
  assert.equal(started.ok, true);
  state.attachCurrentProject();
  await state.load();
  const user = userEvent.setup();
  const { container } = renderWithLanguage(
    <>
      <ProjectSelector read={api.read} commands={api.commands} />
      <ManagementView state={state} />
    </>,
  );
  assert.equal(
    container.querySelector(".candidate-management [data-project-id]"),
    null,
    "候補管理は共通selectorと重複するproject選択操作を描画しない",
  );
  const select = container.querySelector<HTMLSelectElement>(
    "[data-project-context='select']",
  );
  assert.ok(select);

  const create = container.querySelector<HTMLButtonElement>(
    "[data-create-candidate]",
  );
  assert.ok(create);
  await user.click(create);
  const name = container.querySelector<HTMLInputElement>(
    "[name='candidate-name']",
  );
  assert.ok(name);
  await user.type(name, "入力途中");

  await user.selectOptions(select, B);
  assert.ok(container.querySelector("[role='dialog']"));
  const cancel = container.querySelector<HTMLButtonElement>(
    "[data-project-context='cancel']",
  );
  assert.ok(cancel);
  await user.click(cancel);
  assert.equal(name.value, "入力途中");
  assert.equal(state.value.editor?.draft.product.name.confirmed, "入力途中");
  assert.equal(api.read.getSnapshot().selectedProjectId, A);

  await user.selectOptions(select, B);
  const confirm = container.querySelector<HTMLButtonElement>(
    "[role='dialog'] button",
  );
  assert.ok(confirm);
  await user.click(confirm);
  assert.equal(state.value.editor, null);
  assert.equal(api.read.getSnapshot().selectedProjectId, B);
  assert.match(
    container.querySelector("[data-region='candidate-list']")?.textContent ??
      "",
    /B候補/,
  );
  assert.doesNotMatch(container.textContent ?? "", /入力途中/);
  state.releaseCurrentProject();
  if (started.ok) started.value();
});

test("10.1: stale confirmationは候補draftへ適用されない", async () => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([
          {
            id: A,
            name: "架空A",
            updatedAt: "2026-08-10T00:00:00Z" as UtcTimestamp,
          },
          {
            id: B,
            name: "架空B",
            updatedAt: "2026-08-10T00:00:00Z" as UtcTimestamp,
          },
        ]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  const api = createProjectContextPublicApi({ service });
  let discarded = 0;
  const adapter = createProjectContextAdapter({
    read: api.read,
    commands: api.commands,
    guards: api.guards,
    draftGuard: {
      isDirty: () => true,
      discardConfirmedSwitch: () => {
        discarded += 1;
      },
      preserveForcedSwitch: () => {},
    },
  });
  const started = adapter.start();
  assert.equal(started.ok, true);
  const selected = await api.commands.select(B);
  assert.equal(selected.ok && selected.value.kind, "confirmation-required");
  assert.equal(selected.ok, true);
  if (!selected.ok || selected.value.kind !== "confirmation-required") return;
  api.guards.register({
    id: "changes-registry-revision",
    async evaluate() {
      return ok({ kind: "allow" });
    },
  });

  const confirmed = await api.commands.confirm(selected.value.confirmation.id);
  assert.deepEqual(confirmed, {
    ok: false,
    error: { kind: "confirmation-stale" },
  });
  assert.equal(discarded, 0);
  assert.equal(api.read.getSnapshot().selectedProjectId, A);
  if (started.ok) started.value();
});

test("10.3: catalog置換forced通知は旧project draftを保持して保存を遮断する", async () => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([
          {
            id: A,
            name: "架空A",
            updatedAt: "2026-08-10T00:00:00Z" as UtcTimestamp,
          },
          {
            id: B,
            name: "架空B",
            updatedAt: "2026-08-10T00:00:00Z" as UtcTimestamp,
          },
        ]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  const api = createProjectContextPublicApi({ service });
  let mutations = 0;
  const state = createManagementState({
    query: {
      async listProjects() {
        return ok([]);
      },
      async listCandidates() {
        return ok([]);
      },
      async listBuildEligible() {
        return ok([]);
      },
      async getCandidateDraft() {
        return {
          ok: false as const,
          error: {
            code: "validation" as const,
            reason: "entity-not-found" as const,
            message: "candidate",
          },
        };
      },
    },
    service: {
      async createCandidate() {
        mutations += 1;
        return {
          ok: false as const,
          error: { code: "storage-unavailable" as const },
        };
      },
    } as never,
    createMutationContext: () => ({
      requestId: "33333333-3333-4333-8333-333333333333" as Uuid as RequestId,
      expectedRevision: 0 as Revision,
    }),
  });
  const draft = {
    projectId: A,
    category: "uncategorized",
    product: { name: { original: "保持する入力" } },
    normalizedAttributes: { category: "uncategorized" },
  } satisfies CandidateDraft;
  state.beginCreate(draft);
  const adapter = createProjectContextAdapter({
    read: api.read,
    commands: api.commands,
    guards: api.guards,
    draftGuard: {
      isDirty: () => state.hasDirtyProjectDraft(),
      discardConfirmedSwitch: (from, to) =>
        state.discardDraftForConfirmedSwitch(from, to),
      preserveForcedSwitch: (from) =>
        state.preserveDraftAfterForcedSwitch(from),
    },
  });
  const started = adapter.start();
  assert.equal(started.ok, true);
  const prepared = await api.replacementGuard.prepare();
  assert.equal(prepared.ok && prepared.value.kind, "confirmation-required");
  if (!prepared.ok || prepared.value.kind !== "confirmation-required") return;
  const permit = await api.replacementGuard.confirm(
    prepared.value.confirmation.id,
  );
  assert.equal(permit.ok, true);
  if (!permit.ok) return;
  assert.equal(api.replacementGuard.begin(permit.value.id).ok, true);
  assert.equal(
    (await api.replacementGuard.complete(permit.value.id, "succeeded")).ok,
    true,
  );
  await state.saveEditor();

  assert.equal(state.value.editor?.projectId, A);
  assert.equal(state.value.editor?.draft.product.name.original, "保持する入力");
  assert.equal(state.value.displayError?.code, "project-changed-with-draft");
  assert.equal(mutations, 0);
  if (started.ok) started.value();
});
