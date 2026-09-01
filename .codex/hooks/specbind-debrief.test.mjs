import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const hookPath = fileURLToPath(
  new URL("./specbind-debrief.mjs", import.meta.url),
);

test("ignores malformed input", () => {
  const result = runHook("not-json");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("ignores turns that did not use SpecBind", () => {
  const identity = turnIdentity();

  runHook({
    ...identity,
    hook_event_name: "PostToolUse",
    tool_input: { command: "git status --short" },
  });

  const stopped = runHook({ ...identity, hook_event_name: "Stop" });
  assert.equal(stopped.status, 0);
  assert.equal(stopped.stdout, "");
});

test("requests one debrief after SpecBind CLI use", () => {
  const identity = turnIdentity();

  runHook({
    ...identity,
    hook_event_name: "PostToolUse",
    tool_input: { command: "specbind milestone status" },
  });

  const firstStop = runHook({ ...identity, hook_event_name: "Stop" });
  assert.equal(firstStop.status, 0);

  const response = JSON.parse(firstStop.stdout);
  assert.equal(response.decision, "block");
  assert.match(response.reason, /Huruikagi\/specbind/);
  assert.match(response.reason, /dogfooding/);
  assert.match(response.reason, /product_issue/);

  const secondStop = runHook({ ...identity, hook_event_name: "Stop" });
  assert.equal(secondStop.status, 0);
  assert.equal(secondStop.stdout, "");
});

test("detects reads of installed SpecBind Skills", () => {
  const identity = turnIdentity();

  runHook({
    ...identity,
    hook_event_name: "PostToolUse",
    tool_input: {
      cmd: "Get-Content G:\\fixture\\.agents\\skills\\specbind-plan\\SKILL.md",
    },
  });

  const stopped = runHook({ ...identity, hook_event_name: "Stop" });
  assert.equal(JSON.parse(stopped.stdout).decision, "block");
});

test("does not consume the marker during an active Stop hook", () => {
  const identity = turnIdentity();

  runHook({
    ...identity,
    hook_event_name: "PostToolUse",
    tool_input: { command: "& specbind --version" },
  });

  const recursiveStop = runHook({
    ...identity,
    hook_event_name: "Stop",
    stop_hook_active: true,
  });
  assert.equal(recursiveStop.stdout, "");

  const finalStop = runHook({ ...identity, hook_event_name: "Stop" });
  assert.equal(JSON.parse(finalStop.stdout).decision, "block");
});

function turnIdentity() {
  return {
    session_id: randomUUID(),
    turn_id: randomUUID(),
  };
}

function runHook(input) {
  return spawnSync(process.execPath, [hookPath], {
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input),
  });
}
