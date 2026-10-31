#!/usr/bin/env bash
# No-fakes gate: check_no_fakes.py + ruff for Python, ESLint for JS/TS.
#   bash scripts/check.sh            check the whole repo
#   bash scripts/check.sh FILE...    check only these files
# Used by the Claude Code hooks; run it in CI and pre-commit too so other agents hit it.
# no-fakes.profile selects "strict" (default) or "interview"; see scripts/check_no_fakes.py.
set -uo pipefail
cd "$(dirname "$0")/.."

profile=strict
if [ -f no-fakes.profile ]; then
  profile=$(grep -v '^[[:space:]]*#' no-fakes.profile | tr -d '[:space:]')
fi
case "$profile" in
  strict) ruff_args=() ;;
  # Interview code prints, leaves TODOs, and keeps scratch lines around.
  interview) ruff_args=(--ignore FIX,ERA001,T20) ;;
  *) echo "error: no-fakes.profile must be 'strict' or 'interview', got '$profile'" >&2; exit 1 ;;
esac

prune=(-not -path '*/.*' -not -path '*/node_modules/*' -not -path '*/venv/*')
has_py() { [ -n "$(find "$1" -name '*.py' "${prune[@]}" -print -quit)" ]; }
has_js() {
  [ -n "$(find "$1" \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \) \
    -not -name 'eslint.config.*' "${prune[@]}" -print -quit)" ]
}

py=()
js=()
[ $# -gt 0 ] || set -- .
for f in "$@"; do
  if [ -d "$f" ]; then
    has_py "$f" && py+=("$f")
    has_js "$f" && js+=("$f")
  else
    case "$f" in
      *.py) py+=("$f") ;;
      *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) js+=("$f") ;;
      *) echo "error: $f is not a directory or a Python/JS/TS file" >&2; exit 1 ;;
    esac
  fi
done

status=0

if [ ${#py[@]} -gt 0 ]; then
  python3 scripts/check_no_fakes.py "${py[@]}" || status=1
  if command -v ruff >/dev/null; then
    ruff check --ignore-noqa ${ruff_args[@]+"${ruff_args[@]}"} "${py[@]}" || status=1
  elif command -v uvx >/dev/null; then
    uvx ruff check --ignore-noqa ${ruff_args[@]+"${ruff_args[@]}"} "${py[@]}" || status=1
  else
    echo "error: Python files present but ruff is not installed (pip install ruff)" >&2
    status=1
  fi
fi

if [ ${#js[@]} -gt 0 ]; then
  if [ -x node_modules/.bin/eslint ]; then
    node_modules/.bin/eslint "${js[@]}" || status=1
  else
    echo "error: JS/TS files present but ESLint is not installed (npm i -D eslint typescript-eslint)" >&2
    status=1
  fi
fi

exit $status
