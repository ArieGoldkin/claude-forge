---
description: Post inline-anchored review comments to a GitLab MR or GitHub PR from a findings.yaml artifact (companion to /review-mr)
---

# Post MR Comments: $ARGUMENTS

Companion to `/review-mr`. Reads `.claude/reviews/mr-${N}-findings.yaml`, validates the environment, fetches fresh `diff_refs`, runs a stale-check, posts findings sequentially with per-comment anchor verification, and updates the YAML in place with `posted: true` + `discussion_id` after each successful POST.

> **Always a deliberate second action.** The review skill never auto-posts. The user reads the Markdown render, edits the YAML to drop / rephrase / re-rank, then runs this skill. Posting is opt-in, per-finding, with a confirmation gate.

## Synopsis

```
/etk:post-mr-comments {N} [--only 1,2,3] [--skip 11,12] \
                          [--severity blocking,issue] \
                          [--confidence-min 70] \
                          [--dry-run] [--ci]
```

Positional:
- `{N}` — MR/PR number (required). Must match the `mr_number` field in the YAML.

Filters (all optional, AND-combined):
- `--only N1,N2,N3` — post only these finding IDs
- `--skip N1,N2,N3` — exclude these finding IDs (useful for resuming after a partial batch)
- `--severity LIST` — comma-separated severities to include (default: `blocking,issue,suggestion,nitpick` = all)
- `--confidence-min N` — drop findings below this confidence (default: 70)

Modes:
- `--dry-run` — print the post plan + payload preview for one finding, then exit. No API writes.
- `--ci` — non-interactive CI mode (G1, CC-alignment audit 2026-06-01). Skips both the Phase 3 stale-check pause and the Phase 4 `[y/n]` confirm. **Fails closed** instead: if fresh `head_sha != generated_from_sha`, aborts with a nonzero exit (no `y/n/r` prompt). Defaults `--severity` to `blocking,issue` if not explicitly passed. Posting stays sequential, with per-comment anchor verification and atomic YAML write-back, exactly as in interactive mode.

> **CI posting is an EXPLICIT, separate job.** `--ci` is invoked by a dedicated posting job that a human (or pipeline maintainer) wired up on purpose. It is **never** auto-chained from `/review-mr` — the review skill emits the YAML+MD draft and stops. The CI *review* path (`/review-mr --ci`) is review-only and posts nothing; posting requires this command to be run as its own step.

Examples:

```bash
# Post all findings in YAML
/etk:post-mr-comments 1612

# Cherry-pick blockers only
/etk:post-mr-comments 1612 --only 1,2,3

# Post issues + blockers, skip suggestions/nitpicks
/etk:post-mr-comments 1612 --severity blocking,issue

# Resume after manually verifying findings 1-5 are posted; finish 6-12
/etk:post-mr-comments 1612 --skip 1,2,3,4,5

# Preview what would post, no API writes
/etk:post-mr-comments 1612 --dry-run

# CI posting job (non-interactive): fail-closed on SHA drift, defaults to blocking,issue
/etk:post-mr-comments 1612 --ci
```

## References

This skill leans heavily on reference docs from the `code-review-playbook` shared skill — implementers must read the one for their VCS before touching this code:

- **`skills/code-review-playbook/references/glab-inline-comments-recipe.md`** — GitLab patterns: JSON-`--input`-not-`-F`, required position fields, anchor verification, sequential-not-parallel.
- **`skills/code-review-playbook/references/gh-inline-comments-recipe.md`** — GitHub patterns: `pulls/{N}/comments` with `{commit_id, path, line, side}`, `422`-on-bad-line, issue-comment fallback, sequential-not-parallel.
- **`skills/code-review-playbook/references/inline-comment-yaml-schema.md`** — the VCS-agnostic YAML contract (top-level fields, findings entry schema, validation rules, mutation rules, the `discussion_id`/`note_id` mapping per VCS).

## Phase 0: VCS Detection

Same `$VCS_CLI` switch as `/review-mr` Phase 0. **Both GitLab (`glab`) and GitHub (`gh`) are
supported.** The two platforms use different inline-comment APIs (GitLab posts to
`/merge_requests/{N}/discussions` with a `position` object carrying `base_sha`/`head_sha`/`start_sha`;
GitHub posts to `/repos/{owner}/{repo}/pulls/{N}/comments` with `{commit_id, path, line, side}`), so
several phases below branch on `$VCS_CLI`. Everything else — filtering, the stale-check gate,
sequential posting with per-comment verification, atomic per-finding YAML write-back — is identical.

```bash
if command -v glab &>/dev/null; then
  VCS_CLI="glab"
  VCS_API="glab api"
  VCS_ENTITY="MR"
  VCS_PREFIX="!"
elif command -v gh &>/dev/null; then
  VCS_CLI="gh"
  VCS_API="gh api"
  VCS_ENTITY="PR"
  VCS_PREFIX="#"
  # GitHub REST endpoints are keyed by owner/repo, not a URL-encoded project path.
  read -r OWNER REPO < <(gh repo view --json owner,name -q '.owner.login + " " + .name')
  [ -n "$OWNER" ] && [ -n "$REPO" ] || { echo "ERROR: could not resolve owner/repo via gh. Are you in a GitHub repo?"; exit 6; }
else
  echo "ERROR: No VCS CLI found. Install glab (GitLab) or gh (GitHub)."
  exit 1
fi
```

## Phase 1: Validate environment

### 1a. Auth check

```bash
if [ "$VCS_CLI" = "glab" ]; then
  glab auth status 2>&1 | grep -q "✓ Logged in" || {
    echo "ERROR: glab is not authenticated. Run: glab auth login"
    exit 3
  }
else  # gh
  gh auth status >/dev/null 2>&1 || {
    echo "ERROR: gh is not authenticated. Run: gh auth login"
    exit 3
  }
fi
```

### 1b. Locate and parse the YAML

```bash
MR_NUMBER="$1"  # parsed from $ARGUMENTS
YAML_PATH=".claude/reviews/mr-${MR_NUMBER}-findings.yaml"

[ -f "$YAML_PATH" ] || {
  echo "ERROR: ${YAML_PATH} not found. Run /review-mr ${MR_NUMBER} first to generate it."
  exit 4
}

# Validate YAML parses (use python3 since yq isn't always available)
python3 -c "import yaml; yaml.safe_load(open('$YAML_PATH'))" 2>&1 || {
  echo "ERROR: ${YAML_PATH} is not valid YAML. Edit by hand to fix."
  exit 5
}
```

### 1c. Schema validation

Run the validation rules from `inline-comment-yaml-schema.md` Validation rules section. Pseudocode (implement in inline Python):

```python
import yaml, sys
data = yaml.safe_load(open('$YAML_PATH'))

# Top-level required fields
for f in ['mr_number','mr_url','project_path','generated_at','generated_from_sha','review_mode','agents_launched','findings']:
    if f not in data: sys.exit(f"YAML missing top-level field: {f}")

# mr_number in YAML matches CLI arg
if str(data['mr_number']) != "$MR_NUMBER":
    sys.exit(f"YAML mr_number ({data['mr_number']}) does not match CLI arg ($MR_NUMBER). Wrong file?")

# Per-finding fields
SEVERITIES = {'blocking','issue','suggestion','nitpick'}
seen_ids = set()
for fi in data['findings']:
    for f in ['id','severity','confidence','path','line','body','posted','discussion_id','note_id','posted_at']:
        if f not in fi: sys.exit(f"Finding {fi.get('id','?')} missing field: {f}")
    if fi['severity'] not in SEVERITIES: sys.exit(f"Finding {fi['id']}: invalid severity '{fi['severity']}'")
    if not (0 <= fi['confidence'] <= 100): sys.exit(f"Finding {fi['id']}: confidence out of range")
    if not isinstance(fi['line'], int) or fi['line'] < 1: sys.exit(f"Finding {fi['id']}: line must be positive int")
    if '..' in fi['path'] or fi['path'].startswith('/'): sys.exit(f"Finding {fi['id']}: path must be POSIX-relative")
    if fi['id'] in seen_ids: sys.exit(f"Duplicate finding ID: {fi['id']}")
    seen_ids.add(fi['id'])
    if not fi['body'].rstrip().endswith('_Reviewed with Claude Code._'):
        sys.exit(f"Finding {fi['id']}: body must end with '_Reviewed with Claude Code._'")
```

If validation fails, print `STATUS: BLOCKED <reason>` and exit. Do not proceed.

## Phase 2: Fetch fresh diff refs

**GitLab** needs the full `base_sha`/`head_sha`/`start_sha` triple for the `position` object.
**GitHub** needs only the head `commit_id` (the inline-comment payload anchors with `{commit_id, path, line, side}`).

```bash
if [ "$VCS_CLI" = "glab" ]; then
  PROJECT_PATH_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote(open('/dev/stdin').read().strip(), safe=''))" <<< "$(yq -r '.project_path' $YAML_PATH 2>/dev/null || python3 -c "import yaml; print(yaml.safe_load(open('$YAML_PATH'))['project_path'])")")

  glab api "projects/${PROJECT_PATH_ENC}/merge_requests/${MR_NUMBER}" > /tmp/mr-${MR_NUMBER}.json

  eval "$(jq -r '.diff_refs | "BASE_SHA=\(.base_sha)\nHEAD_SHA=\(.head_sha)\nSTART_SHA=\(.start_sha)"' /tmp/mr-${MR_NUMBER}.json)"

  # Sanity
  [ -n "$BASE_SHA" ] && [ -n "$HEAD_SHA" ] && [ -n "$START_SHA" ] || {
    echo "ERROR: Could not fetch diff_refs from MR. Check MR exists and you have access."
    exit 6
  }
else  # gh — only the head commit_id is needed
  HEAD_SHA=$(gh pr view "${MR_NUMBER}" --json headRefOid -q .headRefOid)
  [ -n "$HEAD_SHA" ] || {
    echo "ERROR: Could not fetch head commit from PR. Check PR exists and you have access."
    exit 6
  }
fi
```

## Phase 3: Stale-check

Compare the freshly-fetched `head_sha` against the `generated_from_sha` recorded in the YAML.

```python
import yaml
data = yaml.safe_load(open('$YAML_PATH'))
generated = data['generated_from_sha']
fresh = "$HEAD_SHA"

if generated != fresh:
    print(f"⚠ MR head_sha changed since review was generated:")
    print(f"   Review generated against: {generated}")
    print(f"   MR HEAD now:              {fresh}")
    print(f"   Recent commits:")
    # glab api "projects/{enc}/merge_requests/{N}/commits" | jq -r '.[:5][] | "   - \(.short_id) \(.title)"'
    print()
    print(f"   Line numbers in the YAML may be stale.")
    print(f"   (y) Continue posting (you accept the risk that anchors may land on wrong lines)")
    print(f"   (n) Abort (recommended if commits touched the same files)")
    print(f"   (r) Re-run /review-mr {data['mr_number']} to regenerate against fresh head")
    # Read user response; act accordingly
```

**Interactive gate** (default, `--ci` absent): this skill is interactive. Always pause for user confirmation when stale-check fails. Don't silently proceed.

**`--ci` fail-closed gate** (G1, CC-alignment audit 2026-06-01): in CI mode there is no `y/n/r` prompt. If `generated_from_sha != fresh head_sha`, abort immediately with a nonzero exit — the draft was generated against a different head and its anchors may be stale, so a non-interactive job must NOT guess:

```python
if generated != fresh:
    sys.exit(
        f"STATUS: BLOCKED — --ci: MR head_sha changed since review was generated "
        f"(review={generated[:12]}, HEAD={fresh[:12]}). Re-run /review-mr {data['mr_number']} "
        f"to regenerate against fresh head, then re-run the posting job."
    )
# (exit code is nonzero; the pipeline step fails so the drift is visible)
```

When the SHAs match, `--ci` proceeds straight to Phase 4 with no pause.

## Phase 4: Filter findings + print plan + confirm

Apply the CLI flags in this order:

1. Drop `posted: true` entries (already posted; skip silently — they're done).
2. Apply `--confidence-min` (default 70).
3. Apply `--severity` filter. **`--ci` default**: if `--severity` was not explicitly passed, default to `blocking,issue` (not the all-severities interactive default) — CI posting targets merge-relevant findings, not nitpicks (G1, CC-alignment audit 2026-06-01).
4. Apply `--skip` (drop these IDs).
5. Apply `--only` (keep only these IDs; if both `--only` and `--skip` given, `--only` wins).

Print the plan:

```
Posting 5 of 12 findings to !${MR_NUMBER}:
  filters: severity=blocking,issue | confidence-min=70

  #1  blocking  utils/database/foo.py:89   conf=95
  #2  blocking  utils/database/foo.py:611  conf=90
  #3  blocking  lambdas/admin/main.tf:85   conf=88
  #4  issue     lambdas/users/main.tf:90   conf=82
  #5  issue     infra/vars/prod.tfvars:31  conf=75

Already posted (skipped): 0
Filtered out: 7 (3 by severity, 4 by confidence)

Diff refs (fresh):
  base_sha:  ${BASE_SHA:0:12}
  head_sha:  ${HEAD_SHA:0:12}
  start_sha: ${START_SHA:0:12}

Proceed? [y/n]
```

If `--dry-run`: print the plan + a payload preview for finding #1 (the JSON body that would be POSTed), then exit. No API writes.

```
Dry-run payload preview (finding #1):
{
  "body": "**blocking:** Phantom table — nothing in this repo writes to `healthy_action_tag`...",
  "position": {
    "base_sha": "a23e5767f667...",
    "head_sha": "4f3d153eb487...",
    "start_sha": "672b192d010f...",
    "position_type": "text",
    "new_path": "utils/database/foo.py",
    "old_path": "utils/database/foo.py",
    "new_line": 89
  }
}

(dry-run; no POST issued)
```

If user enters `n` or anything other than `y`, abort cleanly. No POSTs.

**`--ci`**: skip the `Proceed? [y/n]` prompt entirely (G1, CC-alignment audit 2026-06-01). Print the plan for the pipeline log, then proceed straight to Phase 5. The fail-closed stale-check in Phase 3 is the only gate in CI mode; once past it, the job posts the planned findings without asking.

## Phase 5: Post sequentially with verification

For each filtered finding (in YAML order, NOT parallel).

### 5·0. Pre-flight: build the in-hunk line map (G9, CC-alignment audit 2026-06-01)

Before posting anything, fetch the MR diff once and parse the `@@` hunk headers to build, per file, the set of NEW-side line ranges that are inline-anchorable. This is the **only** way to distinguish the two GitLab failure modes — both return an identical `201 + position: null`:

- **out-of-hunk** (the line isn't in any diff hunk) — *expected*; not a bug. Fall back to a top-level note (5b-OOH) and continue.
- **silently-dropped position on an in-hunk line** (the real bug from `glab-inline-comments-recipe.md`) — *unexpected*; hard-halt + delete the bad note (5c).

The verify response alone cannot tell these apart, so the pre-flight map is mandatory.

> **GitHub note:** `gh` does NOT share GitLab's silent `201 + position: null` failure mode — the
> GitHub REST API returns a hard `422 Unprocessable Entity` when `line` is not part of the diff.
> The in-hunk pre-flight is still run for both VCS so out-of-hunk findings route to the top-level
> fallback (5b-OOH) *without* a failed API round-trip, but on GitHub the 422 is a second backstop.

```bash
if [ "$VCS_CLI" = "glab" ]; then
  glab mr diff "${MR_NUMBER}" > /tmp/mr-${MR_NUMBER}.diff
else  # gh
  gh pr diff "${MR_NUMBER}" > /tmp/mr-${MR_NUMBER}.diff
fi
```

```python
import re, collections
# Parse `diff --git` file blocks + `@@ -a,b +c,d @@` hunk headers into
# {new_path: [(new_start, new_end_inclusive), ...]} on the NEW side.
hunks = collections.defaultdict(list)
cur = None
for ln in open('/tmp/mr-${MR_NUMBER}.diff'):
    m = re.match(r'^\+\+\+ b/(.*)$', ln)          # NEW-side path
    if m:
        cur = m.group(1).strip()
        continue
    h = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', ln)
    if h and cur:
        start = int(h.group(1))
        count = int(h.group(2)) if h.group(2) is not None else 1
        if count > 0:
            hunks[cur].append((start, start + count - 1))

def in_hunk(path, line):
    return any(a <= line <= b for (a, b) in hunks.get(path, []))
```

For each finding, evaluate `WAS_IN_HUNK = in_hunk(F_PATH, F_LINE)` once and branch on it below (5b vs 5b-OOH); carry the same value into the 5d YAML write-back so `anchored` matches the path actually taken. (GitLab also anchors to ±3 context lines around a hunk; the `@@` `count` already includes the context lines GitLab emits, so the parsed ranges are the authoritative in-hunk set.)

### 5a. Build the payload

```bash
# For each finding, write body to a temp file and build JSON via heredoc
# NOTE: \$N is the CC v2.1.163+ escape for a literal $N — without it, slash-command
# argument substitution clobbers these shell variables with /post-mr-comments args.
F_ID="\$1"  # current finding ID
F_PATH="\$2"
F_LINE="\$3"
F_BODY_FILE=$(mktemp)
yq -r ".findings[] | select(.id == $F_ID) | .body" "$YAML_PATH" > "$F_BODY_FILE"
F_BODY_JSON=$(python3 -c "import json; print(json.dumps(open('$F_BODY_FILE').read()))")

if [ "$VCS_CLI" = "glab" ]; then
  cat > /tmp/post-${F_ID}.json <<EOF
{
  "body": $F_BODY_JSON,
  "position": {
    "base_sha": "$BASE_SHA",
    "head_sha": "$HEAD_SHA",
    "start_sha": "$START_SHA",
    "position_type": "text",
    "new_path": "$F_PATH",
    "old_path": "$F_PATH",
    "new_line": $F_LINE
  }
}
EOF
else  # gh — GitHub PR review-comment shape: commit_id + path + line + side
  cat > /tmp/post-${F_ID}.json <<EOF
{
  "body": $F_BODY_JSON,
  "commit_id": "$HEAD_SHA",
  "path": "$F_PATH",
  "line": $F_LINE,
  "side": "RIGHT"
}
EOF
fi
```

### 5b. POST (in-hunk: inline-anchored)

If `in_hunk(F_PATH, F_LINE)` is true, post the inline comment:

```bash
if [ "$VCS_CLI" = "glab" ]; then
  glab api "projects/${PROJECT_PATH_ENC}/merge_requests/${MR_NUMBER}/discussions" \
    -X POST \
    -H "Content-Type: application/json" \
    --input /tmp/post-${F_ID}.json \
    > /tmp/result-${F_ID}.json
else  # gh — POST a PR review comment (creates a new review thread)
  gh api "repos/${OWNER}/${REPO}/pulls/${MR_NUMBER}/comments" \
    -X POST \
    -H "Accept: application/vnd.github+json" \
    --input /tmp/post-${F_ID}.json \
    > /tmp/result-${F_ID}.json
fi
```

**Critical rules:**
- **GitLab** (see `glab-inline-comments-recipe.md`): `--input` + `Content-Type: application/json`
  is non-negotiable (never `-F`); all 5 position fields (`base_sha`, `head_sha`, `start_sha`,
  `position_type`, `new_path`) plus `new_line` are required.
- **GitHub** (see `gh-inline-comments-recipe.md`): `--input` reads the JSON body; `{commit_id, path,
  line, side: "RIGHT"}` are required. `commit_id` MUST be the PR head SHA. A `line` outside the diff
  returns `422` (caught in 5c) rather than GitLab's silent `201 + position: null`.

### 5b-OOH. POST (out-of-hunk: top-level fallback) (G9, CC-alignment audit 2026-06-01)

If `in_hunk(F_PATH, F_LINE)` is false, the line cannot be inline-anchored — this is *expected*, not a bug. Do NOT attempt the inline POST (it would return the ambiguous `201 + position: null`). Instead post a **top-level discussion note** (no `position` object) whose body is prefixed with the location so it's still visible:

```bash
# Prefix the body with "`path:line` — " so the location survives without an anchor.
F_OOH_BODY_FILE=$(mktemp)
{ printf '`%s:%s` — ' "$F_PATH" "$F_LINE"; cat "$F_BODY_FILE"; } > "$F_OOH_BODY_FILE"

cat > /tmp/post-${F_ID}.json <<EOF
{
  "body": $(python3 -c "import json; print(json.dumps(open('$F_OOH_BODY_FILE').read()))")
}
EOF

if [ "$VCS_CLI" = "glab" ]; then
  glab api "projects/${PROJECT_PATH_ENC}/merge_requests/${MR_NUMBER}/discussions" \
    -X POST \
    -H "Content-Type: application/json" \
    --input /tmp/post-${F_ID}.json \
    > /tmp/result-${F_ID}.json
else  # gh — a top-level PR comment is a GitHub *issue* comment (no position)
  gh api "repos/${OWNER}/${REPO}/issues/${MR_NUMBER}/comments" \
    -X POST \
    -H "Accept: application/vnd.github+json" \
    --input /tmp/post-${F_ID}.json \
    > /tmp/result-${F_ID}.json
fi
```

Then record it with `anchored: false` (5d sets `posted: true`, `discussion_id`, `note_id`, `posted_at` as usual) and **continue the batch** — an out-of-hunk finding never halts. Log it:

```python
import json
r = json.load(open(f'/tmp/result-{F_ID}.json'))
print(f"#{F_ID} TOP-LEVEL (out-of-hunk): {F_PATH}:{F_LINE} id={str(r['id'])[:12]}")
```

### 5c. Verify the anchor took (in-hunk path only)

This verification applies to the **in-hunk** POST (5b). On **GitLab**, a `201 + position: null`
means the position was silently dropped on a line that IS postable — the genuine bug from
`glab-inline-comments-recipe.md`. On **GitHub**, a bad line is a hard `422` (the POST in 5b
already failed nonzero and wrote no comment object); a `201` with a returned `path`/`line` means
it anchored. Either way, hard-halt and delete the bad note on failure:

```python
import json, sys, subprocess
vcs = "$VCS_CLI"
r = json.load(open(f'/tmp/result-{F_ID}.json'))

if vcs == "glab":
    note = r['notes'][0]
    pos = note.get('position') or {}
    ok = (pos.get('position_type') == 'text'
          and pos.get('new_path') == "$F_PATH"
          and pos.get('new_line') == $F_LINE)
    located = f"{pos.get('new_path')}:{pos.get('new_line')}"
    thread_id = str(r['id'])
    note_id = str(note['id'])
    # delete: glab api "projects/{enc}/merge_requests/{N}/discussions/{thread_id}/notes/{note_id}" -X DELETE
else:  # gh — POST returns the review comment object directly
    ok = (r.get('path') == "$F_PATH" and (r.get('line') or r.get('original_line')) == $F_LINE)
    located = f"{r.get('path')}:{r.get('line') or r.get('original_line')}"
    thread_id = str(r.get('id', ''))   # GitHub: the comment id IS the thread root
    note_id = str(r.get('id', ''))
    # delete: gh api "repos/{OWNER}/{REPO}/pulls/comments/{note_id}" -X DELETE

if not ok:
    # F_PATH:F_LINE was confirmed IN-HUNK by the 5·0 pre-flight, so this is the
    # real failure (position dropped / rejected despite being anchorable), NOT out-of-hunk.
    print(f"⚠ Finding #{F_ID}: inline anchor failed on an IN-HUNK line. Deleting bad note {note_id}...")
    sys.exit(f"STATUS: BLOCKED — inline anchor failed on in-hunk finding #{F_ID}. Bad note deleted. Investigate before retrying.")

print(f"#{F_ID} INLINE: {located} id={thread_id[:12]}")
```

> On GitHub the 5b POST itself fails (nonzero exit, `422` body) when `line` is out of the diff,
> so a missing/!ok JSON here is the in-hunk failure path. Treat a 5b nonzero exit on an
> in-hunk finding the same as a failed verify: delete any partial comment and `STATUS: BLOCKED`.

**Stop the batch on first IN-HUNK verification failure.** Don't continue posting if the API silently dropped the position on a line that should have anchored. The out-of-hunk top-level fallback (5b-OOH) is the *only* case that continues; a dropped position on a postable line still hard-halts + deletes.

### 5d. Update YAML in place

After a successful inline verify (5c) OR a successful out-of-hunk top-level post (5b-OOH), mutate the YAML for this finding ONLY (per the schema's mutation rules). Set `anchored` to reflect which path posted it (G9, CC-alignment audit 2026-06-01):

```python
import yaml
vcs = "$VCS_CLI"
r = json.load(open(f'/tmp/result-{F_ID}.json'))

# Resolve the (thread, note) id pair from the VCS-specific response shape:
#   GitLab inline  → r['id'] (discussion) + r['notes'][0]['id'] (note)
#   GitLab OOH     → same shape (discussion with one note)
#   GitHub inline  → r['id'] (review comment id; IS the thread root)
#   GitHub OOH     → r['id'] (issue comment id)
if vcs == "glab":
    thread_id = str(r['id'])
    note_id = str(r['notes'][0]['id'])
else:  # gh — the comment id is both the thread root and the note
    thread_id = str(r['id'])
    note_id = str(r['id'])

data = yaml.safe_load(open('$YAML_PATH'))
for f in data['findings']:
    if f['id'] == $F_ID:
        f['posted'] = True
        f['anchored'] = $WAS_IN_HUNK   # True for inline (5b/5c), False for top-level fallback (5b-OOH)
        f['discussion_id'] = thread_id
        f['note_id'] = note_id
        f['posted_at'] = "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        break

with open('$YAML_PATH', 'w') as fp:
    yaml.safe_dump(data, fp, sort_keys=False, allow_unicode=True, default_flow_style=False)
```

**Atomic per-finding** — write the file after every successful POST, never batch-update. Guarantees that if the loop is interrupted (Ctrl-C, network failure, verification halt), the YAML reflects exactly what's posted on the MR.

### 5e. Update Markdown render

Replace the `Posted: ❌ pending` line for this finding in the rendered MD:

```python
import re
md_path = '$YAML_PATH'.replace('.yaml', '.md')
md = open(md_path).read()
short = r['id'][:8]
# Find the line matching this finding's path:line and update
pattern = re.compile(r'(\\*\\*Confidence\\*\\*: \\d+ \\| \\*\\*Posted\\*\\*: )❌ pending', re.MULTILINE)
# More robust: regex on the heading + N lines below
# (implementation detail — keep simple)
new_md = md.replace('❌ pending', f'✅ disc={short}', 1)  # FIRST occurrence of the heading-anchored block
open(md_path, 'w').write(new_md)
```

(Implementation note: the simple `replace(..., 1)` works only if findings are processed in YAML order; for `--only` cherry-pick, use a regex anchored to the finding's `path:line` heading. Defer the regex to implementation; the YAML mutation is the load-bearing one.)

### 5f. Per-finding sleep

```bash
sleep 0.3   # gentle on rate limit
```

## Phase 6: Summary

```
Posted ${POSTED_COUNT}/${PLANNED_COUNT} (${ANCHORED_COUNT} inline-anchored, ${OOH_COUNT} top-level out-of-hunk).

YAML updated:  .claude/reviews/mr-${MR_NUMBER}-findings.yaml
MD synced:     .claude/reviews/mr-${MR_NUMBER}-findings.md

Open the MR's Changes tab to verify anchors landed on the right lines:
  ${MR_URL}/diffs

Re-run with --skip ${POSTED_IDS} to skip already-posted findings if you want
to add more later.

STATUS: DONE
```

If verification halted partway:

```
Posted ${POSTED_COUNT} of ${PLANNED_COUNT} planned, then stopped on finding #${FAILED_ID}.

YAML reflects exactly what's posted. To resume after fixing:
  /etk:post-mr-comments ${MR_NUMBER} --skip ${POSTED_IDS}

STATUS: BLOCKED — anchor verification failed on #${FAILED_ID}. See output above.
```

## Anti-patterns (preserved from `/review-mr`)

These rules apply equally to this skill — re-stated for self-contained reading:

- **Don't post one giant top-level summary comment.** This skill posts inline-anchored discussions for findings whose line is in a diff hunk. The single permitted top-level note is the per-finding out-of-hunk fallback (5b-OOH, body prefixed with `` `path:line` — ``), never a roll-up summary. The summary belongs in the MR description, not as a comment.
- **Don't blast 30+ comments without showing a draft first.** The YAML+MD pair IS the draft. The user has reviewed it. The Phase 4 confirmation gate is the second checkpoint (skipped in `--ci`, replaced by the fail-closed stale-check).
- **Don't post in parallel.** Sequential with verification beats parallel — clearer failure attribution, better rate-limit behavior, atomic YAML state.
- **Don't continue past an IN-HUNK verification failure.** A dropped position on a line the pre-flight confirmed anchorable is the real bug — stop on first failure, delete the bad note, exit `STATUS: BLOCKED`. An *out-of-hunk* finding is NOT a failure: it posts as a top-level note (`anchored: false`) and the batch continues.

## Edge cases

- **YAML edited mid-flight**: if the user edits the YAML between Phase 1 (validate) and Phase 5 (post), the changes for un-posted findings ARE picked up (we re-read per finding). Posted-status fields edited by hand are honored — if the user marks `posted: true` for a finding that wasn't actually posted, this skill respects that (we trust the file). Don't try to detect tampering.

- **MR/PR closed/merged during posting**: `glab api`/`gh api` returns 404 or 422. Halt with a clear error. The YAML state is already accurate (atomic per-finding write).

- **Same finding posted twice**: prevented by the `posted: true` check in Phase 4. Re-running this skill on a fully-posted YAML produces "Posted 0/0 — all findings already posted."

- **`--only N` where N doesn't exist in YAML**: warn and skip; don't error. Useful when the user typos.

- **Body contains shell-special characters**: handled by `python3 ... json.dumps()` for safe escaping. Backticks, quotes, newlines, code fences all round-trip cleanly.

## Skills referenced

- `code-review-playbook` (shared) — `references/glab-inline-comments-recipe.md` (GitLab), `references/gh-inline-comments-recipe.md` (GitHub), `references/inline-comment-yaml-schema.md`, `references/agent-review-templates.md`

## Output

- 0 to N inline comments on the MR/PR (one per posted finding): inline-anchored where the line is in a diff hunk, top-level (`` `path:line` — `` prefix) for out-of-hunk findings
- YAML mutated in place with `posted: true` + `anchored` (true=inline, false=top-level fallback) + `discussion_id` + `note_id` + `posted_at` per posted finding
- MD synced with `Posted: ✅` badges
- `STATUS: DONE` or `STATUS: BLOCKED <reason>` on its own line as the final output line
