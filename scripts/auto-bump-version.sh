#!/usr/bin/env bash
# Auto-bump patch version for any plugin whose source files are staged.
#
# Called from the pre-commit hook BEFORE validate-versions.sh so the bump
# is included in the commit automatically — no developer action required.
#
# Source changes that trigger a bump (per plugin):
#   hooks/src/**  skills/**  agents/**  commands/**
#
# Ignored (no bump triggered):
#   hooks/dist/**  hooks/tests/**  CHANGELOG.md  CLAUDE.md  .claude-plugin/**
#
# Bump only happens when the staged version matches the version on main,
# meaning the developer hasn't already bumped manually.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUMP_SCRIPT="$REPO_ROOT/scripts/bump-version.sh"
BASE_BRANCH="${BASE_BRANCH:-main}"

# Staged files in this commit
STAGED=$(git diff --cached --name-only 2>/dev/null || true)

if [[ -z "$STAGED" ]]; then
  exit 0
fi

bumped_any=0

for plugin_dir in "$REPO_ROOT"/plugins/*/; do
  PLUGIN_NAME="$(basename "$plugin_dir")"
  PLUGIN_JSON="$plugin_dir/.claude-plugin/plugin.json"

  [[ -f "$PLUGIN_JSON" ]] || continue

  # Check if any source files for this plugin are staged
  source_changed=0
  while IFS= read -r file; do
    # Must be under this plugin's directory
    [[ "$file" == plugins/"$PLUGIN_NAME"/* ]] || continue

    # Strip plugin prefix
    rel="${file#plugins/$PLUGIN_NAME/}"

    # Match source paths only — not dist, tests, docs, or version files
    if [[ "$rel" == hooks/src/* ]] || \
       [[ "$rel" == skills/* ]] || \
       [[ "$rel" == agents/* ]] || \
       [[ "$rel" == commands/* ]]; then
      source_changed=1
      break
    fi
  done <<< "$STAGED"

  [[ "$source_changed" -eq 1 ]] || continue

  # Get current staged version
  CURRENT_VER=$(python3 -c "import json; print(json.load(open('$PLUGIN_JSON'))['version'])")

  # Get version on base branch (skip if plugin didn't exist there)
  BASE_VER=$(git show "$BASE_BRANCH:plugins/$PLUGIN_NAME/.claude-plugin/plugin.json" 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])" 2>/dev/null \
    || echo "NOT_FOUND")

  if [[ "$BASE_VER" == "NOT_FOUND" ]]; then
    echo "  NEW   $PLUGIN_NAME (no base version — skipping auto-bump)"
    continue
  fi

  if [[ "$CURRENT_VER" != "$BASE_VER" ]]; then
    echo "  OK    $PLUGIN_NAME @ $CURRENT_VER (already bumped from $BASE_VER)"
    continue
  fi

  # Version unchanged — auto-bump patch
  IFS='.' read -r major minor patch <<< "$CURRENT_VER"
  NEW_VER="$major.$minor.$((patch + 1))"

  echo "  BUMP  $PLUGIN_NAME: $CURRENT_VER → $NEW_VER (source changed, auto-bumping patch)"
  bash "$BUMP_SCRIPT" "$PLUGIN_NAME" "$NEW_VER" > /dev/null

  # Re-stage the bumped files
  git add \
    "$plugin_dir/.claude-plugin/plugin.json" \
    "$REPO_ROOT/.claude-plugin/marketplace.json" \
    2>/dev/null || true

  bumped_any=1
done

if [[ "$bumped_any" -eq 1 ]]; then
  echo ""
  echo "Version(s) auto-bumped and staged. Update CHANGELOG.md if needed, then commit again."
fi
