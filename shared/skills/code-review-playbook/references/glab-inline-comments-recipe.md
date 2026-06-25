# `glab` inline-comment recipe

Canonical patterns for posting inline-anchored discussion threads to GitLab MRs via `glab api`. Use this from any skill that needs to translate a finding (file, line, body) into an MR comment that lands on the right line.

> Audience: implementers of `/etk:post-mr-comments` and any future skill that posts inline review comments. **Read this before touching `glab api .../discussions`.**

---

## The single most important rule

**Use a JSON `--input` file with an explicit `Content-Type: application/json` header. Never use `-F` form fields for the `position` object.**

```bash
# ❌ WRONG — posts as top-level note, position silently dropped, HTTP 201 lies
glab api "projects/{enc}/merge_requests/{N}/discussions" \
  -X POST \
  -F "body=$(cat /tmp/c1.md)" \
  -F "position[base_sha]=..." \
  -F "position[head_sha]=..." \
  -F "position[start_sha]=..." \
  -F "position[position_type]=text" \
  -F "position[new_path]=..." \
  -F "position[new_line]=89"

# ✅ RIGHT — inline-anchored, position object preserved
cat > /tmp/post.json <<EOF
{
  "body": $(python3 -c "import json,sys; print(json.dumps(open('/tmp/body.md').read()))"),
  "position": {
    "base_sha": "$BASE_SHA",
    "head_sha": "$HEAD_SHA",
    "start_sha": "$START_SHA",
    "position_type": "text",
    "new_path": "path/to/file",
    "old_path": "path/to/file",
    "new_line": 89
  }
}
EOF

glab api "projects/{enc}/merge_requests/{N}/discussions" \
  -X POST \
  -H "Content-Type: application/json" \
  --input /tmp/post.json
```

### Why `-F` fails silently

`glab api -F "position[base_sha]=..."` sends multipart/form-data with bracketed field names. The `/discussions` endpoint requires `position` as a nested JSON object. The endpoint accepts the multipart request, returns **HTTP 201**, creates the discussion, but **drops the position fields with no error**. You get a top-level note with `position: null`. The 201 means "the discussion was created," not "the position was honored."

### Why `Content-Type` is required

`glab api --input file.json` does **not** set `Content-Type: application/json` automatically. Without it, GitLab returns `HTTP 415: The provided content-type '' is not supported`. Always pass `-H "Content-Type: application/json"`.

---

## Required position fields (5 + line)

All five `position` keys are required for an inline text comment. Drop any one and you get either a 400 (best case) or a top-level note (worst case).

| Field | Source | Notes |
|-------|--------|-------|
| `base_sha` | `mr.diff_refs.base_sha` | The MR's base commit |
| `head_sha` | `mr.diff_refs.head_sha` | The MR's HEAD commit |
| `start_sha` | `mr.diff_refs.start_sha` | Often equals `base_sha` but not always — must include separately |
| `position_type` | literal `"text"` | The only value that works for code-line anchors |
| `new_path` | repo-relative path | The file in the **NEW** (post-diff) tree |

Plus exactly one of:
- `new_line` — for added or context lines (~95% of cases)
- `old_line` — for removed lines (rarely needed in reviews; use only if commenting on a deletion)

`old_path` should equal `new_path` unless the file was renamed in the MR.

### Get `diff_refs` once, reuse for the whole batch

```bash
glab api "projects/{enc}/merge_requests/{N}" \
  | jq -r '.diff_refs | "BASE_SHA=\(.base_sha)\nHEAD_SHA=\(.head_sha)\nSTART_SHA=\(.start_sha)"'

# Source the output OR cache to a temp file
eval "$(glab api ... | jq -r ...)"
```

Don't re-fetch per finding. The diff_refs are stable for the lifetime of the MR's current head — re-fetching only matters if you suspect the author pushed during your review (see Stale-check below).

---

## Always verify the anchor took

**HTTP 201 is not enough.** Parse the response and confirm the position fields round-tripped intact. Two distinct failure modes can return 201 with a non-anchored note:
1. Form-style position fields silently dropped (above) — the real bug.
2. Line numbers outside any diff hunk → some `glab` versions return 201 with `position: null` instead of the expected 400 — *expected*, not a bug.

These two return **identical** responses, so post-hoc verification can't tell them apart. Use the pre-flight hunk map (see "Line numbers must be in-diff" below) to decide *before* posting: in-hunk lines go inline (a dropped position is then unambiguously bug #1 → halt + delete); out-of-hunk lines skip the inline POST entirely and go to a top-level note (`anchored: false`).

Required verification pattern after every **in-hunk** POST (out-of-hunk findings never reach this — they took the top-level path):

```python
import json
r = json.load(open('/tmp/result.json'))
note = r['notes'][0]
pos = note.get('position') or {}
ok = (
    pos.get('position_type') == 'text' and
    pos.get('new_path') == expected_path and
    pos.get('new_line') == expected_line
)
if not ok:
    # The pre-flight map confirmed this line was in-hunk, so a null position
    # is the real bug (#1), not an out-of-hunk line. Delete the bad note before
    # retrying — don't leave a trail of mis-posts.
    note_id = note['id']
    discussion_id = r['id']
    # glab api ".../merge_requests/{N}/discussions/{discussion_id}/notes/{note_id}" -X DELETE
    raise SystemExit(f"Position dropped on in-hunk line — note {note_id} posted as top-level. Deleted.")
```

The verification adds ~5 seconds per finding and is non-negotiable for any sequential post loop. **Stop on first in-hunk verification failure** — don't continue posting if the API silently changed shape mid-batch. (Out-of-hunk findings are not failures: they post as top-level notes and the batch continues.)

---

## Line numbers must be in-diff — pre-flight the hunk map (G9, CC-alignment audit 2026-06-01)

GitLab inline comments anchor only to lines that are EITHER:
- Added (`+` in the diff), OR
- Within ±3 context lines of a hunk (GitLab folds these into the `@@` `count`).

If `new_line` points to a line that's not part of any hunk, the API returns 400 — **or `201` with `position: null`**. That second mode is the trap: it's **byte-for-byte identical** to the form-fields-silently-dropped failure (above). The verify response alone cannot tell "out-of-hunk line (expected)" from "position dropped on a postable line (the real bug)". **The pre-flight hunk-range parser is the only way to distinguish them** — run it before the posting loop and branch on its result, don't try to recover from the ambiguous 201 after the fact.

### Build the in-hunk line map once, before posting

```bash
glab mr diff {N} > /tmp/mr-{N}.diff
```

```python
import re, collections
# {new_path: [(new_start, new_end_inclusive), ...]} on the NEW side of the diff.
hunks = collections.defaultdict(list)
cur = None
for ln in open('/tmp/mr-{N}.diff'):
    m = re.match(r'^\+\+\+ b/(.*)$', ln)              # NEW-side path
    if m:
        cur = m.group(1).strip(); continue
    h = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', ln)  # @@ -a,b +c,d @@
    if h and cur:
        start = int(h.group(1))
        count = int(h.group(2)) if h.group(2) is not None else 1
        if count > 0:
            hunks[cur].append((start, start + count - 1))

def in_hunk(path, line):
    return any(a <= line <= b for (a, b) in hunks.get(path, []))
```

### Branch each finding on `in_hunk`

- **`in_hunk(path, line)` is true** → post inline as documented above (5-field position object + verify). A `201 + position:null` here is the genuine bug: **hard-halt + delete the bad note** (you confirmed the line was anchorable, so a dropped position is unexpected).
- **`in_hunk(path, line)` is false** → do NOT attempt the inline POST. Post a **top-level discussion note** (no `position` object) whose body is prefixed so the location stays visible:

  ```bash
  { printf '`%s:%s` — ' "$F_PATH" "$F_LINE"; cat "$F_BODY_FILE"; } > "$F_OOH_BODY_FILE"
  cat > /tmp/post-ooh.json <<EOF
  { "body": $(python3 -c "import json; print(json.dumps(open('$F_OOH_BODY_FILE').read()))") }
  EOF
  glab api "projects/{enc}/merge_requests/{N}/discussions" \
    -X POST -H "Content-Type: application/json" --input /tmp/post-ooh.json
  ```

  Record it `anchored: false` + `posted: true` (plus `discussion_id`/`note_id`/`posted_at`) in the findings YAML and **continue the batch** — an out-of-hunk finding is expected, not a failure. Only a dropped position on an *in-hunk* line halts.

This replaces the old "fall back to a top-level note and document the limitation" sketch: the fallback is now first-class, not a manual workaround.

---

## Sequential, not parallel

GitLab rate-limits aggressive parallel `discussions` POSTs. More importantly, sequential posting:
- Gives clear failure attribution (which finding failed → which line/SHA mismatch).
- Lets the verification step stop the batch on first failure (see above).
- Allows YAML / state to be updated atomically per-finding (the post step writes `posted: true` after each successful POST; partial-batch state is well-defined on interrupt).

```bash
for ID in $(jq -r '.findings[] | select(.posted == false) | .id' findings.yaml); do
  post_one "$ID" || break  # halt batch on first failure
  sleep 0.3                 # gentle on rate limit; tune as needed
done
```

A 12-finding batch takes ~30-45 seconds sequentially. That's fine. Don't optimize parallelism.

---

## Worked example: MR !1612 (12 anchored comments, 2026-05-01)

The session that drove this recipe — keep for posterity.

### Setup: get diff_refs once

```bash
glab api "projects/acme%2Fbackend%2Fapi-service/merge_requests/1612" > /tmp/mr1612.json
eval "$(jq -r '.diff_refs | "BASE_SHA=\(.base_sha)\nHEAD_SHA=\(.head_sha)\nSTART_SHA=\(.start_sha)"' /tmp/mr1612.json)"
echo "BASE=$BASE_SHA / HEAD=$HEAD_SHA / START=$START_SHA"
# BASE=a23e5767f667c54d83249549fdbb9c058de5c214
# HEAD=4f3d153eb487f1d32b6b49ed6fdd3ffb41cc78cb
# START=672b192d010ff1be85eebae2fdc17c95cdac274f
```

### Per-finding template

```bash
N=1  # finding ID from YAML

cat > /tmp/post${N}.json <<EOF
{
  "body": $(python3 -c "import json; print(json.dumps(open('/tmp/c${N}.md').read()))"),
  "position": {
    "base_sha": "$BASE_SHA",
    "head_sha": "$HEAD_SHA",
    "start_sha": "$START_SHA",
    "position_type": "text",
    "new_path": "utils/database/operational_utils.py",
    "old_path": "utils/database/operational_utils.py",
    "new_line": 89
  }
}
EOF

glab api "projects/{enc}/merge_requests/1612/discussions" \
  -X POST -H "Content-Type: application/json" --input /tmp/post${N}.json \
  > /tmp/result${N}.json

# Verify
python3 -c "
import json, sys
r = json.load(open('/tmp/result${N}.json'))
n = r['notes'][0]
p = n.get('position') or {}
ok = p.get('position_type') == 'text' and p.get('new_line')
sys.exit(0 if ok else 1)
print(f'#${N} {\"INLINE\" if ok else \"FAILED\"}: {p.get(\"new_path\")}:{p.get(\"new_line\")} disc={r[\"id\"][:12]}')
"
```

### Result: all 12 anchored

```
#1  INLINE: utils/database/operational_utils.py:89   disc=c6d9fd2d521f
#2  INLINE: utils/database/operational_utils.py:611  disc=a7f723ef20d2
#3  INLINE: lambdas/admin/get-all-actions/main.tf:85         disc=6f137bbe60b1
#4  INLINE: lambdas/users/action-page/main.tf:90             disc=f0500ad24673
#5  INLINE: infra/vars/production-v3.tfvars:31                disc=6e69b3dde347
#6  INLINE: utils/config/enabled_tags.py:37                   disc=358b8f719e38
#7  INLINE: utils/database/test_tag_filter.py:36              disc=2b4fd294566e
#8  INLINE: utils/database/operational_utils.py:118  disc=1d85d5361e69
#9  INLINE: cms/.../action_models.py:99                       disc=c00d9ae80082
#10 INLINE: alembic/versions/92196a77068b_add_*.py:29         disc=6d4e45bc2b87
#11 INLINE: alembic/versions/92196a77068b_add_*.py:36         disc=a806cd70c74b
#12 INLINE: utils/config/enabled_tags.py:26                   disc=0cd27970c6fd
```

### What was tried first (and shouldn't be)

```bash
# Two of these mis-posts were caught before deletion: HTTP 201, position: null,
# top-level note with no anchor. The fix took ~15 minutes of API-response
# inspection before the JSON-vs-form-fields divergence was understood.
glab api ".../discussions" -X POST \
  -F "body=$(cat /tmp/c1.md)" \
  -F "position[base_sha]=$BASE_SHA" \
  ...
```

---

## Quick checklist (use before every batch post)

- [ ] `diff_refs` fetched once, all 3 SHAs cached (`base_sha`, `head_sha`, `start_sha`).
- [ ] Body composed via `python3 -c "import json; print(json.dumps(...))"` for safe JSON escaping (handles backticks, quotes, newlines, code fences).
- [ ] POST uses `--input file.json` AND `-H "Content-Type: application/json"`.
- [ ] Pre-flight hunk map built once (`glab mr diff {N}`) and each finding branched on `in_hunk(path, line)` BEFORE posting (G9).
- [ ] In-hunk POST: parse response, verify `position.position_type == "text"` and `position.new_line` non-null. Stop batch on first failure + delete bad note. Out-of-hunk: top-level note (`anchored: false`), continue batch.
- [ ] State updated per-finding after successful verify (`posted: true`, `anchored`, `discussion_id`, `note_id`, `posted_at`) — never batch-update.
- [ ] If a `--dry-run` flag exists, it should print the planned POST payload + position object for at least one finding so the user can spot-check before going live.

---

## See also

- `inline-comment-yaml-schema.md` — the YAML schema that `/etk:post-mr-comments` consumes
- `agent-review-templates.md` — comment body conventions (label, length budget, footer)
- `false-positive-filtering.md` — confidence-threshold rules that determine which findings reach this recipe
