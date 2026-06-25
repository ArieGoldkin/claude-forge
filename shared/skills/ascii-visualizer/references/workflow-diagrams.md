# Workflow Diagram Patterns

## Table of Contents
- [1. Linear Flow](#1-linear-flow)
- [2. Decision Tree](#2-decision-tree)
- [3. Parallel Execution (Fork/Join)](#3-parallel-execution-forkjoin)
- [4. State Machine](#4-state-machine)
- [5. Swimlane Diagram](#5-swimlane-diagram)
- [6. Pipeline with Stages](#6-pipeline-with-stages)
- [Tips](#tips)

## 1. Linear Flow

```
+----------+     +----------+     +----------+     +----------+
| Receive  |---->| Validate |---->| Process  |---->| Respond  |
| Request  |     | Input    |     | Data     |     | to Client|
+----------+     +----------+     +----------+     +----------+
```

## 2. Decision Tree

```
                +------------------+
                |  Check User Role |
                +--------+---------+
                         |
              +----------+----------+
              |                     |
         Admin?                   User?
              |                     |
              v                     v
     +--------+--------+  +--------+--------+
     | Show Admin Panel|  | Show Dashboard  |
     +--------+--------+  +--------+--------+
              |                     |
         +----+----+           +----+----+
         | Has MFA?|           | Active? |
         +--+---+--+           +--+---+--+
            |   |                 |   |
          Yes   No              Yes   No
            |   |                 |   |
            v   v                 v   v
         +--++ +--+---+       +--++ +--+---+
         |Skip| |Prompt|      |Load| |Renew |
         | MFA| | MFA  |     |Data| |Prompt |
         +----+ +------+     +----+ +------+
```

## 3. Parallel Execution (Fork/Join)

```
                +------------------+
                |  Start Pipeline  |
                +--------+---------+
                         |
              +----------+----------+
              |          |          |
              v          v          v
        +-----+--+ +----+---+ +---+------+
        | Lint   | | Unit   | | Security |
        | Check  | | Tests  | | Scan     |
        +-----+--+ +----+---+ +---+------+
              |          |          |
              +----------+----------+
                         |
                         v
                +--------+---------+
                |  All Passed?     |
                +---+----------+---+
                    |          |
                  Yes          No
                    |          |
                    v          v
             +------+--+  +---+--------+
             | Deploy  |  | Notify     |
             | to Env  |  | + Block    |
             +---------+  +------------+
```

## 4. State Machine

```
+----------+   create    +----------+   submit    +----------+
|          |------------>|          |------------>|          |
|  Draft   |             | Pending  |             | Review   |
|          |<------------|          |             |          |
+----------+   reject    +-----+----+             +----+-----+
                               |                       |
                          cancel|                approve|  reject
                               |                   +---+---+
                               v                   |       |
                        +------+---+               v       v
                        | Canceled |         +-----+-+ +---+------+
                        +----------+         |Approved| | Rejected |
                                             +---+----+ +----------+
                                                 |
                                                 v
                                           +-----+----+
                                           | Published|
                                           +----------+
```

## 5. Swimlane Diagram

```
  Client          API Gateway        Lambda           Database
    |                  |                |                  |
    |  POST /user      |                |                  |
    |----------------->|                |                  |
    |                  | invoke         |                  |
    |                  |--------------->|                  |
    |                  |                |  INSERT INTO     |
    |                  |                |----------------->|
    |                  |                |     OK           |
    |                  |                |<-----------------|
    |                  |   201 Created  |                  |
    |                  |<---------------|                  |
    |   201 + body     |                |                  |
    |<-----------------|                |                  |
    |                  |                |                  |
```

## 6. Pipeline with Stages

```
+--------+    +--------+    +--------+    +--------+    +--------+
| Source |    | Build  |    |  Test  |    | Stage  |    |  Prod  |
|        |--->|        |--->|        |--->|        |--->|        |
| GitLab |    | Docker |    | pytest |    | Deploy |    | Deploy |
| Push   |    | Build  |    | + lint |    | to QA  |    | to Prod|
+--------+    +--------+    +--------+    +--------+    +--------+
                                              |
                                              v
                                         +---------+
                                         | Manual  |
                                         | Approval|
                                         +---------+
```

## Tips

- **Top-to-bottom** for sequential flows, **left-to-right** for pipelines.
- **Label branches** with conditions (Yes/No, role names, events).
- **Merge lines** when parallel paths converge to show synchronization.
- **Swimlanes** use vertical pipes (`|`) as column separators.
