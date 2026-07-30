#!/usr/bin/env bash
#
# cmux-conduct — cold-start launcher for /etk:conduct
#
# Boots a cmux workspace running `claude "/etk:conduct <item>"`, so conduct starts
# INSIDE cmux and can drive placement instead of only emitting a recipe.
#
# It is deliberately THIN: it creates the container and hands off. All classification,
# routing, placement and teardown belong to the conduct skill — this script must never
# grow routing logic (single-source rule, root CLAUDE.md § Skill body hygiene).
#
# Requires: macOS + the cmux app (0.64.20+) running, and the `claude` CLI on PATH.
# Verified against cmux 0.64.20 on bash 3.2 / BSD userland.

set -euo pipefail

PROGNAME="${0##*/}"

# ── defaults ────────────────────────────────────────────────────────────────────
WS_NAME=""
WS_CWD="$PWD"
CLAUDE_MODEL=""
FORCE_NEW=0
FOCUS="true"
DRY_RUN=0
ITEM=""

usage() {
	cat <<EOF
$PROGNAME — cold-start launcher for /etk:conduct

USAGE
  $PROGNAME [options] "<work item or ticket>"

WHAT IT DOES
  Creates a cmux workspace whose terminal runs:
      claude "/etk:conduct <work item>"
  The spawned terminal gets its own CMUX_WORKSPACE_ID, so conduct sees itself inside
  cmux and can place work, rather than degrading to emit-only.

  Already inside a cmux workspace? This script refuses by design and points you at
  /etk:conduct in your existing session — conduct's Container axis nests the work
  under the current workspace. Minting a sibling is the exact failure conduct v2 fixed.

OPTIONS
  -n, --name <title>   Workspace title            (default: conduct-<slug of item>)
  -C, --cwd <path>     Working directory          (default: \$PWD)
  -m, --model <model>  Pass --model to claude     (e.g. "opus[1m]", sonnet)
      --new            Force a new workspace even when already inside cmux
                       (use for a genuine container mismatch — different project)
      --no-focus       Create the workspace without focusing it
      --dry-run        Print the cmux command that would run, then exit
  -h, --help           Show this help

EXIT CODES
  0  workspace launched (or --dry-run / --help)
  1  usage error
  2  precondition failed (cmux missing or not running, claude not on PATH)
  3  refused: already inside cmux — nothing launched, guidance printed

EXAMPLES
  $PROGNAME "PROJ-2200 build the user preferences page"
  $PROGNAME --model "opus[1m]" "restore the broken checkout flow — prod down"
  $PROGNAME --new --cwd ~/projects/other-repo "PROJ-1187 null-guard in the date parser"
  $PROGNAME --dry-run "audit the repo for security risks"

SHELL FUNCTION (optional — makes this one word to type from anywhere)
  Installed plugin paths are version-pinned and several versions coexist in the
  cache, so resolve the newest rather than hardcoding one. Uses find, not a glob:
  an unmatched glob is a hard error in zsh. Add to ~/.zshrc or ~/.bashrc:

      cmux-conduct() {
        local s
        s=\$(find "\$HOME/.claude/plugins/cache" \\
               -path '*/etk/*/skills/conduct/scripts/cmux-conduct.sh' \\
               2>/dev/null | sort -V | tail -1)
        [ -n "\$s" ] || { printf 'cmux-conduct: etk plugin not installed\\n' >&2; return 2; }
        "\$s" "\$@"
      }

NOTE
  This launcher never passes --dangerously-skip-permissions. Conduct's Phase-3
  confirmation gate is the cost control for fleets and races; bypassing permissions
  would defeat it.
EOF
}

die() {
	printf '%s: %s\n' "$PROGNAME" "$1" >&2
	exit "${2:-1}"
}

# ── argument parsing ────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
	case "$1" in
	-h | --help)
		usage
		exit 0
		;;
	-n | --name)
		[ $# -ge 2 ] || die "--name requires a value"
		WS_NAME="$2"
		shift 2
		;;
	-C | --cwd)
		[ $# -ge 2 ] || die "--cwd requires a value"
		WS_CWD="$2"
		shift 2
		;;
	-m | --model)
		[ $# -ge 2 ] || die "--model requires a value"
		CLAUDE_MODEL="$2"
		shift 2
		;;
	--new)
		FORCE_NEW=1
		shift
		;;
	--no-focus)
		FOCUS="false"
		shift
		;;
	--dry-run)
		DRY_RUN=1
		shift
		;;
	--)
		shift
		break
		;;
	-*)
		die "unknown option: $1 (try --help)"
		;;
	*)
		break
		;;
	esac
done

[ $# -gt 0 ] || {
	usage >&2
	die "missing work item" 1
}
ITEM="$*"

# cmux --command sends text+Enter and submits once per newline ("one task = one line",
# cmux skill § agent-fleets). A multi-line item would submit its first line as the prompt
# and type the remainder as a SECOND prompt into the fresh session. Collapse whitespace.
ITEM=$(printf '%s' "$ITEM" | tr '\n\r\t' '   ' | sed 's/  */ /g; s/^ //; s/ $//')
[ -n "$ITEM" ] || die "work item is empty after whitespace normalization"

# ── helpers ─────────────────────────────────────────────────────────────────────

# Single-quote a string for safe embedding in a shell command line.
shq() {
	printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# conduct-<slug>. A ticket ID anywhere in the item wins; else the item text.
derive_name() {
	local raw="$1" s
	if printf '%s' "$raw" | grep -qE '[A-Za-z]{2,}-[0-9]+'; then
		s=$(printf '%s' "$raw" | grep -oE '[A-Za-z]{2,}-[0-9]+' | head -1)
	else
		s="$raw"
	fi
	s=$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//')
	if [ "${#s}" -gt 32 ]; then
		local cut_at_sep
		cut_at_sep=$(printf '%s' "$s" | cut -c33-33)
		s=$(printf '%s' "$s" | cut -c1-32)
		# dropped mid-word? drop the partial trailing segment rather than leave "…date-p"
		if [ "$cut_at_sep" != "-" ]; then
			case "$s" in
			*-*) s=$(printf '%s' "$s" | sed 's/-[^-]*$//') ;;
			esac
		fi
	fi
	s=$(printf '%s' "$s" | sed 's/-*$//')
	[ -n "$s" ] || s="item"
	printf 'conduct-%s' "$s"
}

# Human-readable label for a workspace id. Cosmetic — degrades to the raw id.
workspace_label() {
	local wid="$1" label=""
	if command -v python3 >/dev/null 2>&1; then
		label=$(CMUX_QUIET=1 "$CMUX" workspace list --json --id-format both 2>/dev/null |
			python3 -c '
import sys, json
try:
    want = sys.argv[1]
    for w in json.load(sys.stdin).get("workspaces", []):
        if w.get("id") == want:
            print(w.get("custom_title") or w.get("title") or "")
            break
except Exception:
    pass
' "$wid" 2>/dev/null || true)
	fi
	if [ -n "$label" ]; then
		printf '"%s" (%s)' "$label" "$wid"
	else
		printf '%s' "$wid"
	fi
}

# ── resolve the cmux binary ─────────────────────────────────────────────────────
CMUX="${CMUX_BIN:-}"
if [ -z "$CMUX" ]; then
	if command -v cmux >/dev/null 2>&1; then
		CMUX="$(command -v cmux)"
	elif [ -x /Applications/cmux.app/Contents/Resources/bin/cmux ]; then
		CMUX=/Applications/cmux.app/Contents/Resources/bin/cmux
	else
		die "cmux not found. Install the cmux app, or set CMUX_BIN=/path/to/cmux" 2
	fi
fi
[ -x "$CMUX" ] || die "cmux at '$CMUX' is not executable" 2

# ── preconditions ───────────────────────────────────────────────────────────────
if [ "$DRY_RUN" -eq 0 ]; then
	CMUX_QUIET=1 "$CMUX" ping >/dev/null 2>&1 ||
		die "cmux is installed but not responding. Open the cmux app and retry." 2
	command -v claude >/dev/null 2>&1 ||
		die "the 'claude' CLI is not on PATH — the launched workspace would have nothing to run." 2
fi

[ -d "$WS_CWD" ] || die "--cwd '$WS_CWD' is not a directory"

# ── the inside-cmux guard (conduct v2's no-sibling invariant) ───────────────────
# --dry-run is exempt so the command stays inspectable from inside cmux (the normal
# place to be); the dry-run output carries the same warning instead.
if [ -n "${CMUX_WORKSPACE_ID:-}" ] && [ "$FORCE_NEW" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
	cat >&2 <<EOF
$PROGNAME: already inside cmux workspace $(workspace_label "$CMUX_WORKSPACE_ID").
Nothing launched — cold start is for a plain shell, and minting a sibling workspace
is the placement bug conduct v2 fixed.

  Run this in your Claude session instead:
      /etk:conduct $ITEM
  Conduct's Container axis will nest the work under this workspace.

  If this work belongs to a different project (container mismatch), force a new one:
      $PROGNAME --new $(shq "$ITEM")
EOF
	exit 3
fi

# ── build the launch ────────────────────────────────────────────────────────────
[ -n "$WS_NAME" ] || WS_NAME="$(derive_name "$ITEM")"

CLAUDE_CMD="claude"
if [ -n "$CLAUDE_MODEL" ]; then
	CLAUDE_CMD="$CLAUDE_CMD --model $(shq "$CLAUDE_MODEL")"
fi
CLAUDE_CMD="$CLAUDE_CMD $(shq "/etk:conduct $ITEM")"

if [ "$DRY_RUN" -eq 1 ]; then
	if [ -n "${CMUX_WORKSPACE_ID:-}" ] && [ "$FORCE_NEW" -eq 0 ]; then
		printf 'NOTE: you are inside cmux — a real run would refuse (exit 3) and point you\n'
		printf '      at /etk:conduct in this session. Add --new to actually create one.\n\n'
	fi
	printf 'Would run:\n\n'
	printf '  %s workspace create \\\n' "$CMUX"
	printf '    --name %s \\\n' "$(shq "$WS_NAME")"
	printf '    --cwd %s \\\n' "$(shq "$WS_CWD")"
	printf '    --focus %s \\\n' "$FOCUS"
	printf '    --json \\\n'
	printf '    --command %s\n\n' "$(shq "$CLAUDE_CMD")"
	printf 'Workspace terminal would then run:\n\n  %s\n' "$CLAUDE_CMD"
	exit 0
fi

# --json is undocumented in `workspace create --help` but supported (verified on
# 0.64.20); it returns workspace_ref / surface_ref / window_ref / group_ref.
CREATE_OUT=$(CMUX_QUIET=1 "$CMUX" workspace create \
	--name "$WS_NAME" \
	--cwd "$WS_CWD" \
	--focus "$FOCUS" \
	--json \
	--command "$CLAUDE_CMD" 2>&1) || die "cmux workspace create failed: $CREATE_OUT" 2

WS_REF=$(printf '%s' "$CREATE_OUT" | grep -ao 'workspace:[0-9][0-9]*' | head -1 || true)
SURF_REF=$(printf '%s' "$CREATE_OUT" | grep -ao 'surface:[0-9][0-9]*' | head -1 || true)

if [ -n "$SURF_REF" ]; then
	printf 'Launched /etk:conduct in cmux workspace %s (surface %s)\n' "${WS_REF:-?}" "$SURF_REF"
else
	printf 'Launched /etk:conduct in cmux workspace %s\n' "${WS_REF:-?}"
fi
printf '  name:  %s\n' "$WS_NAME"
printf '  cwd:   %s\n' "$WS_CWD"
printf '  item:  %s\n' "$ITEM"
printf '\nConduct will classify, confirm, then place the work. Watch it with:\n'
printf '  %s read-screen --workspace %s\n' "${CMUX:-cmux}" "${WS_REF:-<ref>}"
printf 'Close it when done (only what you created):\n'
printf '  %s workspace close %s\n' "${CMUX:-cmux}" "${WS_REF:-<ref>}"
