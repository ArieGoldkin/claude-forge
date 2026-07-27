# Example Toolkit

> **Version**: 1.2.0

## Environment

```bash
X_TOOLKIT_LOG_LEVEL     # WRONG ON PURPOSE (issue #63). The wrapper sets
                        # CLAUDE_PLUGIN_NAME="xtk", so production reads
                        # XTK_LOG_LEVEL and a user following this line would
                        # export a variable nothing has ever read.
```

This fixture deliberately mentions the correct name (`XTK_LOG_LEVEL`) in the
comment above as well. That makes it a control for **set equality** rather than
mere presence: a check written as "the expected variable appears somewhere in
CLAUDE.md" passes this file, because the right name is right there. Only a check
that rejects any *other* `*_LOG_LEVEL` name catches it — which is the shape #63
actually had, a wrong name sitting beside the documentation users read.
