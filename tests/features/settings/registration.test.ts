import assert from "node:assert/strict";
import test from "node:test";

import type {
  Availability,
  FeatureMountContext,
} from "../../../src/application-shell/public.js";
import type { BackupRestoreSectionMount } from "../../../src/features/backup-restore/public.js";
import { createSettingsFeatureRegistration } from "../../../src/features/settings/public.js";

const context = (container: HTMLElement): FeatureMountContext => ({
  container,
  operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
  reportError: () => {},
});

test("settings registration は persistent metadata と availability を透過する", () => {
  const availability: Availability = {
    status: "unavailable",
    reason: "fixture",
  };
  const listener = () => {};
  const unsubscribe = () => {};
  const registration = createSettingsFeatureRegistration({
    backupRestore: { mount: async () => ({ unmount: async () => {} }) },
    getAvailability: () => availability,
    subscribeAvailability(received) {
      assert.equal(received, listener);
      return unsubscribe;
    },
  });

  assert.equal(registration.id, "settings");
  assert.equal(registration.presentation, "persistent");
  assert.deepEqual(registration.navigation, {
    labelKey: "nav.settings",
    order: 60,
    icon: "settings",
  });
  assert.deepEqual(registration.publicApi, {});
  assert.equal(registration.getAvailability(), availability);
  assert.equal(registration.subscribeAvailability(listener), unsubscribe);
});

test("settings registration は root の後に section を mount し逆順で一度だけ解放する", async () => {
  const events: string[] = [];
  const backupRestore: BackupRestoreSectionMount = {
    async mount(received) {
      events.push("backup:mount");
      assert.equal(received.container.dataset.region, "backup-restore-host");
      return { unmount: async () => void events.push("backup:unmount") };
    },
  };
  const container = document.createElement("div");
  const registration = createSettingsFeatureRegistration({ backupRestore });
  const handle = await registration.mount(context(container));

  assert.ok(container.querySelector("[data-region='settings']"));
  assert.deepEqual(events, ["backup:mount"]);
  await handle.unmount();
  events.push(`children:${container.childElementCount}`);
  await handle.unmount();
  assert.deepEqual(events, ["backup:mount", "backup:unmount", "children:0"]);
});

test("backup section mount 失敗時は settings root を rollback して失敗を返す", async () => {
  const container = document.createElement("div");
  const registration = createSettingsFeatureRegistration({
    backupRestore: {
      async mount() {
        throw new Error("fixture section failure");
      },
    },
  });

  await assert.rejects(
    registration.mount(context(container)),
    /fixture section failure/,
  );
  assert.equal(container.childElementCount, 0);
});
