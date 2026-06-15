# Changelog

Monorepo-level changes. Each plugin also keeps its own `CHANGELOG.md` under `plugins/<name>/`.

## 2026-06-14 — first open-source release

Initial public release of **claude-dev-kit** — five domain-agnostic Claude Code plugins (ctk, dtk, atk, ftk, etk) sharing hook infrastructure via directory-level symlinks. MIT licensed.

- `/etk:review-mr` + `/etk:post-mr-comments` work against both GitLab MRs and GitHub PRs.
- CI runs on GitHub Actions (`.github/workflows/ci.yml`): per-plugin lint/typecheck/test matrix, shared-library tests, manifest-shape validation, and plugin-structure validation.

_Detailed pre-release history was internal and has been omitted from the open-source launch._
