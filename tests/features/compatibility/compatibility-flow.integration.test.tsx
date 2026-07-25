import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createSidePanelFeatureContributions } from "../../../src/application-shell/side-panel-contributions.js";
import type {
  CandidatePartId,
  ProjectId,
  RequestId,
  Revision,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import { schemaValidator } from "../../../src/domain/public.js";
import { createCandidateManagementService } from "../../../src/features/candidate-management/service.js";
import {
  createInMemoryStorageAdapter,
  createInMemoryStorageState,
} from "../../../src/persistence/in-memory-storage-adapter.js";
import { maintenancePolicy } from "../../../src/persistence/maintenance.js";
import { createMigrationRegistry } from "../../../src/persistence/migration-registry.js";
import { createMutationPipeline } from "../../../src/persistence/mutation-pipeline.js";
import { referenceRepairPolicy } from "../../../src/persistence/reference-repair-policy.js";
import { createReplacementCoordinator } from "../../../src/persistence/replacement.js";
import { createLocalDataRepository } from "../../../src/persistence/repository.js";
import { createRootTransactionRunner } from "../../../src/persistence/root-transaction-runner.js";
import { createInMemoryRootWriteLock } from "../../../src/persistence/root-write-lock.js";
import { createInitialRoot } from "../../../src/persistence/schema.js";
import { createWriteAuthority } from "../../../src/persistence/write-authority.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";

const timestamp = "2026-07-23T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000081" as Uuid as ProjectId;
let requestSequence = 0;
let candidateSequence = 0;

const nextRequest = (): RequestId =>
  `20000000-0000-4000-8000-${String(++requestSequence).padStart(12, "0")}` as Uuid as RequestId;

const nextCandidateId = (): CandidatePartId =>
  `30000000-0000-4000-8000-${String(++candidateSequence).padStart(12, "0")}` as Uuid as CandidatePartId;

const createFoundationPort = () => {
  const storageState = createInMemoryStorageState({ quotaBytes: 10_000_000 });
  const storage = createInMemoryStorageAdapter(storageState);
  const migrations = createMigrationRegistry(1, [], schemaValidator);
  const runner = createRootTransactionRunner({
    storage,
    lock: createInMemoryRootWriteLock(),
    migrations,
    validator: schemaValidator,
    maintenance: maintenancePolicy,
    replacement: createReplacementCoordinator(migrations, schemaValidator),
    now: () => timestamp,
    initialRoot: createInitialRoot,
  });
  return createWriteAuthority({
    repository: createLocalDataRepository(storage, migrations),
    runner,
    pipeline: createMutationPipeline(schemaValidator, referenceRepairPolicy),
  });
};

const policy = { isAllowed: () => true, subscribe: () => () => {} };

const waitUntil = async (
  predicate: () => Promise<boolean>,
  attempts = 50,
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition did not become true in time");
};

test("現在構成を変更して互換性画面を再表示すると、選択済み候補だけの全5規則が根拠付きで更新される", async () => {
  const data = createFoundationPort();
  const seedService = createCandidateManagementService({
    data,
    now: () => timestamp,
    createProjectId: () => projectId,
    createCandidateId: nextCandidateId,
  });

  const created = await seedService.createProject(
    { name: "架空統合PC構成" },
    { requestId: nextRequest(), expectedRevision: 0 as Revision },
  );
  assert.equal(created.ok, true);

  const cpu = await seedService.createCandidate(
    {
      projectId,
      category: "cpu",
      product: { name: { original: "架空CPU", confirmed: "架空CPU" } },
      normalizedAttributes: {
        category: "cpu",
        socket: { original: "元表記", confirmed: "SYN-AM5" },
      },
    },
    { requestId: nextRequest(), expectedRevision: 1 as Revision },
  );
  assert.equal(cpu.ok, true);
  if (!cpu.ok) throw new Error("cpu候補を作成できません");

  const mismatchedMotherboard = await seedService.createCandidate(
    {
      projectId,
      category: "motherboard",
      product: {
        name: { original: "架空マザーボードA", confirmed: "架空マザーボードA" },
      },
      normalizedAttributes: {
        category: "motherboard",
        socket: { original: "元表記", confirmed: "SYN-LGA" },
      },
    },
    { requestId: nextRequest(), expectedRevision: 2 as Revision },
  );
  assert.equal(mismatchedMotherboard.ok, true);
  if (!mismatchedMotherboard.ok)
    throw new Error("マザーボード候補を作成できません");

  const matchedMotherboard = await seedService.createCandidate(
    {
      projectId,
      category: "motherboard",
      product: {
        name: { original: "架空マザーボードB", confirmed: "架空マザーボードB" },
      },
      normalizedAttributes: {
        category: "motherboard",
        socket: { original: "元表記", confirmed: "SYN-AM5" },
      },
    },
    { requestId: nextRequest(), expectedRevision: 3 as Revision },
  );
  assert.equal(matchedMotherboard.ok, true);
  if (!matchedMotherboard.ok)
    throw new Error("マザーボード候補を作成できません");

  const contributions = createSidePanelFeatureContributions({
    data,
    fullDataPort: data,
    navigator: {
      async activate() {
        return { ok: true as const, value: undefined };
      },
    },
  });
  const [, currentBuild, , compatibility] = contributions;

  // 現在構成でCPUと不一致マザーボードを選択する。
  const buildContainer = document.createElement("div");
  let buildHandle:
    | Awaited<ReturnType<typeof currentBuild.registration.mount>>
    | undefined;
  await act(async () => {
    buildHandle = await currentBuild.registration.mount({
      container: buildContainer,
      operationPolicy: policy,
      reportError: () => {},
    });
  });
  const buildQuery = currentBuild.registration.publicApi.query;

  const cpuButton = buildContainer.querySelector(
    `[data-select-candidate-id='${cpu.value.id}']`,
  ) as HTMLButtonElement;
  await act(async () => {
    cpuButton.click();
    await waitUntil(async () => {
      const result = await buildQuery.getByProject(projectId);
      return (
        result.ok &&
        result.value.currentBuild?.items.some(
          (item) => item.candidatePartId === cpu.value.id,
        ) === true
      );
    });
  });

  const motherboardTab = buildContainer.querySelector(
    "[data-category='motherboard']",
  ) as HTMLButtonElement;
  await act(async () => {
    motherboardTab.click();
  });
  const mismatchedButton = buildContainer.querySelector(
    `[data-select-candidate-id='${mismatchedMotherboard.value.id}']`,
  ) as HTMLButtonElement;
  await act(async () => {
    mismatchedButton.click();
    await waitUntil(async () => {
      const result = await buildQuery.getByProject(projectId);
      return (
        result.ok &&
        result.value.currentBuild?.items.some(
          (item) => item.candidatePartId === mismatchedMotherboard.value.id,
        ) === true
      );
    });
  });

  // 互換性画面を開くと、選択済み候補だけの全5規則が根拠付きで表示される。
  const compatibilityContainer = document.createElement("div");
  let compatibilityHandle:
    | Awaited<ReturnType<typeof compatibility.registration.mount>>
    | undefined;
  await act(async () => {
    compatibilityHandle = await compatibility.registration.mount({
      container: compatibilityContainer,
      operationPolicy: policy,
      reportError: () => {},
    });
  });

  assert.match(
    compatibilityContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.incompatible")),
  );
  assert.match(compatibilityContainer.textContent ?? "", /架空CPU/);
  assert.match(compatibilityContainer.textContent ?? "", /架空マザーボードA/);
  const resultRows = compatibilityContainer.querySelectorAll("[data-rule-id]");
  assert.equal(resultRows.length, 5, "全5規則の個別結果が表示されていない");

  await act(async () => compatibilityHandle?.unmount());
  assert.equal(compatibilityContainer.textContent, "");

  // 現在構成を一致するマザーボードへ変更する。
  const removeButton = buildContainer.querySelector(
    `[data-remove-candidate-id='${mismatchedMotherboard.value.id}']`,
  ) as HTMLButtonElement;
  await act(async () => {
    removeButton.click();
    await waitUntil(async () => {
      const result = await buildQuery.getByProject(projectId);
      return (
        result.ok &&
        result.value.currentBuild?.items.some(
          (item) => item.candidatePartId === mismatchedMotherboard.value.id,
        ) !== true
      );
    });
  });
  const matchedButton = buildContainer.querySelector(
    `[data-select-candidate-id='${matchedMotherboard.value.id}']`,
  ) as HTMLButtonElement;
  await act(async () => {
    matchedButton.click();
    await waitUntil(async () => {
      const result = await buildQuery.getByProject(projectId);
      return (
        result.ok &&
        result.value.currentBuild?.items.some(
          (item) => item.candidatePartId === matchedMotherboard.value.id,
        ) === true
      );
    });
  });

  // 互換性画面を再表示すると、変更後の構成に基づく新しい結果が表示される。
  const reopenedContainer = document.createElement("div");
  let reopenedHandle:
    | Awaited<ReturnType<typeof compatibility.registration.mount>>
    | undefined;
  await act(async () => {
    reopenedHandle = await compatibility.registration.mount({
      container: reopenedContainer,
      operationPolicy: policy,
      reportError: () => {},
    });
  });

  // 他4規則は該当カテゴリ不足でunknownのまま残るためcautionへ集約されるが、
  // 非互換だったCPUソケット規則は一致するマザーボードへの変更を反映しcompatibleへ更新される。
  assert.match(
    reopenedContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.caution")),
  );
  assert.doesNotMatch(
    reopenedContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.incompatible")),
  );
  const socketRow = reopenedContainer.querySelector(
    "[data-rule-id='cpu-motherboard-socket']",
  );
  assert.equal(socketRow?.getAttribute("data-result-status"), "compatible");
  assert.match(reopenedContainer.textContent ?? "", /架空マザーボードB/);
  assert.doesNotMatch(reopenedContainer.textContent ?? "", /架空マザーボードA/);

  await act(async () => reopenedHandle?.unmount());
  await act(async () => buildHandle?.unmount());
});

test("現在構成が空なら互換性画面は全不足の判定不能を示し、上流保存値を変更しない", async () => {
  const data = createFoundationPort();
  const seedService = createCandidateManagementService({
    data,
    now: () => timestamp,
    createProjectId: () => projectId,
    createCandidateId: nextCandidateId,
  });

  const created = await seedService.createProject(
    { name: "架空統合PC構成（未選択）" },
    { requestId: nextRequest(), expectedRevision: 0 as Revision },
  );
  assert.equal(created.ok, true);

  const cpu = await seedService.createCandidate(
    {
      projectId,
      category: "cpu",
      product: {
        name: { original: "架空CPU未選択", confirmed: "架空CPU未選択" },
      },
      normalizedAttributes: {
        category: "cpu",
        socket: { original: "元表記", confirmed: "SYN-AM5" },
      },
    },
    { requestId: nextRequest(), expectedRevision: 1 as Revision },
  );
  assert.equal(cpu.ok, true);
  if (!cpu.ok) throw new Error("cpu候補を作成できません");

  const contributions = createSidePanelFeatureContributions({
    data,
    fullDataPort: data,
    navigator: {
      async activate() {
        return { ok: true as const, value: undefined };
      },
    },
  });
  const [candidateManagement, currentBuild, , compatibility] = contributions;
  const candidateQuery = candidateManagement.registration.publicApi.query;
  const buildQuery = currentBuild.registration.publicApi.query;

  // 選択して解除することで、items が空の実在するCurrentBuild行を用意する
  // （プロジェクトにCurrentBuildが一度も存在しない no-build 状態とは区別する）。
  const buildContainer = document.createElement("div");
  let buildHandle:
    | Awaited<ReturnType<typeof currentBuild.registration.mount>>
    | undefined;
  await act(async () => {
    buildHandle = await currentBuild.registration.mount({
      container: buildContainer,
      operationPolicy: policy,
      reportError: () => {},
    });
  });
  const selectButton = buildContainer.querySelector(
    `[data-select-candidate-id='${cpu.value.id}']`,
  ) as HTMLButtonElement;
  await act(async () => {
    selectButton.click();
    await waitUntil(async () => {
      const result = await buildQuery.getByProject(projectId);
      return (
        result.ok &&
        result.value.currentBuild?.items.some(
          (entry) => entry.candidatePartId === cpu.value.id,
        ) === true
      );
    });
  });
  const removeButton = buildContainer.querySelector(
    `[data-remove-candidate-id='${cpu.value.id}']`,
  ) as HTMLButtonElement;
  await act(async () => {
    removeButton.click();
    await waitUntil(async () => {
      const result = await buildQuery.getByProject(projectId);
      return (
        result.ok &&
        result.value.currentBuild !== null &&
        result.value.currentBuild.items.length === 0
      );
    });
  });
  await act(async () => buildHandle?.unmount());

  const candidatesBefore = await candidateQuery.listBuildEligible(projectId);
  const buildBefore = await buildQuery.getByProject(projectId);
  assert.equal(candidatesBefore.ok, true);
  assert.equal(buildBefore.ok, true);

  // 何も選択しないまま互換性画面を開く: 全5規則が両側欠如で判定不能となり、
  // 集約結果は情報不足で判定不能になる。
  const compatibilityContainer = document.createElement("div");
  let compatibilityHandle:
    | Awaited<ReturnType<typeof compatibility.registration.mount>>
    | undefined;
  await act(async () => {
    compatibilityHandle = await compatibility.registration.mount({
      container: compatibilityContainer,
      operationPolicy: policy,
      reportError: () => {},
    });
  });

  assert.match(
    compatibilityContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.unknown")),
  );
  assert.doesNotMatch(
    compatibilityContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.compatible")),
  );
  assert.doesNotMatch(
    compatibilityContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.incompatible")),
  );
  assert.doesNotMatch(
    compatibilityContainer.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.caution")),
  );
  const resultRows = compatibilityContainer.querySelectorAll(
    "[data-result-status='unknown']",
  );
  assert.equal(resultRows.length, 5, "全5規則が判定不能として表示されていない");

  await act(async () => compatibilityHandle?.unmount());

  // 互換性確認は読取専用であり、候補・現在構成の保存値を変更しない。
  const candidatesAfter = await candidateQuery.listBuildEligible(projectId);
  const buildAfter = await buildQuery.getByProject(projectId);
  assert.equal(candidatesAfter.ok, true);
  assert.equal(buildAfter.ok, true);
  if (
    !candidatesBefore.ok ||
    !candidatesAfter.ok ||
    !buildBefore.ok ||
    !buildAfter.ok
  ) {
    throw new Error("上流データを照会できません");
  }
  assert.deepEqual(candidatesAfter.value, candidatesBefore.value);
  assert.deepEqual(buildAfter.value, buildBefore.value);
});
