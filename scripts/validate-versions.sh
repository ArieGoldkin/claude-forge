#!/usr/bin/env bash
# Validates version consistency across all plugin version references.
# Run as a pre-commit hook or in CI.
# Exit 0 = all good. Exit 1 = mismatch found.
#
# Usage: validate-versions.sh [REPO_ROOT]
#   REPO_ROOT defaults to the repo containing this script. Pass an explicit
#   root to validate a fixture tree (used by the CI negative/positive fixtures).
#
# Checks (per plugin):
#   1. plugin.json version matches marketplace.json
#   2. plugin CLAUDE.md "Version:" line matches plugin.json
#   3. CHANGELOG.md has an entry for the current version
#   4. README.md plugin table has the correct version
#   5. root CLAUDE.md tree comment "(vX.Y.Z, installed as <short>)" matches
#      (Release Checklist item 6)
#   6. log-level env var identity agrees across wrapper / vitest.config / CLAUDE.md,
#      and the plugin name is a valid shell identifier (#63, #74)

set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MARKETPLACE_JSON="$REPO_ROOT/.claude-plugin/marketplace.json"
README_FILE="$REPO_ROOT/README.md"
ROOT_CLAUDE_MD="$REPO_ROOT/CLAUDE.md"
FAILED=0
CHECKED=0   # plugins actually validated -- guards against "silently validated nothing"

while IFS= read -r plugin_dir; do
  PLUGIN_NAME="$(basename "$plugin_dir")"
  PLUGIN_JSON="$plugin_dir/.claude-plugin/plugin.json"

  [[ -f "$PLUGIN_JSON" ]] || continue

  PLUGIN_VER=$(python3 -c "import json; print(json.load(open('$PLUGIN_JSON'))['version'])")
  # Short name (e.g. "ctk") is the marketplace / README / install identity;
  # the directory basename (e.g. "continuity-toolkit") is only a filesystem path.
  SHORT_NAME=$(python3 -c "import json; print(json.load(open('$PLUGIN_JSON')).get('name', '$PLUGIN_NAME'))")

  # --- Check 1: plugin.json vs marketplace.json ---
  MARKET_VER=$(python3 -c "
import json
d = json.load(open('$MARKETPLACE_JSON'))
match = next((p['version'] for p in d['plugins'] if p['name'] == '$SHORT_NAME'), None)
print(match or 'NOT_FOUND')
")

  if [[ "$MARKET_VER" == "NOT_FOUND" ]]; then
    echo "  SKIP  $PLUGIN_NAME (not in marketplace.json)"
    continue
  elif [[ "$PLUGIN_VER" != "$MARKET_VER" ]]; then
    echo "  FAIL  $PLUGIN_NAME: plugin.json=$PLUGIN_VER vs marketplace.json=$MARKET_VER"
    echo "        Fix: ./scripts/bump-version.sh $PLUGIN_NAME $PLUGIN_VER"
    FAILED=1
    continue
  fi

  # --- Check 2: CLAUDE.md version ---
  CLAUDE_MD="$plugin_dir/CLAUDE.md"
  if [[ -f "$CLAUDE_MD" ]]; then
    CLAUDE_VER=$(python3 -c "
import re, sys
text = open('$CLAUDE_MD').read()
m = re.search(r'\*\*Version\*\*:\s*([\d.]+)', text)
print(m.group(1) if m else 'NOT_FOUND')
")
    if [[ "$CLAUDE_VER" == "NOT_FOUND" ]]; then
      : # No version line in CLAUDE.md — skip silently
    elif [[ "$CLAUDE_VER" != "$PLUGIN_VER" ]]; then
      echo "  FAIL  $PLUGIN_NAME: CLAUDE.md=$CLAUDE_VER vs plugin.json=$PLUGIN_VER"
      echo "        Fix: Update '> **Version**:' in $CLAUDE_MD"
      FAILED=1
      continue
    fi
  fi

  # --- Check 3: CHANGELOG.md has entry for current version ---
  CHANGELOG="$plugin_dir/CHANGELOG.md"
  if [[ -f "$CHANGELOG" ]]; then
    # -F (fixed string): the dots in a version must be literal, not regex
    # "any char" -- otherwise "[1x2x0]" would satisfy the "[1.2.0]" check.
    if ! grep -qF "[$PLUGIN_VER]" "$CHANGELOG" 2>/dev/null; then
      echo "  FAIL  $PLUGIN_NAME: CHANGELOG.md missing entry for [$PLUGIN_VER]"
      echo "        Fix: Add ## [$PLUGIN_VER] section to $CHANGELOG"
      FAILED=1
      continue
    fi
  fi

  # --- Check 4: README.md plugin table version ---
  if [[ -f "$README_FILE" ]]; then
    README_VER=$(python3 -c "
import re
text = open('$README_FILE').read()
m = re.search(r'\[$SHORT_NAME\].*?\|\s*([\d.]+)', text)
print(m.group(1) if m else 'NOT_FOUND')
")
    if [[ "$README_VER" == "NOT_FOUND" ]]; then
      : # Plugin not in README table — skip
    elif [[ "$README_VER" != "$PLUGIN_VER" ]]; then
      echo "  FAIL  $PLUGIN_NAME: README.md=$README_VER vs plugin.json=$PLUGIN_VER"
      echo "        Fix: Update version in README.md plugin table"
      FAILED=1
      continue
    fi
  fi

  # --- Check 5: root CLAUDE.md tree comment (Release Checklist item 6) ---
  # e.g. "│   ├── continuity-toolkit/  # ... (v2.7.3, installed as ctk)"
  if [[ -f "$ROOT_CLAUDE_MD" ]]; then
    ROOT_VER=$(python3 -c "
import re
text = open('$ROOT_CLAUDE_MD').read()
m = re.search(r'\(v([\d.]+),\s*installed as $SHORT_NAME\)', text)
print(m.group(1) if m else 'NOT_FOUND')
")
    if [[ "$ROOT_VER" == "NOT_FOUND" ]]; then
      : # Not listed in the root tree comment -- skip
    elif [[ "$ROOT_VER" != "$PLUGIN_VER" ]]; then
      echo "  FAIL  $PLUGIN_NAME: root CLAUDE.md=(v$ROOT_VER) vs plugin.json=$PLUGIN_VER"
      echo "        Fix: update '(vX.Y.Z, installed as $SHORT_NAME)' in $ROOT_CLAUDE_MD"
      FAILED=1
      continue
    fi
  fi

  # --- Check 6: log-level env var identity (wrapper vs tests vs CLAUDE.md) ---
  # Issue #63 shipped THREE disagreeing names for ONE variable: production read
  # `AI_LOG_LEVEL` (wrapper sets CLAUDE_PLUGIN_NAME="ai"), tests ran as
  # `ai-toolkit`, and CLAUDE.md documented `AI_TOOLKIT_LOG_LEVEL` -- so a user
  # following the documentation exported a variable nothing has ever read.
  #
  # Issue #74 then found there was no signal for any of it: corrupting the
  # documented name left the plugin suite (765 tests), the shared suite (1217)
  # and this script all at exit 0, and nothing under scripts/, .github/ or
  # tools/ mentioned LOG_LEVEL at all. These checks are that missing signal.
  WRAPPER="$plugin_dir/hooks/bin/run-hook-wrapper.sh"
  VITEST_CONFIG="$plugin_dir/hooks/vitest.config.ts"
  if [[ -f "$WRAPPER" ]]; then
    HOOK_NAME=$(sed -n 's/^[[:space:]]*export[[:space:]][[:space:]]*CLAUDE_PLUGIN_NAME="\([^"]*\)".*/\1/p' "$WRAPPER" | head -1)

    if [[ -z "$HOOK_NAME" ]]; then
      echo "  FAIL  $PLUGIN_NAME: $WRAPPER does not export CLAUDE_PLUGIN_NAME"
      echo "        Fix: add 'export CLAUDE_PLUGIN_NAME=\"<short-name>\"' -- without it logging"
      echo "             silently falls back to the name 'plugin' for every hook in this plugin"
      FAILED=1
      continue
    fi

    # 6a. The name is upper-cased into a SHELL variable name, so it must be a
    # valid shell identifier. `export AI-TOOLKIT_LOG_LEVEL=debug` is rejected by
    # sh as "not a valid identifier" while Node's process.env accepts the key
    # happily -- a knob that can be read but never set. Root CLAUDE.md's "Adding
    # a New Plugin" states the constraint; this is where it is enforced.
    if ! [[ "$HOOK_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "  FAIL  $PLUGIN_NAME: CLAUDE_PLUGIN_NAME=\"$HOOK_NAME\" is not a valid shell identifier"
      echo "        Fix: use only [A-Za-z_][A-Za-z0-9_]* in $WRAPPER --"
      echo "             the name is upper-cased into \${NAME}_LOG_LEVEL, which a POSIX shell must be able to export"
      FAILED=1
      continue
    fi

    EXPECTED_LOG_VAR="$(printf '%s' "$HOOK_NAME" | tr '[:lower:]' '[:upper:]')_LOG_LEVEL"

    # 6b. Tests must run under the PRODUCTION identity. This is #63 exactly.
    if [[ -f "$VITEST_CONFIG" ]]; then
      TEST_NAME=$(sed -n "s/^[[:space:]]*CLAUDE_PLUGIN_NAME:[[:space:]]*['\"]\([^'\"]*\)['\"].*/\1/p" "$VITEST_CONFIG" | head -1)
      if [[ -n "$TEST_NAME" ]] && [[ "$TEST_NAME" != "$HOOK_NAME" ]]; then
        echo "  FAIL  $PLUGIN_NAME: vitest.config.ts runs as \"$TEST_NAME\" but production runs as \"$HOOK_NAME\""
        echo "        Fix: set CLAUDE_PLUGIN_NAME: '$HOOK_NAME' in $VITEST_CONFIG"
        FAILED=1
        continue
      fi
    fi

    # 6c. CLAUDE.md must document EXACTLY the variable production reads.
    # Set equality, not mere presence: #63's docs named a variable that existed
    # nowhere, so a "the right name appears somewhere" check would have passed
    # with the wrong name sitting right beside it.
    if [[ -f "$CLAUDE_MD" ]]; then
      DOC_VARS=$(grep -oE '[A-Za-z_][A-Za-z0-9_]*_LOG_LEVEL' "$CLAUDE_MD" | sort -u || true)
      if [[ "$DOC_VARS" != "$EXPECTED_LOG_VAR" ]]; then
        echo "  FAIL  $PLUGIN_NAME: CLAUDE.md documents [${DOC_VARS//$'\n'/, }] but production reads $EXPECTED_LOG_VAR"
        echo "        Fix: document exactly $EXPECTED_LOG_VAR in $CLAUDE_MD"
        echo "             (derived from CLAUDE_PLUGIN_NAME=\"$HOOK_NAME\" in $WRAPPER)"
        FAILED=1
        continue
      fi
    fi
  fi

  CHECKED=$((CHECKED + 1))
  echo "  OK    $PLUGIN_NAME ($SHORT_NAME) @ $PLUGIN_VER"
done < <(find "$REPO_ROOT/plugins" -maxdepth 1 -mindepth 1 -type d | sort)

# Guard against the failure this script has a documented history of: keying on
# the wrong identity silently SKIPped every plugin and passed while validating
# nothing. If a plugins/ tree exists, at least one plugin must have been checked.
if [[ -d "$REPO_ROOT/plugins" ]] && [[ "$CHECKED" -eq 0 ]] && [[ "$FAILED" -eq 0 ]]; then
  echo "  FAIL  validated 0 plugins -- a plugins/ tree exists but nothing matched."
  echo "        This is the 'silently validated nothing' failure mode; check name/marketplace wiring."
  FAILED=1
fi

if [[ "$FAILED" -eq 1 ]]; then
  echo ""
  echo "Version mismatch detected. Run the fix commands above, then re-commit."
  exit 1
fi
