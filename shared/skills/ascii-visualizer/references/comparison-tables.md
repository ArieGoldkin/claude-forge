# Comparison Table Patterns

## 1. Feature Matrix

```
+-------------------+--------+--------+---------+
| Feature           | Option | Option | Option  |
|                   |   A    |   B    |   C     |
+-------------------+--------+--------+---------+
| Real-time sync    |   Y    |   Y    |   N     |
| Offline support   |   N    |   Y    |   Y     |
| Multi-tenant      |   Y    |   Y    |   Y     |
| HIPAA compliant   |   Y    |   N    |   Y     |
| Self-hosted       |   N    |   N    |   Y     |
+-------------------+--------+--------+---------+
  Y = supported, N = not supported
```

## 2. Trade-Off Analysis

```
+-------------------+----------------------------+----------------------------+
| Criterion         | Approach A: Monolith       | Approach B: Microservices  |
+-------------------+----------------------------+----------------------------+
| Deployment        | Single artifact, simple    | Per-service, complex       |
| Scaling           | Vertical only              | Horizontal per service     |
| Team autonomy     | Low (shared codebase)      | High (owned services)      |
| Latency           | In-process calls           | Network hops (+2-5ms)      |
| Debugging         | Single stack trace         | Distributed tracing needed |
| Initial cost      | Low                        | High                       |
+-------------------+----------------------------+----------------------------+
  RECOMMENDATION: Approach A for < 5 developers, Approach B for > 10
```

## 3. Technology Comparison

```
+------------------+--------------+--------------+--------------+
| Aspect           | PostgreSQL   | DynamoDB     | MongoDB      |
+------------------+--------------+--------------+--------------+
| Query language   | SQL          | PartiQL/API  | MQL          |
| Schema           | Strict       | Schemaless   | Flexible     |
| Transactions     | Full ACID    | Limited      | Multi-doc    |
| Scaling          | Vertical+    | Auto horiz.  | Sharding     |
| Cost model       | Instance hrs | R/W capacity | vCPU + I/O   |
| Best for         | Relational   | Key-value    | Documents    |
|                  | + analytics  | high scale   | + flexible   |
+------------------+--------------+--------------+--------------+
```

## 4. Status Dashboard

```
+------------------+----------+----------+--------+
| Service          | Status   | Uptime   | Notes  |
+------------------+----------+----------+--------+
| Auth API         |  [OK]    | 99.99%   |        |
| User Service     |  [OK]    | 99.95%   |        |
| Scoring Engine   | [WARN]   | 99.80%   | p95 up |
| Report Generator | [DOWN]   | 98.50%   | OOM    |
| Notification Svc |  [OK]    | 99.97%   |        |
+------------------+----------+----------+--------+
  [OK] = healthy  [WARN] = degraded  [DOWN] = outage
```

## 5. Priority Matrix (Effort vs Impact)

```
              Low Effort          High Effort
           +-------------------+-------------------+
           |                   |                   |
  High     |   QUICK WINS      |   MAJOR PROJECTS  |
  Impact   |                   |                   |
           |   - Add caching   |   - Replatform    |
           |   - Fix N+1 query |   - Multi-region  |
           |                   |                   |
           +-------------------+-------------------+
           |                   |                   |
  Low      |   FILL-INS        |   AVOID           |
  Impact   |                   |                   |
           |   - Rename vars   |   - Full rewrite  |
           |   - Update docs   |   - Custom ORM    |
           |                   |                   |
           +-------------------+-------------------+
```

## Tips

- **Consistent column widths** - Pad all cells to match the widest value.
- **Header separator line** - Always use `+---+` between header and body rows.
- **Legend below** - Define abbreviations (Y/N, status codes) outside the table.
- **Limit columns to 4-5** - More than that becomes hard to read in 80 chars.
