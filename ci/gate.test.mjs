import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePlan, main, PLAN_MARKER } from "./gate.mjs";

const comment = (login, body) => ({ user: { login }, body, html_url: `https://example.test/${login}` });

test("the planner may run when no plan comment by the App exists for this issue", () => {
  assert.deepEqual(decidePlan([], "7", "td-software-factory"), { allowed: true });
  const others = [comment("coderkhaleesi", `${PLAN_MARKER}7\n...`), comment("td-software-factory[bot]", `${PLAN_MARKER}8`)];
  assert.deepEqual(decidePlan(others, "7", "td-software-factory"), { allowed: true });
});

test("an existing plan comment by the App blocks a second planner run, with or without the [bot] suffix", () => {
  const comments = [comment("td-software-factory[bot]", `${PLAN_MARKER}7\n\n## Goal`)];
  for (const bot of ["td-software-factory", "td-software-factory[bot]"]) {
    const d = decidePlan(comments, "7", bot);
    assert.equal(d.allowed, false);
    assert.match(d.reason, /already has a plan comment by td-software-factory\[bot\]/);
  }
});

test("missing flags or token fail with the name", async () => {
  await assert.rejects(main(["--for", "plan"], { GITHUB_TOKEN: "x" }), /--repo is required/);
  await assert.rejects(main(["--for", "plan", "--repo", "o/r", "--issue", "1", "--bot", "b"], {}), /GITHUB_TOKEN is required/);
  await assert.rejects(main(["--for", "build", "--repo", "o/r", "--issue", "1", "--bot", "b"], { GITHUB_TOKEN: "x" }), /not implemented yet/);
});
