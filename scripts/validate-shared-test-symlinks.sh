#!/usr/bin/env bash
# Every plugin must run the SAME SET of lib tests as shared/, as the same files.
#
# `src/lib/` is symlinked into all five plugins, so every tree runs identical
# library code. The tests were copies, and the copies drifted: seven files, up to
# 735 lines, and five suites passed against a stale spec (#60).
#
# This guard asserts SET PARITY, not per-file properties. The distinction is
# load-bearing — an adversarial review of the first version defeated it three
# ways, each reproducing #60 with green CI:
#
#   * deleting a plugin's symlink              → only existing files were inspected
#   * `git mv output.test.ts output-x.test.ts` → a rename left the shared name unclaimed
#   * `mkdir legacy && cp`                     → a fixed-depth, non-recursive glob missed it
#
# So: the REQUIRED set is derived from shared/ and every plugin must present all
# of it; candidates are found recursively so depth cannot hide a copy; names are
# compared case-folded so the verdict matches on macOS and CI's Linux; and
# exemptions live in a checked-in file, making an omission a reviewable line
# rather than a silent absence.
#
# Two ways to keep a genuinely plugin-specific test:
#   1. Add it to scripts/shared-test-exemptions.txt with a `local:` prefix, or
#   2. Parameterise it and keep it in shared/ — see tests/lib/logging.test.ts,
#      which runs under six identities off one file.
#
# A plugin may also replace its whole `tests/lib` with a directory symlink to
# shared's; that is strictly stronger (it cannot omit or diverge from a file it
# does not own) and matches the repo's own `src/lib` idiom, so it passes.
#
# Usage:  scripts/validate-shared-test-symlinks.sh
#
# Exit codes:
#   0 — every plugin presents the required set, as symlinks to shared
#   1 — a drift finding (missing, unclaimed copy, real file, wrong target, broken link)
#   2 — environment error (expected paths missing, exemption file unreadable)

set -euo pipefail

SHARED_DIR="shared/hooks-infra/tests/lib"
EXEMPTIONS="scripts/shared-test-exemptions.txt"

[ -d "$SHARED_DIR" ] || { echo "error: $SHARED_DIR not found — run from the repo root, or shared tests were moved/deleted" >&2; exit 2; }
[ -r "$EXEMPTIONS" ] || { echo "error: $EXEMPTIONS not readable" >&2; exit 2; }

# ---------------------------------------------------------------------------
# Exemptions: strip comments, split shared-exempt from plugin-local.
# ---------------------------------------------------------------------------
exempt_shared=()
exempt_local=()
while IFS= read -r raw; do
  line="${raw%%#*}"
  line="$(printf '%s' "$line" | tr -d '[:space:]')"
  [ -n "$line" ] || continue
  case "$line" in
    local:*) exempt_local+=("${line#local:}") ;;
    *)       exempt_shared+=("$line") ;;
  esac
done < "$EXEMPTIONS"

in_list() {
  local needle="$1"; shift
  local item
  for item in "$@"; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# ---------------------------------------------------------------------------
# REQUIRED = shared top-level *.test.ts minus exemptions.
# ---------------------------------------------------------------------------
shopt -s nullglob
required=()
shared_all=()
for f in "$SHARED_DIR"/*.test.ts; do
  b="$(basename "$f")"
  shared_all+=("$b")
  if [ "${#exempt_shared[@]}" -gt 0 ] && in_list "$b" "${exempt_shared[@]}"; then continue; fi
  required+=("$b")
done
[ "${#required[@]}" -gt 0 ] || { echo "error: no required tests derived from $SHARED_DIR — every shared test is exempted, or the tests were renamed/deleted" >&2; exit 2; }

plugin_roots=(plugins/*/hooks)
[ "${#plugin_roots[@]}" -gt 0 ] || { echo "error: no plugins found at plugins/*/hooks" >&2; exit 2; }

FAIL=0
CHECKED=0
DIRLINKED=0

for root in "${plugin_roots[@]}"; do
  plugin="$(basename "$(dirname "$root")")"
  libdir="$root/tests/lib"

  # A tests/lib that is itself a symlink subsumes every per-file check below.
  if [ -L "$libdir" ]; then
    if [ "$(realpath "$libdir")" = "$(realpath "$SHARED_DIR")" ]; then
      DIRLINKED=$((DIRLINKED + 1))
      continue
    fi
    echo "FAIL  $libdir is a directory symlink to $(realpath "$libdir"), expected $(realpath "$SHARED_DIR")"
    FAIL=1
    continue
  fi

  [ -d "$libdir" ] || { echo "FAIL  $libdir is missing entirely"; FAIL=1; continue; }

  # --- 1. every REQUIRED shared test present as a symlink to shared ---
  for b in "${required[@]}"; do
    target="$libdir/$b"
    CHECKED=$((CHECKED + 1))

    if [ ! -e "$target" ] && [ ! -L "$target" ]; then
      echo "FAIL  $plugin is missing $b — every shared lib test must be linked, or exempted in $EXEMPTIONS"
      FAIL=1
      continue
    fi
    if [ ! -L "$target" ]; then
      echo "FAIL  $target is a real file but $SHARED_DIR/$b exists"
      echo "      → replace it with a symlink, or exempt the name as local: in $EXEMPTIONS"
      FAIL=1
      continue
    fi
    if [ ! -f "$target" ]; then
      echo "FAIL  $target is a broken symlink (target: $(readlink "$target"))"
      FAIL=1
      continue
    fi
    actual="$(realpath "$target")"
    expected="$(realpath "$SHARED_DIR/$b")"
    if [ "$actual" != "$expected" ]; then
      echo "FAIL  $target resolves to $actual, expected $expected"
      FAIL=1
    fi
  done

  # --- 2a. tests/lib is an ALLOWLIST: nothing real may live there unlisted ---
  # tests/lib mirrors src/lib, which is 100% shared, so a real file there is
  # either an explicitly declared plugin-local test or a copy. Renaming a copy
  # (`git mv output.test.ts output-plugin.test.ts`) defeats name-collision
  # detection completely — it collides with nothing — so the only durable rule is
  # that every real file under tests/lib must be named in the exemptions file.
  # Plugin-specific tests for plugin-specific hooks belong in a sibling directory
  # (tests/pretool/, tests/bin/, …), which this pass does not restrict.
  while IFS= read -r cand; do
    [ -L "$cand" ] && continue
    cb="$(basename "$cand")"
    if [ "${#exempt_local[@]}" -gt 0 ] && in_list "$cb" "${exempt_local[@]}"; then continue; fi
    echo "FAIL  $cand is a real file under tests/lib that is not declared plugin-local"
    echo "      → tests/lib mirrors the fully-shared src/lib; add it as local: in $EXEMPTIONS,"
    echo "        move it to a sibling test directory, or make it a symlink to shared"
    FAIL=1
  done < <(find "$libdir" -type f 2>/dev/null)

  # --- 2b. no same-named copy elsewhere under tests/, any depth, any case ---
  while IFS= read -r cand; do
    [ -L "$cand" ] && continue
    case "$cand" in "$libdir"/*) continue ;; esac   # covered by 2a
    cb_lower="$(lower "$(basename "$cand")")"
    for sb in "${shared_all[@]}"; do
      if [ "$cb_lower" = "$(lower "$sb")" ]; then
        echo "FAIL  $cand is a real file whose name collides with $SHARED_DIR/$sb"
        echo "      → a copy at another path or in another case is exactly the drift this guard exists to stop"
        FAIL=1
        break
      fi
    done
  done < <(find "$root/tests" -type f -name '*.test.ts' 2>/dev/null)
done

if [ "$FAIL" -eq 0 ]; then
  echo "OK    ${#required[@]} required shared lib test(s) x ${#plugin_roots[@]} plugin(s): $CHECKED link(s) verified, $DIRLINKED via directory symlink"
  echo "      ${#exempt_shared[@]} shared test(s) exempted, ${#exempt_local[@]} plugin-local name(s) allowed — see $EXEMPTIONS"
fi
exit "$FAIL"
