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

test("backupとsettings rootのcleanup失敗を順序付きで集約する", async () => {
  const backupError = new Error("backup cleanup failed");
  const rootError = new Error("root cleanup failed");
  const root = {
    backupRestoreHost: document.createElement("div"),
    unmount() {
      throw rootError;
    },
  };
  const backupRestore: BackupRestoreSectionMount = {
    async mount() {
      return {
        async unmount() {
          throw backupError;
        },
      };
    },
  };
  const handle = await mountSettingsSectionResources(
    root,
    backupRestore,
    context(document.createElement("div")),
  );

  await assert.rejects(handle.unmount(), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, "Settings section cleanup failed");
    assert.deepEqual(error.errors, [backupError, rootError]);
    return true;
  });
});

test("cleanup失敗後は未解放resourceだけを再試行する", async () => {
  let backupAttempts = 0;
  let rootAttempts = 0;
  const root = {
    backupRestoreHost: document.createElement("div"),
    unmount() {
      rootAttempts += 1;
      if (rootAttempts === 1) throw new Error("root cleanup failed once");
    },
  };
  const backupRestore: BackupRestoreSectionMount = {
    async mount() {
      return {
        async unmount() {
          backupAttempts += 1;
          if (backupAttempts === 1)
            throw new Error("backup cleanup failed once");
        },
      };
    },
  };
  const handle = await mountSettingsSectionResources(
    root,
    backupRestore,
    context(document.createElement("div")),
  );

  await assert.rejects(handle.unmount(), AggregateError);
  await handle.unmount();
  await handle.unmount();

  assert.equal(backupAttempts, 2);
  assert.equal(rootAttempts, 2);
});

test("backup mount失敗とsettings rollback失敗を順序付きで保持する", async () => {
  const mountError = new Error("backup mount failed");
  const rollbackError = new Error("settings rollback failed");
  const root = {
    backupRestoreHost: document.createElement("div"),
    unmount() {
      throw rollbackError;
    },
  };
  const backupRestore: BackupRestoreSectionMount = {
    async mount() {
      throw mountError;
    },
  };

  await assert.rejects(
    mountSettingsSectionResources(
      root,
      backupRestore,
      context(document.createElement("div")),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, "Settings section mount rollback failed");
      assert.deepEqual(error.errors, [mountError, rollbackError]);
      return true;
    },
  );
});
