---
description: Google NotebookLM programmatic access — create notebooks, manage sources (URLs, PDFs, YouTube, Drive), generate audio/video/slides/quizzes, and chat with documents. Use when building a research notebook, generating a podcast from docs, or querying a source collection. Triggers on notebooklm, podcast from docs, research notebook, audio overview, source grounding
---

# notebooklm

## Setup Verification

Before invoking the skill, verify the CLI is available:

```bash
notebooklm --version
```

If `command not found`:

1. Install: `uv tool install "notebooklm-py[browser]" --python 3.12`
2. Add to PATH if needed: add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc`
3. Install browser for OAuth: `uv tool run --from playwright playwright install chromium`
4. Authenticate: `notebooklm login` (opens browser for Google OAuth)
5. Verify: `notebooklm auth check --test`

If installed but auth expired, re-run `notebooklm login`.

## Skill

Invoking skill: atk:notebooklm

Follow the instructions in the notebooklm skill exactly.

$ARGUMENTS
