#!/usr/bin/env python3
import importlib.util
import pathlib
import sys
import tempfile
import unittest

MODULE_PATH = pathlib.Path(__file__).with_name("merge_gate.py")
SPEC = importlib.util.spec_from_file_location("merge_gate", MODULE_PATH)
mg = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = mg
SPEC.loader.exec_module(mg)


def story(*patterns: str, labels=("type:story",)) -> dict:
    body = "### Scope\n\n" + "\n".join(patterns) + "\n\n### Acceptance notes\n\nverify\n"
    return {"body": body, "labels": [{"name": label} for label in labels]}


class MergeGateTests(unittest.TestCase):
    def test_globs_are_segment_aware(self):
        self.assertTrue(mg.match_path("src/**", "src/deep/a.js"))
        self.assertTrue(mg.match_path("**/a.js", "a.js"))
        self.assertFalse(mg.match_path("src/*", "src/deep/a.js"))

    def test_valid_pr_passes(self):
        verdict = mg.evaluate("Story: #13\n", ["src/a.js"], story("src/**"), True)
        self.assertTrue(verdict.passed)

    def test_each_contract_fails_closed(self):
        cases = [
            ("no story", ["src/a.js"], story("src/**"), True, mg.Violation.LINK_MISSING),
            ("Story: #13\n", ["src/a.js"], story("test/**"), True, mg.Violation.OUT_OF_SCOPE),
            ("Story: #13\n", ["src/a.js"], story("src/**"), False, mg.Violation.TESTS_FAILED),
            ("Story: #13\n", ["src/a.js"], None, True, mg.Violation.STORY_NOT_FOUND),
        ]
        for body, paths, linked, tests_passed, code in cases:
            with self.subTest(code=code):
                verdict = mg.evaluate(body, paths, linked, tests_passed)
                self.assertIn(code, [finding.code for finding in verdict.findings])

    def test_bulleted_scope_is_rejected_as_legacy(self):
        patterns, error = mg.parse_scope("### Scope\n\n- src/**\n")
        self.assertEqual(patterns, [])
        self.assertEqual(error, mg.Violation.SCHEMA_LEGACY_ARTIFACT)

    def test_gate_logic_and_runner_are_advisory_surfaces(self):
        self.assertEqual(mg.classify_surface([".github/merge-gate/merge_gate.py"])[0], "logic")
        self.assertEqual(mg.classify_surface([".github/workflows/merge-gate.yml"])[0], "runner")

    def test_internal_errors_return_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = pathlib.Path(directory) / "missing.json"
            self.assertEqual(mg.guarded_main(["--fixture", str(missing)]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
