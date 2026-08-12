---
name: kiro-spec-update-batch
description: Update every pending existing specification listed in roadmap.md by dependency wave, merging the latest Change Brief into requirements, design, and tasks without reinitializing the spec. Use after kiro-spec-batch for mixed roadmaps, or whenever `## Existing Spec Updates` contains multiple pending entries that need one final cross-spec consistency review.
---

# Existing Spec Update Batch

<background_information>
- **Success Criteria**:
  - Every pending existing-spec update has a matching feature-local Change Brief
  - Requirements, design, and tasks are revised in merge mode without losing unaffected approved behavior
  - Dependency ordering is respected and independent updates run in parallel when available
  - New specs and updated existing specs pass one final roadmap-wide consistency review
  - Direct implementation candidates remain outside spec ownership
</background_information>

<instructions>

## Step 1: Validate the update set

1. Read `.kiro/steering/roadmap.md` and parse `## Existing Spec Updates`.
2. For each pending `[ ]` entry, extract its stable feature name, description, and `Dependencies`.
3. Require `.kiro/specs/<feature>/spec.json`, `brief.md`, `requirements.md`, `design.md`, and `tasks.md` to exist.
4. Require the latest `## Change Brief:` in `brief.md` to match the roadmap item's scope and dependencies. Stop that item if the delta is missing, stale, or contradictory; do not infer it from the one-line roadmap entry.
5. Confirm the update's approvals are invalidated (`phase: change-brief-created`, affected approvals false, `ready_for_implementation: false`) unless the same update was already regenerated and is resumable.
6. Read `## Specs (dependency order)` and `## Direct Implementation Candidates` only for dependency and boundary context.
7. Run `git status --porcelain` and inspect `git diff` before dispatch. Build a narrow accepted baseline and never revert or overwrite it:
   - Accept discovery handoff changes in a pending existing-update directory only when the diff is limited to the matching latest Change Brief in `brief.md` plus the prescribed approval invalidation/timestamp fields in `spec.json`.
   - Accept a newly created or discovery-updated `roadmap.md` only when every changed Existing Spec Update matches a feature-local Change Brief, every direct candidate has all five required fields, dependency names resolve, completed/history content is preserved, and no unrelated roadmap section changed. Treat this proven discovery roadmap as the batch input baseline.
   - Accept same-Change-Brief interrupted regeneration only when Step 3.8 can prove from disk which phases integrated that exact Change Brief; resume from the first unproved phase and rerun its review gate.
   - Accept uncommitted new-spec directories and roadmap changes from the immediately preceding `$kiro-spec-batch` only when every such spec is complete/approved and the roadmap diff changes only `[ ]` to `[x]` under `## Specs (dependency order)`.
   - Preserve and ignore unrelated dirty files outside roadmap and participating spec directories; never stage them. Stop on overlapping unexplained spec-document changes, uncorroborated roadmap scope/dependency edits, unexpected existing/direct checklist changes, or validation-history changes.
8. Verify every roadmap entry under `## Specs (dependency order)` has `spec.json`, requirements, design, and tasks generated and approved. Do not continue to final review while any new spec is incomplete or failed.

Dependencies use globally unique work-item names:

- `spec:<name>` requires requirements, design, and tasks generated and approved for the current spec metadata.
- `implementation:<name>` requires every executable task checked, no blocked annotation, and the latest matching `Type=spec` history row to be clean `GO` with `Validated at` not older than the spec's `updated_at`.
- `direct:<name>` requires the direct checkbox `[x]` and the latest matching `Type=direct` row to be clean `GO`.
- Bare names in this specification-preparation skill mean `spec:<name>`.

If the roadmap contains existing-update entries but none are pending, skip regeneration and run Step 4 as an idempotent final-review pass. If the section is absent or empty, report that this skill has nothing to update.

## Step 2: Build dependency waves

Build waves from pending existing updates:

- Wave 1: all dependencies are already satisfied
- Wave N: all remaining dependencies are satisfied by earlier waves or existing completed work

Reject cycles, unknown dependency names, and implementation dependencies without clean `GO` evidence. Show the plan before execution, including deferred direct implementation candidates.

## Step 3: Update each wave

For every feature in a wave, dispatch one sub-agent when parallel agent work is available. Otherwise process sequentially. Give each agent ownership of only `.kiro/specs/<feature>/` and tell it not to revert other agents' changes.

The agent must:

1. Read the feature's `spec.json`, full `brief.md`, current `requirements.md`, `design.md`, and `tasks.md`.
2. Read roadmap context and relevant steering files.
3. Read and follow these skills in order:
   - `.agents/skills/kiro-spec-requirements/SKILL.md`
   - `.agents/skills/kiro-spec-design/SKILL.md`
   - `.agents/skills/kiro-spec-tasks/SKILL.md`
4. Never run `kiro-spec-init`; this is an in-place revision.
5. Integrate only the latest Change Brief delta while preserving unaffected requirements, numbering where possible, prior implementation notes, and approved behavior outside the delta.
6. After requirements generation and its review gate pass, explicitly set requirements approved before design. Run design with `-y`; after its review gate passes, run tasks with `-y`. Do not defer approvals until the end of the pipeline.
7. Set generated and approved flags for requirements, design, and tasks to true, set `phase: tasks-generated`, set `ready_for_implementation: true`, and update the timestamp consistently.
8. Make the current documents explicitly identify the integrated latest Change Brief ID in their change/integration context. On resume, accept a feature as already regenerated only when the latest Change Brief ID, full In-scope traceability, all Out-of-scope preservation checks, approvals, and metadata are provable from disk; otherwise regenerate it safely.
9. Report changed files, coverage of every Change Brief In-scope item, and preservation of every Out-of-scope item.

After the wave completes:

1. Verify all required spec files and metadata.
2. Keep successfully regenerated entries `[ ]` until the final roadmap-wide review passes; track wave success in controller state and on-disk spec evidence, not premature roadmap completion.
3. Leave failed entries pending, report them, and continue with other independent entries.
4. Do not start a dependent wave when its prerequisite failed.

## Step 4: Run the final roadmap-wide review

Run one fresh `spec-reviewer` sub-agent when available. Review the planned end state, not only files generated by this skill:

- requirements and design for every entry in `## Specs (dependency order)` and `## Existing Spec Updates`
- `_Boundary:` and `_Depends:` lines from their tasks files
- structured Scope, Preserves, Dependencies, and Validation fields from `## Direct Implementation Candidates`
- the complete roadmap

Check:

1. Data-model and interface alignment
2. Dependency completeness and direction
3. Duplicate functionality and shared ownership
4. Naming and file-path consistency
5. Task boundary overlap
6. Change Brief coverage and preserved behavior
7. Direct candidates have not been absorbed into a spec
8. Direct candidates still qualify for no-spec implementation
9. Revalidation triggers cover downstream impact
10. The complete decomposition remains independently executable

For important local issues, dispatch a fresh fixing agent for each affected spec. The fixer must use the same requirements/design/tasks phase skills, invalidate and reapprove affected downstream phases in order, and leave roadmap checkboxes pending. Re-run the independent review, up to three remediation rounds. The review-only `spec-reviewer` never edits files. For decomposition problems, leave all entries pending and return to `$kiro-discovery` instead of patching around them.

## Step 5: Finalize

- After the final review passes, mark all successfully regenerated and reviewed existing-update entries complete in one roadmap edit. Never mark an entry complete before this gate.
- Never mark direct implementation candidates complete.
- Preserve all validation-history rows.
- Report one of:
  - `ROADMAP_SPECS_READY`: all new and updated specs are ready and final review passed
  - `PARTIAL`: independent items succeeded but failures or blocked dependencies remain
  - `BLOCKED_FOR_DISCOVERY`: the decomposition must change
- List pending direct candidates and recommend `$kiro-impl-direct <item-id>` only after their dependencies are satisfied.
- After a passed final review, report the exact changed files and verification result. Commit or push specification artifacts only when repository-local instructions explicitly cover spec-document changes or the user explicitly requested publication; when authorized, stage only affected spec directories and roadmap.md and preserve the accepted upstream baseline.

</instructions>

## Critical Constraints

- Never initialize or rename an existing spec.
- Never overwrite a full spec from only a roadmap summary.
- Never treat an existing `tasks.md` as proof that the latest Change Brief was integrated.
- Never claim final cross-spec consistency before both new-spec generation and existing-spec updates are included.
- Never implement production code from this skill.
- Never use a roadmap checkbox as the only resumability signal; verify the latest Change Brief integration from spec files and metadata.

## Safety and fallback

- **Missing Change Brief**: leave the item pending and run `$kiro-discovery` for that feature.
- **Missing roadmap**: stop and report that no active roadmap batch exists; do not reconstruct a released/deleted roadmap from Git history.
- **Dirty overlapping files**: do not dispatch parallel writers for the same spec or shared file.
- **No multi-agent support**: process each wave sequentially and perform the same review in a fresh local pass when possible.
- **All updates complete but review missing**: run Step 4 without regenerating unchanged specs.
