import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";

import type {
  Availability,
  FeatureMountHandle,
} from "../../../src/application-shell/contracts.js";
import { createBackupRestoreFeatureRegistration } from "../../../src/features/backup-restore/registration.js";
import { createBackupRestoreState } from "../../../src/features/backup-restore/state.js";
import type { FoundationDataPort } from "../../../src/persistence/public.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";
import { collectFeatureContractViolations } from "../../contracts/application-shell-contract-kit.js";

const notExpected = (label: string) => (): never => {
  throw new Error(`must not call ${label}`);
};

const buildFoundationDataPort = (): FoundationDataPort => ({
  query: notExpected("query"),
  mutate: notExpected("mutate"),
  assessReplacement: notExpected("assessReplacement"),
  replaceRoot: notExpected("replaceRoot"),
  runMaintenance: notExpected("runMaintenance"),
});

const policy = { isAllowed: () => true, subscribe: () => () => {} };

test("backup-restore registrationはshell契約に適合しmount/unmountを行う", async () => {
  const availabilityListeners = new Set<(value: Availability) => void>();
  const registration = createBackupRestoreFeatureRegistration({
    data: buildFoundationDataPort(),
    subscribeAvailability(listener) {
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
  });

  assert.deepEqual(registration.publicApi, {});
  const violations = await collectFeatureContractViolations(registration, {
    emitAvailability: (availability) => {
      for (const listener of availabilityListeners) listener(availability);
    },
  });

  assert.deepEqual(violations, []);
});

test("captureStateを公開せず、activationも公開しない（画面再生成で常にidleから始まる）", async () => {
  const registration = createBackupRestoreFeatureRegistration({
    data: buildFoundationDataPort(),
  });
  const container = document.createElement("div");

  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: policy,
      reportError: () => {},
    });
  });

  assert.equal(handle?.captureState, undefined);
  assert.equal(registration.activation, undefined);
  await act(async () => handle?.unmount());
});

test("state未注入時はdataから構成したBackupRestoreStateをmountする", async () => {
  const backupRoot = { schemaVersion: 1 };
  const data: FoundationDataPort = {
    query: async (queryFn) => ({
      ok: true,
      value: queryFn(backupRoot as never),
    }),
    mutate: notExpected("mutate"),
    assessReplacement: notExpected("assessReplacement"),
    replaceRoot: notExpected("replaceRoot"),
    runMaintenance: notExpected("runMaintenance"),
  };
  const registration = createBackupRestoreFeatureRegistration({ data });
  const container = document.createElement("div");

  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: policy,
      reportError: () => {},
    });
  });

  const button = container.querySelector(
    'button[data-action="export"]',
  ) as HTMLButtonElement;
  assert.ok(button);

  await act(async () => handle?.unmount());
});

test("state注入時は注入されたstateをそのままmountする", async () => {
  const injectedState = createBackupRestoreState({
    backupService: { create: notExpected("create") },
    restoreService: {
      preflight: notExpected("preflight"),
      commit: notExpected("commit"),
    },
    fileGateway: {
      read: notExpected("read"),
      download: notExpected("download"),
    },
  });
  const registration = createBackupRestoreFeatureRegistration({
    data: buildFoundationDataPort(),
    state: injectedState,
  });
  const container = document.createElement("div");

  let handle: FeatureMountHandle | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: policy,
      reportError: () => {},
    });
  });

  assert.equal(
    container.textContent?.includes(
      defaultMessageResolver("backup.exportHeading"),
    ),
    true,
  );
  await act(async () => handle?.unmount());
  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
});
