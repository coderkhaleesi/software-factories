# AGENTS.md

Rules for any agent working in this repository. These are requirements, not suggestions.

This repository is the software factory: the agentic workflows, CI lanes, and gate scripts that other projects install. The first project it serves is `coderkhaleesi/evaluation-bible`. The same file is installed into every project the factory serves, with section 0 replaced by that project's commands, and the cloud builder reads it too. Section 9 says what changes when no human is in the session.

An explicit user instruction overrides these rules for that request. When you set a rule aside because of one, say which rule in your next message. If an instruction is ambiguous about whether it overrides a rule, ask.

## 0. Commands

Validate steps and the final validation use these commands, not invented ones. A Validate step may not cite a command that does not exist yet. If the task creates the command, the Validate step runs it after the task.

<!-- commands:begin -->
- Install: `npm ci`
- Test: `node --test && python3 -m unittest discover -s tests`
- Lint: `actionlint .github/workflows/*.yml`
- Compile workflows: `gh aw compile --verbose`
- No-fakes gate: `bash scripts/check.sh` (see section 6)
<!-- commands:end -->

Per project the factory serves, replace this list with that project's commands and keep the no-fakes gate.

## 1. Plan before you act

Every change runs in full mode. There is no light mode. Do not write, edit, or delete code until a plan exists and the user has approved it.

### Spec or plan?

| Requirements | Write |
|---|---|
| Clear | `.agents/PLAN.md` only. Requirements go in its Context and Assumptions. |
| Not clear | A spec first, then `.agents/PLAN.md`. |

Requirements aren't clear when any of these hold:
- the work needs product or UX decisions the user hasn't made,
- it will span several sessions or PRs,
- planning turns up more than two open questions that each block a task,
- or the user asks for a spec.

**Who starts the spec.** The user, by running `/spec-interview <file>` (the prompt is also in `prompts/spec-interview.md`). You can't run it, and the interview needs the user anyway. When the work meets the criteria above, stop before writing `PLAN.md` and suggest it: "This needs a spec because <reason>. Run `/spec-interview specs/<feature>.md`?" If the user declines, list the open questions in `PLAN.md` and continue as usual.

**Spec vs. plan.**
- The spec (`SPEC.md` or `specs/<feature>.md`) says what to build and why: behavior, UX, constraints, edge cases, and what's out of scope. The user owns it, and it gets committed with the code. Edit it only during a spec interview or with the user's approval.
- `.agents/PLAN.md` says how you'll build it: tasks, skills, validation, evidence. You own it. It's a gitignored work log.
- The plan's `Spec:` line names the spec. Every requirement in the spec maps to at least one task's Validate step, and the plan adds no scope the spec doesn't have.
- If the spec turns out wrong or incomplete mid-build, stop and tell the user. Update the spec first (with approval), then the plan. Never let the plan quietly diverge from the spec.
- Writing the spec and building it happen in separate sessions. The interview session ends when the spec is written. The build starts in a new session: "implement @specs/<feature>.md".

### Steps

1. Read the request, the spec if there is one, and the relevant code. Don't guess at structure you haven't read.
2. Create or update `.agents/PLAN.md` using the template in section 8.
3. Break the work into tasks. Each task should:
   - change one coherent thing,
   - be possible to validate on its own,
   - be finishable in a single focused pass.
4. Every task needs a **Validate** step: a command and its expected result, or a concrete check. "Looks right" is not a validation.
5. Every task names a **Skill** (section 3).
6. List assumptions and open questions. If an open question blocks a task, ask before starting that task.

A one-line fix follows the same steps. The plan is short, but it exists and it waits for approval.

## 2. Talk to the user

### Before execution
After writing the plan, send:
- the goal in one sentence,
- the task list, with each task's skill,
- assumptions and open questions,
- anything irreversible or touching shared systems.

Then wait for approval. If the user changes the plan, update `PLAN.md` first, then confirm the change.

### After each task
When a task is marked `[x]` or `[!]`, send: the task, its status, the validation result, and anything that changes later tasks. A few lines at most.

### At the end
Send a final report:
- what changed (files and behavior),
- what was validated and how,
- what is blocked and what would unblock it.

### Any time
Stop and ask instead of guessing when an open question blocks the next task, the plan turns out to be wrong, or a task can't be done for real (section 6).

## 3. Skills

pstack is required. Every task runs under `/pstack:poteto-mode`. If pstack is not installed, stop and tell the user before planning. Don't substitute an unskilled run.

pstack installs as a plugin, so its skills are namespaced: `/poteto-mode` in this file means `/pstack:poteto-mode`, and so on. `/spec-interview` and `/prompt-review` are user skills in `~/.claude/skills/`, not pstack.

### Default: `/poteto-mode`
Give it the task goal and use the task's **Validate** line as the finish condition. Playbook steps it loads are sub-steps of the current `PLAN.md` task, not new tasks. poteto-mode routes to the skills below on its own; name one on a task only when the task is just that move.

### Call one skill directly when the task is just that move

| Task is mainly... | Skill |
|---|---|
| Understanding how existing code or a workflow works | `/how` |
| Understanding why something is the way it is | `/why` |
| Recalling earlier decisions on this codebase | `/recall` |
| Clarifying a vague request: the real goal, the expert approach, how much spec it needs | `/sharpen` |
| Confirming you understood the goal before planning | `/in-your-own-words` |
| Designing the shape of a change: types, signatures, modules, workflow boundaries | `/architect` |
| Comparing competing designs | `/arena` |
| Stress-testing a design, a gate, or an assumption | `/interrogate` |
| Planning a large migration or open-ended multi-part change | `/figure-it-out` |
| Splitting independent work across agents | `/swarm` |
| Writing code test-first | `/tdd` |
| Generating or repairing a project's scripted app driver for the acceptance lane | `/create-verification-skill`, `/maintain-verification-skill` |
| Turning a repeated agent mistake into a lint, type, or test | `/correct` |
| Keeping a decision trail for unattended or multi-phase work | `/show-me-your-work` |
| Writing docs, workflow prompts, PR bodies, or commit messages | `/technical-writing` |
| Cleaning prose, comments, or docs | `/unslop` |
| Auditing a finished branch for bugs, security, and maintainability | `/thermos` |
| Reviewing a finished task against the transcript | `/reflect` |

If a task needs more than one move, or you're unsure, use `/poteto-mode`. Put research and design tasks before build tasks.

### Specs and design
For when to write a spec and who starts it, see "Spec or plan?" in section 1. Skills for the design work:
- When the request is loose but doesn't need a full spec, make the first task `/sharpen` to pin down requirements. Add an `/architect` task if the change crosses a function or workflow boundary. Record the results in `PLAN.md` under Context and Assumptions, then plan the build tasks.
- When a spec exists, skip `/sharpen`. Use `/architect` for the shape if the spec leaves it open.
- Stress-test the spec with `/interrogate`. Use `/arena` only when there's a real design choice to settle.
- poteto-mode's `multi-phase-plan` playbook is only for work that spans several PRs, and only when the user asks for it. Write its plan under `.agents/`, not `~/.claude/orchestrate/`. Don't run its prototype, live-lane, or PR steps without approval.

### When a skill conflicts with this file
This file wins. Skip any skill or playbook step that commits, rebases, pushes, opens a PR, merges, needs a worktree that requires a commit, or writes outside the repo, and say which step you skipped. The Babysit, Shipping, and Autopilot playbooks run only when the user asks for them by name.

## 4. Execute one task at a time

- Mark the task `[~]` before starting it.
- Work on that task only. New work becomes a new task in the plan. If it changes scope, tell the user before doing it.
- Run the validation when the task is done.
- Mark it `[x]` only after validation passes, and record the command and relevant output under **Evidence**.
- If validation fails, fix the cause and re-run. Don't weaken the validation.

### Stay in scope
- Don't refactor, rename, or reformat code the task doesn't need.
- Don't add or upgrade dependencies without asking.
- Don't edit a test to make it pass. If you believe the test is wrong, stop and say why.
- Don't commit, push, open PRs, or merge unless asked.

## 5. Factory rules

These apply to the files the factory is made of: agentic workflow Markdown, Actions YAML, and the gate scripts in `ci/`.

- Agents never hold write tokens. Every write a workflow makes is a `safe-outputs` entry with a `max`. `permissions` stays read-only.
- `merge-pull-request` is not a safe output until `docs/factory/trust-policy.md` says so for a labelled class.
- Every `uses:` pins a full commit SHA with the version in a comment.
- Every agentic workflow sets `timeout-minutes`, `max-turns`, and `max-ai-credits`.
- Threat detection stays on, with `continue-on-error: false` on any workflow that pushes code.
- Tests are not retried. No `retry`, `rerun-failed`, or `|| true` on a test step.
- A lane that cannot run because a tool or secret is missing reports skipped with the reason. It never reports passed.
- `required.mjs` treats a skipped, cancelled, or missing selected lane as a failure. Don't add an exception for one lane.
- `pr-readiness` checks out the default branch, never the PR head.
- Factory workflows never edit protected files (`AGENTS.md`, `CLAUDE.md`, `no-fakes.*`, `scripts/check*`, lint configs, `.claude/`, `.github/`, `ci/`). A workflow that touches them gets `request_review`, never `allowed`. In a session with a human, `ci/` and `.github/` are ordinary task scope; the rest follow section 6.
- After every edit to a workflow file, run `gh aw compile --verbose`. A warning is a failure for the Validate step.

## 6. No mocks, no stubs, no fallbacks

The code must do the real thing or fail visibly. There is one path, and it either works or raises.

### Never
- Mock, fake, stub, dummy, or placeholder implementations, in production code or tests.
- Hardcoded or sample data returned in place of a real call.
- A `catch`/`except` that doesn't rethrow: no logging and continuing, no `return None`, no default value.
- A fallback: when the intended path fails, quietly doing something else (another source, a cached value, a default, a "degraded mode").
- Literal defaults that hide missing data: `x or "unknown"`, `x ?? []`, `os.getenv("K", "dev")`.
- `TODO`, `pass`, `...`, `NotImplementedError`, or empty bodies in delivered code.
- Skipped, focused, or `xfail` tests.
- Comments or docstrings that admit a shortcut: "for now", "simulate", "temporary", "hardcoded".
- In YAML, the same things by other names: `continue-on-error: true` on a gate, `if: always()` that hides a failed dependency, a step that swallows an exit code, an action pinned to a floating tag.

### Instead
- Let errors propagate. If you catch one, rethrow it with context (`raise X(...) from e`, `throw new X(..., { cause: e })`).
- Validate required config at startup and fail with a message naming the missing key.
- Test against the real system. If a test can't reach it, that's a blocker to report, not a reason to mock.

### Test doubles
Only allowed in files the user has listed in `no-fakes.allow`, with a reason. Don't edit that file. If you think a double is needed, stop and ask.

### Profile
`no-fakes.profile` is `strict` and stays `strict`. Don't change it, and don't pass the checker a different profile.

### Enforcement
- `bash scripts/check.sh` runs `scripts/check_no_fakes.py`, ruff, and ESLint. A failure fails validation.
- In Claude Code, hooks in `.claude/settings.json` run the checks after every edit and refuse to let you finish while they fail. In Codex, `.codex/hooks.json` does the same. Other agents, and the cloud builder, run `scripts/check.sh` as part of every Validate step, and CI runs it in the `static` lane.
- `noqa` and `eslint-disable` comments are ignored. The rules (`AGENTS.md`, `CLAUDE.md`), the checkers, the lint configs, `no-fakes.allow`, `no-fakes.profile`, and the hooks are human-edited. Edit one only when the user names it in an instruction, and say so in your next message.
- Renaming things to dodge a check (`alt_source`, `backup_path`, `default_data`) is the same violation. The rule is about behavior, not words.

If you can't implement something for real (missing credentials, unreachable service, unclear spec), mark the task `[!]`, write down what's missing, and tell the user. A blocked task is acceptable. A faked one isn't.

## 7. Finish

The work is done when:
- every task is `[x]`, or `[!]` with a stated reason,
- the final validation passes,
- a short summary is at the bottom of `PLAN.md`,
- the final report has been sent.

Don't claim completion for anything you haven't validated.

## 8. PLAN.md template

```markdown
# Plan: <one-line goal>

## Goal
<What done looks like.>

Spec: <path to the spec, or "none: requirements are in Context and Assumptions">

## Context
<Files, modules, and constraints read before planning.>

## Assumptions
- <Assumption, and how it will be checked.>

## Open questions
- <Question> (blocks: T2)

## Approval
- Status: [ ] waiting / [x] approved <date>
- Changes requested: <none, or what changed>

## Tasks

### T1: <imperative title>
- Status: [ ]
- Skill: `/how` (need to understand the auth flow first)
- Change: <what, which files>
- Validate: `<command>` → expect <result>
- Evidence:

### T2: <imperative title>
- Status: [ ]
- Depends on: T1
- Skill: `/poteto-mode`
- Change: <...>
- Validate: `<command>` → expect <result>
- Evidence:

## Final validation
- Test, lint, typecheck, and `bash scripts/check.sh` from section 0 → all pass
- <End-to-end check against the real system>

## Summary
<Filled in at the end.>
```

Status markers: `[ ]` not started, `[~]` in progress, `[x]` done and validated, `[!]` blocked.

## 9. The same rules without a human in the session

The factory's cloud builder runs this file inside a GitHub Agentic Workflow. Nobody is watching the session, so these substitutions apply. Everything else above still holds.

- The approved plan is the planner's comment on the issue. Treat it as `PLAN.md`. The `factory:approved` label is the approval in section 2.
- You cannot ask the user. An open question that blocks a task ends the run: comment the question on the issue, label it `factory:needs-input`, and stop. Don't pick an answer.
- A blocked task is `[!]` in the PR body with what's missing, plus the `factory:stuck` label. Never a stub.
- Write every Validate command's output under Evidence in the PR body. Evidence is the literal output, not a description of it.
- Open the PR as a draft with `Closes #<issue>` and an AI-disclosure line. Leave the Human owner line and the readiness checkboxes blank. A human fills them. Never attest to a human review.
- Stay inside the bash allowlist and the network allowlist. A blocked command or host is reported in the PR body, not worked around.
- The run has a turn and credit budget. If it runs out mid-task, push nothing, comment what was finished and what was not, and label `factory:stuck`.

## 10. Bootstrap mode

Temporary. Applies while `.agents/PLAN.md` in `software-factories` is being executed, in this repository and in the pilot's baseline work, and ends when that plan's T14 is `[x]` or the user deletes this section. Everything else in this file still holds.

- The plan is approved. When a task is `[x]` or `[!]`, send the after-task report and start the next task without waiting for a go.
- Commit and push on `main` of this repository and on `factory/*` branches of the pilot without asking, and open pull requests. Never merge, force-push, rewrite history, or delete a branch or a repository.
- GitHub actions the plan names (creating the factory repository, labels, the GitHub App, environments, branch protection, repository settings) run without asking again. Secret values are entered by the user. Ask for one when a task needs it; never read one from a file or paste one into a message.
- Edit a protected file in this repository when a task needs it, and name the file in the report.
- Dev dependencies the plan names are approved. Any other dependency still needs a yes.
- Section 1 still applies to new work: a change the plan does not name gets a task in the plan first.
