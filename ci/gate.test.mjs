import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideBuild, decidePlan, main, writeNoop, PLAN_MARKER } from "./gate.mjs";

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
  await assert.rejects(main(["--for", "review", "--repo", "o/r", "--issue", "1", "--bot", "b"], { GITHUB_TOKEN: "x" }), /not a stage/);
});

test("the builder needs a plan comment, the planned label, and no open factory PR for the issue", () => {
  const planned = [comment("td-software-factory[bot]", `${PLAN_MARKER}6\n`)];
  const pr = (ref, state = "open") => ({ state, head: { ref }, html_url: `https://example.test/${ref}` });
  assert.match(decideBuild({ pulls: [], comments: [], labels: ["factory:planned"] }, "6", "td-software-factory").reason, /no plan comment/);
  assert.match(decideBuild({ pulls: [], comments: planned, labels: ["factory:ready"] }, "6", "td-software-factory").reason, /not labelled factory:planned/);
  assert.match(decideBuild({ pulls: [pr("factory/issue-6-template")], comments: planned, labels: ["factory:planned"] }, "6", "td-software-factory").reason, /already has an open factory pull request/);
  const ok = decideBuild({ pulls: [pr("factory/issue-61-other"), pr("factory/issue-6-old", "closed")], comments: planned, labels: ["factory:planned", "factory:approved"] }, "6", "td-software-factory");
  assert.deepEqual(ok, { allowed: true });
});

test("a blocked decision inside a gh-aw job writes a noop safe output", () => {
  const file = join(mkdtempSync(join(tmpdir(), "gate-")), "outputs.jsonl");
  writeNoop(file, "already planned");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8").trim()), { type: "noop", message: "already planned" });
});
