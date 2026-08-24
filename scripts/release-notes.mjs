import { pathToFileURL } from "node:url";

/**
 * @typedef {{ readonly name: string }} IssueLabel
 * @typedef {{ readonly number: number, readonly title: string, readonly url: string, readonly labels?: readonly IssueLabel[] }} MilestoneIssue
 */

const priorityGroups = [
  { label: "enhancement", heading: "新機能・改善" },
  { label: "bug", heading: "不具合修正" },
  { label: "documentation", heading: "ドキュメント" },
];
const defaultHeading = "その他";

/** @param {MilestoneIssue} issue */
function assertValidIssue(issue) {
  if (
    issue === null ||
    typeof issue !== "object" ||
    typeof issue.number !== "number" ||
    !issue.title ||
    !issue.url
  ) {
    throw new Error(
      `each issue must have number, title, and url: ${JSON.stringify(issue)}`,
    );
  }
}

/**
 * @param {{ readonly tag: string, readonly issues: readonly MilestoneIssue[] }} input
 * @returns {string}
 */
export function renderReleaseNotes({ tag, issues }) {
  if (!Array.isArray(issues) || issues.length === 0)
    throw new Error("issues must contain at least one entry");
  for (const issue of issues) assertValidIssue(issue);

  const headings = [
    ...priorityGroups.map((group) => group.heading),
    defaultHeading,
  ];
  /** @type {Map<string, MilestoneIssue[]>} */
  const buckets = new Map(headings.map((heading) => [heading, []]));

  for (const issue of issues) {
    const labelNames = new Set(
      (issue.labels ?? []).map((/** @type {IssueLabel} */ label) => label.name),
    );
    const matched = priorityGroups.find((group) => labelNames.has(group.label));
    buckets.get(matched?.heading ?? defaultHeading)?.push(issue);
  }

  const lines = [`## ${tag}`, ""];
  for (const heading of headings) {
    const bucketIssues = buckets.get(heading) ?? [];
    if (bucketIssues.length === 0) continue;
    lines.push(`### ${heading}`);
    for (const issue of bucketIssues)
      lines.push(`- ${issue.title} ([#${issue.number}](${issue.url}))`);
    lines.push("");
  }

  return lines.join("\n");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const tagIndex = process.argv.indexOf("--tag");
  const tag = tagIndex === -1 ? undefined : process.argv[tagIndex + 1];
  if (!tag) throw new Error("--tag <tag> is required");
  const issues = JSON.parse(await readStdin());
  process.stdout.write(renderReleaseNotes({ tag, issues }));
}
