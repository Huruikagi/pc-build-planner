import assert from "node:assert/strict";
import test from "node:test";

import type {
  FeatureMountContext,
  FeatureMountHandle,
} from "../../../src/application-shell/public.js";
import type { BackupRestoreSectionMount } from "../../../src/features/backup-restore/public.js";
import { mountSettingsSectionResources } from "../../../src/features/settings/public.js";

const context = (container: HTMLElement): FeatureMountContext => ({
  container,
  operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
  reportError: () => {},
});

test("公開 backup section mount に安定 host と既存 context を渡す", async () => {
  const events: string[] = [];
  const shellContainer = document.createElement("div");
  const backupHost = document.createElement("div");
  shellContainer.append(backupHost);
  const root = {
    backupRestoreHost: backupHost,
    unmount: () => events.push("root"),
  };
  const mountContext = context(shellContainer);
  const backupRestore: BackupRestoreSectionMount = {
    async mount(received): Promise<FeatureMountHandle> {
      assert.equal(received.container, backupHost);
      assert.equal(received.operationPolicy, mountContext.operationPolicy);
      events.push("backup:mount");
      return {
        unmount: async () => {
          events.push("backup:unmount");
        },
      };
    },
  };
  const handle = await mountSettingsSectionResources(
    root,
    backupRestore,
    mountContext,
  );
  await handle.unmount();
  await handle.unmount();

  assert.deepEqual(events, ["backup:mount", "backup:unmount", "root"]);
});

test("backup mount 失敗時は settings root を rollback する", async () => {
  const events: string[] = [];
  const container = document.createElement("div");
  const root = {
    backupRestoreHost: document.createElement("div"),
    unmount: () => events.push("root"),
  };
  const backupRestore: BackupRestoreSectionMount = {
    async mount() {
      throw new Error("section failed");
    },
  };

  await assert.rejects(
    mountSettingsSectionResources(root, backupRestore, context(container)),
    /section failed/,
  );
  assert.deepEqual(events, ["root"]);
});
