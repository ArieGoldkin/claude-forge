#!/usr/bin/env python3
"""Crippled-check matrix for the #65 scannable projection.

Disable one mechanism at a time; assert that a SPECIFIC, non-empty set of tests
flips red. A mechanism whose removal breaks nothing is not pinned by anything.

Restores from an in-memory backup, never `git checkout` — the working tree here
holds uncommitted work in the same file.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/ariegoldkin/Arie/projects/claude-plugins-main")
SRC = ROOT / "shared/hooks-infra/src/lib/shell-projection.ts"
HOOKS = ROOT / "plugins/continuity-toolkit/hooks"

# (label, needle, replacement) — each removes exactly one guard.
MUTATIONS = [
    ("pipe-guard", "      if (seg.pipedOut) continue;", "      // CRIPPLED"),
    (
        "heredoc-pipe-guard",
        "const afterHeredoc = hasRealPipe(command) ? command : blankQuotedHeredocs(command);",
        "const afterHeredoc = blankQuotedHeredocs(command);",
    ),
    (
        "substitution-guard",
        "      if (scan.hasSubstitution || scan.hasRedirect) continue;",
        "      if (scan.hasRedirect) continue;",
    ),
    (
        "redirect-guard",
        "      if (scan.hasSubstitution || scan.hasRedirect) continue;",
        "      if (scan.hasSubstitution) continue;",
    ),
    # The unbalanced-quote behaviour is defended in depth by THREE independent
    # layers (splitSegments returning null, scan.balanced, the outer try/catch),
    # so no single-line mutation can flip it. Crippling one layer proves nothing;
    # this removes the two that are reachable together.
    (
        "all-quote-guards",
        [
            ("      if (!scan.balanced) continue;", "      // CRIPPLED"),
            ("  if (single || double) return null;", "  // CRIPPLED"),
        ],
        None,
    ),
    (
        "heredoc-quote-awareness",
        "    if (single || double || c !== '<' || command[i + 1] !== '<') {",
        "    if (c !== '<' || command[i + 1] !== '<') {",
    ),
    (
        "heredoc-data-consumer-allowlist",
        "    if (HEREDOC_DATA_CONSUMERS.has(commandKey(firstToken))) {",
        "    if (true) {",
    ),
    # Must actually change behaviour: the code reads m[1] ?? m[2], so ADDING a
    # third group is a no-op. Widen group 1 to swallow unquoted delimiters.
    (
        "quoted-heredoc-delimiter",
        "const opRe = /^<<-?[ \\t]*(?:'([^']+)'|\"([^\"]+)\")/;",
        "const opRe = /^<<-?[ \\t]*['\"]?([^\\s'\"]+)['\"]?()/;",
    ),
    (
        "grep-pattern-file-flag",
        "  if (hasPatternFileFlag(words)) return;",
        "  // CRIPPLED",
    ),
    (
        "grouped-pipe-guard",
        "    if (hasGroupedPipe(command)) return command;",
        "    // CRIPPLED",
    ),
    (
        "commandkey-path-trust",
        "  return token.includes('/') ? '' : token;",
        "  const i = token.lastIndexOf('/'); return i === -1 ? token : token.slice(i + 1);",
    ),
]

TEST_FILES = [
    "tests/lib/shell-projection.test.ts",
    "tests/pretool/security-blocker.test.ts",
    "tests/pretool/security-blocker-fp-corpus.test.ts",
]


def run_tests():
    """Return (passed, failed, failing_names)."""
    # Inherit the real environment; strip only the two session ids that leak a
    # live session's identity into the logging/input tests.
    env = dict(os.environ)
    env.pop("CLAUDE_SESSION_ID", None)
    env.pop("CLAUDE_CODE_SESSION_ID", None)
    proc = subprocess.run(
        ["npx", "vitest", "run", *TEST_FILES, "--reporter=verbose"],
        cwd=HOOKS,
        capture_output=True,
        text=True,
        env=env,
    )
    out = proc.stdout + proc.stderr
    failing = re.findall(r"[×✕]\s+(.+?)(?:\s+\d+ms)?$", out, re.MULTILINE)
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    failed = int(m.group(1)) if m and m.group(1) else 0
    passed = int(m.group(2)) if m else -1
    return passed, failed, failing


def main():
    original = SRC.read_text()

    print("=" * 78)
    print("BASELINE (no mutation)")
    passed, failed, failing = run_tests()
    print(f"  passed={passed} failed={failed}")
    if failed != 0:
        print("  ABORT: baseline is not green; a crippled-check is meaningless.")
        return 1
    baseline_passed = passed

    print("=" * 78)
    print(f"{'MUTATION':<28} {'FAILED':>7}  VERDICT")
    print("-" * 78)

    results = []
    for label, needle, repl in MUTATIONS:
        # A mutation is either one (needle, repl) or a list of them.
        edits = needle if isinstance(needle, list) else [(needle, repl)]
        missing = [n for n, _ in edits if n not in original]
        if missing:
            print(f"{label:<28} {'--':>7}  ERROR: needle not found (mutation is stale)")
            results.append((label, None))
            continue
        try:
            mutated = original
            for n, r in edits:
                mutated = mutated.replace(n, r, 1)
            SRC.write_text(mutated)
            _, failed, failing = run_tests()
            verdict = "PINNED" if failed > 0 else "*** NOT PINNED ***"
            print(f"{label:<28} {failed:>7}  {verdict}")
            for f in failing[:4]:
                print(f"{'':<28} {'':>7}    - {f.strip()[:70]}")
            results.append((label, failed))
        finally:
            SRC.write_text(original)

    print("-" * 78)
    # Restoration control: the file must be byte-identical and green again.
    passed, failed, _ = run_tests()
    ok = failed == 0 and passed == baseline_passed
    print(f"RESTORE CONTROL: passed={passed} failed={failed}  {'OK' if ok else '*** DIRTY ***'}")

    unpinned = [l for l, f in results if f == 0 or f is None]
    print("=" * 78)
    if unpinned:
        print(f"UNPINNED MECHANISMS: {unpinned}")
        return 1
    print("All mechanisms pinned by at least one failing test.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
