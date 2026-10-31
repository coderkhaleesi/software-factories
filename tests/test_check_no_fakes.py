"""Allowlist forms read by scripts/check_no_fakes.py.

Fixtures are written to a scratch directory that the repository gate never scans.
"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CHECKER = Path(__file__).resolve().parents[1] / "scripts" / "check_no_fakes.py"

TEXT_ONLY = '''"""Persona matrix for the user simulator demo."""


def build(persona: str) -> str:
    """Simulate one user with the given persona."""
    return persona.upper()
'''

TEXT_AND_SWALLOW = '''"""Persona matrix for the user simulator demo."""


def build(persona: str) -> str | None:
    """Simulate one user with the given persona."""
    try:
        return persona.upper()
    except Exception:
        return None
'''


def run_checker(allowlist: Path, *files: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECKER), "--allowlist", str(allowlist), *map(str, files)],
        check=False,
        capture_output=True,
        text=True,
    )


class AllowlistForms(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        demo = self.root / "demos" / "simulate_users"
        demo.mkdir(parents=True)
        self.text_only = demo / "text_only.py"
        self.text_only.write_text(TEXT_ONLY)
        self.text_and_swallow = demo / "text_and_swallow.py"
        self.text_and_swallow.write_text(TEXT_AND_SWALLOW)
        self.allowlist = self.root / "no-fakes.allow"

    def test_no_entry_fails_both_on_the_docstring(self) -> None:
        self.allowlist.write_text("")
        for f in (self.text_only, self.text_and_swallow):
            result = run_checker(self.allowlist, f)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("docstring says 'Simulate'", result.stdout)

    def test_text_off_skips_only_the_text_rule(self) -> None:
        self.allowlist.write_text("demos/simulate_users/*  text-off  # the domain is simulation\n")
        ok = run_checker(self.allowlist, self.text_only)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        bad = run_checker(self.allowlist, self.text_and_swallow)
        self.assertEqual(bad.returncode, 1, bad.stdout + bad.stderr)
        self.assertIn("except block doesn't re-raise", bad.stdout)
        self.assertNotIn("docstring says", bad.stdout)

    def test_bare_entry_still_skips_the_file_entirely(self) -> None:
        self.allowlist.write_text("demos/simulate_users/*  # checker fixtures\n")
        result = run_checker(self.allowlist, self.text_and_swallow)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, "")

    def test_unknown_keyword_is_an_error(self) -> None:
        self.allowlist.write_text("demos/simulate_users/*  text-of  # typo\n")
        result = run_checker(self.allowlist, self.text_only)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("no-fakes.allow:1", result.stderr)
        self.assertIn("text-off", result.stderr)

    def test_text_off_entry_needs_a_reason(self) -> None:
        self.allowlist.write_text("demos/simulate_users/*  text-off\n")
        result = run_checker(self.allowlist, self.text_only)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("needs a reason", result.stderr)


if __name__ == "__main__":
    unittest.main()
