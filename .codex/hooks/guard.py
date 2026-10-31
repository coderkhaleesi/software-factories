"""Claude Code hooks that enforce AGENTS.md section 6.

  pre   PreToolUse: block edits to the rules, checkers, allowlist, and hooks.
  post  PostToolUse: run the no-fakes checks on the file just edited.
  stop  Stop: run scripts/check.sh before the agent may finish.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2])

PROTECTED_FILES = {
    "AGENTS.md", "CLAUDE.md", "no-fakes.allow", "no-fakes.profile", "scripts/check.sh", "scripts/check_no_fakes.py",
}
PROTECTED_DIRS = (".claude/",)
PROTECTED_BASENAMES = re.compile(r"^(\.?ruff\.toml|eslint\.config\.[cm]?[jt]s)$")

BASH_NAMES = re.compile(
    r"AGENTS\.md|CLAUDE\.md|no-fakes\.(allow|profile)|check_no_fakes\.py|check\.sh|\.claude\b|"
    r"ruff\.toml|eslint\.config"
)
# ~/.claude (user config, plugins, transcripts) isn't this project's .claude/.
HOME_CLAUDE = re.compile(r"(~|\$HOME|\$\{HOME\}|" + re.escape(str(Path.home())) + r")/\.claude\b\S*")
BASH_SAFE = re.compile(
    r"(python3?|bash|sh)\s+(\./)?scripts/(check_no_fakes\.py|check\.sh)(\s+[\w./-]+)*|\d?>&\d|>\s*/dev/null"
)
BASH_WRITES = re.compile(
    r">|\btee\b|\bsed\b[^|;&]*\s-i|\bperl\b[^|;&]*\s-\w*i|\b(mv|cp|rm|ln|truncate|chmod|dd|install)\b|"
    r"\b(python3?|node|ruby|awk)\b|\bgit\s+(checkout|restore|rm|mv|apply|reset|stash)\b"
)

PY_SUFFIXES = {".py"}
JS_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}


def is_protected(path_str: str) -> bool:
    path = Path(path_str)
    if not path.is_absolute():
        path = ROOT / path
    try:
        rel = path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return False
    return (
        rel in PROTECTED_FILES
        or any(rel.startswith(d) for d in PROTECTED_DIRS)
        or bool(PROTECTED_BASENAMES.match(path.name))
    )


def block(reason: str) -> None:
    print(reason, file=sys.stderr)
    sys.exit(2)


def pre(event: dict) -> None:
    tool, args = event.get("tool_name", ""), event.get("tool_input", {})
    if tool == "Bash":
        command = HOME_CLAUDE.sub("", BASH_SAFE.sub("", args.get("command", "")))
        if BASH_NAMES.search(command) and BASH_WRITES.search(command):
            block(
                "Blocked: this command may modify a protected file (AGENTS.md, CLAUDE.md, lint configs, "
                "no-fakes checkers, no-fakes.allow/profile, or .claude/). Only the user changes these. "
                "If a check is wrong, stop and tell the user."
            )
        return
    path = args.get("file_path") or args.get("notebook_path") or ""
    if path and is_protected(path):
        block(
            f"Blocked: {path} is protected. Only the user edits the rules, lint configs, no-fakes "
            "checkers, no-fakes.allow/profile, and hooks. If you need a test double or a rule changed, "
            "stop and ask the user."
        )


def run(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, check=False, cwd=ROOT, capture_output=True, text=True)
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def post(event: dict) -> None:
    path = Path(event.get("tool_input", {}).get("file_path", ""))
    if not path.is_file() or path.suffix not in PY_SUFFIXES | JS_SUFFIXES:
        return
    code, out = run(["bash", "scripts/check.sh", str(path)])
    if code:
        block(
            "AGENTS.md section 6 violations in the file you just edited. Fix them now by doing the "
            "real thing or letting the error surface. Renaming to dodge the check is also a violation. "
            "If you can't do it for real, mark the task [!] and tell the user.\n\n" + out
        )
    if "warning" in out:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "No-fakes warnings in the file you just edited. Fix them or mention "
                                 "them to the user:\n" + out,
        }}))


def stop(event: dict) -> None:
    code, out = run(["bash", "scripts/check.sh"])
    if code == 0:
        return
    if event.get("stop_hook_active"):
        # Already sent back once; let the turn end so the user sees the failure instead of a loop.
        print(json.dumps({"systemMessage": f"No-fakes gate still failing:\n{out}"}))
        return
    print(json.dumps({
        "decision": "block",
        "reason": "scripts/check.sh failed. Fix every violation before finishing, or mark the task [!] "
                  "and explain what's missing.\n\n" + out,
    }))


if __name__ == "__main__":
    handlers = {"pre": pre, "post": post, "stop": stop}
    handlers[sys.argv[1]](json.load(sys.stdin))
