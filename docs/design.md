# Factory design: repo layout and project-side footprint

Written 2026-10-31 in plan task T2 after an architect arena with two candidates. This is the contract the scripts in `ci/`, the installer, and the workflow templates are built against. Deviations found while building are recorded under Implementation reconciliation, not absorbed.

## Problem

The factory ships deterministic CI (a classifier, five lanes, one `required` gate), a PR readiness check, agent pre-flight gates, and a dependency diff into projects that differ in language. The pilot is Python with uv. The factory itself is Node. Four constraints shape the design.

1. Copying `ci/*.mjs` into a Python project breaks that project's no-fakes gate. `scripts/check.sh` finds JavaScript, demands ESLint, and fails every Stop hook there.
2. A reusable `workflow_call` workflow cannot reach the factory's scripts at its own commit without a second, hand-synced SHA input.
3. AGENTS.md sections 5 and 6 bind the scripts. Labels may only add lanes. A selected lane that is skipped or missing fails the gate. A missing input fails with the key named. Nothing is defaulted.
4. Agents can write PR bodies through safe outputs, so a readiness check that trusts the body without proving who wrote it accepts a forgeable attestation.

## Usage (caller's view)

Install into a project, from the project maintainer's README:

```bash
git clone https://github.com/coderkhaleesi/software-factories ~/dev/software-factories
cd ~/dev/evaluation-bible && git status                      # must be clean
~/dev/software-factories/install.sh --dry-run --preset python-uv .
~/dev/software-factories/install.sh --preset python-uv .
git diff                                                      # review, then commit
```

The dry run prints one row per file, `create | update | unchanged | kept | not applicable`, and writes nothing. A second real run prints only `unchanged` and `kept`. To upgrade, pull the factory and rerun. Every pinned `uses:` line moves to the new SHA in one diff. The installer prints, but does not run, the `gh aw add ...@<sha>` lines and the label sync command.

`factory.json` at the project root is the project's facts. It holds the commands, which paths are docs, the lockfiles, and what each lane runs. AGENTS.md section 0 is rendered from its commands, so section 0 and the lanes never disagree. Every key is required. A lane the project has not built yet is `{ "off": "<reason>" }` and reports as off with that reason.

The pilot's `ci.yml`, rendered:

```yaml
jobs:
  changes:
    outputs: { selection: "${{ steps.classify.outputs.selection }}" }
    steps:
      - uses: actions/checkout@<sha> # v4.2.2
        with: { fetch-depth: 0, persist-credentials: false }
      - id: classify
        uses: coderkhaleesi/software-factories/actions/classify@<sha> # software-factories <date> <sha7>
  unit:
    needs: changes
    if: fromJSON(needs.changes.outputs.selection).lanes.unit
    steps:
      - uses: actions/checkout@<sha> # v4.2.2
      - uses: ./.github/actions/factory-setup
      - uses: coderkhaleesi/software-factories/actions/lane@<sha>
        with: { lane: unit, selection: "${{ needs.changes.outputs.selection }}" }
  required:
    needs: [changes, static, unit, integration, acceptance, artifact]
    if: ${{ always() }}
    steps:
      - uses: coderkhaleesi/software-factories/actions/required@<sha>
        with: { needs: "${{ toJSON(needs) }}" }
```

Classify output for a docs-only PR, one line on stdout and one `$GITHUB_OUTPUT` value:

```json
{"version":1,"event":"pull_request","tier":"fast",
 "lanes":{"static":true,"unit":false,"integration":false,"acceptance":false,"artifact":false},
 "off":{"integration":"no container dependency until tracing code lands (T8)"},
 "facts":{"files":2,"docs_only":true,"ci":false,"deps":false,"protected":false,"unclaimed":[]},
 "reasons":[{"rule":"factory:static-always","by":"*"},{"rule":"project:docs","by":"docs/research/judges.md"}]}
```

The `required` table when a seeded `if: false` hits `unit`:

```
job          role        result    verdict
changes      classifier  success   ok
static       selected    success   ok
unit         selected    skipped   FAIL  selected lane did not run
integration  off         skipped   ok    off: no container dependency until tracing code lands (T8)
required: FAIL (1 of 4 rows)
```

Approving a factory PR: the owner pastes the attestation block into the approving review.

```
Human owner: @coderkhaleesi
- [x] I read the diff myself, not only the agent's summary.
- [x] The Evidence section matches what the diff does.
- [x] I own this change and accept responsibility for merging it.
```

## Shape

Repo layout:

```
software-factories/
  AGENTS.md CLAUDE.md README.md         the contract; README's footprint table is generated from the manifest
  factory.json                          the factory's own project facts; its section 0 renders from it too
  package.json package-lock.json        devDependencies: eslint, typescript-eslint (the gate's ESLint half)
  ci/                                   Node >= 20, ESM, zero runtime dependencies, pure functions plus main()
    factory.mjs                         vocabulary: LANES, LABELS, BRANCH, PROTECTED_GLOBS, PR_BODY, ATTESTATION, ARTIFACTS
    config.mjs                          the one factory.json parser, the glob matcher, the section 0 renderer
    github.mjs                          the one API client; raw JSON never leaves it
    classify.mjs required.mjs lane.mjs pr-readiness.mjs gate.mjs deps-diff.mjs labels.mjs
    *.test.mjs                          including vocab.test.mjs (hand-synced lists) and install.test.mjs (real git)
  actions/<name>/action.yml             composite wrappers: classify, lane, required, readiness, gate, deps-diff
  templates/github/                     ci.yml nightly.yml pr-readiness.yml review-relay.yml pull_request_template.md ISSUE_TEMPLATE/
  templates/no-fakes.allow              header-only seed
  presets/{python-uv,node-npm}/         factory.json and setup.yml seeds
  install/manifest.mjs install/install.mjs install.sh
  workflows/*.md workflows/shared/factory.md   gh-aw sources, installed with gh aw add .../workflows/<name>.md@<sha>
  .github/workflows/*.yml               the factory's own CI, equal to the templates rendered with ./actions (test-enforced)
  docs/design.md                        this file
```

Data structures, in the order code depends on them.

- **Selection**, the wire type every lane keys on. `{version, event, tier, lanes: Record<Lane, boolean>, off: Record<Lane, string>, facts, reasons}`. Keys are snake_case so `fromJSON(...).facts.docs_only` reads without brackets. One GitHub output, one line.
- **Rule = Matcher + Effect.** Factory policy, project path rules from `factory.json`, labels, and event kinds share this shape, and one evaluator joins their effects. An Effect can add lanes, raise the tier to full, or set facts. It has no field that removes a lane or lowers a tier, so "no label may remove a lane" holds by construction, and a property test over label subsets checks it. A forged label costs minutes and cannot skip a check. Only the schedule and dispatch events raise the tier, because full-tier commands may need secrets a pull request never gets; a protected change or `factory:full` on a PR selects every lane at the fast tier.
- **Unclaimed paths select every on-lane.** A changed path no rule claims is the fail-closed case. Diffs use `--no-renames`, so moving code into `docs/` is not docs-only.
- **ProjectConfig** from `factory.json`. Per lane a tagged union: `{paths, fast: [commandId], full: {commands, secrets}}` or `{off: reason}`. `fast` has no secrets field, so PR lanes are keyless by type. Lanes name command ids, so a command line exists once and section 0 and CI run the same text. The parser requires the no-fakes gate command in the static lane.
- **Needs** in `required.mjs`. One input, `toJSON(needs)`. The selection rides inside `needs.changes.outputs.selection`, so the caller cannot pass a selection that disagrees with the run. Each lane gets one role, selected, not selected, or off, and each role has one pass set. No branch depends on which lane it is. An unselected lane must still appear in `needs`, so a forgotten job fails the first run.
- **Attestation.** An owner line plus three declarations. From a review: state APPROVED, commit id equal to the head SHA, a User author with admin or maintain permission, and the owner line naming that user. From the PR body: only when the PR author is that user and nobody else edited the body. The blank block, the PR template, the builder prompt, and the review helper all render from one constant.
- **Manifest** in `install/manifest.mjs`. One array of `{path, ownership, source, render?, when?}` with four ownerships: managed (byte copy, overwritten), rendered (a pure function of factory source, `factory.json`, and the factory ref, overwritten), seeded (written once, project-owned after), and block (marker-delimited lines in a project-owned file). Seeded and never overwritten: `factory.json`, `no-fakes.allow`, `.github/actions/factory-setup/action.yml`. The README table is generated from it.

Load-bearing decisions.

- **A project never contains `ci/`.** Scripts run from the factory at a pinned SHA through composite actions, which see the whole repo at that SHA under `$GITHUB_ACTION_PATH`. The project stays free of JavaScript, cannot drift from the version it pins, and upgrades by one SHA bump. gh-aw pre-steps use the same actions.
- **One per-project file, no defaults.** Policy lives in code. A project can add protected globs and docs globs; it cannot remove a factory rule.
- **The project-local setup action holds the toolchain and nothing else.** `uses:` cannot be an expression, so toolchain actions come from a seeded, project-owned composite. Dependency install is the `install` command, run first by every lane.
- **`required` uses `if: always()`.** GitHub counts a skipped required check as passed, so `!cancelled()` would let a cancelled run merge. `always()` runs the judge on every outcome, and every dependency result is its input. This is not the hiding pattern section 6 bans; the dependency results are the whole input.
- **Attempts are counted from the PR's commits by the factory App, not from labels.** The count is read from GitHub, which an agent cannot forget to update, through the read-only token a pre-step holds. `factory:fix-1..3` labels do not exist. The gate's fix stage counts App commits dated after the PR opened, so the builder's own commit never counts; at three it writes a noop plus an `add_labels` safe output for `factory:stuck`, and the fourth failure starts no agent. The fixer runs on `workflow_run` of `CI` for `factory/**` branches, checks out the run's head branch, and refuses when the PR head has moved past the run's SHA. A person re-runs the failed CI run to invoke it by hand; there is no slash command.
- **The reviewer runs on `pull_request: opened` only** for `factory/` heads and submits one COMMENT review. It never runs on `synchronize`, so a fixer push does not trigger a second review, and it cannot approve.
- **Readiness checks out nothing.** It reads the PR, reviews, permissions, changed files, and `factory.json` at the base SHA through the API. Review events reach it through a relay on `workflow_run`, because `pull_request_review` would run the PR head's workflow file. It posts one commit status on the head SHA.
- **Globs use a small matcher** supporting `**`, `*`, `?`, and literals. Node's `matchesGlob` prints an experimental warning on every call.
- **Action shells assign node's output to a variable before writing `$GITHUB_OUTPUT`**, because `echo "x=$(node ...)"` discards the exit status.
- **Node floor is 20 on the runner, with no setup-node inside the factory actions**, since a nested setup-node would change the project's PATH for its own later steps.

Vocabulary, all in `ci/factory.mjs`:

- Lanes: `static`, `unit`, `integration`, `acceptance`, `artifact`.
- Labels, human-only: `factory:ready`, `factory:approved` (also the light-class step), `factory:full`, `factory:auto-merge`. Agent: `factory:planned`, `factory:needs-spec`, `factory:light`, `factory:built`, `factory:suggested`, `factory:needs-input`, `factory:stuck`. Eleven in all; `LABELS.length` is the count tests use.
- Branch: `factory/issue-<N>-<slug>`, slug at most 40 characters of lower-case kebab.
- PR title: Conventional Commits, no `[factory]` prefix. Factory PRs are identified by branch prefix and `factory:built`.
- PR body headings: `## Plan`, `## Evidence`, `## Test Status`, `## Human owner`, the three unchecked declarations, `Closes #N`, and an AI-disclosure line.
- Artifact lane baseline: `factory-artifact-baseline`, uploaded by the schedule event on the default branch; PR output `factory-artifact-<sha7>`.
- Protected globs: `AGENTS.md`, `CLAUDE.md`, `no-fakes.*`, `scripts/check*`, `ruff.toml`, `eslint.config.*`, `factory.json`, `.claude/**`, `.github/**`, `ci/**`.

## Synthesis decision

The opus candidate is the base. Its composite-action distribution removes JavaScript from projects and the hand-synced SHA that a reusable workflow needs, and its single-input `required` closes the gap where a caller passes a selection the run did not use. Its Node installer is testable with the same `node --test` command as the scripts.

Grafted from the sonnet candidate: `if: always()` on `required`, with the reason above; the explicit rule that an unselected lane that reports `failure` or `cancelled` still fails the gate; the review-corroboration wording for attestation; and the README ownership table.

Rejected from sonnet: copying scripts into `.github/factory/` with a symlink in this repo (N drifting copies, and a symlink where the project's CI depends on files it carries but does not own); the reusable `lanes.yml`; fixer attempts as labels written by a pre-step (a pre-step inside the agent job holds a read-only token); a bash installer with a TSV manifest (not testable by the one test command).

Rejected from opus: a fourth declaration required when protected files change (protected changes already select every lane and get `request_review`; the three declarations stay as the trust policy states); rendering `ruff.toml` with a per-project print allowance (`ruff.toml` stays a managed byte copy, extended only by a human edit).

## Tradeoffs accepted

- We accept that every lane job fetches the factory repo at job start, in exchange for projects carrying no copies of the scripts. The factory repo must be public on GitHub, which the pilot plan already requires of itself.
- We accept five near-identical lane jobs in the template instead of a matrix, so `needs` reports each lane separately.
- We accept that `labeled` and `unlabeled` re-run CI, so `factory:full` takes effect at once, softened by `cancel-in-progress`.
- We accept that a lockfile change selects every lane, since a dependency bump can break anything.
- We accept that `install.sh` needs a committed factory HEAD that exists on a remote, even for a dry run, so every pin it writes resolves.
- We accept `statuses: write` on the readiness workflow. The owner's approving review with stale-review dismissal is the second key.
- We accept that the installer never deletes a file a project no longer needs.

## Alternatives considered

- Copy `ci/` into each project, as the plan's T2 list said. Breaks the pilot's gate and leaves N copies to drift.
- A reusable `lanes.yml` workflow, as plan rule 10 said. Hides lanes behind one `uses:` but needs its own SHA passed back in to reach the scripts, and a project cannot add its toolchain step without a callee input per kind.
- Defaults in the scripts with an optional override file. An omitted key silently means the factory's guess, which is the literal-default pattern section 6 bans.
- Separate lane booleans as individual job outputs, as plan T7 listed. A second representation to keep in sync with the JSON.

## Implementation reconciliation

- 2026-10-31, T2. Plan rule 10 said projects install `ci/` and reusable workflows by SHA. Replaced by composite actions at a SHA. Accepted by the plan owner's standing approval of T2's "decide and record" scope; the plan text is updated to match.
- 2026-10-31, T2. T2's Validate line ran `install.sh --dry-run` against the pilot. The installer needs a factory commit that exists on a remote, and this repo has no commits. The Validate moves to `node --test ci/`, where `install.test.mjs` runs the real installer against a scratch bare remote. The real dry run against the pilot runs in T2b after the factory repo exists on GitHub.
- 2026-10-31, T2. T11's `factory:fix-1..3` labels and `ci/attempts.mjs` are replaced by `gate.mjs` counting App commits on the PR. The pilot's trust policy says so after this task.

## Open questions and risks

- Does `gh aw add owner/repo/workflows/x.md@<sha>` also pull `workflows/shared/factory.md` at that ref? T4 checks with the hello workflow.
- Does GitHub list commits pushed through `push-to-pull-request-branch` with the App's bot identity as committer? T11 checks before trusting the attempt count.
- Does a review-triggered readiness status land on the same head SHA that branch protection reads? T12 checks.

## Next implementation step

`ci/factory.mjs`, `ci/config.mjs`, and `ci/classify.mjs` test-first, starting with classify cases for a docs-only diff, an unclaimed path, a rename into `docs/`, and the label-monotonicity property, driven against a scratch git repo.

## The acceptance lane and the nightly tier

The acceptance lane runs a project-owned runner, `tests/acceptance/run_features.py`, seeded from the python-uv preset. Its name misses pytest's default `test_*.py` pattern on purpose, so the project's plain test command never collects it and the acceptance command names the file. It drives the features in `tests/acceptance/features/` the way a reader of the README would: each feature's bash fences run from the repository root and check the observable result themselves. The map lives under `tests/`, not `.claude/`, because `.claude/` is protected from factory workflows and the builder must add a feature file whenever it adds a demo. The lane runner exports `FACTORY_TIER`, so one command serves both tiers: the pull-request lanes run the fast features, and `nightly.yml` runs every feature under the `nightly` environment with the secrets each lane's `full.secrets` names. `ci.yml` runs on pull requests only. A test fails the build when any other template references a GitHub environment.
