"""The Stop hook runs the gate only when the checkout changed, and both hook copies agree."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLAUDE_GUARD = ROOT / ".claude" / "hooks" / "guard.py"
CODEX_GUARD = ROOT / ".codex" / "hooks" / "guard.py"


def git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.email=t@example.com", "-c", "user.name=t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
    )


class StopHook(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        shutil.copytree(ROOT / "scripts", self.repo / "scripts")
        for name in ("no-fakes.profile", "no-fakes.allow", "ruff.toml"):
            shutil.copy(ROOT / name, self.repo / name)
        git(self.repo, "init", "-q")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "base")

    def run_stop(self) -> subprocess.CompletedProcess[str]:
        env = {**os.environ, "CLAUDE_PROJECT_DIR": str(self.repo)}
        return subprocess.run(
            [sys.executable, str(CLAUDE_GUARD), "stop"],
            input="{}",
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_both_hook_copies_are_identical_below_the_docstring(self) -> None:
        def strip(p: Path) -> str:
            return p.read_text().split('"""', 2)[2]

        self.assertEqual(strip(CLAUDE_GUARD), strip(CODEX_GUARD))

    def test_clean_tree_ends_the_turn_without_running_the_gate(self) -> None:
        result = self.run_stop()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_a_new_file_with_a_violation_blocks_the_turn(self) -> None:
        (self.repo / "bad.py").write_text(
            "def f():\n    try:\n        return 1\n    except Exception:\n        return None\n"
        )
        result = self.run_stop()
        self.assertEqual(result.returncode, 0, result.stderr)
        decision = json.loads(result.stdout)
        self.assertEqual(decision["decision"], "block")
        self.assertIn("re-raise", decision["reason"])


if __name__ == "__main__":
    unittest.main()
