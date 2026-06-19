---
description: Investigate a Sentry issue — fetch events, aggregate patterns, cross-reference AWS, produce assessment doc with decision matrix.
---

# Investigate Sentry: $ARGUMENTS

Investigate a Sentry issue and produce a structured assessment document.

**Usage:**
```bash
/investigate-sentry APP-2Y                        # By short ID
/investigate-sentry APP-2Y --skip-aws             # Skip CloudWatch cross-reference
/investigate-sentry https://<your-org>.sentry.io/issues/1234567890/  # By URL
```

## Execution

Use the `/etk:investigate-sentry` skill to execute the full investigation workflow:

1. **Parse** — Extract short ID or numeric ID from `$ARGUMENTS`, detect flags
2. **Authenticate** — Retrieve Sentry token via `op` CLI or `$SENTRY_AUTH_TOKEN`
3. **Fetch** — Pull issue metadata, events (up to 100), and tag distributions from Sentry API
4. **Aggregate** — Build event timeline, distribution analysis, pattern detection
5. **AWS cross-ref** — CloudWatch Lambda metrics if server-side (skip with `--skip-aws`)
6. **Synthesize** — Root cause hypotheses, decision matrix, open questions
7. **Write** — Assessment doc to `docs/sentry-{short-id}-assessment.md`
8. **Present** — TL;DR + recommendation + next steps

## Output

```markdown
## Investigation Complete: {SHORT_ID}

**TL;DR**: {3-line summary}
**Recommendation**: {plain-English recommendation}
**Assessment**: `docs/sentry-{short-id}-assessment.md`

**Next steps**:
- Share assessment with team for decision
- `/fix-bug` if fix approved (root cause from this investigation)
- Instrumentation option if more data needed
```

## Complementary Commands

| Command | When to use |
|---------|-------------|
| `/fix-bug` | Fix the bug after investigation |
| `/review-mr` | Review the fix MR |
| `/verify` | Confirm the fix passes |
