# Changelog

Monorepo-level changes. Each plugin also keeps its own `CHANGELOG.md` under `plugins/<name>/`.

## 2026-06-25 — rebranded to Claude Forge

Renamed the suite from **claude-dev-kit** to **Claude Forge**. Functional changes for installers:

- GitHub repository renamed `claude-dev-kit` → `claude-forge` (GitHub redirects the old URL).
- Marketplace identifier renamed `claude-dev-kit` → `claude-forge` in `.claude-plugin/marketplace.json`. **Existing installs must re-add the marketplace** (`/plugin marketplace add https://github.com/ArieGoldkin/claude-forge.git`) and reinstall plugins as `<plugin>@claude-forge`.
- Install commands, repository/homepage URLs, the `continuity-recommendation` hook's install hint, and the `bump-version` cache key all updated to `claude-forge`.
- All 5 plugins patch-bumped to ship the rebranded metadata; new logo added at `docs/assets/claude-forge-logo.jpeg`.
- Plugin short names (ctk/dtk/atk/ftk/etk) are unchanged.

## 2026-06-14 — first open-source release

Initial public release — originally shipped as **claude-dev-kit** (rebranded to **Claude Forge** on 2026-06-25). Five domain-agnostic Claude Code plugins (ctk, dtk, atk, ftk, etk) sharing hook infrastructure via directory-level symlinks. MIT licensed.

- `/etk:review-mr` + `/etk:post-mr-comments` work against both GitLab MRs and GitHub PRs.
- CI runs on GitHub Actions (`.github/workflows/ci.yml`): per-plugin lint/typecheck/test matrix, shared-library tests, manifest-shape validation, and plugin-structure validation.

_Detailed pre-release history was internal and has been omitted from the open-source launch._
