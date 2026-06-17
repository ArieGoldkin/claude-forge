# cmux Socket API (JSON-RPC v2)

Detailed reference for the `/tmp/cmux.sock` Unix-socket API. Read this only when the CLI is insufficient — typically a tight loop where per-call subprocess spawn cost matters. For everything else, prefer the `cmux` CLI (see SKILL.md).

## Contents

- [Envelope (v2 only)](#envelope-v2-only)
- [Method prefixes](#method-prefixes)
- [Access modes](#access-modes)
- [Minimal Python client](#minimal-python-client)
- [When to use the socket vs the CLI](#when-to-use-the-socket-vs-the-cli)

> The authoritative, build-specific method list comes from `cmux capabilities --json`. The methods below are stable prefixes; individual method names and params can change between cmux versions, so enumerate capabilities rather than hard-coding a method you haven't confirmed.

## Envelope (v2 only)

Every request is a JSON-RPC v2 object. Legacy v1 payloads (`{"command": ...}`) are rejected.

```json
{ "id": "1", "method": "workspace.list", "params": {} }
```

Responses carry the matching `id` and either `result` or `error`:

```json
{ "id": "1", "result": { "workspaces": [ ... ] } }
{ "id": "2", "error": { "code": -32601, "message": "Method not found" } }
```

## Method prefixes

| Prefix | Domain |
|--------|--------|
| `system.*` | app-level: capabilities, version, config reload |
| `window.*` | top-level macOS windows |
| `workspace.*` | sidebar tabs (list, create, select, metadata) |
| `pane.*` | split regions within a workspace |
| `surface.*` | tabs within a pane (terminal/browser/markdown): create, move, close, health |
| `notification.*` | notify, status, progress, log, flash |
| `browser.*` | WKWebView control: open, snapshot, click, fill, wait, eval, cookies, state |

Enumerate the exact methods and their params in the running build:

```bash
cmux capabilities --json
```

## Access modes

The socket gates who may connect. Default is the most restrictive:

| Mode | Who can connect | Notes |
|------|-----------------|-------|
| `cmuxOnly` | only processes cmux itself spawned | **default** — an external process gets `Failed to connect to socket` |
| `automation` | any local process | set in Settings > Automation when driving cmux from outside a cmux terminal |
| `password` | local processes with the configured secret | |
| `allowAll` | any local process, no auth | unsafe — avoid |

If you hit `Failed to connect to socket` as an external (non-cmux-spawned) process under the default `cmuxOnly`, either run your automation from inside a cmux terminal (so it inherits the spawned-process trust) or switch the mode.

## Minimal Python client

A small client that opens the socket, sends one JSON-RPC call, and returns the parsed result. Connect once and reuse the socket across calls in a hot loop rather than reconnecting per request.

```python
import json
import os
import socket
import itertools


class CmuxSocket:
    def __init__(self, path: str | None = None):
        self.path = path or os.environ.get("CMUX_SOCKET_PATH", "/tmp/cmux.sock")
        self._ids = itertools.count(1)
        self._sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._sock.connect(self.path)
        self._buf = b""

    def call(self, method: str, params: dict | None = None, timeout: float = 15.0):
        req_id = str(next(self._ids))
        req = {"id": req_id, "method": method, "params": params or {}}
        self._sock.sendall((json.dumps(req) + "\n").encode())
        self._sock.settimeout(timeout)
        # Responses are newline-delimited JSON. Read frames until one carries
        # OUR request id: a reused socket can interleave other frames
        # (notifications, an earlier slow reply), so correlate by id rather
        # than assuming the next line is the answer to this call.
        while True:
            while b"\n" not in self._buf:
                chunk = self._sock.recv(65536)
                if not chunk:
                    raise ConnectionError("cmux socket closed before a full response")
                self._buf += chunk
            line, _, self._buf = self._buf.partition(b"\n")
            if not line.strip():
                continue
            resp = json.loads(line)
            if resp.get("id") != req_id:
                continue  # not our response - keep reading
            if "error" in resp:
                raise RuntimeError(f"cmux RPC error: {resp['error']}")
            return resp.get("result")

    def close(self):
        self._sock.close()


if __name__ == "__main__":
    c = CmuxSocket()
    try:
        print(c.call("workspace.list"))
    finally:
        c.close()
```

Quick one-shot from the shell without Python:

```bash
echo '{"id":"1","method":"workspace.list","params":{}}' | nc -U /tmp/cmux.sock
```

## When to use the socket vs the CLI

- **CLI** — default for everything. Each command is one authoritative, self-documenting call (`cmux <cmd> --help`).
- **Socket** — only for tight polling/automation loops where the ~tens-of-ms subprocess spawn cost per `cmux` invocation adds up across hundreds of calls. Open the socket once, reuse it, and you avoid that cost.
