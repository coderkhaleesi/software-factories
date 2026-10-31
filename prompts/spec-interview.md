# Spec interview

Spec-based workflow for large features (from Thariq, @trq212, Dec 2025):

When to use it, and how the spec relates to `.agents/PLAN.md`: AGENTS.md section 2, "Spec or plan?".

1. Write a minimal spec or prompt in `SPEC.md` (or `specs/<feature>.md`).
2. Run the prompt below (or `/spec-interview specs/<feature>.md`). Claude interviews you with AskUserQuestion and writes the full spec to the file.
3. Start a new session to execute the spec: `implement @specs/<feature>.md, full mode`. That session writes `.agents/PLAN.md` from the spec.

## Prompt

```text
read this @SPEC.md and interview me in detail using the AskUserQuestionTool about literally anything: technical implementation, UI & UX, concerns, tradeoffs, etc. but make sure the questions are not obvious

be very in-depth and continue interviewing me continually until it's complete, then write the spec to the file
```
