# Sentry API Reference

## Authentication

```bash
# Primary: 1Password CLI
SENTRY_AUTH_TOKEN=$(op read "op://<your-vault>/sentry-api-token/credential" 2>/dev/null)

# Fallback: environment variable
SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN:-}"

# Validate token
curl -sf -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/organizations/<your-org>/" > /dev/null
```

If `op` CLI fails: ask the user for the correct `op://` vault path or a manually exported `SENTRY_AUTH_TOKEN`.

## API Endpoints

Base URL: `https://sentry.io/api/0/`
Org slug: `<your-org>`
Auth header: `Authorization: Bearer $SENTRY_AUTH_TOKEN`

### Resolve short ID to numeric issue ID

```
GET /organizations/{org}/issues/?query={SHORT_ID}&limit=1
```

Response: array of issue objects. Extract `id` (numeric) from first result.

### Issue details

```
GET /issues/{ISSUE_ID}/
```

Key fields: `title`, `status`, `priority`, `substatus`, `firstSeen`, `lastSeen`, `count`, `userCount`, `project.slug`, `platform`.

### Events (paginated)

```
GET /issues/{ISSUE_ID}/events/?full=true&limit=100
```

Per event: `dateCreated`, `user`, `release`, `tags`, `contexts` (browser, OS), `entries` (stack traces, breadcrumbs), `context.url`.

### Tag distributions

```
GET /issues/{ISSUE_ID}/tags/
```

Returns array of tag keys with `topValues` (value + count). Useful keys: `release`, `browser`, `os`, `environment`, `url`, `user`.

### Tag key detail

```
GET /issues/{ISSUE_ID}/tags/{TAG_KEY}/values/
```

Full distribution for a specific tag (e.g., all releases with counts).

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 401 | Token expired/invalid | Ask user to refresh |
| 404 | Issue not found | Verify short ID format |
| 429 | Rate limited | Wait, retry with backoff |
| 200 + empty results | No events | Note in assessment |
