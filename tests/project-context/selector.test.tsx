import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { act } from "react";

import {
  ok,
  type ProjectId,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { createProjectCatalogProjection } from "../../src/project-context/catalog.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextPublicApi } from "../../src/project-context/public.js";
import { ProjectSelector } from "../../src/project-context/selector.js";
import { createProjectContextService } from "../../src/project-context/service.js";
import {
  resetUiLanguageForTest,
  uiLanguageStore,
} from "../../src/ui-language/store.js";
import { renderWithLanguage } from "../ui-language/render-with-language.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;
const B = "22222222-2222-4222-8222-222222222222" as ProjectId;

afterEach(() => {
  cleanup();
  resetUiLanguageForTest();
});

const createReadyApi = async (
  names: readonly string[] = ["架空A", "架空B"],
) => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok(
          names.map((name, index) => ({
            id: (index === 0 ? A : B) as ProjectId,
            name,
            updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
          })),
        );
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await service.initialize();
  return createProjectContextPublicApi({ service });
};

test("3.2: ready selector は選択・live status・markup-like project 名を安全に描画する", async () => {
  const api = await createReadyApi(["<img src=x onerror=alert(1)>", "架空B"]);
  const user = userEvent.setup();
  const { container } = renderWithLanguage(
    <ProjectSelector read={api.read} commands={api.commands} />,
  );
  const select = container.querySelector<HTMLSelectElement>(
    "[data-project-context='select']",
  );
  assert.ok(select);
  assert.equal(select.value, A);
  assert.match(container.textContent ?? "", /<img src=x onerror=alert\(1\)>/);
  assert.equal(container.querySelector("img"), null);
  assert.ok(container.querySelector("[role='status']"));

  await user.selectOptions(select, B);
  assert.equal(api.read.getSnapshot().selectedProjectId, B);

  await act(() => uiLanguageStore.setLanguage("en"));
  assert.equal(select.value, B);
  assert.match(container.textContent ?? "", /Current project/);
});

test("3.2: empty と unavailable は操作不能表示または retry を提供する", async () => {
  const emptyService = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return ok([]);
      },
    }),
    preference: createInMemoryProjectPreferencePort(),
  });
  await emptyService.initialize();
  const emptyApi = createProjectContextPublicApi({ service: emptyService });
  const { container, unmount } = renderWithLanguage(
    <ProjectSelector read={emptyApi.read} commands={emptyApi.commands} />,
  );
  const emptySelect = container.querySelector<HTMLSelectElement>(
    "[data-project-context='select']",
  );
  assert.ok(emptySelect);
  assert.equal(emptySelect.disabled, true);
  assert.match(
    container.textContent ?? "",
    /利用できるプロジェクトはありません/,
  );
  unmount();

  const unavailableApi = createProjectContextPublicApi({
    service: createProjectContextService({
      catalog: createProjectCatalogProjection({
        async list() {
          return { ok: false, error: { kind: "source-unavailable" } } as const;
        },
      }),
      preference: createInMemoryProjectPreferencePort(),
    }),
  });
  const unavailable = renderWithLanguage(
    <ProjectSelector
      read={unavailableApi.read}
      commands={unavailableApi.commands}
    />,
  );
  assert.ok(
    unavailable.container.querySelector("[data-project-context='retry']"),
  );
});

test("3.2: confirmation は keyboard で cancel でき、選択を維持する", async () => {
  const api = await createReadyApi();
  api.guards.register({
    id: "requires-confirmation",
    async evaluate() {
      return ok({ kind: "confirmation-required" });
    },
  });
  const user = userEvent.setup();
  const { container } = renderWithLanguage(
    <ProjectSelector read={api.read} commands={api.commands} />,
  );
  const select = container.querySelector<HTMLSelectElement>(
    "[data-project-context='select']",
  );
  assert.ok(select);
  await user.selectOptions(select, B);
  const dialog = container.querySelector<HTMLElement>("[role='dialog']");
  assert.ok(dialog);
  assert.equal(
    dialog.getAttribute("aria-labelledby"),
    "project-context-confirmation-title",
  );
  const cancel = container.querySelector<HTMLButtonElement>(
    "[data-project-context='cancel']",
  );
  assert.ok(cancel);
  assert.equal(document.activeElement, cancel);
  await user.keyboard("{Escape}");
  assert.equal(container.querySelector("[role='dialog']"), null);
  assert.equal(api.read.getSnapshot().selectedProjectId, A);
});
