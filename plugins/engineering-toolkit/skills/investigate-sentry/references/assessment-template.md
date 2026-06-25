# Assessment Document Template

Output path: `docs/sentry-{short-id-lowercase}-assessment.md`

## Template

```markdown
# {SHORT_ID} -- Assessment & Open Questions

**Sentry issue:** [{SHORT_ID}]({sentry_url})
**Title:** `{error_title}`
**Status:** {status}, priority {priority}, substatus {substatus}
**Investigator:** {git user name from `git config user.name`}
**Date:** {today YYYY-MM-DD}

---

## TL;DR

{3-5 sentence summary: what the error is, how severe, whether it affects users,
and the recommended action. State the recommendation plainly.}

---

## What the error is

- **Source:** {file:line from stack trace}
- **Error type:** {exception class or HTTP status}
- **Platform:** {client-side / server-side / both}
- **Call pattern:** {fire-and-forget / blocking / async-awaited}
- **Transport:** {how the call is made, e.g., TanStack mutation -> Gateway -> API.post}

---

## Evidence

### Sentry ({event_count} events, {first_seen} -> {last_seen})

| Date (UTC) | User suffix | Release prefix | Browser | URL pattern |
| ---------- | ----------- | -------------- | ------- | ----------- |
{one row per event, user de-identified to last 12 chars, release truncated to 8 chars}

Distribution:
- **Releases:** {N distinct — regression signature or scattered}
- **Browsers:** {spread or concentrated}
- **Environments:** {prod only, or also QA/dev}
- **Users:** {repeat offenders or one-off, total unique}
- **Routes:** {specific route concentration or scattered}

### Infrastructure health

{Lambda health summary table from aws-cross-reference.md, or
"N/A — client-side error, no server component involved."}

### Interpretation

{Root cause hypotheses ranked by likelihood. For each:}
1. **{Theory}** — {1-2 sentence explanation with supporting evidence}
2. ...

{Note what cannot be proven from the current data and what would be needed to confirm.}

---

## Decision options

| Option | Effort | Risk | What it buys |
| ------ | ------ | ---- | ------------ |
| A. Do nothing | 0 | None | {what accepting the status quo means} |
| B. {Quick mitigation} | ~X hr | Low | {what it changes} |
| C. {Root cause fix} | ~X day | Med | {what it fixes permanently} |
| D. {Instrument for more data} | ~X hr | Low | {what it reveals} |

{Plain-English recommendation with reasoning: "My recommendation: **X**, because..."}

---

## Open questions for the team

1. {Question about user reports correlating with this pattern}
2. {Question about priority model / signal-to-noise tuning}
3. {Question about ownership}
4. {Question about related tooling or config}
...

---

## References

- Sentry issue: {url}
- {Source files with line numbers}
- {CloudWatch log groups if applicable}
- {Related Jira tickets if known}
```

## HIPAA De-identification Rules

Apply these to ALL output in the assessment:

- **User IDs**: Show only last 12 characters (e.g., `a3b62fcd88b4`), never full IDs
- **No emails or names**: Strip from Sentry user objects
- **No IP addresses**: Strip from event context
- **No request/response bodies**: May contain PHI or other sensitive user data
- **No breadcrumb payloads**: Summarize breadcrumb types and timing, not content
- **Release hashes**: First 8 characters only (sufficient for identification)
