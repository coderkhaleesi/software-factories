---
description: |
  Second hop of the factory's hop test. Fires when an issue is labeled factory:hello, which
  proves that a label applied through the App token starts a workflow.
on:
  issues:
    types: [labeled]
    names: [factory:hello]
permissions:
  contents: read
  issues: read
imports:
  - shared/factory.md
tools:
  github:
    toolsets: [issues]
safe-outputs:
  add-comment:
    max: 1
timeout-minutes: 5
max-turns: 10
max-ai-credits: 20
max-daily-ai-credits: 50
---

# Factory hello, hop 2

Add one comment to the triggering issue with the text `hop 2: a label applied through the App token started this workflow (run ${{ github.run_id }})`. Do nothing else.
