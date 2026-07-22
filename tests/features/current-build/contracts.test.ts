import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidatePartId,
  ProjectId,
  Uuid,
} from "../../../src/domain/public.js";
import { createRequestId, createRevision } from "../../../src/domain/public.js";
import type {
  BuildCommand,
  BuildError,
  BuildMutationContext,
  CurrentBuildSnapshot,
} from "../../../src/features/current-build/contracts.js";

const projectId = "10000000-0000-4000-8000-000000000001" as Uuid as ProjectId;
const candidatePartId =
  "20000000-0000-4000-8000-000000000001" as Uuid as CandidatePartId;

test("選択・数量変更・解除の操作は同じprojectとcandidatePartIdを共有する判別共用体である", () => {
  const select: BuildCommand = {
    type: "select",
    projectId,
    candidatePartId,
  };
  const setQuantity: BuildCommand = {
    type: "set-quantity",
    projectId,
    candidatePartId,
    quantity: 2,
  };
  const remove: BuildCommand = {
    type: "remove",
    projectId,
    candidatePartId,
  };

  for (const command of [select, setQuantity, remove]) {
    assert.equal(command.projectId, projectId);
    assert.equal(command.candidatePartId, candidatePartId);
  }
  assert.equal(select.type, "select");
  assert.equal(setQuantity.type, "set-quantity");
  assert.equal(remove.type, "remove");
});

test("更新contextはrequest IDと読込revisionを保持する", () => {
  const context: BuildMutationContext = {
    requestId: createRequestId(),
    expectedRevision: createRevision(0),
  };

  assert.equal(typeof context.requestId, "string");
  assert.equal(context.expectedRevision, 0);
});

test("現在構成の読取契約は構成なしを正常なnullとして表現する", () => {
  const empty: CurrentBuildSnapshot = {
    revision: createRevision(0),
    currentBuild: null,
  };
  assert.equal(empty.currentBuild, null);
});

test("失敗分類は利用者が再試行・再読込・操作停止を選べる種別を網羅する", () => {
  const kinds: readonly BuildError["kind"][] = [
    "validation",
    "not-found",
    "conflict",
    "maintenance",
    "corrupt-data",
    "unsupported-data",
    "quota",
    "storage",
  ];

  const classify = (kind: BuildError["kind"]): "retry" | "reload" | "stop" => {
    switch (kind) {
      case "conflict":
        return "reload";
      case "maintenance":
      case "quota":
      case "storage":
        return "retry";
      case "validation":
      case "not-found":
      case "corrupt-data":
      case "unsupported-data":
        return "stop";
    }
  };

  for (const kind of kinds) {
    assert.ok(["retry", "reload", "stop"].includes(classify(kind)));
  }
});
