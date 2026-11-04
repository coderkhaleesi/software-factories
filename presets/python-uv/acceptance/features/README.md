# Acceptance feature map

The maintained source for proving this project's user-facing behavior. `tests/acceptance/run_features.py` reads every `*.md` file in this directory except this index, selects the features for the current tier, and runs each one's bash fences from the repository root under `bash -euo pipefail`. A feature passes when its fences exit 0. The fences check the observable end state themselves. A command that prints the right thing but is not checked proves nothing.

## Feature file contract

- An H1 title and one paragraph on the user-visible behavior.
- Exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`.
- The driving section starts with `Preconditions:` and carries one `- Tier: fast` or `- Tier: full` line. Fast means no key and no network. Full means the feature needs a secret from the `nightly` environment, and that secret is named in `factory.json` under `lanes.acceptance.full.secrets`.
- The driving section holds one or more fenced `bash` blocks. They run in order from the repository root. Each block drives the real surface the way a user would and checks the result with `grep -q`, an exit code, or a file that exists.
- Evidence lands in `reports/acceptance/<feature-id>.log`: the script, stdout, stderr, and the exit code. Cleanup inside a block removes scratch state the block created, never the log.
- Every `demos/<name>/README.md` has a feature file `demo-<name>.md`. The runner fails when one is missing.

## Tiers

- `FACTORY_TIER=fast` runs the fast features. The pull-request lanes run this tier.
- `FACTORY_TIER=full` runs every feature. The nightly workflow runs this tier under the `nightly` environment.

## Features

One line per feature file, added by the project.
