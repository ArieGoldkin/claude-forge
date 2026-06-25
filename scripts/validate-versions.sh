#!/usr/bin/env bash
# Validates version consistency across all plugin version references.
# Run as a pre-commit hook or in CI.
# Exit 0 = all good. Exit 1 = mismatch found.
#
# Checks:
#   1. plugin.json version matches marketplace.json
#   2. CLAUDE.md "Version:" line matches plugin.json
#   3. CHANGELOG.md has an entry for the current version
#   4. README.md plugin table has the correct version

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKETPLACE_JSON="$REPO_ROOT/.claude-plugin/marketplace.json"
README_FILE="$REPO_ROOT/README.md"
FAILED=0

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
    if ! grep -q "\[$PLUGIN_VER\]" "$CHANGELOG" 2>/dev/null; then
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

  echo "  OK    $PLUGIN_NAME ($SHORT_NAME) @ $PLUGIN_VER"
done < <(find "$REPO_ROOT/plugins" -maxdepth 1 -mindepth 1 -type d | sort)

if [[ "$FAILED" -eq 1 ]]; then
  echo ""
  echo "Version mismatch detected. Run the fix commands above, then re-commit."
  exit 1
fi
