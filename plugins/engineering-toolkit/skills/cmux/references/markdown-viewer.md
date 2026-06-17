# cmux Markdown Viewer

Detailed reference for the cmux live markdown renderer — loaded from the cmux skill (SKILL.md) when you actually need to drive the viewer. Covers reusing one right-hand pane instead of spawning strays, swapping the displayed file (close-FIRST order), and the failure modes that otherwise waste turns.

### Reuse the existing right markdown pane (don't spawn strays)

`markdown open` **creates a new pane every time** by default, even with `--direction right`. To keep all docs as tabs in ONE right pane:

```bash
# 1. Find the right pane and its surfaces (anchor to THIS workspace)
cmux list-panes --workspace "$CMUX_WORKSPACE_ID"
cmux list-pane-surfaces --pane pane:10        # the right/helper pane

# 2. Open targeting an existing markdown surface IN that pane (reuses pane, adds tab)
cmux markdown open /abs/path/file.md --surface surface:12 --focus false

# 3. If it STILL spawned a new pane (it can), move the new surface in + verify
cmux move-surface --surface surface:NEW --pane pane:10 --focus false
cmux list-panes --workspace "$CMUX_WORKSPACE_ID"   # confirm stray pane is gone
```

### Swapping the file in the single right pane (close-FIRST, then open)

To replace the doc shown in your one right markdown pane, the only reliable order is **close the previous surface FIRST, then `markdown open` the new file fresh** — never move an existing viewer, never open-then-close.

```bash
cmux list-panes --workspace "$CMUX_WORKSPACE_ID"
cmux close-surface --surface surface:PREV        # 1. right side goes empty
cmux markdown open /abs/path/new.md --direction right --focus false   # 2. open fresh
```

ORDER MATTERS: close-previous BEFORE open-new. Opening first then closing the old one, or `move-surface`-ing an existing viewer, leaves the right pane BLANK.

### Hard-won lessons (avoid the trial-and-error)

- **Surface refs are global, not per-workspace.** A ref like `surface:126` from an earlier `markdown open` may live in a different window/workspace. Always re-list (`list-panes` / `list-pane-surfaces`) before reusing a ref — never assume a ref from a previous turn is still in the right pane.
- **`move-surface`-ing a markdown viewer often leaves it BLANK.** The moved surface keeps `type=markdown` and `surface-health` looks fine but renders nothing. Fix: `close-surface` it and `cmux markdown open <path>` fresh, then move the _fresh_ surface if needed. Don't waste time on `refresh-surfaces` — it usually won't fix a moved-then-blank viewer.
- **You cannot screenshot or `read-screen` a markdown surface** (`Surface is not a terminal`; browser screenshot is WKWebView-only). To verify a markdown viewer rendered, ask the user or open the file in a browser surface instead.
- **`cmux list-surfaces` does not exist.** Use `cmux list-pane-surfaces [--pane ...]`.
