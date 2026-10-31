---
description: |
  Hop test for the factory. Comments on an issue and labels it factory:hello through the App
  token, which must make factory-hello-hop fire. Run it once when installing the factory.
on:
  workflow_dispatch:
    inputs:
      issue_number:
        description: The issue to comment on and label
        required: true
        type: string
concurrency:
  job-discriminator: ${{ github.run_id }}
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
    target: "*"
  add-labels:
    allowed: [factory:hello]
    max: 1
    target: "*"
timeout-minutes: 5
max-turns: 10
max-ai-credits: 20
max-daily-ai-credits: 50
---

# Factory hello

Issue number: ${{ github.event.inputs.issue_number }}. Run id: ${{ github.run_id }}.

Do exactly two things on that issue and nothing else.

1. Add one comment with the text `hello from the factory, run ${{ github.run_id }}`.
2. Add the label `factory:hello`.

Do not read other issues, do not edit files, and do not comment anywhere else.
