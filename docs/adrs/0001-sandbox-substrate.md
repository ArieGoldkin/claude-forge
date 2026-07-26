# ADR-0001: Sandbox Substrate for Sandboxed ADW Dispatch

- **Status**: Proposed
- **Date**: 2026-07-24
- **Deciders**: Arie Goldkin
- **Tracking**: milestone [#1](https://github.com/ArieGoldkin/claude-forge/milestone/1) · issue [#44](https://github.com/ArieGoldkin/claude-forge/issues/44) (T1) · unblocks [#45](https://github.com/ArieGoldkin/claude-forge/issues/45) (T2)

> **This ADR is deliberately non-binding.** It records a *spike recommendation* so T2 can start, not a settled commitment. The T4 pilot (Gate 1) may overturn it; that is the intended workflow, not a failure of this document. Status moves `Proposed → Accepted` only after Gate 1.
>
> **Provenance**: every vendor figure below was fetched from vendor documentation on 2026-07-24/25 and then independently re-verified by an adversarial reviewer, which corrected four material errors in the first draft (cost model, cold-start framing, runtime list, region limits). Figures are dated because they drift.

## Context

`docs/artifacts/agentic-engineering-gap-analysis.html` maps 18 agentic-engineering concepts against this repo. Of those, exactly one is a hard **GAP**: **agent sandboxes — "a computer per agent."** Our isolation ceiling today is **git worktrees**, which share the host filesystem, host network, and host credentials. (The `worktree-create`/`worktree-remove` hooks manage *continuity state* for worktrees — they are evidence the repo works this way, not the isolation mechanism itself.)

Milestone #1 upgrades `etk:auto-research` from *route-goal→pick-a-skill* into *route-goal→dispatch a sandboxed ADW* (scout→plan→build→test running in isolation). That dispatcher needs an execution substrate. The locked decision (2026-07-24) is to **adopt an existing sandbox** rather than build a container-per-agent harness; this ADR picks which one and on what evidence.

**Forces at play:**

- **Isolation vs. friction.** A stronger boundary (cloud microVM) costs setup and money that a worktree does not.
- **Scope discipline.** The milestone is a *one-ADW pilot ending at Gate 1*. A substrate that takes weeks to stand up defeats the point of a pilot.
- **Pilot economics ≠ factory economics.** What is cheapest to *try* is not what is cheapest to *run at volume*. This ADR optimizes for the pilot and says so explicitly, because the two answers diverge here (see Decision §1 and the Negative consequences).
- **Repo identity.** All five plugins are domain-agnostic and install-and-go. A substrate requiring a cloud account collides with that — see the identity decision, the load-bearing part of this ADR.
- **Prior-art caution — applies symmetrically.** The gap analysis implies reuse because `ftk:agent-browser` references both vendors. Verified: **neither reference is code-execution reuse.** Both appear only as agent-browser *browser* providers — `agentcore` at `plugins/frontend-toolkit/skills/agent-browser/references/protocol-alignment.md:58-61` (`--provider agentcore`, browser-in-microVM), and `vercel-sandbox` at `.../agent-browser/SKILL.md:103` and `.../references/commands.md:330` (agent-browser *inside* Vercel Sandbox microVMs). We inherit documented credential shapes, not runnable ADW code. This is genuine net-new integration on both sides, and neither vendor gets an advantage from it.

### Provider comparison (vendor docs, fetched 2026-07-24/25)

| Axis | Vercel Sandbox | AWS Bedrock AgentCore (Code Interpreter) |
|---|---|---|
| Isolation | Firecracker microVM, own filesystem + network | microVM per session; terminated + memory-sanitized at session end. *(AWS docs are internally inconsistent: the Code Interpreter overview says "containerized environment"; session-characteristics says microVM.)* |
| **Repo access** | **Native** — `source: { url, revision, depth, username, password }` git-clone as a create param | S3-oriented file access; git clone is **scripted inside** the session |
| Max session | 24 h (Pro/Ent) · **45 min (Hobby)** | 8 h (default 15 min, configurable) |
| Runtimes | `node26`, `node24`, `node22`, `python3.13` (default `node24`); Amazon Linux 2023, sudo | Python / JS / TS (`python`, `nodejs`, `deno`) |
| **Billing dimensions** | **Five metrics.** Active CPU $0.128/hr · **Provisioned Memory $0.0212/GB-hr (wall-clock)** · Creations $0.60/1M · Data Transfer $0.15/GB (egress only; downloads free) · Snapshot Storage $0.08/GB-mo | CPU $0.0895/vCPU-hr + **Memory $0.00945/GB-hr**, per-second. Billing spans "microVM boot, initialization, active processing, **idle periods**, until session termination" |
| I/O-wait treatment | Not billed **for Active CPU**; Provisioned Memory still accrues | Not billed **for CPU**; memory bills the full session (AWS's own example: 48 s CPU vs 120 s memory) |
| Free/included tier | Hobby: 5 CPU-hr + 420 GB-hr + 5k creations + 20 GB transfer / mo. Overage **pauses creation, never charges** | None; pay-as-you-go from the first second |
| Startup latency | Vendor claims **"Sandboxes start in milliseconds"** (qualitative; no p50/p99 published) | **No vendor figure published** (docs say only "first request to a new instance has higher latency") |
| Egress control | `networkPolicy`: `allow-all` / `deny-all` / custom domain + CIDR allow/deny. *Header transformation/forwarding rules are Pro/Enterprise-gated* | IAM + VPC governed; configurable network modes |
| Concurrency / rate | Hobby 10 concurrent, 40 vCPU/10 min · Pro 2,000 concurrent, 200 vCPU/min | IAM/service quotas |
| Data residency | **`iad1` only** — no region choice | Standard AWS multi-region |
| Retention | Snapshots expire 30 days after last use (configurable) | Session data TTL **30 days** |
| Lifecycle extras | snapshot-on-stop (default), `fork()`, `extendTimeout()`, **≤4 exposed ports** (`@vercel/sandbox@2.9.0` `dist/sandbox.d.ts:51-54` — "Sandboxes can expose up to 4 ports"), multi-agent user isolation, Drives (beta — *not present in the 2.9.0 SDK surface*) | session lifecycle + CloudTrail audit logging |
| Auth model | Vercel account — OIDC token (recommended) or access token | AWS SigV4 / full IAM credential chain |
| Stack fit | Node/TS-native SDK (also Python); matches our tsup + vitest + biome toolchain | AWS-native; heavier IAM/VPC setup |

**Rate comparison (the two cost models are structurally similar, not incomparable):** both bill CPU-hours plus wall-clock memory GB-hours. On published rates **Vercel is the more expensive option — ~1.43× on CPU ($0.128 vs $0.0895) and ~2.24× on memory ($0.0212 vs $0.00945).** Vercel is nonetheless *cheaper for this pilot*, because its Hobby tier is free within limits and AgentCore bills from the first second. That inversion — cheap to pilot, costlier at volume — is the single most important economic fact in this document.

## Decision

**1. Use Vercel Sandbox as the substrate for the T4 pilot.** Reasons, strongest first:

- **Native git-clone as a create parameter.** A dispatcher's job is repo-in → result-out. Vercel takes the clone as one argument on `Sandbox.create()`; AgentCore requires a scripted clone inside the session. *Honest scope:* `username`/`password` are fields of that argument, so a PAT must still be minted and passed — Vercel removes a step and keeps the secret out of the guest's shell history, it does not remove credential plumbing. Real advantage, not a decisive one.
- **Stack fit.** Node/TS SDK against a TypeScript monorepo — T2's launcher lib is written in the same language as the rest of `shared/hooks-infra/`.
- **Free to pilot.** Hobby covers 5 CPU-hours + 420 GB-hours/month, and overage *pauses sandbox creation rather than charging*. The pilot can run at genuinely zero spend, with no billing-surprise tail.
- **Fastest path to a running prototype.** The `vercel:vercel-sandbox` skill and Vercel MCP tools are installed and reachable **in this session** (see the honesty note below).
- **Published startup claim favors it.** "Sandboxes start in milliseconds" is vendor-stated; AWS publishes nothing comparable for AgentCore. Qualitative and unverified — but it is the only published signal that exists, and it points this way.
- **Egress policy is first-class.** `networkPolicy` (`deny-all`, domain/CIDR allow-lists) maps onto the repo's parked `deniedDomains` posture (security audit #4). Note the *header-transformation* features — the ones that would let a dispatcher broker a token without handing it to the guest — are Pro/Enterprise-gated and unavailable on the Hobby tier this pilot proposes.

> **Honesty note on "reachable in-session":** the `vercel:vercel-sandbox` skill and Vercel MCP come from `vercel@claude-plugins-official` v0.45.1 installed at **user scope on the maintainer's machine** — they are *not* in this repo, unlike the AgentCore reference which is an in-repo file. This is a property of one laptop, not of the repo, CI, or any other operator, and it does not imply working Vercel credentials exist. It is a real convenience for *this* spike and should not be read as an architectural advantage.

**2. AWS Bedrock AgentCore is the documented fallback, and the likely better choice at factory scale.** It is cheaper on both metered rates, offers multi-region data residency (Vercel Sandbox is `iad1`-only), 8-hour sessions, IAM governance, and CloudTrail audit logging, and aligns with dtk's existing AWS/Bedrock surface. Revisit at Gate 1 if the pilot exposes a compliance, data-residency, or sustained-volume requirement. Its per-session teardown story is qualified by a 30-day session-data TTL.

**3. Identity — this is maintainer tooling, not a shipped plugin feature.** Both substrates require the *operator* to hold a cloud account and credentials (Vercel: account + OIDC/access token; AgentCore: SigV4/full IAM chain). A plugin that provisions billable cloud VMs by default violates the install-and-go, domain-agnostic posture every plugin here maintains — that alone is sufficient grounds, independent of any assumption about what share of installers hold cloud accounts.

Therefore:
- Sandboxed-ADW dispatch is built as **maintainer tooling for running claude-forge's own software factory**.
- **T2 must NOT bake sandbox provisioning into the shared ctk hooks that every installer runs.** Sandbox lifecycle wiring is opt-in and inert without explicit configuration.
- Plugin-ization is a **later, separate, opt-in bring-your-own-credentials decision**, gated on the pilot proving value — not assumed by this milestone.

## Consequences

### Positive
- T2 (#45) is unblocked with a concrete provider and SDK.
- The pilot runs at zero spend on Hobby, and the overage behavior (pause, don't bill) removes billing-surprise risk from an autonomous dispatcher.
- Native git-clone removes the largest single piece of T2 plumbing.
- The identity decision prevents the worst outcome of this milestone: silently turning five install-and-go plugins into cloud-account-requiring plugins.
- `networkPolicy` gives dispatched agents a real egress boundary — strictly better than a worktree, which inherits full host network and credentials.

### Negative
- **We are piloting on the more expensive substrate.** Vercel costs ~1.43× (CPU) and ~2.24× (memory) versus AgentCore on published rates. Fine for a free-tier pilot; a real cost question the moment volume is sustained. Gate 1 must revisit this rather than let the pilot choice harden by default.
- **Hobby's ceilings are low for a dispatcher**: 45-minute max duration, 10 concurrent sandboxes, 40 vCPU/10 min allocation rate. A fan-out dispatcher hits concurrency and rate limits well before the CPU-hour allowance. Pro ($20/mo, with a $20 usage credit) lifts these to 24 h / 2,000 / 200-per-min. **Whether a real ADW fits in 45 minutes is unknown until T4 measures it** — if it does not, "free pilot" becomes "$20/mo pilot."
- **`iad1`-only.** No data-residency choice at all. Disqualifying for any workload with regional requirements, and a live constraint on the compliance story.
- **Idle sandboxes cost money on paid tiers.** Provisioned Memory accrues on wall-clock, so an agent blocked on model calls still bills memory (~$0.085/hr at the 2 vCPU / 4 GB default). The launcher must stop sandboxes promptly rather than idle to timeout.
- **Vendor coupling** in the T2 launcher. Mitigate by keeping the provider behind a thin `provision / seed / exec / teardown` interface so AgentCore stays a swappable implementation, not a rewrite.
- **Cold-start latency is unmeasured.** Vercel's "milliseconds" is a marketing claim with no p50/p99 behind it; AWS publishes nothing. If provisioning is slow in practice, per-task sandboxes may be the wrong granularity (per-ADW or pooled instead). T4 measures it.
- **Maintainer-tool identity limits reach** — this benefits the maintainer first and should not consume budget earmarked for installer-facing plugin work.
- **A second account/credential** enters the workflow, with its own key-management burden.

### Neutral
- The two cost models are **directly comparable** (both = CPU-hours + wall-clock memory GB-hours); only the *tiering* differs — Vercel front-loads a free allowance, AWS bills from the first second. Real totals still require T4's measured numbers.
- Choosing Vercel now does not preclude AgentCore later; capability overlap is high and the thin-interface mitigation keeps the door open.

## Alternatives Considered

### A. AWS Bedrock AgentCore as the primary substrate
- **Pros:** cheaper on both metered rates; multi-region data residency; per-session microVM teardown with memory sanitization; CloudTrail audit logging; IAM/VPC governance; 8 h sessions; aligns with dtk's AWS/Bedrock surface.
- **Cons:** git clone must be scripted with credentials inside the session; heavier IAM/VPC setup before the first successful run; no free tier — a pilot bills from the first second; no in-session code-exec tooling today; 30-day session-data TTL qualifies the ephemerality story.
- **Why not chosen:** setup friction dominates at the pilot stage, and the pilot is the whole point of the milestone. Retained as the documented fallback and the **likely correct choice at factory scale or under compliance/data-residency requirements.**

### B. Build a container-per-agent harness (Docker/Podman locally)
- **Pros:** no vendor account; no per-run cost; runs offline; full control; no data-residency limit; no credential-model conflict with the plugins' install-and-go posture.
- **Cons:** we build and maintain provisioning, seeding, teardown, resource limits, and network policy ourselves — precisely the substrate work "adopt existing" was chosen to avoid; local containers share the host kernel (weaker isolation than a microVM); no path to parallel scale beyond one machine.
- **Why not chosen:** explicitly excluded by the locked 2026-07-24 decision. Recorded because it remains the natural answer *if* the identity decision is later reversed toward a shipped plugin feature — a local harness is the only option that does not require an installer to hold a cloud account.

### C. Stay on git worktrees (do nothing)
- **Pros:** zero new cost, zero new credentials, already shipped and working.
- **Cons:** shares host filesystem, network, and credentials — not isolation in any meaningful sense; leaves the milestone's one true GAP open; cannot support the L6–L9 rungs of the scaling ladder.
- **Why not chosen:** it is the status quo this milestone exists to move past. Still the correct fallback if Gate 1 rejects the dispatch premise.

## References

- `docs/artifacts/agentic-engineering-gap-analysis.html` — §5 (build-next, P1 chain), §7 (Phase 1 plan)
- Issues: [#43](https://github.com/ArieGoldkin/claude-forge/issues/43) (R1 report-return de-risk) · [#44](https://github.com/ArieGoldkin/claude-forge/issues/44) (this spike) · [#45](https://github.com/ArieGoldkin/claude-forge/issues/45) (T2) · [#46](https://github.com/ArieGoldkin/claude-forge/issues/46) (T3) · [#47](https://github.com/ArieGoldkin/claude-forge/issues/47) (T4 / Gate 1)
- [Vercel Sandbox overview](https://vercel.com/docs/sandbox) (isolation, runtimes, startup claim, auth) · [pricing and limits](https://vercel.com/docs/sandbox/pricing) (five metrics, plan ceilings, `iad1`) · [SDK reference](https://vercel.com/docs/sandbox/sdk-reference) (`source` git param, `networkPolicy`, `fork`, `extendTimeout`)
- [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/) (rates + the worked 30k-execution example) · [Code Interpreter session characteristics](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-session-characteristics.html) (microVM, 8 h, 30-day TTL) · [Code Interpreter tool](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/code-interpreter-tool.html)
- `plugins/frontend-toolkit/skills/agent-browser/references/protocol-alignment.md:58-61` and `.../agent-browser/SKILL.md:103` — both vendors appear only as **browser** providers (the prior art that is *not* code-exec reuse, symmetrically)

## Open questions for Gate 1 (T4 measures these)

1. **Does a real ADW fit in Hobby's 45 minutes**, or is Pro required? Decides whether "free pilot" holds.
2. **Measured cold-start latency** per sandbox — decides granularity (per-task, per-ADW, or pooled).
3. **Measured cost** of one full pilot run against a hand-run baseline — and, given Vercel's rate premium, at what volume AgentCore becomes the correct substrate.
4. **Does the result return intact?** Owned by R1 (#43) — the repo has a known, unfixed dispatch defect (named agents go idle and lose reports; a PreToolUse deny is terminal for a fork). A substrate that runs perfectly but loses its report is worthless to a dispatcher. *Observed live during this very spike: an adversarial-verifier subagent returned its preamble instead of its report while continuing to work for another 30 tool calls; the findings were recovered only from its on-disk transcript.*
