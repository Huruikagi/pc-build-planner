import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPEC_BIND_REPOSITORY = "Huruikagi/specbind";
const DOGFOODING_LABEL = "dogfooding";

const input = await readInput();

if (input === null) {
  process.exit(0);
}

const markerPath = markerPathFor(input);

if (input.hook_event_name === "PostToolUse") {
  if (usedSpecBind(input)) {
    await mkdir(join(tmpdir(), "pc-build-planner-specbind-debrief"), {
      recursive: true,
    });
    await writeFile(
      markerPath,
      JSON.stringify({
        session_id: input.session_id,
        turn_id: input.turn_id,
        recorded_at: new Date().toISOString(),
      }),
      "utf8",
    );
  }

  process.exit(0);
}

if (input.hook_event_name !== "Stop" || input.stop_hook_active === true) {
  process.exit(0);
}

if (!(await consumeMarker(markerPath))) {
  process.exit(0);
}

process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason: [
      "SpecBindのドッグフーディングをデブリーフしてください。これは完了したターンの事後評価であり、新しい実装作業ではありません。",
      "このターンですでに得た情報だけを使ってください。ローカルの追加調査、SpecBind CLIの再実行、ファイル変更は行わないでください。",
      "SpecBind CLI、実行したspecbind-* Skill、Rule、テンプレート、プロトコルについて、具体的で再現可能な摩擦があれば抽出してください。",
      "各所見を product_issue、agent_mistake、project_specific のいずれかに分類してください。agent_mistakeとproject_specificはGitHubへ送信しません。",
      `product_issueごとに ${SPEC_BIND_REPOSITORY} のopen/closed Issueを重複検索し、同じ問題があれば新規作成せずそのURLを報告してください。`,
      `重複がなければ、1所見につき1件のIssueを ${SPEC_BIND_REPOSITORY} に作成してください。現行契約に反する再現可能な挙動は bug、それ以外の操作性・回復性の改善は enhancement とし、そのラベルと ${DOGFOODING_LABEL} ラベルの両方を付けます。`,
      "Issue本文はSpecBindのBug reportまたはImprovement proposalと同等の見出しで、再現手順、期待結果、実際の結果、回避策、影響を含めてください。バージョンなど未取得の値は推測せずunknownとします。",
      "非公開情報、シークレット、pc-build-planner固有で再現に不要な内容を除去し、末尾に『Detected during maintainer-operated dogfooding in pc-build-planner.』と記載してください。",
      "このデブリーフで許可される追加ツール実行は、GitHubでの重複検索とIssue作成だけです。Issueのコメント、編集、クローズ、その他の外部書き込みは行いません。",
      "具体的なproduct_issueがなければ『SpecBindデブリーフ: 追加の所見なし。』とのみ報告してください。Issueを作成した場合は、最終報告に各URLを含めてください。",
    ].join("\n"),
  }),
);

async function readInput() {
  let raw = "";

  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function markerPathFor(input) {
  const identity = `${input.session_id ?? "unknown"}\0${input.turn_id ?? "unknown"}`;
  const key = createHash("sha256").update(identity).digest("hex");
  return join(tmpdir(), "pc-build-planner-specbind-debrief", `${key}.json`);
}

function usedSpecBind(input) {
  const command = input.tool_input?.command ?? input.tool_input?.cmd;

  if (typeof command !== "string") {
    return false;
  }

  const invokedCli =
    /(?:^|[\r\n;&|]\s*)["']?specbind(?:\.exe)?(?=\s|["']|$)/imu.test(
      command,
    );
  const readSkill =
    /[\\/]\.agents[\\/]skills[\\/]specbind-[^\\/]+[\\/]SKILL\.md/iu.test(
      command,
    );

  return invokedCli || readSkill;
}

async function consumeMarker(path) {
  try {
    await readFile(path, "utf8");
    await rm(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
