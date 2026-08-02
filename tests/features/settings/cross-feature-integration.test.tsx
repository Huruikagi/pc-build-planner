import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { userEvent } from "@testing-library/user-event";
import { act } from "react";

import { createApplicationShellIntegration } from "../../../src/application-shell/application-shell-integration.js";
import { createFeatureRegistry } from "../../../src/application-shell/feature-registry.js";
import type {
  FeatureId,
  TransientApplicationFeatureRegistration,
} from "../../../src/application-shell/public.js";
import { createSettingsFeatureRegistration } from "../../../src/features/settings/public.js";
import type {
  MaintenanceSnapshot,
  MaintenanceSnapshotSource,
} from "../../../src/persistence/public.js";
import {
  initializeUiLanguage,
  resetUiLanguageForTest,
} from "../../../src/ui-language/store.js";

const id = (value: string) => value as FeatureId;
const snapshot = (active: boolean, revision: number): MaintenanceSnapshot => ({
  generation: 1 as MaintenanceSnapshot["generation"],
  revision: revision as MaintenanceSnapshot["revision"],
  active,
});

function maintenanceFixture() {
  const listeners = new Set<(value: MaintenanceSnapshot) => void>();
  const source: MaintenanceSnapshotSource = {
    async getSnapshot() {
      return { ok: true, value: snapshot(false, 1) };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    emit(value: MaintenanceSnapshot) {
      for (const listener of listeners) listener(value);
    },
  };
}

afterEach(() => resetUiLanguageForTest());

test("maintenance・backup failure・transient 遷移でも policy/state と逆順 cleanup を保つ", async () => {
  const events: string[] = [];
  const registry = createFeatureRegistry();
  let mountedPolicy: (() => void) | undefined;
  const settings = createSettingsFeatureRegistration({
    backupRestore: {
      async mount(context) {
        const input = document.createElement("input");
        input.value = "failed-backup.json";
        input.dataset.state = "backup-failure";
        context.container.append(input);
        mountedPolicy = () => {};
        const unsubscribe = context.operationPolicy.subscribe(mountedPolicy);
        events.push("backup:mount");
        return {
          async unmount() {
            events.push(
              context.container.closest("[data-region='settings']")
                ? "backup:unmount-before-root"
                : "backup:unmount-after-root",
            );
            unsubscribe();
            events.push("backup:unsubscribe");
          },
        };
      },
    },
  });
  const transient: TransientApplicationFeatureRegistration = {
    id: id("capture"),
    presentation: "transient",
    transientActivation: {
      validate: (request) => ({ ok: true, value: request }),
      accept: async () => ({ ok: true, value: { release: async () => {} } }),
    },
    publicApi: {},
    getAvailability: () => ({ status: "available" }),
    subscribeAvailability: () => () => {},
    async mount(context) {
      events.push("transient:mount");
      context.container.textContent = "transient";
      return { unmount: async () => void events.push("transient:unmount") };
    },
  };
  assert.equal(registry.register(settings).ok, true);
  assert.equal(registry.register(transient).ok, true);
  const maintenance = maintenanceFixture();
  const container = document.createElement("div");
  const integration = createApplicationShellIntegration({
    registry,
    container,
    maintenanceSource: maintenance.source,
    onStateChange() {},
    reportError() {},
  });

  let startResult!: Awaited<ReturnType<typeof integration.start>>;
  await act(async () => {
    startResult = await integration.start();
  });
  assert.equal(startResult.ok, true);
  const backupState = container.querySelector<HTMLInputElement>(
    '[data-state="backup-failure"]',
  );
  const language = container.querySelector<HTMLSelectElement>(
    '[data-region="language-select"]',
  );
  assert.ok(backupState);
  assert.ok(language);
  await act(() => maintenance.emit(snapshot(true, 2)));
  assert.equal(integration.operationPolicy.isAllowed("mutation"), false);
  await act(async () => {
    await userEvent.setup().selectOptions(language, "en");
  });
  assert.equal(
    container.querySelector('[data-state="backup-failure"]'),
    backupState,
  );
  assert.equal(backupState.value, "failed-backup.json");
  assert.ok(mountedPolicy);

  let transientResult:
    | Awaited<ReturnType<NonNullable<typeof integration.showTransient>>>
    | undefined;
  await act(async () => {
    transientResult = await integration.showTransient?.({
      activationId: "settings-transition" as never,
      surfaceId: transient.id,
      tabId: 1 as never,
    });
  });
  assert.equal(transientResult?.ok, true);
  assert.deepEqual(events.slice(0, 4), [
    "backup:mount",
    "backup:unmount-before-root",
    "backup:unsubscribe",
    "transient:mount",
  ]);
  let restoreResult:
    | Awaited<ReturnType<NonNullable<typeof integration.restorePersistent>>>
    | undefined;
  await act(async () => {
    restoreResult = await integration.restorePersistent?.(
      settings.id,
      "navigated",
    );
  });
  assert.equal(restoreResult?.ok, true);
  assert.equal(
    container.querySelectorAll("[data-region='settings']").length,
    1,
  );
  await act(async () => integration.stop());
});

test("persistent切替のcleanup失敗後はsettings handleを保持して未解放backupを再試行する", async () => {
  const registry = createFeatureRegistry();
  let backupUnmountAttempts = 0;
  let backupSubscribed = false;
  const settings = createSettingsFeatureRegistration({
    backupRestore: {
      async mount() {
        backupSubscribed = true;
        return {
          async unmount() {
            backupUnmountAttempts += 1;
            if (backupUnmountAttempts === 1)
              throw new Error("backup cleanup failed once");
            backupSubscribed = false;
          },
        };
      },
    },
  });
  const target = {
    id: id("target"),
    presentation: "persistent" as const,
    navigation: { labelKey: "nav.settings" as const, order: 70 },
    publicApi: {},
    getAvailability: () => ({ status: "available" as const }),
    subscribeAvailability: () => () => {},
    async mount(context: { readonly container: HTMLElement }) {
      context.container.textContent = "target";
      return { unmount: async () => context.container.replaceChildren() };
    },
  };
  assert.equal(registry.register(settings).ok, true);
  assert.equal(registry.register(target).ok, true);
  const integration = createApplicationShellIntegration({
    registry,
    container: document.createElement("div"),
    maintenanceSource: maintenanceFixture().source,
    onStateChange() {},
    reportError() {},
  });
  let startResult!: Awaited<ReturnType<typeof integration.start>>;
  await act(async () => {
    startResult = await integration.start();
  });
  assert.equal(startResult.ok, true);

  let first!: Awaited<ReturnType<typeof integration.select>>;
  await act(async () => {
    first = await integration.select(target.id);
  });
  assert.equal(first.ok, false);
  assert.equal(backupSubscribed, true);
  assert.equal(backupUnmountAttempts, 1);

  let second!: Awaited<ReturnType<typeof integration.select>>;
  await act(async () => {
    second = await integration.select(target.id);
  });
  assert.equal(second.ok, true);
  assert.equal(backupSubscribed, false);
  assert.equal(backupUnmountAttempts, 2);
  assert.equal(integration.getSelected?.(), target.id);

  await act(async () => integration.stop());
});

test("言語保存失敗は表示と backup 操作を継続し domain data を変更しない", async () => {
  const domain = Object.freeze({ revision: 7, projects: 2 });
  let writes = 0;
  await initializeUiLanguage({
    browserUiLanguage: () => "ja",
    preferences: {
      async read() {
        return { ok: true, value: "ja" };
      },
      async write() {
        writes += 1;
        return { ok: false, error: { code: "storage-write-failed" } };
      },
    },
  });
  let backupActions = 0;
  const registration = createSettingsFeatureRegistration({
    backupRestore: {
      async mount(context) {
        const button = document.createElement("button");
        button.dataset.action = "fixture-backup";
        button.onclick = () => {
          backupActions += 1;
        };
        context.container.append(button);
        return { unmount: async () => {} };
      },
    },
  });
  const container = document.createElement("div");
  let handle!: Awaited<ReturnType<typeof registration.mount>>;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError() {},
    });
  });
  const language = container.querySelector<HTMLSelectElement>(
    '[data-region="language-select"]',
  );
  const backup = container.querySelector<HTMLButtonElement>(
    '[data-action="fixture-backup"]',
  );
  assert.ok(language);
  assert.ok(backup);
  await act(async () => {
    await userEvent.setup().selectOptions(language, "en");
  });
  await act(async () => backup.click());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1);
  assert.equal(backupActions, 1);
  assert.deepEqual(domain, { revision: 7, projects: 2 });
  assert.match(container.textContent ?? "", /Settings/);
  await act(async () => handle.unmount());
});

test("言語変更はsettings root・section host・入力値・scroll位置を再生成しない", async () => {
  const registration = createSettingsFeatureRegistration({
    backupRestore: {
      async mount(context) {
        const input = document.createElement("input");
        input.dataset.state = "draft";
        context.container.append(input);
        return { unmount: async () => {} };
      },
    },
  });
  const container = document.createElement("div");
  let handle!: Awaited<ReturnType<typeof registration.mount>>;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError() {},
    });
  });
  const settingsRoot = container.querySelector<HTMLElement>(
    "[data-region='settings']",
  );
  const languageSection = container.querySelector<HTMLElement>(
    "[data-region='language']",
  );
  const backupHost = container.querySelector<HTMLElement>(
    "[data-region='backup-restore-host']",
  );
  const draft = container.querySelector<HTMLInputElement>(
    "[data-state='draft']",
  );
  const language = container.querySelector<HTMLSelectElement>(
    "[data-region='language-select']",
  );
  assert.ok(settingsRoot);
  assert.ok(languageSection);
  assert.ok(backupHost);
  assert.ok(draft);
  assert.ok(language);
  assert.equal(
    container.querySelectorAll("[data-region='language-select']").length,
    1,
  );
  draft.value = "編集中";
  settingsRoot.scrollTop = 37;

  await act(async () => {
    await userEvent.setup().selectOptions(language, "en");
  });

  assert.equal(
    container.querySelector("[data-region='settings']"),
    settingsRoot,
  );
  assert.equal(
    container.querySelector("[data-region='language']"),
    languageSection,
  );
  assert.equal(
    container.querySelector("[data-region='backup-restore-host']"),
    backupHost,
  );
  assert.equal(container.querySelector("[data-state='draft']"), draft);
  assert.equal(draft.value, "編集中");
  assert.equal(settingsRoot.scrollTop, 37);
  await act(async () => handle.unmount());
});

test("backup cross-feature mount failure は settings 部分表示を残さない", async () => {
  const registry = createFeatureRegistry();
  const states: { readonly kind: string }[] = [];
  assert.equal(
    registry.register(
      createSettingsFeatureRegistration({
        backupRestore: {
          async mount() {
            throw new Error("backup fixture failure");
          },
        },
      }),
    ).ok,
    true,
  );
  const container = document.createElement("div");
  const integration = createApplicationShellIntegration({
    registry,
    container,
    maintenanceSource: maintenanceFixture().source,
    onStateChange(state) {
      states.push(state);
    },
    reportError() {},
  });
  let result!: Awaited<ReturnType<typeof integration.start>>;
  await act(async () => {
    result = await integration.start();
  });
  assert.equal(result.ok, true);
  assert.equal(states.at(-1)?.kind, "error");
  assert.equal(container.querySelector("[data-region='settings']"), null);
  await act(async () => integration.stop());
});
