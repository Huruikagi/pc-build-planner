---
name: kiro-record-validation
description: Record a successful Kiro implementation-validation checkpoint in `.kiro/steering/roadmap.md`. Use immediately after `$kiro-validate-impl feature-name` returns `GO` and the user wants an append-only record of the feature, validation time, Git state, and concise evidence.
---

# Record Implementation Validation

<instructions>

## 1. Resolve the validation target

- Use `$1` as the feature name when provided.
- Otherwise, derive the feature only when the current conversation contains exactly one unambiguous, most-recent `$kiro-validate-impl` report.
- Require `.kiro/specs/<feature>/spec.json` to exist. Stop if the feature is missing or ambiguous.

## 2. Verify eligible evidence

- Find the most-recent validation report for the target feature in the current conversation.
- Require the report to contain `DECISION: GO` from `$kiro-validate-impl`.
- Require its mechanical results and integration/design checks to be present; a bare user assertion that validation passed is insufficient.
- Refuse to record `NO-GO`, `MANUAL_VERIFY_REQUIRED`, incomplete, or unverifiable results.
- Stop if any file-changing action occurred after the qualifying report, because the current repository state may no longer be the validated state.
- Do not re-run `$kiro-validate-impl` from this skill. Ask the user to run it when fresh evidence is unavailable.

## 3. Capture the checkpoint

- Read `.kiro/steering/roadmap.md` and require this exact table shape:

```markdown
## Implementation Validation History

| Feature | Result | Validated at | Commit | Evidence |
|---|---|---|---|---|
```

- If the section is absent, add it at the end of the roadmap without changing roadmap checklist lines or ordering.
- Capture the current commit with `git rev-parse --short=12 HEAD`.
- Inspect `git status --porcelain`. Use `<sha>` when clean and `<sha>+dirty` when any tracked or untracked change exists before adding the record.
- Use the local system time at skill execution, including its UTC offset, in ISO 8601 seconds precision: `YYYY-MM-DDTHH:mm:ss+HH:mm`.
- Summarize evidence from the qualifying report in one line. Include the canonical validation command and exit code when reported, plus smoke status. Do not invent missing evidence.
- Escape Markdown table delimiters in cell values and replace line breaks with spaces.

## 4. Append and verify

- Append one row; never overwrite, reorder, or consolidate older validation records.
- Treat a repeated successful validation as a separate event, even when feature and commit match an earlier row.
- Read the roadmap back and verify the exact row is present once.
- Report the recorded feature, timestamp, commit marker, and evidence.
- Follow repository-local Git instructions after writing. Never include unrelated changes in a commit.

Use this row format:

```markdown
| <feature> | GO | <ISO 8601 timestamp> | `<sha-or-sha+dirty>` | <concise evidence> |
```

</instructions>

## Safety and fallback

- Never convert an unsuccessful or uncertain validation into `GO`.
- Never infer the validated commit when repository state cannot be read.
- Never edit spec task checkboxes as part of recording.
- If the roadmap table is malformed, stop and describe the required repair instead of guessing where to append.
