import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./extension-fixture.js";
import {
  applicationShell,
  featureRoot,
  navItem,
} from "./models/application-shell.js";
import {
  candidateRow,
  createCandidateButton,
} from "./models/candidate-management.js";
import {
  compatibilityResult,
  compatibilityState,
} from "./models/compatibility.js";
import {
  categoryButton,
  removeCandidateButton,
  selectCandidateButton,
} from "./models/current-build.js";
import {
  formField,
  region,
  submitButton,
} from "./models/locator-primitives.js";
import { projectContextSelect } from "./models/project-context.js";
import { selectLanguage } from "./models/settings.js";

const names = {
  mismatch: "E2E 架空 不一致",
  partial: "E2E 架空 部分不足",
  unknown: "E2E 架空 全不足",
  empty: "E2E 架空 空構成",
} as const;

async function extensionId(context: {
  serviceWorkers(): readonly { url(): string }[];
  waitForEvent(event: "serviceworker"): Promise<{ url(): string }>;
}): Promise<string> {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  return new URL(worker.url()).host;
}

const selectProject = async (page: Page, name: string): Promise<void> => {
  await projectContextSelect(page).selectOption({ label: name });
  await expect(projectContextSelect(page)).toHaveValue(/.+/);
};

const createProject = async (page: Page, name: string): Promise<void> => {
  await navItem(page, "candidate-management").click();
  const management = featureRoot(page, "candidate-management");
  await formField(management, "project-name").fill(name);
  await submitButton(region(management, "project-form")).click();
  await selectProject(page, name);
};

const createCandidate = async (
  page: Page,
  name: string,
  category: "cpu" | "motherboard",
  socket?: string,
): Promise<void> => {
  const management = featureRoot(page, "candidate-management");
  await createCandidateButton(management).click();
  const form = region(management, "candidate-form");
  await formField(form, "candidate-name").fill(name);
  await formField(form, "candidate-category").selectOption(category);
  if (socket !== undefined)
    await formField(form, "attribute-socket").fill(socket);
  await submitButton(form).click();
  await expect(
    candidateRow(region(management, "candidate-list"), name),
  ).toBeVisible();
};

const adopt = async (
  page: Page,
  category: "cpu" | "motherboard",
  name: string,
): Promise<Locator> => {
  await navItem(page, "currentBuild").click();
  const build = featureRoot(page, "currentBuild");
  await categoryButton(build, category).click();
  const row = candidateRow(region(build, "candidate-list"), name);
  await selectCandidateButton(row).click();
  await expect(removeCandidateButton(row)).toBeVisible();
  return row;
};

test("production拡張の共通project selectorで互換性の主要状態と日英表示を切り替える", async ({
  context,
}) => {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${await extensionId(context)}/side-panel.html`,
  );
  await expect(applicationShell(page)).toHaveAttribute(
    "data-runtime-state",
    "started",
  );
  await selectLanguage(page, "ja");

  await navItem(page, "compatibility").click();
  let compatibility = featureRoot(page, "compatibility");
  await expect(compatibilityState(compatibility)).toHaveAttribute(
    "data-status",
    "no-projects",
  );

  await createProject(page, names.mismatch);
  await createCandidate(page, "架空 不一致 CPU", "cpu", "SYN-MISMATCH-A");
  await createCandidate(
    page,
    "架空 不一致 MB",
    "motherboard",
    "SYN-MISMATCH-B",
  );
  await adopt(page, "cpu", "架空 不一致 CPU");
  await adopt(page, "motherboard", "架空 不一致 MB");

  await createProject(page, names.partial);
  await createCandidate(page, "架空 部分 CPU", "cpu", "SYN-PARTIAL");
  await createCandidate(page, "架空 部分 MB", "motherboard", "SYN-PARTIAL");
  await adopt(page, "cpu", "架空 部分 CPU");
  await adopt(page, "motherboard", "架空 部分 MB");

  await createProject(page, names.unknown);
  await createCandidate(page, "架空 不足 CPU", "cpu");
  await createCandidate(page, "架空 不足 MB", "motherboard");
  await adopt(page, "cpu", "架空 不足 CPU");
  await adopt(page, "motherboard", "架空 不足 MB");

  await createProject(page, names.empty);
  await createCandidate(page, "架空 空構成 CPU", "cpu", "SYN-EMPTY");
  const emptyRow = await adopt(page, "cpu", "架空 空構成 CPU");
  await removeCandidateButton(emptyRow).click();

  await navItem(page, "compatibility").click();
  compatibility = featureRoot(page, "compatibility");
  await expect(compatibilityState(compatibility)).toHaveAttribute(
    "data-status",
    "empty-build",
  );

  await selectProject(page, names.mismatch);
  await expect(compatibility).toContainText("互換性なし");
  await expect(compatibilityResult(compatibility, "incompatible")).toHaveCount(
    1,
  );
  await expect(compatibility).toContainText("架空 不一致 CPU");

  await selectProject(page, names.partial);
  await expect(compatibility).toContainText("注意事項あり");
  await expect(compatibility).toContainText("架空 部分 CPU");
  await expect(compatibility).not.toContainText("架空 不一致 CPU");
  await expect(compatibilityResult(compatibility, "compatible")).toHaveCount(1);
  await expect(compatibilityResult(compatibility, "unknown")).not.toHaveCount(
    0,
  );

  await selectProject(page, names.unknown);
  await expect(compatibility).toContainText("情報不足で判定不能");
  await expect(compatibilityResult(compatibility, "unknown")).toHaveCount(5);

  await selectLanguage(page, "en");
  await navItem(page, "compatibility").click();
  await expect(featureRoot(page, "compatibility")).toContainText(
    "Can't determine — not enough information",
  );
});
