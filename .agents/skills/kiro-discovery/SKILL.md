---
name: kiro-discovery
description: Entry point for new work. Determines the best action path or work decomposition (update existing spec, create new spec, mixed decomposition, or no spec needed), refines ideas through structured dialogue, and persists new briefs or append-only existing-spec Change Briefs.
---


# Discovery

<background_information>
- **Success Criteria**:
  - Correct action path or work decomposition identified based on existing project state
  - User's intent clarified through questions, not assumptions
  - Output is an actionable next step (not just a description)
</background_information>

<instructions>

## Step 1: Lightweight Scan

Gather **only metadata** to determine the action path. Do NOT read full file contents yet.

- **Specs inventory**: Scan `.kiro/specs/*/spec.json` for `name`, `phase` fields and `approvals` status. Note feature names and their current status.
- **Steering existence**: Check which files exist in `.kiro/steering/` (product.md, tech.md, structure.md, roadmap.md). Do NOT read their contents yet.
- **Roadmap check**: If `.kiro/steering/roadmap.md` exists, read it. This contains project-level context (approach, scope, constraints, spec list) from a previous discovery session. Use it to restore project context.
- **Change Brief check**: For every existing spec named under roadmap `## Existing Spec Updates`, note whether its `brief.md` contains a matching `## Change Brief:` section. The roadmap is the global dependency plan, not a substitute for feature-local change context.
- **Top-level structure**: List the project root directory to note key directories and files. Do NOT recurse into subdirectories.

This step should consume minimal context. If `specs/` is empty and no steering exists, note "greenfield project" and move to Step 2.

## Step 2: Determine Action Path

Based on the user's request and the metadata from Step 1, determine which path applies:

**Path A: Existing spec update**
- The request is an extension, enhancement, or fix within an existing spec's domain
- Every meaningful part of the request fits that same spec boundary
- Any remaining small follow-up work can be handled directly without creating a new spec
- Continue through Steps 3-7 in **Change Brief mode**; do not create a new spec boundary

**Path B: No spec needed**
- The request is a bug fix, config change, simple refactor, or trivial addition
- No meaningful part of the request needs a new or updated spec boundary
- The request does not need to update an existing spec either
- Skip remaining steps

**Path C: New single-scope feature**
- The request is new, doesn't overlap with existing specs, and fits in one spec

**Path D: Multi-scope decomposition needed**
- The request spans multiple domains or would produce 20+ tasks in a single spec

**Path E: Mixed decomposition**
- The request contains a mix of: existing spec extensions, one or more new spec candidates, and optional direct-implementation work
- Use this path only when at least one genuinely new spec boundary is needed

For Path A/C/D/E, present the determined path (or mixed decomposition) to the user and confirm before proceeding.
For Path B, recommend direct implementation and stop.

## Step 3: Deep Context Loading

**Only for Path A, C, D, and E.** Now load the context needed for discovery.

**In main context** (essential for dialogue with user):
- **Steering documents**: Read product.md and tech.md (if they exist) for project goals, constraints, and tech stack
- **Relevant specs**: If the request is adjacent to an existing spec, read that spec's requirements.md to understand boundaries and avoid overlap
- **Existing spec brief**: For Path A and every Path E existing-spec update, read the full `brief.md` when present so the original discovery record and prior Change Briefs are preserved

**Delegate to sub-agent** (keeps exploration out of main context):
- **Codebase exploration**: Spawn a sub-agent to explore the codebase and return a structured summary. Ask it to summarize: (1) tech stack and frameworks, (2) directory structure and key modules, (3) patterns and conventions used, (4) areas relevant to the user's request. The sub-agent returns findings under 200 lines.
- For Path D/E, also ask the sub-agent to identify natural domain boundaries, existing module separation, and which areas look like existing-spec extensions vs new boundaries.
- Skip sub-agent dispatch for small/obvious requests where the top-level directory listing from Step 1 is sufficient.

**Context budget**: Keep total content loaded into main context under ~500 lines. The sub-agent handles the heavy exploration.

## Step 4: Understand the Idea

Ask clarifying questions **sequentially** (not all at once), prioritizing boundary discovery over feature detail:

1. **Who and why**: Who has the problem? What pain does it cause?
2. **Desired outcome**: What should be true when this is done?
3. **Boundary candidates**: What are the natural responsibility seams in this work? Where could this be split so implementation can proceed independently?
4. **Out of boundary**: What should this spec explicitly NOT own, even if related?
5. **Existing vs new**: Which parts seem like extensions to existing specs, and which parts look like genuinely new boundaries?
6. **Upstream / downstream**: What existing systems, specs, or components does this depend on? What future work is likely to depend on this?
7. **Constraints**: Are there technology, timeline, or compatibility constraints?

Ask only questions whose answers you cannot infer from the context already loaded. Skip questions that steering documents already answer. If the user already provided a clear description, skip to Step 5.
The goal is NOT to assign final owners yet. The goal is to discover the cleanest responsibility boundaries that can later become specs, tasks, and review scopes.

## Step 5: Propose Approaches

Propose **2-3 concrete approaches** with trade-offs:

For each approach:
- **Approach name**: One-line summary
- **How it works**: 2-3 sentences on the technical approach
- **Pros**: What makes this approach good
- **Cons**: What are the risks or downsides
- **Scope estimate**: Rough complexity (small / medium / large)

If technical research is needed (unfamiliar framework, library evaluation), spawn a sub-agent to research and return a concise summary. Ask it to compare options, check latest versions, and note known issues. Raw search results never enter the main context.

Recommend one approach and explain why.

**After the user selects an approach**, spawn a sub-agent to verify viability before proceeding to Step 6. Ask it to check: (1) Are these technologies still actively maintained? (2) Any license incompatibilities (e.g., GPL contamination)? (3) Do the components actually work together for the use case? (4) Any known showstoppers (critical bugs, security vulnerabilities, platform limitations)? Return only issues found, or "No issues found" if everything checks out.

If the viability check reveals issues, present them to the user and revisit the approach selection. If no issues, proceed to Step 6.

## Step 6: Refine and Confirm

- Address user's questions or concerns about the approaches
- Narrow scope if needed: favor smaller, deliverable increments and cleaner responsibility seams
- For Path D/E: propose work decomposition with dependency ordering
  - Each new boundary-worthy feature = one spec
  - Existing spec extensions are explicitly listed with their target spec
  - Truly small direct-implementation items are listed separately instead of being forced into a spec
  - Dependencies between specs/workstreams are explicit
  - Consider vertical slices (end-to-end value) vs horizontal layers (one layer at a time) based on the project needs
- Confirm the final direction

## Step 7: Write Files to Disk

**CRITICAL: You MUST write these files to disk BEFORE suggesting any next command. Conversation text does not survive session boundaries. If you skip this step, all discovery analysis is lost when the session ends.**

**Change Brief format for existing specs (Path A and Path E)**:

Append or update a feature-local section in `.kiro/specs/<existing-feature>/brief.md` using this structure:

```
## Change Brief: <change-id>

### Problem
[who has the problem, what pain the change addresses]

### Current State
[what the existing spec and implementation already provide, and the remaining gap]

### Desired Outcome
[what should become true after this update]

### Scope
- **In**: [what this update adds or changes]
- **Out**: [what remains outside this update]

### Boundary Impact
- **Extends**: [responsibilities added to this existing spec]
- **Preserves**: [existing responsibilities and contracts that must remain unchanged]
- **Adjacent**: [neighbor specs or modules and the seam to preserve]

### Dependencies
- **Upstream**: [work that must land first]
- **Downstream**: [work enabled or affected by this update]

### Source
- [roadmap phase, milestone, issue, or user request that created this change]
```

Change Brief rules:
- Use a stable change ID such as a milestone (`v0.4.0`) or concise kebab-case request ID.
- Preserve the original brief and every prior Change Brief; never rewrite history wholesale.
- If the same change ID already exists, update that section in place instead of appending a duplicate.
- Append new Change Briefs in chronological order so the latest section is the active requirements delta.
- If `brief.md` does not exist, create it with `# Brief: <feature-name>` followed by the Change Brief.
- Keep implementation choices out of the Change Brief unless they are hard project constraints; requirements owns WHAT and design owns HOW.

**Invalidate approvals for a changed existing spec**:

When Path A or Path E adds a new Change Brief or materially updates an existing Change Brief, update that feature's `spec.json` in the same write operation:

- Set `phase: "change-brief-created"`.
- Set `approvals.requirements.approved`, `approvals.design.approved`, and `approvals.tasks.approved` to `false`.
- Preserve every phase's existing `generated` value. The prior requirements, design, and tasks still exist as revision inputs even though they are no longer approved for the active change.
- Set `ready_for_implementation: false`.
- Update `updated_at` to the current timestamp while preserving all unrelated metadata.
- If discovery writes no semantic Change Brief difference, leave `spec.json` unchanged. An idempotent re-run must not invalidate approvals or churn timestamps.

**For Path A (existing spec update)**:

- Write or update the target spec's Change Brief and, when its content changed, invalidate the target spec's approvals as defined above.
- If roadmap.md exists and the change belongs to its current phase, add or update the matching item under `## Existing Spec Updates` without disturbing completed items or validation history.
- Do not create a new spec directory or add the existing feature under `## Specs (dependency order)`.

**For Path C (single spec)**:

Write `.kiro/specs/<feature-name>/brief.md` to disk with this structure:

```
# Brief: <feature-name>

## Problem
[who has the problem, what pain it causes]

## Current State
[what exists today, what's the gap]

## Desired Outcome
[what should be true when done]

## Approach
[chosen approach and why]

## Scope
- **In**: [what this feature includes]
- **Out**: [what's explicitly excluded]

## Boundary Candidates
- [responsibility seam 1]
- [responsibility seam 2]

## Out of Boundary
- [explicit non-goals this spec does not own]

## Upstream / Downstream
- **Upstream**: [existing systems/specs this depends on]
- **Downstream**: [likely consumers or follow-on specs]

## Existing Spec Touchpoints
- **Extends**: [existing spec(s) this work updates, if any]
- **Adjacent**: [neighbor specs or modules to avoid overlapping]

## Constraints
[technology, compatibility, or other constraints]
```

**For Path D (multi-spec decomposition)**:

Write these to disk:
- `.kiro/steering/roadmap.md`
- `.kiro/specs/<feature>/brief.md` for every feature listed under `## Specs (dependency order)`

Use this roadmap structure:

```
# Roadmap

## Overview
[Project goal and chosen approach -- 1-2 paragraphs]

## Approach Decision
- **Chosen**: [approach name and summary]
- **Why**: [key reasoning]
- **Rejected alternatives**: [what was considered and why it was rejected]

## Scope
- **In**: [what the overall project includes]
- **Out**: [what is explicitly excluded]

## Constraints
[technology, compatibility, timeline, or other project-wide constraints]

## Boundary Strategy
- **Why this split**: [why these spec boundaries improve independence]
- **Shared seams to watch**: [cross-spec boundaries needing careful review]

## Specs (dependency order)
- [ ] feature-a -- [one-line description]. Dependencies: none
- [ ] feature-b -- [one-line description]. Dependencies: feature-a
- [ ] feature-c -- [one-line description]. Dependencies: feature-a, feature-b

## Implementation Validation History

| Feature | Result | Validated at | Commit | Evidence |
|---|---|---|---|---|
```

Then write `.kiro/specs/<feature>/brief.md` for **every** feature listed under `## Specs (dependency order)` using the Path C brief format. This enables parallel spec creation via `$kiro-spec-batch`.

**For Path E (mixed decomposition)**:

Use the same roadmap structure as Path D, plus these additional sections:

```
## Existing Spec Updates
- [ ] existing-feature-a -- [one-line description of the extension]. Dependencies: none
- [ ] existing-feature-b -- [one-line description of the extension]. Dependencies: feature-a

## Direct Implementation Candidates
- [ ] small-item-a -- [why this stays direct implementation]
- [ ] small-item-b -- [why this stays direct implementation]

## Specs (dependency order)
- [ ] new-feature-a -- [one-line description]. Dependencies: none
- [ ] new-feature-b -- [one-line description]. Dependencies: new-feature-a
```

Path E rules:
- Keep `## Specs (dependency order)` reserved for **new specs only** so `$kiro-spec-batch` can still parse it unchanged
- Record existing-spec extensions under `## Existing Spec Updates`
- Record true no-spec work under `## Direct Implementation Candidates`
- Write the full `brief.md` for every **new spec** listed under `## Specs (dependency order)`
- Write or update a Change Brief for **every existing spec** listed under `## Existing Spec Updates`; each roadmap item and Change Brief must describe the same scope and dependencies
- For every existing spec whose Change Brief changed, invalidate that spec's approvals as defined above

**Re-entry (roadmap.md already exists)**:
Write the next new spec's brief.md and any newly discovered or changed existing-spec Change Briefs to disk. Update roadmap.md if scope/ordering changed, preserving completed items, prior phases, prior Change Briefs, and every existing row in `## Implementation Validation History`. Discovery creates the empty validation-history table but never adds validation records; `$kiro-record-validation` owns those append-only entries.

After writing, verify the files exist by reading them back.

## Step 8: Suggest Next Steps

Suggest the next command and stop. Do NOT automatically run downstream spec generation from this skill.

- Path A: `$kiro-spec-requirements {feature}` to integrate the latest Change Brief into the existing requirements
- Path B: Recommend direct implementation without creating a spec
- Path C: Default to `$kiro-spec-init <feature-name>`
  - Optional fast path: `$kiro-spec-quick <feature-name>` when the user explicitly wants to continue immediately
- Path D: Default to `$kiro-spec-batch` (creates all specs in parallel based on roadmap.md dependency order)
  - Optional cautious path: `$kiro-spec-init <first-feature-name>` when the user wants to validate the first slice before batching the rest
- Path E: Choose the next command based on the new-spec portion of the decomposition
  - If there is exactly one new spec: `$kiro-spec-init <new-feature-name>`
  - If there are multiple new specs: `$kiro-spec-batch`
  - Also note which existing specs now have Change Briefs ready for `$kiro-spec-requirements <feature>`
- Re-entry: `$kiro-spec-init <next-feature-name>` or `$kiro-spec-batch` if multiple specs remain

If the decomposition contains only existing-spec updates plus direct implementation candidates, do NOT use Path E. Prefer Path A when one existing spec is the clear home, or recommend the existing-spec update plus direct implementation work without creating roadmap entries.

</instructions>

## Critical Constraints
- **Files on disk are the source of continuity**: For Path A/C/D/E, write full briefs, existing-spec Change Briefs, and roadmap.md to disk as applicable before suggesting the next command. Do NOT leave discovery results only in conversation text.

## Safety & Fallback

**Roadmap Already Exists (re-entry)**:
- Read roadmap.md to restore project context before asking questions
- Determine next spec based on completed specs' status
- Write brief.md for the next spec only (just-in-time)
- Update roadmap.md if scope/ordering changed based on implementation experience
- Append new specs as a new phase if the request expands the project, don't overwrite existing content
