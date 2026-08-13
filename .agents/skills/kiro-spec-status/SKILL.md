---
name: kiro-spec-status
description: Show specification status and progress, or report a structured direct roadmap item's dependency, validation, and completion state when the requested name is not a spec.
---


# Specification Status

<background_information>
- **Success Criteria**:
  - Show current phase and completion status
  - Identify next actions and blockers
  - Provide clear visibility into progress
  - Surface boundary readiness, upstream/downstream context, and likely revalidation needs when available
</background_information>

<instructions>
## Execution Steps

### Step 1: Load Spec Context
- First read `.kiro/steering/roadmap.md` when it exists. If `$1` is not a spec directory but exactly matches an item under `## Direct Implementation Candidates`, use Direct Item mode below.
- Read `.kiro/specs/$1/spec.json` for metadata and phase status
- Read `.kiro/specs/$1/brief.md` if it exists
- Read existing files: `requirements.md`, `design.md`, `tasks.md` (if they exist)
- Check `.kiro/specs/$1/` directory for available files
- Read `.kiro/steering/roadmap.md` if it exists and this spec appears in it
- From roadmap.md, read the `## Implementation Validation History` section if present and collect every row whose Work Item cell matches `$1`; accept legacy Feature tables as `Type=spec`

### Direct Item mode

- Read Source, Scope, Preserves, Dependencies, Validation, and checkbox state.
- Resolve each dependency using the same `spec:`, `implementation:`, and `direct:` rules as `$kiro-impl-direct`.
- Report whether the item is ready, blocked, completed, or missing required fields.
- Show matching `Type=direct` validation rows and treat `+dirty`, missing, or mismatched-type rows as invalid completion evidence.
- Recommend `$kiro-impl-direct <item-id>` only when the item is pending, structurally complete, and dependency-ready.

### Step 2: Analyze Status

**Parse each phase**:
- **Requirements**: Count requirements and acceptance criteria
- **Design**: Check for architecture, components, diagrams, and whether boundary sections are present
- **Tasks**: Count completed vs total tasks (parse `- [x]` vs `- [ ]`)
- **Approvals**: Check approval status in spec.json
- **Boundary context**:
  - From brief.md: note `Boundary Candidates`, `Upstream / Downstream`, and `Existing Spec Touchpoints` if present
  - From design.md: note `Boundary Commitments`, `Out of Boundary`, `Allowed Dependencies`, and `Revalidation Triggers` if present
  - From roadmap.md: note upstream dependencies and whether this spec is adjacent to `Existing Spec Updates`
- **Validation history**:
  - Report the matching rows as recorded; the roadmap is reset per release, so treat them as the current milestone's record only
  - Do not compare the recorded commit against the current `HEAD`. Within a milestone almost any later commit would make the comparison fire, so it carries no signal
  - Note when tasks are fully checked off but no validation row exists for this spec
  - Treat a row whose commit cell ends with `+dirty` as a blocker: the validated repository state was not committed
  - Note when multiple rows exist for this spec, which indicates repeated validation
- **Revalidation watchlist**:
  - Identify downstream specs, neighboring existing-spec updates, or rollout-sensitive design notes that may need revalidation if this spec changes
  - Call out when the current spec shape looks too broad and may want roadmap/design splitting instead of more local repair

### Step 3: Generate Report

In Direct Item mode, use the roadmap/user language and report: checkbox state, required fields, dependency readiness, matching validation evidence, classification risks, next command, and blockers. Do not fabricate spec phase percentages.

Create report in the language specified in spec.json covering:
1. **Current Phase & Progress**: Where the spec is in the workflow
2. **Completion Status**: Percentage complete for each phase
3. **Task Breakdown**: If tasks exist, show completed/remaining counts
4. **Boundary Context**: Upstream/downstream, out-of-boundary, and allowed dependency notes when available
5. **Validation History**: Latest recorded `/kiro-record-validation` result for this work item (type, result, timestamp, commit marker, evidence), or "not recorded in this milestone" when absent
6. **Revalidation Watchlist**: Downstream or adjacent work likely affected by changes to this spec
7. **Next Actions**: What needs to be done next
8. **Blockers**: Any issues preventing progress

</instructions>

## Safety & Fallback

### Error Scenarios

**Spec Not Found**:
- **Message**: "No spec or direct roadmap item found for `$1`."
- **Action**: List available spec directories and direct item IDs

**No Validation History**:
- **Behavior**: When the roadmap has no `## Implementation Validation History` section, or no row matches this spec, report validation as not recorded for this milestone
- **Action**: Do not treat this as an error; suggest `/kiro-validate-impl` when tasks are complete because a successful GO checkpoint is recorded automatically

**Incomplete Spec**:
- **Warning**: Identify which files are missing
- **Suggested Action**: Point to next phase command

### List All Specs

To see all available specs:
- Run with no argument or use wildcard
- Shows all specs in `.kiro/specs/` with their status
