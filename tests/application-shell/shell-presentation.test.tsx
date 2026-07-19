import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";

import type { FeatureId } from "../../src/application-shell/contracts.js";
import { createShellPresentation } from "../../src/application-shell/shell-presentation.js";

const featureId = (value: string) => value as FeatureId;

test("shellとfeatureの別containerを維持してstateとnavigationを描画する", async () => {
  const shellContainer = document.createElement("div");
  document.body.append(shellContainer);
  const navigated: FeatureId[] = [];
  let retries = 0;
  const presentation = createShellPresentation();
  const mounted = presentation.mount({
    shellContainer,
    onNavigate: (id) => navigated.push(id),
    onRetry: () => {
      retries += 1;
    },
  });
  assert.equal(mounted.ok, true);
  if (!mounted.ok) return;
  const handle = mounted.value;
  assert.notEqual(handle.featureContainer, shellContainer);
  assert.equal(shellContainer.contains(handle.featureContainer), true);

  await act(() =>
    handle.publish({ kind: "ready", selected: featureId("projects") }, [
      { id: featureId("projects"), label: "Projects" },
      { id: featureId("parts"), label: "Parts" },
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
      { kind: "maintenance", selected: featureId("parts"), message: "停止中" },
      [
        { id: featureId("projects"), label: "Projects" },
        { id: featureId("parts"), label: "Parts" },
      ],
    ),
  );
  assert.equal(handle.featureContainer, slot);
  assert.equal(slot.textContent, "feature-owned");
  assert.match(shellContainer.textContent ?? "", /停止中/);

  await act(() =>
    handle.publish(
      {
        kind: "error",
        message: "safe <script>text</script>",
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
  const mounted = createShellPresentation().mount({
    shellContainer,
    onNavigate() {},
    onRetry() {},
  });
  assert.equal(mounted.ok, true);
  if (!mounted.ok) return;

  await act(() => mounted.value.publish({ kind: "ready", selected: null }, []));
  assert.equal(shellContainer.querySelectorAll("nav button").length, 0);
  assert.match(shellContainer.textContent ?? "", /利用可能な機能がありません/);
  assert.equal(shellContainer.contains(mounted.value.featureContainer), true);
  await act(() => mounted.value.stop());
  shellContainer.remove();
});

test("shellContainerでない要素だけをfeature slotとして公開する", () => {
  const shellContainer = document.createElement("div");
  const mounted = createShellPresentation().mount({
    shellContainer,
    onNavigate() {},
    onRetry() {},
  });
  assert.equal(mounted.ok, true);
  if (mounted.ok) {
    assert.notEqual(mounted.value.featureContainer, shellContainer);
    mounted.value.stop();
  }
});
