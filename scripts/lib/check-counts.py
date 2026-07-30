#!/usr/bin/env python3
"""Check 7 helper: every DECLARED skill/agent/command count must match the filesystem.

Invoked per-plugin by validate-versions.sh. Prints FAIL lines to stdout and exits 1
on mismatch; exits 0 and prints nothing when every declared count is correct.

    check-counts.py <repo_root> <plugin_dir> <short_name>

THE CONTRACT, stated precisely: *every count this repo declares must be true.*
It is NOT "every site must declare a count" -- plugins legitimately differ in
which docs enumerate contents (ctk's README declares none). Absence is fine;
being wrong is not. The failure this guards against is the one measured on
2026-07-30: etk's README declared "20 Commands" over a list of 19 against a
truth of 21, omitting `conduct` -- the very command that release shipped --
while every version check stayed green, because versions were all this script
knew how to check.

KNOWN GAP, deliberate: hook counts are NOT checked. Their declarations carry
free-form riders ("34 registered - 31 shared + 3 ctk-specific", "2 (review-logger,
continuity-recommendation)") that no safe pattern extracts, and the authoritative
basis is `^registerHook(` in hooks/src/index.ts rather than a directory listing.
A pattern loose enough to read those would false-FAIL on prose. Better an honest
gap than a check that cries wolf -- but note etk's hook count WAS wrong in four
docs on 2026-07-30, so this gap has a demonstrated cost.
"""

import json
import pathlib
import re
import sys

KINDS = ("skill", "agent", "command")

# Form A -- "27 skills", "**27 skills**", "18 specialized skills".
# One optional intervening adjective is allowed, because dtk's README says
# "Provides 18 specialized skills"; requiring adjacency missed it entirely.
# The (?<![\d.]) guard stops "2.0.11 skills"-shaped version text from matching,
# and the adjective may not be a digit, so "3 of 5 commands" reads only as "5
# commands" rather than inventing a "3 commands" claim.
FORM_A = re.compile(
    r"(?<![\d.])(\d+)\s+(?:[A-Za-z][A-Za-z-]*\s+)?\*{0,2}(skill|agent|command)s?\b",
    re.IGNORECASE,
)

# Form B -- a markdown HEADING whose text is exactly "<Kind> (N)", e.g. ctk's
# "## Skills (11)". Anchored to headings of depth <= 3 AND to the bare noun on
# purpose: dtk's README carries "#### Additional Skills (2)" and "#### Skill
# Commands (12)", which are SUBSET counts under a section. An unanchored
# "Skills \((\d+)\)" reads those as totals and fails a correct file -- measured
# against the real tree before this was tightened.
FORM_B = re.compile(
    r"^#{1,3}[ \t]+\*{0,2}(Skills|Agents|Commands)\*{0,2}[ \t]*\((\d+)\)",
    re.IGNORECASE | re.MULTILINE,
)


def declarations(text):
    """-> list of (kind, number, matched_text). Both forms, in one pass."""
    found = []
    for m in FORM_A.finditer(text):
        found.append((m.group(2).lower(), int(m.group(1)), m.group(0).strip()))
    for m in FORM_B.finditer(text):
        found.append((m.group(1).lower().rstrip("s"), int(m.group(2)), m.group(0).strip()))
    return found


# An ENUMERATED comma list: "- **21 commands**: agent-loops, allocate-tasks, ...".
# Checked against the directory by NAME, not just by length, because the original
# defect was a *plausible* list: etk's README said "20 Commands" over 19 names, and
# the names themselves included a `review-mr` command that does not exist while
# omitting `conduct`. Length alone would have passed a list with one phantom and
# one omission -- the single most likely way for a hand-edited list to be wrong.
ENUM_LIST = re.compile(
    r"-\s*\*\*(\d+)\s+(skills|agents|commands)\*\*:\s*([^\n]+)", re.IGNORECASE
)


def enumerated_lists(text):
    """-> list of (kind, declared_n, [names]). Only the comma form; tables vary too
    much between plugins to parse safely (dtk uses 4 sub-tables)."""
    out = []
    for m in ENUM_LIST.finditer(text):
        names = [n.strip().strip("`*") for n in m.group(3).split(",")]
        out.append((m.group(2).lower().rstrip("s"), int(m.group(1)), [n for n in names if n]))
    return out


def ground_truth(plugin_dir):
    """Count real entries. Symlinked skills (etk -> shared/skills) COUNT: they are
    part of what the plugin ships, and every doc in the repo enumerates them."""
    out = {}
    for kind in KINDS:
        d = plugin_dir / (kind + "s")
        out[kind] = len(list(d.iterdir())) if d.is_dir() else None
    return out


def main():
    repo_root = pathlib.Path(sys.argv[1])
    plugin_dir = pathlib.Path(sys.argv[2])
    short = sys.argv[3]

    truth = ground_truth(plugin_dir)
    sites = []  # (label, text)

    pj_path = plugin_dir / ".claude-plugin" / "plugin.json"
    pj = json.loads(pj_path.read_text())
    sites.append((str(pj_path) + " (description)", pj.get("description", "")))

    # Shared files: isolate THIS plugin's fragment first, or one plugin's row
    # would be checked against another's ground truth.
    mk_path = repo_root / ".claude-plugin" / "marketplace.json"
    if mk_path.exists():
        entry = next(
            (p for p in json.loads(mk_path.read_text()).get("plugins", []) if p.get("name") == short),
            None,
        )
        if entry:
            sites.append((str(mk_path) + f" ({short} description)", entry.get("description", "")))

    # Root README plugin table: | **[etk](plugins/...)** — ... | 2.17.1 | 27 · 5 · 21 |
    rr = repo_root / "README.md"
    if rr.exists():
        m = re.search(
            r"\[%s\]\([^)]*\)[^|\n]*\|[^|\n]*\|\s*(\d+)\s*·\s*(\d+)\s*·\s*(\d+)\s*\|" % re.escape(short),
            rr.read_text(),
        )
        if m:
            for kind, n in zip(KINDS, m.groups()):
                sites.append((f"{rr} (plugin table, {kind}s column)", f"{n} {kind}s"))

    # Root CLAUDE.md summary table: | etk (formerly engineering-toolkit) | 27 | 5 | 21 | ...
    rc = repo_root / "CLAUDE.md"
    if rc.exists():
        m = re.search(
            r"\|\s*%s\s*\(formerly[^|\n]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|" % re.escape(short),
            rc.read_text(),
        )
        if m:
            for kind, n in zip(KINDS, m.groups()):
                sites.append((f"{rc} (plugin summary table, {kind}s column)", f"{n} {kind}s"))

    # Per-plugin docs. CHANGELOG.md is excluded by design, exactly as check 6c
    # excludes it: it is a historical record and legitimately states the counts
    # that past releases had.
    for name in ("CLAUDE.md", "README.md"):
        p = plugin_dir / name
        if p.exists():
            sites.append((str(p), p.read_text()))

    failures = []
    for label, text in sites:
        for kind, declared, raw in declarations(text):
            actual = truth.get(kind)
            if actual is None:
                continue  # plugin ships no such directory -- nothing to compare against
            if declared != actual:
                failures.append((label, kind, declared, actual, raw))

    for label, kind, declared, actual, raw in failures:
        print(f"  FAIL  {short}: declares {declared} {kind}s but {plugin_dir}/{kind}s/ holds {actual}")
        print(f"        at: {label}")
        print(f"        text: \"{raw}\"")

    # The enumerated list itself, by name. Runs on the per-plugin docs only.
    list_failures = []
    for label, text in sites:
        if not label.endswith(".md"):
            continue
        for kind, declared, names in enumerated_lists(text):
            d = plugin_dir / (kind + "s")
            if not d.is_dir():
                continue
            real = {p.stem if p.suffix == ".md" else p.name for p in d.iterdir()}
            phantom = sorted(n for n in names if n not in real)
            missing = sorted(n for n in real if n not in names)
            if len(names) != declared or phantom or missing:
                list_failures.append((label, kind, declared, len(names), phantom, missing))

    for label, kind, declared, listed, phantom, missing in list_failures:
        print(f"  FAIL  {short}: {kind}s list is wrong (declares {declared}, lists {listed})")
        print(f"        at: {label}")
        if phantom:
            print(f"        listed but DOES NOT EXIST: {', '.join(phantom)}")
        if missing:
            print(f"        exists but NOT LISTED:     {', '.join(missing)}")
        print(f"        Fix: the list must name exactly what {plugin_dir}/{kind}s/ contains.")

    if list_failures:
        return 1

    if failures:
        counts = ", ".join(f"{k}s={v}" for k, v in truth.items() if v is not None)
        print(f"        Fix: correct the declaration(s) above to the real counts ({counts}),")
        print(f"             and update the enumerated LIST too -- a right total over a wrong")
        print(f"             list is the drift this check exists to catch.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
