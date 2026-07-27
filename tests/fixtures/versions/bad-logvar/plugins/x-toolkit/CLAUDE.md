# Example Toolkit

> **Version**: 1.2.0

## Environment

```bash
X_TOOLKIT_LOG_LEVEL     # WRONG ON PURPOSE. The wrapper sets
                        # CLAUDE_PLUGIN_NAME="xtk", so production reads
                        # XTK_LOG_LEVEL and a user following this line would
                        # export a variable nothing has ever read.
```

This fixture also mentions the correct name (`XTK_LOG_LEVEL`) in the comment
above, which makes it a control for **set equality** rather than mere presence:
a check written as "the expected variable appears somewhere in CLAUDE.md" passes
this file, because the right name is right there.

Note on provenance — this is NOT the shape #63 had. In #63 the correct variable
appeared **nowhere** in the docs, so a presence check would have caught it. This
fixture pins the strictly harder case set equality was chosen for: a partial fix
that adds the correct name while leaving the wrong one in place.
