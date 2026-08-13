import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, cleanup, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ProjectId, UtcTimestamp } from "../../src/domain/public.js";
import type { ProjectContextSnapshot } from "../../src/project-context/contracts.js";
import type { ProjectLifecycleMessageDescriptor } from "../../src/project-context/lifecycle-message-descriptors.js";
import { createProjectLifecyclePresentationContribution } from "../../src/project-context/lifecycle-presentation.js";
import type { ProjectLifecycleService } from "../../src/project-context/lifecycle-service.js";
import { createProjectLifecycleState } from "../../src/project-context/lifecycle-state.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;
const B = "22222222-2222-4222-8222-222222222222" as ProjectId;
const updatedAt = "2026-08-13T01:00:00.000Z" as UtcTimestamp;
const unsafeName = '<img src=x onerror="globalThis.pwned=true">';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const label = (locale: string, descriptor: ProjectLifecycleMessageDescriptor) =>
  `${locale}:${descriptor.intent}:${"projectName" in descriptor ? descriptor.projectName : ""}:${"operation" in descriptor ? descriptor.operation : ""}:${"reason" in descriptor ? descriptor.reason : ""}`;

const harness = () => {
  const context: ProjectContextSnapshot = {
    status: "ready",
    generation: 1,
    catalog: [
      { id: A, name: unsafeName, updatedAt },
      { id: B, name: "Synthetic B", updatedAt },
    ],
    selectedProjectId: A,
  };
  const readListeners = new Set<(snapshot: ProjectContextSnapshot) => void>();
  const calls: string[] = [];
  let createAttempts = 0;
  let createFailure: "storage" | "committed-refresh-failed" | undefined;
  let resolveCommand: (() => void) | undefined;
  let locale = "ja";
  const messageListeners = new Set<() => void>();
  const service: ProjectLifecycleService = {
    async create(name) {
      calls.push(`create:${name}`);
      if (name.trim() === "") {
        return {
          ok: false,
          error: { kind: "validation", fields: { name: "required" } },
        };
      }
      createAttempts += 1;
      if (createFailure !== undefined && createAttempts === 1) {
        return { ok: false, error: { kind: createFailure } };
      }
      await new Promise<void>((resolve) => {
        resolveCommand = resolve;
      });
      return { ok: true, value: { projectId: B, snapshot: context } };
    },
    async rename(projectId, name) {
      calls.push(`rename:${projectId}:${name}`);
      return { ok: true, value: { projectId, snapshot: context } };
    },
    async delete(projectId) {
      calls.push(`delete:${projectId}`);
      return { ok: true, value: { projectId, snapshot: context } };
    },
    async retryRefresh() {
      calls.push("refresh");
      return { ok: true, value: context };
    },
  };
  const read = {
    getSnapshot: () => context,
    subscribe(listener: (snapshot: ProjectContextSnapshot) => void) {
      readListeners.add(listener);
      return () => {
        readListeners.delete(listener);
      };
    },
  };
  const state = createProjectLifecycleState({ read, lifecycle: service });
  const messages = {
    getSnapshot: () => locale,
    subscribe(listener: () => void) {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },
    resolve: (descriptor: ProjectLifecycleMessageDescriptor) =>
      label(locale, descriptor),
  };
  return {
    calls,
    lifecycle: service,
    messages,
    read,
    state,
    finishCommand() {
      resolveCommand?.();
    },
    failFirstCreate(kind: "storage" | "committed-refresh-failed") {
      createFailure = kind;
    },
    switchLocale(next: string) {
      locale = next;
      for (const listener of messageListeners) listener();
    },
    subscriptions: () => readListeners.size + messageListeners.size,
  };
};

test("host container で既存順序・keyboard・focus・pending・安全な text 描画を提供する", async () => {
  const h = harness();
  const container = document.body.appendChild(document.createElement("div"));
  const contribution = createProjectLifecyclePresentationContribution(h);
  let mounted!: ReturnType<typeof contribution.mount>;
  act(() => {
    mounted = contribution.mount(container);
  });
  if (!mounted.ok) assert.fail("mount should succeed");
  const handle = mounted.value;
  const user = userEvent.setup();
  const ui = within(container);

  const nav = ui.getByRole("navigation", {
    name: label("ja", { intent: "project-list" }),
  });
  const form = ui.getByRole("form", {
    name: label("ja", { intent: "create-project" }),
  });
  assert.ok(
    nav.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert.ok(
    ui.getByRole("textbox", {
      name: label("ja", { intent: "create-project" }),
    }),
  );
  assert.ok(
    ui.getByRole("button", {
      name: label("ja", { intent: "create-project-action" }),
    }),
  );
  assert.equal(container.querySelector("img"), null);
  assert.match(
    container.textContent ?? "",
    new RegExp(unsafeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );

  const rename = ui.getByRole("button", {
    name: label("ja", { intent: "rename-project", projectName: unsafeName }),
  });
  await user.click(rename);
  const input = ui.getByRole("textbox", {
    name: label("ja", { intent: "rename-project", projectName: unsafeName }),
  });
  assert.equal(document.activeElement, input);
  assert.ok(
    ui.getByRole("button", {
      name: label("ja", { intent: "save-project-name-action" }),
    }),
  );
  await user.clear(input);
  await user.type(input, "Renamed by keyboard");
  await user.keyboard("{Enter}");
  assert.equal(h.calls.at(-1), `rename:${A}:Renamed by keyboard`);

  const createInput = ui.getByRole<HTMLInputElement>("textbox", {
    name: label("ja", { intent: "create-project" }),
  });
  await user.type(createInput, "Pending build");
  await user.keyboard("{Enter}");
  assert.match(
    ui.getByRole("status").textContent ?? "",
    /ja:operation-pending::create:/,
  );
  assert.equal(createInput.disabled, true);
  await act(async () => {
    h.finishCommand();
    await Promise.resolve();
  });
  act(() => handle.unmount());
});

test("validation、削除確認、cancel/Escape、resolver 切替でも state と選択を維持する", async () => {
  const h = harness();
  const container = document.body.appendChild(document.createElement("div"));
  const contribution = createProjectLifecyclePresentationContribution(h);
  let mounted!: ReturnType<typeof contribution.mount>;
  act(() => {
    mounted = contribution.mount(container);
  });
  if (!mounted.ok) assert.fail("mount should succeed");
  const handle = mounted.value;
  const user = userEvent.setup();
  const ui = within(container);

  await user.click(
    ui.getByRole("button", {
      name: label("ja", { intent: "create-project-action" }),
    }),
  );
  assert.equal(ui.getByRole("textbox").getAttribute("aria-invalid"), "true");
  assert.equal(
    ui.getByRole("alert").textContent,
    label("ja", { intent: "name-required" }),
  );

  const deleteDescriptor = {
    intent: "confirm-delete",
    projectName: unsafeName,
    impact: "owned-candidates",
  } as const;
  await user.click(
    ui.getByRole("button", { name: label("ja", deleteDescriptor) }),
  );
  const dialog = ui.getByRole("dialog", {
    name: label("ja", deleteDescriptor),
  });
  const confirmDelete = within(dialog).getByRole("button", {
    name: label("ja", { intent: "confirm-delete-action" }),
  });
  const cancelDelete = within(dialog).getByRole("button", {
    name: label("ja", { intent: "cancel-delete" }),
  });
  assert.notEqual(
    confirmDelete.getAttribute("aria-label"),
    cancelDelete.getAttribute("aria-label"),
  );
  assert.equal(document.activeElement, cancelDelete);
  await user.keyboard("{Escape}");
  assert.equal(ui.queryByRole("dialog"), null);
  assert.deepEqual(h.calls, ["create:"]);
  assert.equal(
    document.activeElement?.getAttribute("aria-label"),
    label("ja", deleteDescriptor),
  );

  await user.type(ui.getByRole("textbox"), "Locale draft");
  await user.click(
    ui.getByRole("button", { name: label("ja", deleteDescriptor) }),
  );
  act(() => h.switchLocale("en"));
  assert.equal(ui.getByRole("textbox").getAttribute("value"), "Locale draft");
  assert.ok(ui.getByRole("dialog", { name: label("en", deleteDescriptor) }));
  assert.equal(
    container.querySelector("[aria-current='page']")?.textContent,
    unsafeName,
  );
  await user.click(
    within(ui.getByRole("dialog")).getByRole("button", {
      name: label("en", { intent: "confirm-delete-action" }),
    }),
  );
  assert.equal(h.calls.at(-1), `delete:${A}`);
  act(() => handle.unmount());
});

test("rename cancel は draft を破棄して trigger へ focus を戻す", async () => {
  const h = harness();
  const container = document.body.appendChild(document.createElement("div"));
  const contribution = createProjectLifecyclePresentationContribution(h);
  let mounted!: ReturnType<typeof contribution.mount>;
  act(() => {
    mounted = contribution.mount(container);
  });
  if (!mounted.ok) assert.fail("mount should succeed");
  const user = userEvent.setup();
  const ui = within(container);
  const renameDescriptor = {
    intent: "rename-project",
    projectName: unsafeName,
  } as const;
  const trigger = ui.getByRole("button", {
    name: label("ja", renameDescriptor),
  });
  await user.click(trigger);
  await user.clear(ui.getByRole("textbox"));
  await user.type(ui.getByRole("textbox"), "discard me");
  await user.click(
    ui.getByRole("button", { name: label("ja", { intent: "cancel-rename" }) }),
  );
  assert.equal(ui.getByRole<HTMLInputElement>("textbox").value, "");
  assert.equal(document.activeElement, trigger);
  act(() => mounted.ok && mounted.value.unmount());
});

test("mutation failure は入力を保持して再試行し、commit後refresh failure は mutation を閉じ retry だけ許す", async () => {
  for (const failure of ["storage", "committed-refresh-failed"] as const) {
    const h = harness();
    h.failFirstCreate(failure);
    const container = document.body.appendChild(document.createElement("div"));
    const contribution = createProjectLifecyclePresentationContribution(h);
    let mounted!: ReturnType<typeof contribution.mount>;
    act(() => {
      mounted = contribution.mount(container);
    });
    if (!mounted.ok) assert.fail("mount should succeed");
    const user = userEvent.setup();
    const ui = within(container);
    const input = ui.getByRole<HTMLInputElement>("textbox");
    await user.type(input, "retry draft");
    await user.keyboard("{Enter}");
    assert.equal(input.value, "retry draft");
    if (failure === "storage") {
      await user.keyboard("{Enter}");
      assert.deepEqual(h.calls, ["create:retry draft", "create:retry draft"]);
    } else {
      assert.equal(input.disabled, true);
      assert.ok(
        ui.getByRole("button", {
          name: label("ja", { intent: "retry-refresh" }),
        }),
      );
      await user.keyboard("{Enter}");
      assert.deepEqual(h.calls, ["create:retry draft"]);
      await user.click(
        ui.getByRole("button", {
          name: label("ja", { intent: "retry-refresh" }),
        }),
      );
      assert.equal(h.calls.at(-1), "refresh");
    }
    act(() => mounted.ok && mounted.value.unmount());
    container.remove();
  }
});

test("mount は単一 active root を守り、unmount は subscription と DOM を一度だけ解放する", () => {
  const h = harness();
  const container = document.body.appendChild(document.createElement("div"));
  const contribution = createProjectLifecyclePresentationContribution(h);
  let mounted!: ReturnType<typeof contribution.mount>;
  act(() => {
    mounted = contribution.mount(container);
  });
  if (!mounted.ok) assert.fail("mount should succeed");
  const handle = mounted.value;
  assert.equal(h.subscriptions(), 2);
  assert.deepEqual(contribution.mount(container), {
    ok: false,
    error: { kind: "presentation-failed" },
  });
  act(() => {
    handle.unmount();
    handle.unmount();
  });
  assert.equal(h.subscriptions(), 0);
  assert.equal(container.childElementCount, 0);
});
