#!/usr/bin/env bash
# Usage: ./scripts/bump-version.sh <plugin-name> <new-version>
# Example: ./scripts/bump-version.sh continuity-toolkit 1.3.4
#
# Updates ALL version references atomically:
#   1. plugins/<name>/.claude-plugin/plugin.json
#   2. .claude-plugin/marketplace.json
# Then patches local cache so the current session picks it up immediately.

set -euo pipefail

PLUGIN="${1:-}"
VERSION="${2:-}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_BASE="$HOME/.claude/plugins/cache/claude-forge"
INSTALLED_PLUGINS="$HOME/.claude/plugins/installed_plugins.json"

# --- Validate args ---
if [[ -z "$PLUGIN" || -z "$VERSION" ]]; then
  echo "Usage: $0 <plugin-name> <new-version>"
  echo "       $0 continuity-toolkit 1.3.4"
  exit 1
fi

PLUGIN_JSON="$REPO_ROOT/plugins/$PLUGIN/.claude-plugin/plugin.json"
MARKETPLACE_JSON="$REPO_ROOT/.claude-plugin/marketplace.json"

if [[ ! -f "$PLUGIN_JSON" ]]; then
  echo "Error: $PLUGIN_JSON not found. Valid plugins:"
  ls "$REPO_ROOT/plugins/"
  exit 1
fi

# --- Read current version ---
CURRENT=$(python3 -c "import json; print(json.load(open('$PLUGIN_JSON'))['version'])")
echo "Bumping $PLUGIN: $CURRENT → $VERSION"

# --- 1. Update plugin.json ---
python3 - <<PYEOF
import json, sys
path = '$PLUGIN_JSON'
d = json.load(open(path))
d['version'] = '$VERSION'
open(path, 'w').write(json.dumps(d, indent=2) + '\n')
print(f"  ✓ plugins/$PLUGIN/.claude-plugin/plugin.json → $VERSION")
PYEOF

# --- 2. Update marketplace.json ---
python3 - <<PYEOF
import json
path = '$MARKETPLACE_JSON'
d = json.load(open(path))
updated = False
for p in d['plugins']:
    if p['name'] == '$PLUGIN':
        p['version'] = '$VERSION'
        updated = True
        break
if not updated:
    print(f"  ✗ '$PLUGIN' not found in marketplace.json", file=__import__('sys').stderr)
    __import__('sys').exit(1)
open(path, 'w').write(json.dumps(d, indent=2) + '\n')
print(f"  ✓ .claude-plugin/marketplace.json → $VERSION")
PYEOF

# --- 3. Patch local cache (if cache dir exists for new version) ---
CACHE_DIR="$CACHE_BASE/$PLUGIN/$VERSION/.claude-plugin/plugin.json"
if [[ -f "$CACHE_DIR" ]]; then
  python3 - <<PYEOF
import json
d = json.load(open('$CACHE_DIR'))
d['version'] = '$VERSION'
open('$CACHE_DIR', 'w').write(json.dumps(d, indent=2) + '\n')
print(f"  ✓ Patched local cache: $CACHE_DIR")
PYEOF
else
  echo "  ~ Cache $VERSION not yet populated (will be created on next autoUpdate)"
fi

# --- 4. Update installed_plugins.json to new version ---
if [[ -f "$INSTALLED_PLUGINS" ]]; then
  python3 - <<PYEOF
import json
path = '$INSTALLED_PLUGINS'
d = json.load(open(path))
key = '$PLUGIN@claude-forge'
if key in d.get('plugins', {}):
    entries = d['plugins'][key]
    for e in entries:
        if e.get('scope') == 'user':
            old_path = e.get('installPath', '')
            new_path = old_path.rsplit('/', 1)[0] + '/$VERSION'
            e['installPath'] = new_path
            e['version'] = '$VERSION'
    open(path, 'w').write(json.dumps(d, indent=2) + '\n')
    print(f"  ✓ installed_plugins.json → $VERSION")
else:
    print(f"  ~ {key} not in installed_plugins.json (not yet installed)")
PYEOF
fi

echo ""
echo "Done. Next steps:"
echo "  1. Update CHANGELOG.md in plugins/$PLUGIN/"
echo "  2. git add -A && git commit -m 'chore: bump $PLUGIN to $VERSION'"
echo "  3. git push origin main"
