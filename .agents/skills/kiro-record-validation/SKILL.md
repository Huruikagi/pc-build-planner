---
name: kiro-record-validation
description: Record a successful Kiro validation checkpoint in `.kiro/steering/roadmap.md` for either a spec implementation or a direct roadmap item. Called automatically by `$kiro-validate-impl` after GO and by `$kiro-impl-direct` after its committed-state GO report; an optional work-item name is only an explicit target override.
---

# Record Implementation Validation

<instructions>

## 1. Resolve target and type

- Derive the target from the single most-recent qualifying validation report in the current conversation, or from the finalized report produced earlier in the current controller execution when that controller invokes this skill immediately.
- Accept `$1` only when it exactly matches that report's work item.
- For a spec report, require `.kiro/specs/<name>/spec.json` and set `Type=spec`.
- For a direct report, require `TYPE: direct`, `CLASSIFICATION: DIRECT_CONFIRMED`, `REVIEW: APPROVED`, and exactly one matching roadmap entry under `## Direct Implementation Candidates`; set `Type=direct`.
- Stop on ambiguity, an older report, a missing target, or a type/roadmap mismatch.

## 2. Verify eligible evidence

- Resolve the top-level verdict semantically. Normalize Unicode width, Markdown emphasis, whitespace, ASCII case, and ASCII/full-width colons.
- Match canonical tokens longest-first: `MANUAL_VERIFY_REQUIRED`, `NO-GO`, then `GO`. Allow a suffix separated by whitespace or punctuation.
- Accept only a top-level summary field; never accept a token found only in prose, command output, remediation, or a lower-level check.
- Require mechanical validation commands and exit codes plus integration/design checks for a spec report.
- Require review approval, direct classification confirmation, required validation commands, commit, and smoke status for a direct report.
- For a direct report, resolve its `COMMIT` and require it to equal the current `HEAD`; also require a clean pre-record worktree.
- Refuse unsuccessful, partial, conflicting, stale, or unverifiable evidence.
- Stop if a file-changing action occurred after the report was finalized and before this skill began. Do not re-run validation from this skill.

## 3. Capture the checkpoint

Read `.kiro/steering/roadmap.md` and use this canonical table:

```markdown
## Implementation Validation History

| Work Item | Type | Result | Validated at | Commit | Evidence |
|---|---|---|---|---|---|
```

- Add the section at the end when absent.
- If the legacy `| Feature | Result | Validated at | Commit | Evidence |` table exists, migrate its header and every existing row in place by inserting `spec` as the Type cell. Never discard, reorder, or consolidate rows.
- Capture `git rev-parse --short=12 HEAD` and use `<sha>` when clean or `<sha>+dirty` when the pre-record worktree is dirty. Direct reports already require the clean form.
- Use local ISO 8601 time with UTC offset and seconds precision.
- Summarize only evidence present in the report, including canonical commands/exit codes and smoke status. Escape table delimiters and flatten line breaks.

## 4. Append and complete

- Append exactly one row using:

```markdown
| <work-item> | <spec-or-direct> | GO | <timestamp> | `<sha-or-sha+dirty>` | <evidence> |
```

- Treat repeated successful validation as a separate event.
- For `Type=direct` only, atomically change the single matching pending roadmap checkbox from `[ ]` to `[x]` in the same edit.
- For `Type=spec`, never edit roadmap or spec task checkboxes.
- Read the roadmap back and verify the row appears once and, for direct work, the correct item alone became `[x]`.
- Report the work item, type, timestamp, commit marker, and evidence. Follow repository-local Git instructions without including unrelated changes.

</instructions>

## Safety and fallback

- Never convert uncertain evidence into `GO`.
- Never infer a commit when repository state cannot be read.
- Never record or complete a direct item when the pre-record worktree is dirty; require a clean committed implementation state.
- If a non-legacy malformed table exists, stop and describe the required repair.
