---
name: ascii-visualizer
description: "Use when writing an ASCII diagram INTO A FILE — architecture, workflows, comparison tables, or file trees that must render identically in any font, diff viewer, or CI log. For a quick inline picture in the chat instead, use quickviz. Triggers on ascii diagram, box drawing, architecture diagram, file tree, workflow diagram, monospace diagram, text diagram, diagram in docs"
paths:
  - "**/*.md"
  - "**/*.txt"
  - "docs/**"
---

# ASCII Visualizer

## Character Palette

### Box Drawing

| Purpose        | Characters         | Example            |
|----------------|--------------------|--------------------|
| Corners        | `+`                | `+----+`           |
| Horizontal     | `-`                | `------`           |
| Vertical       | `\|`               | `\|    \|`         |
| T-junctions    | `+`                | `+----+----+`      |
| Arrows right   | `-->`              | `A --> B`          |
| Arrows left    | `<--`              | `A <-- B`          |
| Arrows both    | `<-->`             | `A <--> B`         |
| Arrows down    | `v`                | `\|` then `v`      |
| Arrows up      | `^`                | `^` then `\|`      |
| Rounded        | `/` `\`            | `/----\`           |
| Double line    | `=` `\|\|`         | `+====+`           |
| Dashed         | `- -` or `...`     | `A - - > B`        |
| Cross          | `+`                | Lines crossing     |

### File Trees

| Purpose       | Characters |
|---------------|------------|
| Branch        | `├──`      |
| Last branch   | `└──`      |
| Continuation  | `│`        |
| Directory     | `/`        |

## Architecture Diagrams

Use box-and-arrow diagrams to show system components and their connections.

### Three-Tier Web Application

```
+------------------+     +------------------+     +------------------+
|   Browser / App  |     |    API Gateway   |     |    Database       |
|                  |---->|                  |---->|                  |
|  React SPA       |     |  Lambda + REST   |     |  PostgreSQL      |
|  Amplify Auth    |     |  Cognito Auth    |     |  RDS Multi-AZ    |
+------------------+     +------------------+     +------------------+
        |                         |                        |
        v                         v                        v
   CloudFront              CloudWatch Logs           Automated Backups
```

**Key rules:**
- All boxes same width within a row
- Arrows show data flow direction
- Labels inside boxes describe technology
- Annotations below for supporting services

See [references/architecture-diagrams.md](${CLAUDE_SKILL_DIR}/references/architecture-diagrams.md) for 6 architecture patterns.

## Workflow Diagrams

Use flowcharts to illustrate processes, decisions, and branching logic.

### Decision-Branch Workflow

```
                    +------------------+
                    |  Receive Request |
                    +--------+---------+
                             |
                             v
                    +--------+---------+
                    | Validate Input   |
                    +--------+---------+
                             |
                    +--------+---------+
                    | Auth Required?   |
                    +---+----------+---+
                        |          |
                   Yes  |          |  No
                        v          v
              +---------+--+  +----+---------+
              | Check Token|  | Process      |
              +-----+------+  | Directly     |
                    |         +----+---------+
               +----+----+        |
               | Valid?   |       |
               +--+----+--+      |
                  |    |          |
             Yes  |    | No      |
                  v    v         |
            +-----++ +--+----+  |
            |Process| |Return |  |
            |Request| |  401  |  |
            +---+---+ +-------+  |
                |                 |
                v                 v
            +---+-----------------+---+
            |    Return Response      |
            +-------------------------+
```

**Key rules:**
- Decision diamonds can use `+---+` boxes with Yes/No labels on branches
- Keep vertical flow top-to-bottom
- Merge paths back together when they converge

See [references/workflow-diagrams.md](${CLAUDE_SKILL_DIR}/references/workflow-diagrams.md) for 6 workflow patterns.

## Comparison Tables

Use ASCII tables for feature comparisons, trade-off analysis, and status tracking.

### Feature Matrix

```
+-------------------+--------+--------+---------+
| Feature           | Plan A | Plan B | Plan C  |
+-------------------+--------+--------+---------+
| Real-time sync    |   Y    |   Y    |   N     |
| Offline support   |   N    |   Y    |   Y     |
| Cost (monthly)    |  $50   | $120   |  $30    |
| Setup complexity  |  Low   |  High  |  Med    |
| SOC2 compliant    |   Y    |   Y    |   N     |
+-------------------+--------+--------+---------+
  Y = supported, N = not supported
```

**Key rules:**
- Column headers aligned and padded consistently
- Use short values (Y/N, High/Med/Low) for readability
- Add a legend row below if abbreviations are used

See [references/comparison-tables.md](${CLAUDE_SKILL_DIR}/references/comparison-tables.md) for 5 table patterns.

## File Trees

Use tree notation to document project structures with annotations.

### Annotated Project Tree

```
my-api/
├── src/
│   ├── handlers/              # Lambda function handlers
│   │   ├── auth.py            # Authentication endpoints
│   │   ├── users.py           # User CRUD operations
│   │   └── reports.py         # Reporting workflows
│   ├── models/                # SQLAlchemy ORM models
│   │   ├── user.py            # User + tenant isolation
│   │   └── report.py          # Report data model
│   ├── services/              # Business logic layer
│   │   └── analytics.py       # Analytics engine
│   └── lib/                   # Shared utilities
│       ├── db.py              # Database connection pool
│       └── auth.py            # Token validation
├── migrations/                # Alembic migrations
│   └── versions/
├── tests/                     # Pytest test suite
├── pyproject.toml             # Dependencies + config
├── template.yaml              # SAM/CloudFormation template
└── README.md
```

**Key rules:**
- Use `├──` for items with siblings below, `└──` for last item
- Use `│` for continuation lines
- Annotations after `#` with consistent alignment
- Show depth selectively (expand important directories, collapse others)

See [references/file-trees.md](${CLAUDE_SKILL_DIR}/references/file-trees.md) for 5 tree patterns.

## Creation Checklist

Before finalizing any ASCII diagram:

1. **Monospace safe** - Verify alignment in a monospace font (not proportional)
2. **Width under 80 chars** - Fits standard terminals and markdown renderers
3. **Consistent box widths** - Boxes in the same row should be the same width
4. **Arrow direction matches data flow** - `-->` for requests, `<--` for responses
5. **Labels inside boxes** - Not floating between boxes
6. **Whitespace is intentional** - Padding inside boxes is consistent (1-2 spaces)
7. **No orphaned connectors** - Every arrow starts and ends at a box
8. **Legend included** - If abbreviations or symbols need explanation
9. **Wrapped in code fence** - Always use triple backticks in markdown
10. **No Unicode box-drawing** - Stick to ASCII (`+`, `-`, `|`) for maximum compatibility
11. **Vertical alignment** - Pipes (`|`) in columns line up across rows
12. **Tested copy-paste** - Diagram survives copy-paste without corruption

## Alignment & Spacing Rules

### Monospace Verification

Always preview diagrams in a monospace font. Proportional fonts will break alignment. In markdown, wrap all diagrams in triple-backtick code fences.

### 80-Character Width Limit

```
|<-- keep diagrams within this width ---------------------------------------->|
```

If a diagram exceeds 80 characters:
- Abbreviate labels
- Stack components vertically instead of horizontally
- Split into multiple diagrams with a connecting narrative

### Consistent Box Widths

Within a row, all boxes should have the same width:

```
GOOD:                              BAD:
+----------+  +----------+        +------+  +----------------+
| Service A|  | Service B|        |Svc A |  | Service B Long |
+----------+  +----------+        +------+  +----------------+
```

### Padding Inside Boxes

Use 1 space of padding on each side:

```
GOOD:                    BAD:
+----------+            +----------+
| Database |            |Database  |
+----------+            +----------+
```

## Common Mistakes

| Mistake                      | Fix                                        |
|------------------------------|--------------------------------------------|
| Mixed box widths in a row    | Pad shorter labels to match longest         |
| Unicode box-drawing chars **in a file** | Use ASCII only: `+`, `-`, `\|` — see the surface note below |
| Arrows without endpoints     | Every `-->` must connect two boxes          |
| Diagrams outside code fences | Always wrap in triple backticks             |
| Exceeding 80-char width      | Abbreviate or stack vertically              |
| Proportional font testing    | Always verify in monospace                  |
| Inconsistent padding         | Use 1 space padding on all sides            |
| Missing flow direction       | Add arrow labels or a legend                |

## References

- [Architecture Diagram Patterns](${CLAUDE_SKILL_DIR}/references/architecture-diagrams.md)
- [Workflow Diagram Patterns](${CLAUDE_SKILL_DIR}/references/workflow-diagrams.md)
- [Comparison Table Patterns](${CLAUDE_SKILL_DIR}/references/comparison-tables.md)
- [File Tree Patterns](${CLAUDE_SKILL_DIR}/references/file-trees.md)
- [Troubleshooting Guide](${CLAUDE_SKILL_DIR}/references/troubleshooting.md)
- [Diagram Templates](${CLAUDE_SKILL_DIR}/templates/diagram-templates.md)

## ⚠ Which surface — this skill is ASCII-only ON PURPOSE

**This skill's palette is `+ - |`, and that is scoped to its output surface: diagrams written INTO A FILE.** A committed file may be read in any font, any diff viewer, any CI log, and any locale, so it gets the maximally portable character set. The "Unicode box-drawing chars" row above is about *that* surface — it is not a repo-wide ban.

**For a picture rendered inline in the chat, use `quickviz` instead**, which uses Unicode box-drawing (`┌─┐ │`) because a chat reply is rendered by exactly one client. That palette is correct there and **must not be carried back into a file**.

The boundary is stated in both skills deliberately. A rule that lives in one file and not its neighbour is how the next author picks the wrong palette.

## Related Skills

- `quickviz` - The inline-chat counterpart. Unicode palette, renders immediately, never writes a file. Use it when the answer *is* the picture; use this skill when the picture goes into a document.
- `brainstorming` - Use ASCII diagrams to illustrate brainstorming outputs
- `devops-deployment` - Diagram CI/CD pipelines and infrastructure
- `architecture-decision-record` - Visualize architectural options in ADRs
- `api-design-framework` - Diagram API request/response flows
