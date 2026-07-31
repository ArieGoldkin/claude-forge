#!/usr/bin/env python3
"""Check 7 helper: every DECLARED skill/agent/command count must match the filesystem.

Invoked per-plugin by validate-versions.sh. Prints FAIL lines to stdout and exits 1
on mismatch; exits 0 and prints nothing when every declared count is correct.

    check-counts.py <repo_root> <plugin_dir> <short_name>

THE CONTRACT, stated precisely: *every count this repo declares must be true.*
It is NOT "every site must declare a count" -- plugins legitimately differ in
which docs enumerate contents (ctk's README declares none). Absence is fine;
being wrong is not.

Measured against etk's README at commit d15d29b, which every existing check
passed: skills declared 20 / listed 19 / real 26; commands declared 20 / listed
19 / real 20, naming a `review-mr` command that does not exist; and agents
declared 5 / listed 5 / real 5 -- every number correct, and still wrong, because
it named `logic-validator` (absent) and omitted `adversarial-verifier` (present).
Versions were all this script knew how to check, so none of it surfaced.

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


# FORM_A alone cannot tell a DECLARATION from PROSE -- they are the same shape.
# "Provides 15 specialized skills" (a real dtk declaration) and "adds 3 new
# commands" (an ordinary sentence) differ only in intent. Measured on the real
# tree: 3 realistic prose sentences added to one plugin CLAUDE.md produced 3
# FAILs on a document whose every actual declaration was correct.
#
# A position anchor was the obvious fix and is WRONG: 12 of the 24 real
# declarations live mid-sentence ("Provides 16 skills, 1 agent, and 25
# commands") or in a tree comment, so anchoring to line-start/bold would have
# silently dropped half the gate's coverage -- a false NEGATIVE, which is worse
# than the false positive it fixes.
#
# What actually separates the two is the FORM the count appears in. Every real
# declaration in this repo is one of exactly three; prose is none of them:
#
#   MARKED       bold or list-bold      "- **27 skills**: agent-loops, ..."
#   SERIES       ALL THREE kinds        "Provides 16 skills, 1 agent, and 25 commands"
#   DIR_ATTACHED names the directory    "|-- skills/   # 15 specialized skill directories"
#
# "The release adds 2 new commands" is a lone kind, unbolded, with no sibling
# kind and no `commands/` token -- so it is ignored, which is the whole point.
def _is_series(matches):
    """True when a line declares ALL THREE kinds -- the full-inventory shape
    ("16 skills, 1 agent, and 25 commands").

    Requiring all three, not merely two, is #94. At >=2 this read ordinary
    release-note prose as an inventory: "adds 3 new commands and 2 new agents"
    and "shipped 2 skills and 4 commands" both FAILed a correct document. That
    is the same class #92 fixed for single-kind prose, and the reason it is not
    academic is that a release note describes a PAST release, so its counts
    legitimately differ from current totals -- exactly why CHANGELOG.md is
    excluded by design. A "Release Notes" section inside CLAUDE.md/README.md is
    the same historical record with none of the same exemption.

    Measured before changing it: of the 4 form-gated SERIES declarations in this
    repo, 4 carry all three kinds and 0 carry exactly two. The tightening
    therefore costs zero current coverage.

    The trade, stated: a genuine two-kind inventory line written in markdown
    ("Provides 16 skills and 25 commands") would stop being gated. Accepted
    because (a) there are none today, (b) every plugin restates its full
    inventory in plugin.json and marketplace.json, which are trusted sites
    scanned in full, so the NUMBER stays gated regardless, and (c) for this gate
    a false positive is the more dangerous failure -- it red-CIs a correct
    document, and the cheapest way to make a false-failing gate green is to
    weaken it.

    Distinctness still matters: two counts of the same kind on one line is
    prose, not an inventory.
    """
    return len({kind for kind, _, _, _ in matches}) == len(KINDS)


def declarations(text, trusted=False):
    """-> list of (kind, number, matched_text). Both forms, in one pass.

    `trusted=True` scans every FORM_A hit with no form requirement. Use it only
    for text that CANNOT contain prose: the synthesized "<n> <kind>s" strings
    this script builds from the two root tables, and the plugin.json /
    marketplace.json `description` fields, which are single-purpose inventory
    strings rather than documents. Markdown bodies are scanned with
    trusted=False, where the three-form rule above applies.
    """
    found = []
    for line in text.splitlines():
        # (kind, number, raw, match) for every FORM_A hit on this line
        hits = [
            (m.group(2).lower(), int(m.group(1)), m.group(0).strip(), m)
            for m in FORM_A.finditer(line)
        ]
        if not hits:
            continue
        series = _is_series(hits)
        for kind, n, raw, m in hits:
            if trusted:
                found.append((kind, n, raw))
                continue
            marked = line[: m.start()].rstrip().endswith("**")
            dir_attached = f"{kind}s/" in line
            if marked or dir_attached or series:
                found.append((kind, n, raw))
    for m in FORM_B.finditer(text):
        found.append((m.group(1).lower().rstrip("s"), int(m.group(2)), m.group(0).strip()))
    return found


# An ENUMERATED comma list: "- **21 commands**: agent-loops, allocate-tasks, ...".
# Checked against the directory by NAME, not just by length. The case that forces
# this is etk's agents line at d15d29b: `- **5 Agents**: logic-validator, ...` --
# declared 5, listed 5, and the directory held 5. Every number agreed. It was still
# wrong: `logic-validator` does not exist and `adversarial-verifier` was omitted.
# A length check, and a totals-only check, both pass that list. One phantom plus one
# omission is the single most likely way for a hand-edited list to be wrong, and it
# is exactly the shape that leaves every count correct.
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


def content_entries(d):
    """Real shipped entries in a skills/agents/commands directory.

    Dotfiles are NOT content. `iterdir()` returns every dirent, so a single
    Finder-generated .DS_Store -- which this repo gitignores, and which therefore
    appears on developer machines while being invisible in CI -- inflated the
    count. Measured: two stray .DS_Store files produced FOURTEEN FAILs across all
    six sites, on a tree whose docs were entirely correct.

    This is deliberately narrow: only a leading dot is excluded. No real skill,
    agent, or command starts with one, so nothing shippable can hide behind this,
    and a genuinely malformed entry still surfaces.
    """
    return [p for p in d.iterdir() if not p.name.startswith(".")]


def ground_truth(plugin_dir):
    """Count real entries. Symlinked skills (etk -> shared/skills) COUNT: they are
    part of what the plugin ships, and every doc in the repo enumerates them."""
    out = {}
    for kind in KINDS:
        d = plugin_dir / (kind + "s")
        out[kind] = len(content_entries(d)) if d.is_dir() else None
    return out


def main():
    repo_root = pathlib.Path(sys.argv[1])
    plugin_dir = pathlib.Path(sys.argv[2])
    short = sys.argv[3]

    truth = ground_truth(plugin_dir)
    # (label, text, trusted). trusted=True means "cannot contain prose, so scan
    # every hit"; see declarations(). The two JSON `description` fields are
    # single-purpose inventory strings and the two root-table entries are
    # synthesized by this script, so all four stay strictly gated. Only the
    # free-text markdown bodies get the three-form rule.
    sites = []

    pj_path = plugin_dir / ".claude-plugin" / "plugin.json"
    pj = json.loads(pj_path.read_text())
    sites.append((str(pj_path) + " (description)", pj.get("description", ""), True))

    # Shared files: isolate THIS plugin's fragment first, or one plugin's row
    # would be checked against another's ground truth.
    mk_path = repo_root / ".claude-plugin" / "marketplace.json"
    if mk_path.exists():
        entry = next(
            (p for p in json.loads(mk_path.read_text()).get("plugins", []) if p.get("name") == short),
            None,
        )
        if entry:
            sites.append((str(mk_path) + f" ({short} description)", entry.get("description", ""), True))

    # Root README plugin table: | **[etk](plugins/...)** — ... | 2.17.1 | 27 · 5 · 21 |
    rr = repo_root / "README.md"
    if rr.exists():
        m = re.search(
            r"\[%s\]\([^)]*\)[^|\n]*\|[^|\n]*\|\s*(\d+)\s*·\s*(\d+)\s*·\s*(\d+)\s*\|" % re.escape(short),
            rr.read_text(),
        )
        if m:
            for kind, n in zip(KINDS, m.groups()):
                sites.append((f"{rr} (plugin table, {kind}s column)", f"{n} {kind}s", True))

    # Root CLAUDE.md summary table: | etk (formerly engineering-toolkit) | 27 | 5 | 21 | ...
    rc = repo_root / "CLAUDE.md"
    if rc.exists():
        m = re.search(
            r"\|\s*%s\s*\(formerly[^|\n]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|" % re.escape(short),
            rc.read_text(),
        )
        if m:
            for kind, n in zip(KINDS, m.groups()):
                sites.append((f"{rc} (plugin summary table, {kind}s column)", f"{n} {kind}s", True))

    # Per-plugin docs. CHANGELOG.md is excluded by design, exactly as check 6c
    # excludes it: it is a historical record and legitimately states the counts
    # that past releases had.
    for name in ("CLAUDE.md", "README.md"):
        p = plugin_dir / name
        if p.exists():
            sites.append((str(p), p.read_text(), False))

    failures = []
    for label, text, trusted in sites:
        for kind, declared, raw in declarations(text, trusted=trusted):
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
    for label, text, _trusted in sites:
        if not label.endswith(".md"):
            continue
        for kind, declared, names in enumerated_lists(text):
            d = plugin_dir / (kind + "s")
            if not d.is_dir():
                continue
            real = {p.stem if p.suffix == ".md" else p.name for p in content_entries(d)}
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
