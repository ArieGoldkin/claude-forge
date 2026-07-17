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
