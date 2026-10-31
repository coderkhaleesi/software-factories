@AGENTS.md

Claude Code only:

- Run every task under `/pstack:poteto-mode`. The task's Validate line is the finish condition.
- Hooks in `.claude/settings.json` enforce AGENTS.md section 6: a PostToolUse check runs `scripts/check.sh` on each edited Python or JS file, and a Stop hook runs the full gate before the turn can end. There is no PreToolUse guard. Protected files stay human-edited by rule, not by hook.
- `.agents/` holds the plan, the todolist, and decision trails. It is gitignored.
- Keep `AGENTS.md` as the single source of process. Put nothing in this file that another agent runtime would also need.
