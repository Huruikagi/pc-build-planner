import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectId, UtcTimestamp } from "../../src/domain/public.js";
import type { ProjectCatalogItem } from "../../src/project-context/contracts.js";
import {
  describeProjectLifecycleMessages,
  type ProjectLifecycleMessageDescriptor,
  type ProjectLifecycleMessageResolver,
} from "../../src/project-context/lifecycle-message-descriptors.js";
import type { ProjectLifecycleStateSnapshot } from "../../src/project-context/lifecycle-state.js";

const A = "11111111-1111-4111-8111-111111111111" as ProjectId;
const updatedAt = "2026-08-13T01:00:00.000Z" as UtcTimestamp;
const projects: readonly ProjectCatalogItem[] = [
  { id: A, name: "Markup <project>", updatedAt },
];

const snapshot = (
  overrides: Partial<ProjectLifecycleStateSnapshot> = {},
): ProjectLifecycleStateSnapshot => ({
  nameInput: "",
  editingProjectId: null,
  deletion: null,
  pending: false,
  fieldError: null,
  error: null,
  ...overrides,
});

test("base lifecycle state exposes list/create and rename intents without message keys", () => {
  assert.deepEqual(
    describeProjectLifecycleMessages({ snapshot: snapshot(), projects }),
    [
      { intent: "project-list" },
      { intent: "create-project" },
      { intent: "rename-project", projectName: "Markup <project>" },
    ],
  );
});

test("delete confirmation fixes the target name and owned-candidate impact", () => {
  assert.deepEqual(
    describeProjectLifecycleMessages({
      snapshot: snapshot({
        deletion: { projectId: A, projectName: "Original name" },
      }),
      projects,
    }),
    [
      { intent: "project-list" },
      { intent: "create-project" },
      { intent: "rename-project", projectName: "Markup <project>" },
      {
        intent: "confirm-delete",
        projectName: "Original name",
        impact: "owned-candidates",
      },
    ],
  );
});

test("validation, stable mutation failures, pending operation, and refresh retry have distinct trigger conditions", () => {
  assert.deepEqual(
    describeProjectLifecycleMessages({
      snapshot: snapshot({
        pending: true,
        fieldError: "required",
        error: { kind: "conflict" },
      }),
      projects: [],
      operation: "rename",
    }),
    [
      { intent: "project-list" },
      { intent: "create-project" },
      { intent: "name-required" },
      { intent: "operation-failed", reason: "conflict" },
      { intent: "operation-pending", operation: "rename" },
    ],
  );

  for (const reason of [
    "not-found",
    "conflict",
    "maintenance",
    "storage",
    "quota",
    "unsupported-data",
    "operation-in-progress",
  ] as const) {
    assert.deepEqual(
      describeProjectLifecycleMessages({
        snapshot: snapshot({ error: { kind: reason } }),
        projects: [],
      }).find(({ intent }) => intent === "operation-failed"),
      { intent: "operation-failed", reason },
    );
  }

  for (const operation of ["create", "rename", "delete", "refresh"] as const) {
    assert.deepEqual(
      describeProjectLifecycleMessages({
        snapshot: snapshot({ pending: true }),
        projects: [],
        operation,
      }).at(-1),
      { intent: "operation-pending", operation },
    );
  }

  assert.deepEqual(
    describeProjectLifecycleMessages({
      snapshot: snapshot({ error: { kind: "committed-refresh-failed" } }),
      projects: [],
    }),
    [
      { intent: "project-list" },
      { intent: "create-project" },
      {
        intent: "operation-failed",
        reason: "committed-refresh-failed",
      },
      { intent: "retry-refresh" },
    ],
  );
});

test("resolver consumer port receives the semantic descriptor unchanged", () => {
  const received: unknown[] = [];
  const resolver: ProjectLifecycleMessageResolver = {
    resolve(descriptor) {
      received.push(descriptor);
      return descriptor.intent;
    },
  };
  const [descriptor] = describeProjectLifecycleMessages({
    snapshot: snapshot({ pending: true }),
    projects: [],
    operation: "refresh",
  }).filter(({ intent }) => intent === "operation-pending");

  assert.notEqual(descriptor, undefined);
  if (descriptor === undefined) return;
  assert.equal(resolver.resolve(descriptor), "operation-pending");
  assert.deepEqual(received, [
    { intent: "operation-pending", operation: "refresh" },
  ]);
});

test("presentation action intents keep confirm/cancel and create/rename actions semantically distinct", () => {
  const descriptors: ProjectLifecycleMessageDescriptor[] = [
    { intent: "confirm-delete-action" },
    { intent: "cancel-delete" },
    { intent: "cancel-rename" },
    { intent: "create-project-action" },
    { intent: "save-project-name-action" },
  ];
  assert.equal(
    new Set(descriptors.map(({ intent }) => intent)).size,
    descriptors.length,
  );
});
