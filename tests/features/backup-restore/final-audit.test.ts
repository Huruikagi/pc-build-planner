import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

/**
 * 完全検証gateの監査部分。受け入れ基準の網羅、未解決placeholder、
 * 旧maintenance fence経路、独立navigation、通常CRUD capability漏出を
 * 手作業の読み合わせではなく回帰対象として固定する。
 */

const SPEC_DIR = ".kiro/specs/backup-restore";
const FEATURE_DIR = "src/features/backup-restore";

/** requirements.mdの`### Requirement N`配下にある番号付きACをN.Mへ展開する。 */
const acceptanceCriteria = (requirements: string): readonly string[] => {
  const ids: string[] = [];
  let requirement: number | undefined;
  let inCriteria = false;
  for (const line of requirements.split(/\r?\n/)) {
    const heading = /^### Requirement (\d+)\b/.exec(line);
    if (heading?.[1] !== undefined) {
      requirement = Number(heading[1]);
      inCriteria = false;
      continue;
    }
    if (/^#### Acceptance Criteria\s*$/.test(line)) {
      inCriteria = true;
      continue;
    }
    if (/^#{2,4} /.test(line)) {
      inCriteria = false;
      continue;
    }
    const item = /^(\d+)\.\s/.exec(line);
    if (inCriteria && requirement !== undefined && item?.[1] !== undefined)
      ids.push(`${requirement}.${item[1]}`);
  }
  return ids;
};

const featureSources = async (): Promise<
  readonly { readonly name: string; readonly text: string }[]
> => {
  const names = await readdir(FEATURE_DIR);
  return Promise.all(
    names.map(async (name) => ({
      name,
      text: await readFile(`${FEATURE_DIR}/${name}`, "utf8"),
    })),
  );
};

test("52件のAcceptance Criteriaがすべてtaskへ割り当てられている", async () => {
  const requirements = await readFile(`${SPEC_DIR}/requirements.md`, "utf8");
  const tasks = await readFile(`${SPEC_DIR}/tasks.md`, "utf8");
  const criteria = acceptanceCriteria(requirements);
  assert.equal(criteria.length, 52);

  const covered = new Set<string>();
  for (const line of tasks.split(/\r?\n/)) {
    const declared = /^\s*(?:-\s*)?_Requirements:\s*(.+?)_\s*$/.exec(line);
    if (declared?.[1] === undefined) continue;
    for (const id of declared[1].split(","))
      covered.add(id.trim().replace(/\.$/, ""));
  }
  const missing = criteria.filter((id) => !covered.has(id));
  assert.deepEqual(missing, [], "taskへ未割当のAcceptance Criteria");

  const unknown = [...covered].filter((id) => !criteria.includes(id));
  assert.deepEqual(unknown, [], "requirements.mdに存在しないrequirement参照");
});

test("成果物とspecに未解決placeholderが残っていない", async () => {
  const placeholder = /\bTODO\b|\bFIXME\b|\bTBD\b|\bXXX\b|<[a-z-]+ここに|\{\{/;
  const files = [
    ...(await featureSources()),
    ...(await Promise.all(
      ["requirements.md", "design.md", "tasks.md"].map(async (name) => ({
        name,
        text: await readFile(`${SPEC_DIR}/${name}`, "utf8"),
      })),
    )),
  ];
  for (const file of files)
    assert.doesNotMatch(
      file.text,
      placeholder,
      `${file.name} has placeholders`,
    );
});

test("feature実装が旧maintenance fence経路と通常CRUD capabilityへ到達しない", async () => {
  /** fence・generation・owner・lease・raw rootはFoundation内部の語彙である。 */
  const forbidden = [
    /\brunMaintenance\b/,
    /\bMaintenanceFence\b/,
    /\bmaintenanceFence\b/,
    /\breplaceRoot\b/,
    /\bWriteAuthority\b/,
    /\bcreateWriteAuthority\b/,
    /\bLOCAL_DATA_STORAGE_KEY\b/,
    /\bleaseExpiresAt\b/,
    /\.mutate\(/,
  ];
  for (const file of await featureSources())
    for (const pattern of forbidden)
      assert.doesNotMatch(
        file.text,
        pattern,
        `${file.name} violates ${pattern}`,
      );
});

test("backup/restoreは独立した常設navigationを要求しない", async () => {
  /** 区画はsettingsが所有するcontainerへmountされ、shellへ登録しない。 */
  const forbidden = [
    /\bnavigation\s*:/,
    /\bApplicationFeatureRegistration\b/,
    /\bFeatureRegistry\b/,
    /\bcreateFeatureRegistry\b/,
    /\bnavItem\b/,
  ];
  for (const file of await featureSources())
    for (const pattern of forbidden)
      assert.doesNotMatch(
        file.text,
        pattern,
        `${file.name} violates ${pattern}`,
      );
});
