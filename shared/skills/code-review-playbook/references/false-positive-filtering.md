# False Positive Filtering Rules

Three filters applied to every finding BEFORE reporting. These reduce noise and prevent double-reporting of issues already caught by automated tools.

## Filter 1: Linter-Catchable

**Rule**: If Phase 3 automated checks (ruff, biome, tsc) already catch this exact issue, do not re-report it as an agent finding.

**Action**: Set confidence to 50 (below default threshold -> filtered out).

**Rationale**: Phase 3 runs ruff-check, biome-check, and tsc builds. Double-reporting the same lint error adds noise without value.

**Examples**:
- ruff already reports `F401 unused import` at line 5 -> agent should NOT also flag it
- biome already reports `noUnusedVariables` -> agent should NOT also flag it
- tsc build error for type mismatch -> agent should NOT also flag the same type issue

**Exception (context)**: If the agent finding adds context beyond what the linter reports (e.g., "this unused import was the auth middleware -- removing it breaks authorization"), report with original confidence and note the additional context.

**Exception (security)**: `security` label findings are **NEVER** filtered by Filter 1 — consistent with the security exemptions in Filters 2, 3, and 4. A linter can surface a security-shaped issue too, but a real injection or sensitive-data exposure keeps its original confidence rather than being downgraded to 50 (which would drop it below the default threshold).

## Filter 2: Pre-Existing Code

**Rule**: Only flag lines that are part of the current diff. Never flag unchanged lines.

**Verification**:
```bash
git diff main...HEAD -- <file>
```

**Action**: If the flagged line is NOT in the diff output, set confidence to 30 (filtered out).

**Rationale**: Reviewing pre-existing code in an MR review creates noise and discourages small, focused changes. Pre-existing issues should be addressed in separate cleanup MRs.

**Examples**:
- Agent spots a bare `except:` at line 40, but `git diff` shows line 40 was not modified -> confidence 30
- Agent finds missing type hint on a function signature that the MR did not touch -> confidence 30

**Exception**: If pre-existing code has a **security** issue that the current MR makes exploitable (e.g., adding a new endpoint that calls a pre-existing function with SQL injection), report with original confidence.

## Filter 3: Intentional Suppression

**Rule**: If the flagged code has an explicit suppression marker, assume the original author made a deliberate choice.

**Markers recognized**:
- Python: `# noqa`, `# type: ignore`, `# pylint: disable`
- TypeScript: `// @ts-ignore`, `// @ts-expect-error`, `// eslint-disable`
- Domain-specific: `# tenant-isolation-exempt`, `# sensitive-data-logging-exempt`

**Action**: Set confidence to 40 (filtered out at default threshold).

**Exception**: `security` label findings are NEVER filtered by intentional suppression. A `# noqa` comment does not excuse a SQL injection vulnerability or sensitive data exposure.

**Examples**:
- `query = f"SELECT * FROM users WHERE id = {user_id}"  # noqa: S608`
  - If agent labels it `suggestion` -> confidence 40 (filtered)
  - If agent labels it `security [blocking]` -> keep original confidence (exception applies)

## Filter 4: Skip-Path Globs (repo-configured)

**Rule**: If the flagged file path matches any glob in the `skip_paths` array of `.claude/policies/review-policy.json`, DROP the finding before reporting. This targets generated or vendored code the team has chosen not to review (e.g. `src/gen/**`, `*.lock`, `vendor/**`, `**/*.generated.ts`). (G2, CC-alignment audit 2026-06-01)

**Verification**:
```bash
# skip_paths defaults to [] (no paths skipped) when absent
SKIP_PATHS=$(jq -r '.skip_paths // [] | .[]' .claude/policies/review-policy.json 2>/dev/null)
# For each glob, test the finding's File:Line path against it (shell glob / fnmatch semantics)
```

**Action**: If the path matches a configured glob, DROP the finding entirely (do not surface it; count it in the filtered tally).

**Rationale**: `skip_paths` is **repo-configured** noise suppression for code the team does not own or hand-edits — generated bundles, lockfiles, vendored deps. It **complements** (does not replace) Filter 2's diff-scoping: Filter 2 drops lines not in the diff; `skip_paths` drops whole files the repo has opted out of, even when they appear in the diff.

**Exception**: `security` label findings are **NEVER** skipped by `skip_paths` — consistent with the security exemptions in Filters 2 and 3. A SQL injection or leaked secret in `src/gen/**` is still a blocker, regardless of whether the file is generated.

**Examples**:
- `skip_paths: ["src/gen/**", "*.lock"]`; agent flags a `suggestion` in `src/gen/api-client.ts:88` -> dropped (generated code).
- Same config; agent flags `security [blocking]` (hardcoded token) in `src/gen/api-client.ts:90` -> kept (security exemption).

## Security-finding precedents (what is NOT a vulnerability)

Filters 1–4 **exempt** `security` findings from being downgraded — so a *real* vuln always survives. This section is the complement: a curated set of precedents for what does **not** count as a real security finding in the first place, so the Security agent doesn't manufacture high-confidence noise. Adapted from Anthropic's bundled `/security-review` precedents (extracted 2026-07-10; see `docs/reviews/2026-07-10_anthropic-review-skills-vs-etk.md`). Apply these **before** labeling a finding `security`; only raise a `security` finding with a **concrete, exploitable attack path** (author's confidence ≥ 80%).

A finding is **not** a security vulnerability when it is only:

1. **Denial-of-service / resource exhaustion** (memory, CPU, file descriptors, rate-limiting) — out of scope; report as `issue`/`suggestion` if it matters, not `security`.
2. **Framework-safe XSS.** React and Angular escape by default — do **not** raise XSS on `.tsx`/component code unless it uses `dangerouslySetInnerHTML`, `bypassSecurityTrustHtml`, or equivalent unsafe escape hatch.
3. **Client-side authz / validation "gaps."** Missing auth or input validation in client-side JS/TS is not a vuln — the server is responsible. The same applies to any untrusted data sent to a backend: backend validation is the control.
4. **Trusted inputs.** Environment variables and CLI flags are trusted in a secure environment; an attack that relies on controlling them is invalid. UUIDs may be assumed unguessable and need no validation.
5. **Non-security logging.** Logging URLs or non-PII data is safe; only flag logging that exposes secrets, passwords, or PII. Log-spoofing (unsanitized user input in logs) is not a vuln.
6. **Theoretical timing/races** with no concrete, practical trigger; **path-only SSRF** (SSRF matters only when host or protocol is controllable); **regex injection / ReDoS**; outdated third-party deps (managed separately).
7. **Memory-safety issues in memory-safe languages** (buffer overflow / use-after-free in Rust/JS/Python/Go — not applicable).
8. **Test-only / docs-only code** — findings in unit-test files or markdown/docs are not vulnerabilities.

When in doubt on a **security** label, prefer a concrete downgrade to `issue` over a speculative `security [blocking]` — but never suppress a finding with a nameable exploit path.

## Application Order

Filters are applied in order. The FIRST matching filter sets the confidence; Filter 4 is a hard DROP that runs last. The security-finding precedents above are a **validity gate** applied when an agent is deciding whether to label a finding `security` — they run before the exemptions in Filters 1–4 take effect:

1. Linter-catchable (and NOT `security`)? -> confidence 50
2. Pre-existing? -> confidence 30
3. Intentional? -> confidence 40
4. Skip-path glob match (and NOT `security`)? -> DROP (removed before reporting)

If none match, the agent's original confidence stands.

## Summary Table

| Filter | Confidence | Filtered at Default (70)? | Exceptions |
|--------|-----------|--------------------------|------------|
| Linter-catchable | 50 | Yes | Agent adds context beyond linter; security findings |
| Pre-existing | 30 | Yes | Security issue newly exploitable |
| Intentional | 40 | Yes | Security findings |
| Skip-path glob (`skip_paths`) | DROP | Always (removed) | Security findings |

> **Related:** the hunting method that generates findings (before they reach these filters) is the [finder-angle taxonomy](finder-angles.md).
