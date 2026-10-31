# software-factories

A software factory for your repositories. You file a change request as a GitHub issue. Agents running in GitHub Agentic Workflows plan it and build it. A deterministic verification layer proves it. Agent reviewers and a bounded fixer drive the pull request to green. You touch each change twice: you approve the plan, and you approve the pull request.

Status on 2026-10-31: the contract, the gate, the classifier, the required judge, and the installer exist and are tested. The agent workflows, the readiness check, and the lanes beyond static and unit arrive in the plan's later tasks. The first project served is [coderkhaleesi/evaluation-bible](https://github.com/coderkhaleesi/evaluation-bible).

## How it works

- `AGENTS.md` is one contract read by Claude Code locally and by the cloud builder. Section 9 says what changes when no human is in the session.
- `scripts/check.sh` is the no-fakes gate. Hooks run it after every edit and before an agent may finish. CI runs it in the static lane.
- A project's facts live in one file, `factory.json`: its commands, its docs and lockfile paths, and what each lane runs. AGENTS.md section 0 is rendered from it, so the commands agents read and the commands CI runs are the same text.
- CI calls this repository's composite actions at a pinned commit. Projects carry no copy of the scripts. The classifier turns a diff into a selection of lanes. One `required` job judges every lane from `toJSON(needs)`, and a selected lane that was skipped fails.
- Labels can only add lanes. The full tier, which may need secrets, comes only from the nightly schedule and manual dispatch.

The design record with usage, shapes, tradeoffs, and alternatives is `docs/design.md`. The plan is in `.agents/PLAN.md` while the work is in progress.

## Install the factory into a project

```bash
git clone https://github.com/coderkhaleesi/software-factories ~/dev/software-factories
cd ~/dev/<project> && git status                                # must be clean
~/dev/software-factories/install.sh --dry-run --preset python-uv .
~/dev/software-factories/install.sh --preset python-uv .
git diff                                                        # review, then commit
```

Presets: `python-uv`, `node-npm`. The dry run prints one row per file and writes nothing. A second real run prints only `unchanged` and `kept`. To upgrade, pull this repository and rerun; every pinned `uses:` line moves to the new commit in one diff. The installer needs a committed, pushed factory checkout, so the pins it writes resolve. It refuses a dirty target and never deletes anything.

What lands in the project, and who owns each file:

<!-- footprint:begin -->
| File | Ownership | Role |
|---|---|---|
| `AGENTS.md` | rendered | the agent contract; section 0 is rendered from factory.json |
| `CLAUDE.md` | managed | Claude Code pointer to AGENTS.md and the hooks |
| `factory.json` | seeded | the project's commands, paths, and lanes |
| `no-fakes.allow` | seeded | the project's approved exceptions, header only at first |
| `no-fakes.profile` | managed | strict |
| `ruff.toml` | managed | ruff rules the no-fakes gate relies on |
| `eslint.config.js` | managed | ESLint rules the no-fakes gate relies on |
| `scripts/check.sh` | managed | the no-fakes gate |
| `scripts/check_no_fakes.py` | managed | the no-fakes checker |
| `.claude/settings.json` | managed | Claude Code hooks |
| `.claude/hooks/guard.py` | managed | hook implementation |
| `.codex/hooks.json` | rendered | Codex hooks, paths rewritten to the project |
| `.codex/hooks/guard.py` | managed | hook implementation |
| `.github/workflows/ci.yml` | rendered | classifier, five lanes, and the required gate, pinned to the factory ref |
| `.github/workflows/factory-light-approve.yml` | rendered | applies factory:approved to light-class issues through the App |
| `.github/pull_request_template.md` | managed | PR body sections and the blank attestation block |
| `.github/ISSUE_TEMPLATE/change-request.yml` | managed | the change-request issue form the planner reads |
| `.github/actions/factory-setup/action.yml` | seeded | the project's toolchain action, owned by the project |
| `.gitignore` | block | ignores the agent work log and reports |
<!-- footprint:end -->

Change the project's test command by editing `commands.test` in `factory.json` and rerunning the installer. Section 0 and the unit lane change together.

## Layout of this repository

- `AGENTS.md`, `CLAUDE.md`: the contract and the Claude Code pointer.
- `factory.json`: this repository's own commands and lanes, rendered into its AGENTS.md.
- `ci/`: the scripts, Node 20 or newer, ESM, zero runtime dependencies, with their tests.
- `actions/`: composite actions projects call at a pinned commit: classify, lane, required.
- `templates/`: the CI workflow and PR template the installer renders into projects.
- `presets/`: a starting `factory.json` and toolchain action per stack.
- `install/`, `install.sh`: the installer and its manifest, the one list of project-side files.
- `workflows/`: the agent workflow sources, installed with `gh aw add` (arrive in later tasks).
- `scripts/`, `ruff.toml`, `eslint.config.js`, `no-fakes.allow`, `no-fakes.profile`: the gate and its rules.
- `.claude/`, `.codex/`: hooks that run the gate in Claude Code and Codex.
- `prompts/`: the spec interview prompt.
- `tests/`: Python tests for the checker.
- `docs/`: the design record.
- `package.json`: ESLint, the only dependency, for the gate's JavaScript half.

## Commands

```bash
npm ci
node --test && python3 -m unittest discover -s tests
bash scripts/check.sh
```

## Labels

Only a person applies `factory:ready`, `factory:approved`, `factory:full`, and `factory:auto-merge`. Agents apply the rest. No label turns a lane off. The full list, with who may apply each, is `LABELS` in `ci/factory.mjs`.
