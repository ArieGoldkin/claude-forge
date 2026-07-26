#!/usr/bin/env bash
# Every plugin lib test that has a counterpart in shared/ must BE that counterpart.
#
# `src/lib/` is symlinked into all five plugins, so every tree runs identical
# library code. The tests used to be copies, and the copies drifted: five suites
# verified a spec someone snapshotted once while passing against current code
# (issue #60 — 8 files drifted, up to 735 lines, ~23,700 duplicated lines).
# `cp` is all it takes to reintroduce that, and nothing about a green suite
# reveals it, so the invariant is enforced structurally here.
#
# Two ways to satisfy this guard for a genuinely plugin-specific test:
#   1. Give it a name shared/ does not use (it is then ignored here), or
#   2. Parameterise it off CLAUDE_PLUGIN_NAME and keep it in shared/ —
#      see tests/lib/logging.test.ts, which runs under six identities.
#
# Usage:
#   scripts/validate-shared-test-symlinks.sh
#
# Exit codes:
#   0 — every plugin lib test with a shared counterpart is a symlink to it
#   1 — at least one is a real file, a stale link, or points somewhere else
#   2 — environment error (expected directories missing)

set -euo pipefail

SHARED_DIR="shared/hooks-infra/tests/lib"

if [ ! -d "$SHARED_DIR" ]; then
  echo "error: $SHARED_DIR not found — run from the repo root" >&2
  exit 2
fi

FAIL=0
CHECKED=0
LINKED=0

shopt -s nullglob

plugin_dirs=(plugins/*/hooks/tests/lib)
if [ "${#plugin_dirs[@]}" -eq 0 ]; then
  echo "error: no plugin test dirs found at plugins/*/hooks/tests/lib" >&2
  exit 2
fi

for dir in "${plugin_dirs[@]}"; do
  for candidate in "$dir"/*.test.ts; do
    base="$(basename "$candidate")"

    # A test with no shared counterpart is plugin-specific by definition.
    [ -e "$SHARED_DIR/$base" ] || continue

    CHECKED=$((CHECKED + 1))

    if [ ! -L "$candidate" ]; then
      echo "FAIL  $candidate is a real file but $SHARED_DIR/$base exists"
      echo "      → replace it with a symlink, or rename it if it is genuinely plugin-specific"
      FAIL=1
      continue
    fi

    # Resolve both sides to real paths so a link written with the wrong number
    # of ../ segments (or pointing at another plugin's copy) is caught, not just
    # a link that happens to exist.
    if [ ! -f "$candidate" ]; then
      echo "FAIL  $candidate is a broken symlink (target: $(readlink "$candidate"))"
      FAIL=1
      continue
    fi

    actual="$(cd "$(dirname "$candidate")" && realpath "$(readlink "$base" 2>/dev/null || basename "$candidate")" 2>/dev/null || true)"
    expected="$(realpath "$SHARED_DIR/$base")"

    if [ "$actual" != "$expected" ]; then
      echo "FAIL  $candidate resolves to $actual, expected $expected"
      FAIL=1
      continue
    fi

    LINKED=$((LINKED + 1))
  done
done

if [ "$CHECKED" -eq 0 ]; then
  echo "error: no plugin lib tests share a name with $SHARED_DIR — check the paths" >&2
  exit 2
fi

if [ "$FAIL" -eq 0 ]; then
  echo "OK    $LINKED/$CHECKED plugin lib test(s) are symlinks to $SHARED_DIR"
fi
exit "$FAIL"
