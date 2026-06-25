# File Tree Patterns

## Table of Contents
- [1. Basic Project Structure](#1-basic-project-structure)
- [2. Deep Nesting with Annotations](#2-deep-nesting-with-annotations)
- [3. Selective Expansion](#3-selective-expansion)
- [4. Monorepo](#4-monorepo)
- [5. Plugin / Extension Structure](#5-plugin--extension-structure)
- [Tips](#tips)

## 1. Basic Project Structure

```
my-project/
├── src/
│   ├── index.ts
│   ├── config.ts
│   └── utils.ts
├── tests/
│   └── index.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 2. Deep Nesting with Annotations

```
acme-platform/
├── backend/
│   ├── src/
│   │   ├── handlers/              # Lambda entry points
│   │   │   ├── auth.py            # POST /auth/login, /auth/register
│   │   │   ├── users.py           # CRUD /users
│   │   │   └── orders.py          # GET/POST /orders
│   │   ├── services/              # Business logic (no HTTP)
│   │   │   ├── pricing.py         # Pricing engine
│   │   │   └── notifications.py   # Email/SMS dispatch
│   │   ├── models/                # SQLAlchemy ORM models
│   │   │   ├── base.py            # DeclarativeBase + mixins
│   │   │   ├── user.py            # User + tenant isolation
│   │   │   └── order.py           # Order + line items
│   │   └── lib/                   # Shared utilities
│   │       ├── db.py              # Connection pool + session
│   │       └── auth.py            # JWT validation helpers
│   ├── migrations/                # Alembic version scripts
│   └── tests/                     # pytest suite
├── frontend/
│   ├── src/
│   │   ├── components/            # React components
│   │   ├── hooks/                 # Custom React hooks
│   │   └── pages/                 # Route-level components
│   └── public/
└── infrastructure/
    ├── template.yaml              # SAM/CloudFormation
    └── terraform/                 # IaC modules
```

## 3. Selective Expansion

Show only the directories relevant to the current discussion:

```
acme-api/
├── src/
│   ├── handlers/
│   │   └── ...                    # (5 files)
│   ├── services/
│   │   ├── pricing.py             # <-- Focus: order pricing
│   │   │   ├── calculate_total()  #     Main entry point
│   │   │   ├── apply_discounts()  #     Discount rules
│   │   │   └── normalize()        #     Total normalization
│   │   └── ...                    # (3 other services)
│   └── ...
└── tests/
    └── test_pricing.py            # <-- Related tests
```

## 4. Monorepo

```
monorepo/
├── packages/
│   ├── shared/                    # Shared types + utilities
│   │   ├── src/
│   │   └── package.json
│   ├── ui-kit/                    # Component library
│   │   ├── src/
│   │   └── package.json
│   └── api-client/                # Generated API client
│       ├── src/
│       └── package.json
├── apps/
│   ├── web/                       # Main web application
│   │   ├── src/
│   │   └── package.json
│   └── admin/                     # Admin portal
│       ├── src/
│       └── package.json
├── tools/                         # Build + dev scripts
├── package.json                   # Workspace root
└── turbo.json                     # Turborepo config
```

## 5. Plugin / Extension Structure

```
acme-toolkit/
├── .claude-plugin/
│   └── plugin.json                # Plugin manifest
├── skills/
│   ├── ascii-visualizer/          # <-- This skill
│   │   ├── SKILL.md
│   │   ├── references/
│   │   └── templates/
│   ├── api-design-framework/
│   └── ...                        # (58 skills total)
├── agents/
│   ├── devops-architect.md
│   └── ...                        # (12 agents total)
├── commands/
│   └── ...                        # (14 commands)
├── hooks/
│   ├── src/                       # TypeScript source
│   └── dist/                      # Compiled JS
└── CLAUDE.md                      # Plugin instructions
```

## Tips

- **`├──` for siblings, `└──` for last child** - Consistent tree characters.
- **`│` for continuation** - Align vertically with parent `├──`.
- **Annotations after `#`** - Align `#` at a consistent column (e.g., col 40).
- **Use `...` for collapsed sections** - Show count in parens: `(5 files)`.
- **Expand only what matters** - Full trees are noisy; selective expansion is clearer.
