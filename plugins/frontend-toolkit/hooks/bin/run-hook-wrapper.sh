#!/bin/sh
# Frontend Toolkit Plugin - Resilient Hook Wrapper
#
# Defense-in-depth wrapper that ensures Claude Code always receives valid JSON,
# even when Node.js or the compiled bundle is unavailable.
#
# Usage (from hooks.json):
#   sh ${CLAUDE_PLUGIN_ROOT}/hooks/bin/run-hook-wrapper.sh <hook-name>
#
# This script:
# 1. Derives CLAUDE_PLUGIN_ROOT from its own location if env var not set
# 2. Checks that dist/ exists (compiled bundle)
# 3. Checks that node is in PATH
# 4. Executes the Node.js hook runner
# 5. Validates output is valid JSON
# 6. Falls back to safe JSON on any failure
#
# POSIX-compatible (no bash required — works on Alpine, Debian, macOS).
# NEVER exits non-zero — Claude Code treats non-zero as a hook error.

set -eu

# Safe fallback JSON — allows operation to continue silently
SAFE_JSON='{"continue":true,"suppressOutput":true}'

# Derive plugin root from script location if not set
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  CLAUDE_PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  export CLAUDE_PLUGIN_ROOT
fi

# Set plugin name for shared library (logging, etc.)
export CLAUDE_PLUGIN_NAME="frontend"

HOOK_NAME="${1:-}"

if [ -z "$HOOK_NAME" ]; then
  echo "$SAFE_JSON"
  exit 0
fi

# Check compiled bundle exists
HOOK_RUNNER="$CLAUDE_PLUGIN_ROOT/hooks/dist/bin/run-hook.js"
if [ ! -f "$HOOK_RUNNER" ]; then
  echo '{"continue":true,"systemMessage":"⚠ frontend-toolkit: compiled hooks not found. Run: cd hooks && npm run build"}'
  exit 0
fi

# Resolve node binary — probe common locations when not on bare PATH
resolve_node() {
  if [ -n "${CLAUDE_NODE_PATH:-}" ] && [ -x "$CLAUDE_NODE_PATH" ]; then echo "$CLAUDE_NODE_PATH"; return 0; fi
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  for p in /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node; do [ -x "$p" ] && echo "$p" && return 0; done
  for nvm_dir in "${NVM_DIR:-$HOME/.nvm}" "$HOME/.nvm" "/usr/local/share/nvm"; do
    if [ -d "$nvm_dir/versions/node" ]; then
      latest=$(ls -1 "$nvm_dir/versions/node" 2>/dev/null | sort -V | tail -1)
      [ -n "$latest" ] && [ -x "$nvm_dir/versions/node/$latest/bin/node" ] && echo "$nvm_dir/versions/node/$latest/bin/node" && return 0
    fi
  done
  if [ -d "${FNM_DIR:-$HOME/.fnm}/node-versions" ]; then
    latest=$(ls -1 "${FNM_DIR:-$HOME/.fnm}/node-versions" 2>/dev/null | sort -V | tail -1)
    [ -n "$latest" ] && [ -x "${FNM_DIR:-$HOME/.fnm}/node-versions/$latest/installation/bin/node" ] && echo "${FNM_DIR:-$HOME/.fnm}/node-versions/$latest/installation/bin/node" && return 0
  fi
  [ -x "${VOLTA_HOME:-$HOME/.volta}/bin/node" ] && echo "${VOLTA_HOME:-$HOME/.volta}/bin/node" && return 0
  return 1
}
NODE_BIN=$(resolve_node) || NODE_BIN=""
if [ -z "$NODE_BIN" ]; then
  WARN_MARKER="/tmp/.claude-plugin-node-warn-${PPID:-0}"
  if [ ! -f "$WARN_MARKER" ]; then
    echo '{"continue":true,"systemMessage":"⚠ frontend-toolkit: node not found. Install Node.js or set CLAUDE_NODE_PATH in settings.json env. Checked: PATH, /usr/local/bin, nvm, fnm, volta."}'
    touch "$WARN_MARKER" 2>/dev/null || true
  else echo "$SAFE_JSON"; fi
  exit 0
fi

# Read stdin into variable (hooks receive JSON on stdin)
INPUT=""
if [ ! -t 0 ]; then
  INPUT=$(cat)
fi

# Execute the Node.js hook runner, capturing stdout and stderr separately
OUTPUT=""
if [ -n "$INPUT" ]; then
  OUTPUT=$(printf '%s' "$INPUT" | "$NODE_BIN" "$HOOK_RUNNER" "$HOOK_NAME" 2>/dev/null) || true
else
  OUTPUT=$("$NODE_BIN" "$HOOK_RUNNER" "$HOOK_NAME" 2>/dev/null) || true
fi

# Validate output is non-empty and looks like JSON
if [ -n "$OUTPUT" ] && printf '%s\n' "$OUTPUT" | head -1 | grep -q '^{'; then
  # Output the last line that starts with { (the JSON result)
  printf '%s\n' "$OUTPUT" | grep '^{' | tail -1
else
  echo "$SAFE_JSON"
fi

exit 0
