---
name: observability-monitoring
description: |
  Structured logging, metrics, distributed tracing, and alerting strategies for production
  systems. Use when implementing CloudWatch/Datadog logging, setting up Prometheus metrics,
  configuring OpenTelemetry tracing, creating PagerDuty/OpsGenie alerts, or debugging
  production issues. Covers AWS Lambda Powertools logging patterns, correlation IDs for
  request tracing, metric dashboards with Grafana, error tracking with Sentry, and SLO/SLA
  monitoring. Handles log aggregation, anomaly detection, and incident response workflows.
paths:
  - "**/*logging*"
  - "**/*metrics*"
  - "**/*monitor*"
  - "**/*tracing*"
---

# Observability & Monitoring Skill

Comprehensive frameworks for implementing observability including structured logging, metrics, distributed tracing, and alerting.

## When to Use

- Setting up application monitoring
- Implementing structured logging
- Adding metrics and dashboards
- Configuring distributed tracing
- Creating alerting rules
- Debugging production issues

## Three Pillars of Observability

```
┌─────────────────┬─────────────────┬─────────────────┐
│     LOGS        │     METRICS     │     TRACES      │
├─────────────────┼─────────────────┼─────────────────┤
│ What happened   │ How is system   │ How do requests │
│ at specific     │ performing      │ flow through    │
│ point in time   │ over time       │ services        │
└─────────────────┴─────────────────┴─────────────────┘
```

## Structured Logging

### Log Levels

| Level | Use Case |
|-------|----------|
| **ERROR** | Unhandled exceptions, failed operations |
| **WARN** | Deprecated API, retry attempts |
| **INFO** | Business events, successful operations |
| **DEBUG** | Development troubleshooting |

### Best Practice

```typescript
// Good: Structured with context
logger.info('User action completed', {
  action: 'purchase',
  userId: user.id,
  orderId: order.id,
  duration_ms: 150
});

// Bad: String interpolation
logger.info(`User ${user.id} completed purchase`);
```

> See `${CLAUDE_SKILL_DIR}/templates/structured-logging.ts` for Winston setup and request middleware

## Metrics Collection

### RED Method (Rate, Errors, Duration)

Essential metrics for any service:
- **Rate** - Requests per second
- **Errors** - Failed requests per second
- **Duration** - Request latency distribution

### Prometheus Buckets

```typescript
// HTTP request latency
buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]

// Database query latency
buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1]
```

> See `${CLAUDE_SKILL_DIR}/templates/prometheus-metrics.ts` for full metrics configuration

## Distributed Tracing

### OpenTelemetry Setup

Auto-instrument common libraries:
- Express/HTTP
- PostgreSQL
- Redis

### Manual Spans

```typescript
tracer.startActiveSpan('processOrder', async (span) => {
  span.setAttribute('order.id', orderId);
  // ... work
  span.end();
});
```

> See `${CLAUDE_SKILL_DIR}/templates/opentelemetry-tracing.ts` for full setup

### Claude Code SDK Trace Context (CC v2.1.110+)

SDK/headless sessions automatically read `TRACEPARENT` and `TRACESTATE` from the environment for distributed trace linking. Set these in your CI pipeline to connect Claude Code sessions into your existing trace graph:

```bash
# In CI pipeline (e.g., GitLab CI)
export TRACEPARENT="00-$(openssl rand -hex 16)-$(openssl rand -hex 8)-01"
claude --headless -p "run tests and report results"
# The session's tool calls inherit this trace context
```

This enables correlation between CI pipeline spans and Claude Code tool invocations in your observability backend (Jaeger, Datadog, Grafana Tempo).

### Claude Code OTEL Events & Metrics (CC v2.1.180+)

Beyond trace context, Claude Code emits structured OTEL telemetry you can ship to your collector:

- **`model` attribute on metrics (CC v2.1.180)** — token/cost/duration metrics are now tagged with the model id (e.g. `claude-opus-4-8`), so you can break down spend and latency per model in Grafana/Datadog. Group your cost dashboards by this attribute.
- **`claude_code.assistant_response` log event (CC v2.1.193)** — emits the assistant's responses as OTEL logs. **Redacted by default**; set `OTEL_LOG_ASSISTANT_RESPONSES=1` to include response bodies. Leave redaction on in any environment where transcripts may contain sensitive data (PII/PHI/secrets) — opt in only for trusted debugging.

```bash
# Ship Claude Code telemetry to an OTLP collector
export OTEL_EXPORTER_OTLP_ENDPOINT="http://collector:4317"
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
# Opt in to response-body logging ONLY for trusted/non-sensitive sessions:
# export OTEL_LOG_ASSISTANT_RESPONSES=1
```

## Alerting Strategy

### Severity Levels

| Level | Response Time | Examples |
|-------|---------------|----------|
| **Critical (P1)** | < 15 min | Service down, data loss |
| **High (P2)** | < 1 hour | Major feature broken |
| **Medium (P3)** | < 4 hours | Increased error rate |
| **Low (P4)** | Next day | Warnings |

### Key Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| ServiceDown | `up == 0` for 1m | Critical |
| HighErrorRate | 5xx > 5% for 5m | Critical |
| HighLatency | p95 > 2s for 5m | High |
| LowCacheHitRate | < 70% for 10m | Medium |

> See `${CLAUDE_SKILL_DIR}/templates/alerting-rules.yml` for Prometheus alerting rules

## Health Checks

### Kubernetes Probes

| Probe | Purpose | Endpoint |
|-------|---------|----------|
| **Liveness** | Is app running? | `/health` |
| **Readiness** | Ready for traffic? | `/ready` |
| **Startup** | Finished starting? | `/startup` |

### Readiness Response

```json
{
  "status": "healthy|degraded|unhealthy",
  "checks": {
    "database": { "status": "pass", "latency_ms": 5 },
    "redis": { "status": "pass", "latency_ms": 2 }
  },
  "version": "1.0.0",
  "uptime": 3600
}
```

> See `${CLAUDE_SKILL_DIR}/templates/health-checks.ts` for implementation

## Observability Checklist

### Implementation
- [ ] JSON structured logging
- [ ] Request correlation IDs
- [ ] RED metrics (Rate, Errors, Duration)
- [ ] Business metrics
- [ ] Distributed tracing
- [ ] Health check endpoints

### Alerting
- [ ] Service outage alerts
- [ ] Error rate thresholds
- [ ] Latency thresholds
- [ ] Resource utilization alerts

### Dashboards
- [ ] Service overview
- [ ] Error analysis
- [ ] Performance metrics

## Extended Thinking Triggers

Use Opus 4.5 extended thinking for:
- **Incident investigation** - Correlating logs, metrics, traces
- **Alert tuning** - Reducing noise, catching real issues
- **Architecture decisions** - Choosing monitoring solutions
- **Performance debugging** - Cross-service latency analysis

## Templates Reference

| Template | Purpose |
|----------|---------|
| `structured-logging.ts` | Winston logger with request middleware |
| `prometheus-metrics.ts` | HTTP, DB, cache metrics with middleware |
| `opentelemetry-tracing.ts` | Distributed tracing setup |
| `alerting-rules.yml` | Prometheus alerting rules |
| `health-checks.ts` | Liveness, readiness, startup probes |
