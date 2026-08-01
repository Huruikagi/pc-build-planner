import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";

import type { FeatureId } from "../../src/application-shell/contracts.js";
import { createShellPresentation } from "../../src/application-shell/shell-presentation.js";
import {
  defaultMessageResolver,
  type MessageKey,
  message,
} from "../../src/ui-messages/public.js";

const featureId = (value: string) => value as FeatureId;
const labelKey = (value: string) => value as MessageKey;

test("shellとfeatureの別containerを維持してstateとnavigationを描画する", async () => {
  const shellContainer = document.createElement("div");
  document.body.append(shellContainer);
  const navigated: FeatureId[] = [];
  let retries = 0;
  const presentation = createShellPresentation();
  let mounted!: ReturnType<typeof presentation.mount>;
  await act(() => {
    mounted = presentation.mount({
      shellContainer,
      onNavigate: (id) => navigated.push(id),
      onRetry: () => {
        retries += 1;
      },
    });
  });
  assert.equal(mounted.ok, true);
  if (!mounted.ok) return;
  const handle = mounted.value;
  assert.notEqual(handle.featureContainer, shellContainer);
  assert.equal(shellContainer.contains(handle.featureContainer), true);

  await act(() =>
    handle.publish({ kind: "ready", selected: featureId("projects") }, [
      { id: featureId("projects"), labelKey: labelKey("Projects") },
      { id: featureId("parts"), labelKey: labelKey("Parts") },
    ]),
  );
  const slot = handle.featureContainer;
  const buttons = shellContainer.querySelectorAll("nav button");
  assert.equal(buttons.length, 2);
  await act(() => (buttons[1] as HTMLButtonElement).click());
  assert.deepEqual(navigated, [featureId("parts")]);

  slot.textContent = "feature-owned";
  await act(() =>
    handle.publish(
      {
        kind: "maintenance",
        selected: featureId("parts"),
        message: message("shell.maintenanceActive"),
      },
      [
        { id: featureId("projects"), labelKey: labelKey("Projects") },
        { id: featureId("parts"), labelKey: labelKey("Parts") },
      ],
    ),
  );
  assert.equal(handle.featureContainer, slot);
  assert.equal(slot.textContent, "feature-owned");
  assert.match(
    shellContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("shell.maintenanceActive")),
  );

  await act(() =>
    handle.publish(
      {
        kind: "error",
        message: message("shell.featureUnavailable", {
          featureId: "parts",
          reason: "safe <script>text</script>",
        }),
        recoverable: true,
      },
      [],
    ),
  );
  assert.equal(shellContainer.querySelector("script"), null);
  const retry = shellContainer.querySelector<HTMLButtonElement>(
    '[data-action="retry"]',
  );
  assert.ok(retry);
  await act(() => retry.click());
  assert.equal(retries, 1);

  await act(() => handle.stop());
  await act(() => handle.stop());
  assert.equal(shellContainer.textContent, "");
  shellContainer.remove();
});

test("空catalogではnavigationなしのempty stateと安定slotを表示する", async () => {
  const shellContainer = document.createElement("div");
  document.body.append(shellContainer);
  let mounted!: ReturnType<ReturnType<typeof createShellPresentation>["mount"]>;
  await act(() => {
    mounted = createShellPresentation().mount({
      shellContainer,
      onNavigate() {},
      onRetry() {},
    });
  });
  assert.equal(mounted.ok, true);
  if (!mounted.ok) return;
  const handle = mounted.value;

  await act(() => handle.publish({ kind: "ready", selected: null }, []));
  assert.equal(shellContainer.querySelectorAll("nav button").length, 0);
  assert.match(
    shellContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("shell.emptyHeading")),
  );
  assert.equal(shellContainer.contains(handle.featureContainer), true);
  await act(() => handle.stop());
  shellContainer.remove();
});

test("shellContainerでない要素だけをfeature slotとして公開する", async () => {
  const shellContainer = document.createElement("div");
  let mounted!: ReturnType<ReturnType<typeof createShellPresentation>["mount"]>;
  await act(() => {
    mounted = createShellPresentation().mount({
      shellContainer,
      onNavigate() {},
      onRetry() {},
    });
  });
  assert.equal(mounted.ok, true);
  if (mounted.ok) {
    const handle = mounted.value;
    assert.notEqual(handle.featureContainer, shellContainer);
    await act(() => handle.stop());
  }
});
