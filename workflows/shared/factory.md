---
# Shared by every factory workflow. Imported with `imports: [shared/factory.md]`.
# The App token is what lets a safe output start the next stage: events made with the default
# GITHUB_TOKEN start no workflows. The App is created once per account and installed on the repo.
engine: claude
github-app:
  client-id: ${{ vars.FACTORY_APP_ID }}
  private-key: ${{ secrets.FACTORY_APP_PRIVATE_KEY }}
network: defaults
---

Read `AGENTS.md` in this repository before anything else. Nobody is watching this session, so section 9 applies: you cannot ask a question, you never attest to a human review, and a blocked task is reported, never faked.
