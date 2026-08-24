#!/usr/bin/env python3
"""Deterministic pull-request gate evaluated by the trusted copy on main."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import traceback
import urllib.error
import urllib.request
from dataclasses import dataclass, field

SUPPORTED_SCHEMA_MAJOR = 2
GATE_LOGIC_PATTERNS = (".github/merge-gate/**",)
GATE_RUNNER_PATTERNS = (".github/workflows/merge-gate.yml",)
STORY_LINK_RE = re.compile(r"^Story:\s*#(\d+)\s*$", re.MULTILINE)
SCHEMA_LINE_RE = re.compile(r"^Schema-Version:\s*(\d+)\.(\d+)\.(\d+)\s*$", re.MULTILINE)
SECTION_RE = r"^### {name}\s*$\n(.*?)(?=^### |\Z)"


class Violation:
    LINK_MISSING = "LINK_MISSING"
    LINK_DUPLICATE = "LINK_DUPLICATE"
    STORY_NOT_FOUND = "STORY_NOT_FOUND"
    STORY_WRONG_TYPE = "STORY_WRONG_TYPE"
    SCHEMA_INCOMPATIBLE = "SCHEMA_INCOMPATIBLE"
    SCHEMA_LEGACY_ARTIFACT = "SCHEMA_LEGACY_ARTIFACT"
    SCOPE_MISSING = "SCOPE_MISSING"
    SCOPE_MALFORMED = "SCOPE_MALFORMED"
    SCOPE_EMPTY = "SCOPE_EMPTY"
    OUT_OF_SCOPE = "OUT_OF_SCOPE"
    TESTS_FAILED = "TESTS_FAILED"
    NO_CHANGES = "NO_CHANGES"
    INPUT_UNAVAILABLE = "INPUT_UNAVAILABLE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


@dataclass
class Finding:
    code: str
    detail: str


@dataclass
class Verdict:
    findings: list[Finding] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.findings

    def fail(self, code: str, detail: str) -> None:
        self.findings.append(Finding(code, detail))


def parse_section(body: str, name: str) -> str | None:
    match = re.search(SECTION_RE.format(name=re.escape(name)), body or "", re.MULTILINE | re.DOTALL)
    return match.group(1) if match else None


def parse_story_link(pr_body: str) -> tuple[int | None, str | None]:
    matches = STORY_LINK_RE.findall(pr_body or "")
    if not matches:
        return None, Violation.LINK_MISSING
    if len(matches) > 1:
        return None, Violation.LINK_DUPLICATE
    return int(matches[0]), None


def parse_schema_version(text: str) -> int | None:
    match = SCHEMA_LINE_RE.search(text or "")
    return int(match.group(1)) if match else None


def parse_scope(story_body: str) -> tuple[list[str], str | None]:
    raw = parse_section(story_body, "Scope")
    if raw is None:
        return [], Violation.SCOPE_MISSING
    patterns: list[str] = []
    for line in raw.strip("\n").split("\n"):
        if not line.strip():
            continue
        if line != line.strip() or any(char in line for char in "{}[]!"):
            return [], Violation.SCOPE_MALFORMED
        if line.startswith(("- ", "* ", "+ ")):
            return [], Violation.SCHEMA_LEGACY_ARTIFACT
        if line == "_No response_":
            return [], Violation.SCOPE_EMPTY
        if any("**" in segment and segment != "**" for segment in line.split("/")):
            return [], Violation.SCOPE_MALFORMED
        patterns.append(line)
    return (patterns, None) if patterns else ([], Violation.SCOPE_EMPTY)


def _match_segment(pattern: str, segment: str) -> bool:
    regex = "^" + "".join("[^/]*" if c == "*" else "[^/]" if c == "?" else re.escape(c) for c in pattern) + "$"
    return re.match(regex, segment) is not None


def _match_segments(pattern: list[str], path: list[str]) -> bool:
    if not pattern:
        return not path
    if pattern[0] == "**":
        return _match_segments(pattern[1:], path) or bool(path) and _match_segments(pattern, path[1:])
    return bool(path) and _match_segment(pattern[0], path[0]) and _match_segments(pattern[1:], path[1:])


def match_path(pattern: str, path: str) -> bool:
    return _match_segments(pattern.split("/"), path.split("/"))


def classify_surface(paths: list[str]) -> tuple[str, list[str], list[str]]:
    runner = sorted(path for path in paths if any(match_path(p, path) for p in GATE_RUNNER_PATTERNS))
    logic = sorted(path for path in paths if any(match_path(p, path) for p in GATE_LOGIC_PATTERNS))
    return ("runner" if runner else "logic" if logic else "clean", runner, logic)


def label_name(label: object) -> str:
    return label.get("name", "") if isinstance(label, dict) else str(label)


def evaluate(pr_body: str, changed_paths: list[str], story: dict | None,
             tests_passed: bool, story_fetch_error: str | None = None) -> Verdict:
    verdict = Verdict()
    major = parse_schema_version(pr_body)
    if major is not None and major != SUPPORTED_SCHEMA_MAJOR:
        verdict.fail(Violation.SCHEMA_INCOMPATIBLE, f"PR declares schema major {major}; gate implements {SUPPORTED_SCHEMA_MAJOR}.")
    if not changed_paths:
        verdict.fail(Violation.NO_CHANGES, "PR has no changed files.")
    if not tests_passed:
        verdict.fail(Violation.TESTS_FAILED, "CI-computed product tests were not green.")
    story_number, link_error = parse_story_link(pr_body)
    if link_error:
        verdict.fail(link_error, "PR body must contain exactly one canonical `Story: #N` line.")
        return verdict
    if story_fetch_error:
        verdict.fail(Violation.INPUT_UNAVAILABLE, f"could not read story #{story_number}: {story_fetch_error}")
        return verdict
    if story is None:
        verdict.fail(Violation.STORY_NOT_FOUND, f"story #{story_number} does not exist.")
        return verdict
    if "type:story" not in {label_name(label) for label in story.get("labels", [])}:
        verdict.fail(Violation.STORY_WRONG_TYPE, f"issue #{story_number} does not carry `type:story`.")
        return verdict
    story_major = parse_schema_version(story.get("body") or "")
    if story_major is not None and story_major != SUPPORTED_SCHEMA_MAJOR:
        verdict.fail(Violation.SCHEMA_INCOMPATIBLE, f"story #{story_number} declares schema major {story_major}.")
        return verdict
    patterns, scope_error = parse_scope(story.get("body") or "")
    if scope_error:
        verdict.fail(scope_error, f"story #{story_number} has an invalid `### Scope` section.")
        return verdict
    outside = sorted(path for path in changed_paths if not any(match_path(pattern, path) for pattern in patterns))
    if outside:
        verdict.fail(Violation.OUT_OF_SCOPE, "changed paths outside story scope: " + ", ".join(outside))
    return verdict


def _api(url: str, token: str) -> object:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "income-portfolio-merge-gate"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_pr(repo: str, number: int, token: str) -> tuple[dict, list[str]]:
    pr = _api(f"https://api.github.com/repos/{repo}/pulls/{number}", token)
    paths: list[str] = []
    page = 1
    while True:
        batch = _api(f"https://api.github.com/repos/{repo}/pulls/{number}/files?per_page=100&page={page}", token)
        if not batch:
            break
        for entry in batch:
            paths.append(entry["filename"])
            if entry.get("previous_filename"):
                paths.append(entry["previous_filename"])
        if len(batch) < 100:
            break
        page += 1
    return pr, paths


def fetch_story(repo: str, number: int, token: str) -> tuple[dict | None, str | None]:
    try:
        return _api(f"https://api.github.com/repos/{repo}/issues/{number}", token), None
    except urllib.error.HTTPError as exc:
        return (None, None) if exc.code == 404 else (None, f"HTTP {exc.code}")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return None, str(exc)


def render(verdict: Verdict, context: str) -> str:
    lines = [f"Merge gate — {context}", "", "PASS — every deterministic check satisfied." if verdict.passed else f"FAIL — {len(verdict.findings)} violation(s):"]
    lines.extend(f"  [{finding.code}] {finding.detail}" for finding in verdict.findings)
    lines += ["", "Inputs: diff paths, linked story `### Scope`, and the CI-computed product-test result. Verdict code comes from `main`."]
    return "\n".join(lines)


def render_surface(kind: str, runner: list[str], logic: list[str], context: str) -> str:
    lines = [f"Merge gate — enforcement surface — {context}", ""]
    if kind == "clean":
        lines.append("SUCCESS — enforcement surface untouched.")
    elif kind == "logic":
        lines += ["NEUTRAL — gate logic changed; blocking verdict still came from main.", *logic]
    else:
        lines += ["FAILURE — workflow runner changed; human review is the only control.", *runner]
    lines += ["", "Advisory only — never make `merge-gate-surface` required."]
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr", type=int)
    parser.add_argument("--repo")
    parser.add_argument("--tests-passed", choices=("true", "false"))
    parser.add_argument("--fixture")
    parser.add_argument("--mode", choices=("verdict", "surface"), default="verdict")
    args = parser.parse_args(argv)
    if args.fixture:
        with open(args.fixture, encoding="utf-8") as handle:
            data = json.load(handle)
        paths = data.get("changed_paths", [])
        if args.mode == "surface":
            kind, runner, logic = classify_surface(paths)
            print(render_surface(kind, runner, logic, f"fixture {args.fixture}"))
            return 1 if kind == "runner" else 0
        verdict = evaluate(data.get("pr_body", ""), paths, data.get("story"), bool(data.get("tests_passed", True)), data.get("story_fetch_error"))
        print(render(verdict, f"fixture {args.fixture}"))
        return 0 if verdict.passed else 1
    if not (args.pr and args.repo):
        parser.error("--pr and --repo are required")
    if args.mode == "verdict" and not args.tests_passed:
        parser.error("--tests-passed is required in verdict mode")
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("Merge gate — FAIL\n\n  [INPUT_UNAVAILABLE] GITHUB_TOKEN is not set.")
        return 1
    pr, paths = fetch_pr(args.repo, args.pr, token)
    if args.mode == "surface":
        kind, runner, logic = classify_surface(paths)
        print(render_surface(kind, runner, logic, f"{args.repo}#{args.pr}"))
        return 1 if kind == "runner" else 0
    story = None
    story_error = None
    story_number, link_error = parse_story_link(pr.get("body") or "")
    if story_number is not None and not link_error:
        story, story_error = fetch_story(args.repo, story_number, token)
    verdict = evaluate(pr.get("body") or "", paths, story, args.tests_passed == "true", story_error)
    print(render(verdict, f"{args.repo}#{args.pr}"))
    return 0 if verdict.passed else 1


def guarded_main(argv: list[str]) -> int:
    try:
        return main(argv)
    except SystemExit:
        raise
    except BaseException as exc:
        print(f"Merge gate — FAIL\n\n  [{Violation.INTERNAL_ERROR}] {type(exc).__name__}: {exc}\n\nThe gate failed closed.")
        traceback.print_exc(file=sys.stdout)
        return 1


if __name__ == "__main__":
    raise SystemExit(guarded_main(sys.argv[1:]))
