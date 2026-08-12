---
name: kiro-impl-direct
description: Implement one no-spec work item from roadmap.md `## Direct Implementation Candidates` with boundary reclassification, tests, independent review, fresh validation, completion evidence, selective commits, and push. Use when the user names a direct roadmap item or asks to execute work intentionally classified as not requiring a new or updated spec.
---

# Direct Roadmap Implementation

<background_information>
A direct candidate is not exempt from design discipline. Its roadmap fields form a lightweight implementation contract, and the work must return to discovery if implementation reveals a user-visible or architectural responsibility change.
</background_information>

<instructions>

## Step 1: Resolve the work item

1. Require one stable item ID in `$1`.
2. Read `.kiro/steering/roadmap.md` and locate exactly one pending `[ ]` item under `## Direct Implementation Candidates`.
3. Require these indented fields:
   - `Source`
   - `Scope`
   - `Preserves`
   - `Dependencies`
   - `Validation`
4. When Source links a GitHub Issue, read it through the available GitHub integration first, then authenticated `gh` only if needed. Otherwise read the named local source or use the persisted user-request text.
5. Read core steering, directly relevant extra steering, adjacent spec requirements/design boundaries, repository instructions, and relevant code/tests.
6. Require a clean worktree with `git status --porcelain` before editing. Stop and ask the user to preserve or commit unrelated changes first; do not start a workflow that cannot reach clean committed-state validation.

Resolve dependencies as follows:

- `spec:<name>`: requirements, design, and tasks exist and are approved
- `implementation:<name>`: every executable task is checked, no blocked annotation exists, and the latest matching `Type=spec` row is clean `GO` with `Validated at` not older than the spec's `updated_at`
- `direct:<name>`: the direct item is `[x]` and the latest matching `Type=direct` row is clean `GO`
- `none`: no prerequisite

Stop on unknown, ambiguous, or unsatisfied dependencies.

## Step 2: Reclassify before editing

Confirm all of the following from current evidence:

- the item changes no new user-observable product rule
- it adds no new public contract or responsibility boundary
- it does not materially extend an existing spec's owned behavior
- it stays within one small implementation boundary
- its acceptance can be proven by the roadmap Validation field

If any check fails, make no implementation changes. Report `RECLASSIFY_TO_DISCOVERY` with the affected spec/boundary and run `$kiro-discovery` to persist the new decomposition.

Convert the roadmap entry into an in-memory Task Brief containing observable completion, allowed files or modules, preserved contracts, test-first evidence, and exact validation commands. Do not create requirements.md, design.md, or tasks.md for the direct item.

## Step 3: Implement and review

Discover canonical test, build, lint, and smoke commands from repository sources. For behavioral changes, use RED → GREEN → REFACTOR and retain the failing RED output. Configuration, documentation, dependency-only, and behavior-preserving refactors may mark RED as N/A with justification.

Implement only the Task Brief scope. Run task-local tests and checks needed to make the diff reviewable; the full roadmap Validation set runs on the committed state in Step 4. Then obtain a fresh independent review when sub-agent review is available; otherwise apply the same review in the main context. The reviewer must read the roadmap entry, adjacent specs, steering, `git diff`, and task-local validation evidence directly.

The review must return `APPROVED` or `REJECTED` and check:

- actual behavior and full Scope coverage
- preservation of every Preserves contract
- no hidden spec-worthy behavior or cross-boundary ownership
- tests would fail for a broken implementation
- no unrelated files, placeholders, secrets, or unsafe runtime changes
- task-local required commands pass with fresh exit codes, and the Step 4 committed-state validation plan covers the complete Validation field

Repair concrete findings for at most two review rounds. Use `$kiro-debug` for a blocker or repeated rejection. Stop for human/discovery review when the boundary or classification is invalid.

## Step 4: Commit implementation and validate

After approval, apply task-level `$kiro-verify-completion` with claim type `TASK`, the exact in-memory Task Brief claim, the reviewer verdict, and fresh task-local command evidence. Then:

1. Stage only files belonging to this direct item. Do not stage roadmap.md yet.
2. Commit with `fix(<item-id>): ...`, `refactor(<item-id>): ...`, `chore(<item-id>): ...`, or another semantically accurate type.
3. On the committed state, run every command in the roadmap Validation field plus relevant regression/build/smoke commands.
4. Apply `$kiro-verify-completion` with claim type `FIX` for fixes or `TASK` for other direct items.
5. Produce this qualifying report only when all checks pass:

```md
## Direct Implementation Validation
- WORK_ITEM: <item-id>
- TYPE: direct
- DECISION: GO
- REVIEW: APPROVED
- CLASSIFICATION: DIRECT_CONFIRMED
- VALIDATION: <commands and exit codes>
- SMOKE: <status>
- COMMIT: <sha>
```

If evidence is incomplete, report `NO-GO` or `MANUAL_VERIFY_REQUIRED` and leave the roadmap item pending.

## Step 5: Record completion and push

Read and follow `.agents/skills/kiro-record-validation/SKILL.md` using the report from Step 4. For a direct result it must atomically append a `Type=direct` history row and change only the matching roadmap checkbox to `[x]`.

Then:

1. Stage only `.kiro/steering/roadmap.md`.
2. Commit with `docs(roadmap): complete <item-id>`.
3. Push the implementation and roadmap commits to `origin/main` according to repository instructions.
4. Verify the item is `[x]`, its clean `GO` row exists once, the worktree is clean, and `HEAD == origin/main`.

</instructions>

## Critical Constraints

- Never use direct implementation to bypass a required spec update.
- Never infer missing Scope, Preserves, Dependencies, or Validation fields.
- Never mark `[x]` before committed-state validation and approval.
- Never combine unrelated direct items in one run or commit.
- Never use `git add .`, `git add -A`, destructive reset, or force-push.

## Safety and fallback

- **Roadmap absent**: stop and report that there is no active direct work queue; never reconstruct a released/deleted roadmap from Git history.
- **Item absent or already complete**: stop and report the exact state.
- **Classification drift**: leave the item pending and return to discovery.
- **Validation failure**: leave the item pending; do not record `GO`.
- **Pre-existing overlapping changes**: stop before editing the overlapping files.
- **Interrupted run**: re-read git history, roadmap checkbox, and validation history before resuming; never duplicate commits or rows.
