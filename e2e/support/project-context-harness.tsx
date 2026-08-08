import { createRoot } from "react-dom/client";

import {
  ok,
  type ProjectId,
  type UtcTimestamp,
} from "../../src/domain/public.js";
import { createProjectCatalogProjection } from "../../src/project-context/catalog.js";
import type { ProjectCatalogItem } from "../../src/project-context/contracts.js";
import { createInMemoryProjectPreferencePort } from "../../src/project-context/preference-store.js";
import { createProjectContextPublicApi } from "../../src/project-context/public.js";
import { ProjectSelector } from "../../src/project-context/selector.js";
import { createProjectContextService } from "../../src/project-context/service.js";
import { LanguageProvider } from "../../src/ui-language/public.js";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
] as const satisfies readonly ProjectId[];

let entries: readonly ProjectCatalogItem[] = ids.map((id, index) => ({
  id,
  name: index === 0 ? "架空アルファ" : "架空ブラボー",
  updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
}));
let catalogUnavailable = false;
let confirmationRequired = false;
let forcedNotifications = 0;
const preference = createInMemoryProjectPreferencePort();
let service = createService();
let api: ReturnType<typeof createProjectContextPublicApi>;
let root: ReturnType<typeof createRoot> | undefined;

function createService() {
  const next = createProjectContextService({
    catalog: createProjectCatalogProjection({
      async list() {
        return catalogUnavailable
          ? { ok: false, error: { kind: "source-unavailable" as const } }
          : ok(entries);
      },
    }),
    preference,
  });
  if (confirmationRequired)
    next.registerGuard({
      id: "harness-confirmation",
      async evaluate() {
        return ok({ kind: "confirmation-required" });
      },
      notifyForced() {
        forcedNotifications += 1;
      },
    });
  return next;
}

const render = async () => {
  await service.initialize();
  api = createProjectContextPublicApi({ service });
  const container = document.querySelector<HTMLElement>("#root");
  if (container === null) throw new Error("Missing test harness root.");
  root?.unmount();
  root = createRoot(container);
  root.render(
    <LanguageProvider>
      <ProjectSelector read={api.read} commands={api.commands} />
    </LanguageProvider>,
  );
  return api;
};

void render().then(() =>
  Object.assign(window, {
    projectContextHarness: {
      ids,
      async setCatalog(names: readonly string[]) {
        entries = names.map((name, index) => ({
          id: ids[index] ?? ids[0],
          name,
          updatedAt: "2026-01-01T00:00:00Z" as UtcTimestamp,
        }));
        await api.commands.refresh();
      },
      async setCatalogUnavailable(value: boolean, refresh = true) {
        catalogUnavailable = value;
        if (refresh) await api.commands.refresh();
      },
      async requireConfirmation(value: boolean) {
        confirmationRequired = value;
        service = createService();
        await render();
      },
      async reopen() {
        service = createService();
        await render();
      },
      async replace(
        outcome: "succeeded" | "failed" | "cancelled",
        stale = false,
      ) {
        const prepared = await api.replacementGuard.prepare();
        if (!prepared.ok) return prepared;
        const permit =
          prepared.value.kind === "permitted"
            ? prepared.value.permit
            : await api.replacementGuard.confirm(
                prepared.value.confirmation.id,
              );
        if (!permit.ok) return permit;
        if (stale) await api.commands.refresh();
        const begun = api.replacementGuard.begin(permit.value.id);
        if (!begun.ok) return begun;
        const completed = await api.replacementGuard.complete(
          permit.value.id,
          outcome,
        );
        if (completed.ok && outcome === "succeeded")
          await api.commands.refresh();
        return completed;
      },
      forcedNotifications() {
        return forcedNotifications;
      },
      snapshot() {
        return service.getSnapshot();
      },
    },
  }),
);
