# agent-browser Command Reference

> **Curated snapshot of upstream v0.27.3.** This static file is for offline reference and discovery. The **authoritative, always-version-matched** reference is served by the installed CLI:
> ```bash
> agent-browser skills get core --full   # every command, flag, alias, env var + templates
> ```
> Run that when the CLI is installed; fall back to this snapshot otherwise. All commands run as `agent-browser <command>`.

## Table of Contents

- [Navigation](#navigation)
- [Snapshot](#snapshot)
- [Interaction](#interaction)
- [Keyboard](#keyboard)
- [Extraction](#extraction)
- [Check State](#check-state)
- [Wait](#wait)
- [Semantic Find](#semantic-find)
- [Scroll](#scroll)
- [Mouse](#mouse)
- [Screenshot](#screenshot)
- [Recording](#recording)
- [Clipboard](#clipboard)
- [Diff](#diff)
- [Batch](#batch)
- [Session and State](#session-and-state)
- [Auth Vault](#auth-vault)
- [Cookies and Storage](#cookies-and-storage)
- [Network](#network)
- [Console](#console)
- [Dialog Handling](#dialog-handling)
- [Tab Management](#tab-management)
- [Frame Management](#frame-management)
- [Browser Emulation](#browser-emulation)
- [React Introspection and Web Vitals](#react-introspection-and-web-vitals)
- [AI Chat](#ai-chat)
- [Doctor and Skills](#doctor-and-skills)
- [Stream (Live Preview)](#stream-live-preview)
- [Profiler](#profiler)
- [JavaScript Execution](#javascript-execution)
- [Debugging](#debugging)
- [Browser Control](#browser-control)
- [Global Flags](#global-flags)
- [Environment Variables](#environment-variables)

## Navigation

| Command | Description |
|---------|-------------|
| `open <url>` | Open a page / navigate (primary verb; starts browser if needed) |
| `navigate <url>` | Alias for `open` |
| `back` / `forward` / `reload` | History navigation |
| `pushstate <url>` | Client-side SPA navigation, no full page load (auto-detects Next router) |
| `close [--all]` | Close current browser session (or all sessions) |

## Snapshot

| Command | Description |
|---------|-------------|
| `snapshot` | Full accessibility-tree snapshot (verbose) |
| `snapshot -i` | Interactive elements only, with `@e1`, `@e2` refs (**preferred**) |
| `snapshot -u` / `--urls` | Include `href` URLs on link elements |
| `snapshot -c` | Compact (drop empty structural nodes) |
| `snapshot -d <n>` | Cap tree depth at `n` levels |
| `snapshot -s "<css>"` | Scope snapshot to a CSS selector subtree |
| `snapshot --json` | Machine-readable output |

Refs are reassigned on every snapshot and go stale on any page change — re-snapshot before the next ref interaction. (Note: the old `-C`/`--cursor` flag was removed in v0.22.0; cursor elements are included by default.)

## Interaction

| Command | Description |
|---------|-------------|
| `click @ref` / `click "<css>"` | Click element (ref, CSS selector) |
| `click @ref --new-tab` | Open the link in a new tab instead of navigating |
| `dblclick @ref` | Double-click |
| `fill @ref "text"` | Clear field, then type (inputs) |
| `type @ref "text"` | Append text without clearing |
| `press <key>` | Press a key at current focus (e.g. `press Enter`, `press Control+a`) — no ref needed |
| `select @ref "value" ["value2" …]` | Select dropdown option(s) |
| `check @ref` / `uncheck @ref` | Toggle checkbox/radio |
| `hover @ref` / `focus @ref` / `blur @ref` | Pointer/focus control |
| `upload @ref <file> [<file> …]` | Set file input(s) |
| `drag @from @to` | Drag and drop |
| `clear @ref` | Clear input field |
| `scrollintoview @ref` | Scroll element into view |

## Keyboard

| Command | Description |
|---------|-------------|
| `keyboard type "text"` | Type text with key events |
| `keyboard inserttext "text"` | Insert text directly (no key events — bypasses custom inputs) |
| `keyboard press "key"` | Press key (Enter, Tab, ArrowDown, Control+a, …) |

## Extraction

| Command | Description |
|---------|-------------|
| `get text @ref` | Visible text content |
| `get html @ref` | Outer/inner HTML |
| `get value @ref` | Input/select value |
| `get attr @ref "name"` | Attribute by name (alias of `get attribute`) |
| `get count "<css>"` | Count matching elements |
| `get box @ref` | Bounding box (x, y, width, height) |
| `get styles @ref` | Computed styles |
| `get title` / `get url` | Page title / current URL |

## Check State

| Command | Description |
|---------|-------------|
| `is visible @ref` | Element visible |
| `is enabled @ref` | Element enabled |
| `is checked @ref` | Checkbox/radio checked |
| `is editable @ref` | Element editable |

## Wait

| Command | Description |
|---------|-------------|
| `wait @ref` | Until element appears |
| `wait --load <state>` | Load state: `networkidle`, `domcontentloaded`, `load` |
| `wait --text "text"` | Until text appears on page |
| `wait --url "pattern"` | Until URL matches glob pattern |
| `wait --fn "<js>"` | Until JS expression is truthy |
| `wait <ms>` | Fixed wait in milliseconds (last resort) |

Default timeout is 25s. Prefer element/text/url/network waits over fixed `wait <ms>`.

## Semantic Find

Find an element and (optionally) act on it in one command — no prior snapshot needed:

| Command | Description |
|---------|-------------|
| `find role <role> <action> [--name "…"] [--exact]` | By ARIA role, e.g. `find role button click --name "Submit"` |
| `find text "…" <action> [--exact]` | By visible text, e.g. `find text "Sign In" click` |
| `find label "…" <action>` | By associated label, e.g. `find label "Email" fill "user@test.com"` |
| `find placeholder "…" <action>` | By placeholder |
| `find testid "…" <action>` | By `data-testid` |
| `find first "<css>" <action>` / `find nth <n> "<css>" <action>` | First / nth match |

Reliability order for AI agents: snapshot + `@eN` refs > `find role/text/label` > raw CSS selectors.

## Scroll

| Command | Description |
|---------|-------------|
| `scroll up\|down\|left\|right [px]` | Scroll page by amount (e.g. `scroll down 500`) |
| `scroll --to top\|bottom` | Scroll to page extremes |
| `scrollintoview @ref` | Scroll a specific element into view |

## Mouse

| Command | Description |
|---------|-------------|
| `mouse move <x> <y>` | Move to coordinates |
| `mouse down` / `mouse up` | Press / release button |
| `mouse click <x> <y>` / `mouse dblclick <x> <y>` | Click at coordinates |
| `mouse wheel <dx> <dy>` | Scroll wheel (positive = down/right) |

## Screenshot

| Command | Description |
|---------|-------------|
| `screenshot [path]` | Viewport screenshot (temp path printed if omitted) |
| `screenshot --full [path]` | Full scroll-height screenshot |
| `screenshot --annotate [path]` | Numbered element labels; `[N]` maps to ref `@eN` (built for multimodal models) |
| `pdf [path]` | Save page as PDF |

Flags: `--screenshot-format png\|jpeg`, `--screenshot-quality 0-100`, `--screenshot-dir <path>`, `--hide-scrollbars true\|false`.

## Recording

| Command | Description |
|---------|-------------|
| `record start [path]` | Start video recording (WebM/VP9, no audio) |
| `record stop` | Stop recording |
| `record restart` | Stop current and start new |

See [video-recording.md](video-recording.md) for codec options and GIF export.

## Clipboard

| Command | Description |
|---------|-------------|
| `clipboard read` / `clipboard write "text"` | Read / write clipboard |
| `clipboard copy @ref` / `clipboard paste @ref` | Copy element content / paste into element |

## Diff

| Command | Description |
|---------|-------------|
| `diff snapshot <file1> <file2>` | Compare two snapshots (ARIA-tree diffing) |
| `diff screenshot <file1> <file2>` | Visual screenshot comparison |
| `diff url <url1> <url2>` | Compare two URLs side by side |

## Batch

Run multiple commands in one invocation, from stdin or inline args:

```bash
echo '[{"command":"open","args":["https://example.com"]},{"command":"snapshot","args":["-i"]}]' | agent-browser batch
```

Inline-argument mode (no stdin) was added in v0.25.0.

## Session and State

| Command | Description |
|---------|-------------|
| `--session <name>` | Use a named, isolated browser session (own cookies/tabs/refs) |
| `state save <path>` / `state load <path>` | Save / load session state (cookies + localStorage) |
| `state list` / `state show <name>` | Inspect saved states |
| `state rename <old> <new>` / `state clear <name>` / `state clean` | Manage saved states |
| `--state <path>` | Start a command from a saved state file |
| `--session-name <name>` | Auto-save/restore session state by name |

## Auth Vault

| Command | Description |
|---------|-------------|
| `auth save <name> [--url <login-url> --username <user> --password-stdin]` | Save encrypted auth state (read password from stdin) |
| `auth login <name>` | Restore saved auth; fills credentials and submits |

Encrypted with AES-256-GCM. Set `AGENT_BROWSER_ENCRYPTION_KEY`.

## Cookies and Storage

| Command | Description |
|---------|-------------|
| `cookies` | Get all cookies |
| `cookies set <name> <value> [--domain <d>]` | Set a cookie |
| `cookies set --curl <file>` | Bulk import (auto-detects JSON, cURL, and Cookie-header formats) |
| `cookies clear` | Clear all cookies |
| `storage local [get\|set] [<key> [<value>]]` | localStorage access |
| `storage session [get\|set] [<key> [<value>]]` | sessionStorage access |

## Network

| Command | Description |
|---------|-------------|
| `network requests [--type <t>] [--method <m>] [--status <code>]` | List tracked requests |
| `network request <id>` | Details of a specific request |
| `network route "<glob>" --body <response>` | Mock a response |
| `network route "<glob>" --abort` | Block matching requests |
| `network route "<glob>" --resource-type <csv>` | Filter intercepts by CDP resource type |
| `network har start [path]` / `network har stop [path]` | HAR recording |

## Console

| Command | Description |
|---------|-------------|
| `console` | All console messages |
| `console --type error\|warning\|log` | Filter by type |
| `errors` | Page errors (shortcut for `console --type error`) |

## Dialog Handling

| Command | Description |
|---------|-------------|
| `dialog status` | Pending-dialog state |
| `dialog accept ["text"]` | Accept (optional prompt input) |
| `dialog dismiss` | Cancel |

`alert` and `beforeunload` are auto-accepted so agents never block.

## Tab Management

| Command | Description |
|---------|-------------|
| `tab` | List open tabs (with stable `tabId`) |
| `tab new [--label <name>] [<url>]` | New tab (optionally labeled / navigated), switches to it |
| `tab <t2\|label>` | Switch to a tab by stable id or label |
| `tab close <t2\|label>` | Close a tab |

Tab ids are **stable strings** (`t1`, `t2`, …) that don't shift when other tabs open/close. **Bare integers are rejected** with a teaching error — always use `t<N>` or a label. After switching tabs, prior-tab refs no longer apply — re-snapshot.

## Frame Management

| Command | Description |
|---------|-------------|
| `frame @ref` | Switch context into an iframe (refs from `snapshot -i`) |
| `frame main` | Return to the main frame |
| `frame list` | List frames |

Iframes are auto-inlined in snapshots — their refs work transparently without switching. Cross-origin iframes that block accessibility access are silently skipped.

## Browser Emulation

| Command | Description |
|---------|-------------|
| `set viewport <w> <h>` | Viewport dimensions |
| `set device "iPhone 15"` | Emulate device (viewport, UA, touch) |
| `set geo <lat> <lon>` | Geolocation |
| `set offline true\|false` | Toggle offline mode |
| `set media <feature> <value>` | Media feature (e.g. prefers-reduced-motion) |
| `set color-scheme dark\|light` | Preferred color scheme |

## React Introspection and Web Vitals

First-class React DevTools integration (any React app: Next.js, Remix, Vite+React, CRA, TanStack Start, RN Web). Requires the DevTools hook at launch via `--enable react-devtools`:

| Command | Description |
|---------|-------------|
| `open --enable react-devtools <url>` | Launch with the React DevTools hook installed |
| `react tree` | Component tree |
| `react inspect <fiberId>` | Per-fiber props, hooks, state, source |
| `react renders start` / `react renders stop` | Re-render recording + profile (mount/re-render counts, change details) |
| `react suspense [--only-dynamic]` | Suspense boundaries + root-cause classifier |
| `vitals [url] [--json]` | Core Web Vitals (LCP, CLS, TTFB, FCP, INP) + React hydration phases |

`react …` commands error without `--enable react-devtools`. `vitals` and `pushstate` work on any site regardless of framework.

## AI Chat

| Command | Description |
|---------|-------------|
| `chat "<task>"` | Single-shot AI-driven automation (the agent calls any agent-browser command) |
| `chat` | Interactive REPL |

Requires `AI_GATEWAY_API_KEY`; model via `--model` or `AI_GATEWAY_MODEL`. Also available in the observability dashboard.

## Doctor and Skills

| Command | Description |
|---------|-------------|
| `doctor [--offline] [--quick] [--fix] [--json]` | Diagnose install (env, Chrome, daemons, config, security, providers, network, live launch). `--fix` runs repairs |
| `skills get <name> [--full]` | Print a built-in skill (`core`, `electron`, `slack`, `dogfood`, `vercel-sandbox`, `agentcore`). `--full` includes references + templates |
| `skills list` | List skills available on the installed version |
| `skills add` | Install agent skills (with eval support for testing against live sessions) |

`doctor` auto-cleans stale socket/pid/version sidecar files on every run. Run it first when a command fails unexpectedly (`Unknown command`, `Failed to connect`, version mismatch).

## Stream (Live Preview)

| Command | Description |
|---------|-------------|
| `stream enable [--port <port>]` | Enable live-preview WebSocket stream |
| `stream status` / `stream disable` | Status / disable |

The observability **dashboard** (embedded in the binary, port **4848**) provides live session views, status, stream traffic, and an AI chat — no separate install. Configure the stream port via `AGENT_BROWSER_STREAM_PORT` (default 9223).

## Profiler

| Command | Description |
|---------|-------------|
| `profiler start [path]` / `profiler stop` | Performance profiling |

See [profiling.md](profiling.md) (upstream) for Chrome DevTools tracing details.

## JavaScript Execution

| Command | Description |
|---------|-------------|
| `eval "expression"` | Execute a JS expression (simple expressions only) |
| `eval --stdin` | Multi-line JS from stdin (heredoc) — preferred for quotes/special chars |
| `eval -b <base64>` | Execute base64-encoded JS |

## Debugging

| Command | Description |
|---------|-------------|
| `--headed` | Show the browser window |
| `highlight @ref` | Highlight an element visually |
| `inspect` | Open DevTools |
| `trace start` / `trace stop` | Record / save a trace |
| `get cdp-url` | Get the Chrome DevTools Protocol URL |
| `profiles [--json]` | List available Chrome profiles |

## Browser Control

| Flag | Description |
|------|-------------|
| `--executable-path <path>` | Path to browser executable |
| `--engine chrome\|lightpanda` | Browser engine selection |
| `--extension <path>` | Load a browser extension |
| `--args <browser-args>` | Extra browser arguments |
| `--auto-connect` | Connect to an already-running browser |
| `--cdp <port>` | Connect to a specific CDP port |
| `--download-path <path>` | Default download directory |
| `--idle-timeout <ms>` | Idle timeout before auto-close |
| `--headers <json>` | HTTP headers scoped to the URL's origin |

## Global Flags

| Flag | Description |
|------|-------------|
| `--session <name>` | Isolated browser session |
| `--headed` | Show browser window |
| `--json` | Machine-readable JSON output |
| `--timeout <ms>` | Command timeout |
| `--proxy <url>` / `--proxy-bypass <list>` | Proxy server / bypass list |
| `--user-agent <ua>` | Custom user agent |
| `--profile <name\|path>` | Chrome profile (resolves names like `Default`, copies to temp to reuse login state) |
| `--state <path>` | Load saved auth state from JSON |
| `--config <path>` | Config file path |
| `--provider <name>` | Cloud browser provider |
| `--content-boundaries` | Wrap page content in LLM-safety delimiters |
| `--allowed-domains <list>` | Restrict navigation to listed domains |
| `--action-policy <path>` | Action policy file |
| `--annotate` | Annotate screenshots with element refs |
| `--max-output <chars>` | Maximum output character count |
| `--color-scheme dark\|light` | Preferred color scheme |
| `--init-script <path>` | Register a script before first navigation (repeatable) |
| `--enable <feature>` | Enable a built-in init script (e.g. `react-devtools`) (repeatable) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_BROWSER_SESSION_NAME` / `AGENT_BROWSER_SESSION` | Default session name |
| `AGENT_BROWSER_PROFILE` | Browser profile directory |
| `AGENT_BROWSER_STATE` | State storage directory |
| `AGENT_BROWSER_EXECUTABLE_PATH` | Browser executable path |
| `AGENT_BROWSER_EXTENSIONS` | Extensions to load |
| `AGENT_BROWSER_ARGS` | Additional browser arguments |
| `AGENT_BROWSER_USER_AGENT` | Default user agent |
| `AGENT_BROWSER_PROXY` / `AGENT_BROWSER_PROXY_BYPASS` | Proxy / bypass list |
| `AGENT_BROWSER_CONTENT_BOUNDARIES` | Enable content boundary markers |
| `AGENT_BROWSER_MAX_OUTPUT` | Max output characters |
| `AGENT_BROWSER_ALLOWED_DOMAINS` | Restrict navigation domains |
| `AGENT_BROWSER_ACTION_POLICY` | Action policy file path |
| `AGENT_BROWSER_ANNOTATE` | Enable screenshot annotations |
| `AGENT_BROWSER_SCREENSHOT_DIR` / `_FORMAT` / `_QUALITY` | Screenshot defaults |
| `AGENT_BROWSER_AUTO_CONNECT` | Auto-connect to running browser |
| `AGENT_BROWSER_PROVIDER` | Browser provider |
| `AGENT_BROWSER_CONFIG` | Config file path |
| `AGENT_BROWSER_ENGINE` | Browser engine (chrome or lightpanda) |
| `AGENT_BROWSER_DOWNLOAD_PATH` | Default download directory |
| `AGENT_BROWSER_IDLE_TIMEOUT_MS` | Idle timeout before auto-close |
| `AGENT_BROWSER_DEFAULT_TIMEOUT` | Default command timeout |
| `AGENT_BROWSER_ENCRYPTION_KEY` | Auth-vault encryption key (AES-256-GCM) |
| `AGENT_BROWSER_STATE_EXPIRE_DAYS` | Days before saved states expire |
| `AGENT_BROWSER_STREAM_PORT` | WebSocket stream port (default 9223) |
| `AGENT_BROWSER_INIT_SCRIPTS` | Init scripts to register before first navigation |
| `AGENT_BROWSER_ENABLE` | Built-in init scripts to enable (e.g. `react-devtools`) |
| `AI_GATEWAY_API_KEY` / `AI_GATEWAY_MODEL` | `chat` command credentials / model |
| `AGENTCORE_REGION` / `AGENTCORE_PROFILE_ID` / `AGENTCORE_BROWSER_ID` | AWS Bedrock AgentCore provider config |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | Standard proxy vars |
