import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideBuild, decideFix, decidePlan, fixAttempts, main, planComment, safeOutputsFor, writeSafeOutputs, PLAN_MARKER } from "./gate.mjs";
import { FIX_ATTEMPTS } from "./factory.mjs";

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

test("missing flags or token fail with the name, per stage", async () => {
  await assert.rejects(main(["--for", "plan"], { GITHUB_TOKEN: "x" }), /--repo is required/);
  await assert.rejects(main(["--for", "plan", "--repo", "o/r", "--issue", "1", "--bot", "b"], {}), /GITHUB_TOKEN is required/);
  await assert.rejects(main(["--for", "review", "--repo", "o/r", "--issue", "1", "--bot", "b"], { GITHUB_TOKEN: "x" }), /not a stage/);
  await assert.rejects(main(["--for", "build", "--repo", "o/r", "--bot", "b"], { GITHUB_TOKEN: "x" }), /--issue is required for the build stage/);
  await assert.rejects(main(["--for", "fix", "--repo", "o/r", "--bot", "b", "--branch", "factory/issue-1-a"], { GITHUB_TOKEN: "x" }), /--head-sha is required for the fix stage/);
  await assert.rejects(main(["--for", "fix", "--repo", "o/r", "--bot", "b", "--branch", "factory/issue-1-a", "--head-sha", "abc"], { GITHUB_TOKEN: "x" }), /--head-sha must be a full commit SHA/);
  await assert.rejects(main(["--for", "plan", "--repo", "o/r", "--bot", "b", "--issue", "x"], { GITHUB_TOKEN: "x" }), /--issue must be a number/);
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

test("a blocked decision inside a gh-aw job writes a noop safe output, and an exhausted fixer also the stuck label", () => {
  const file = join(mkdtempSync(join(tmpdir(), "gate-")), "safeoutputs", "outputs.jsonl");
  writeSafeOutputs(file, safeOutputsFor({ allowed: false, reason: "already planned" }));
  writeSafeOutputs(file, safeOutputsFor({ allowed: false, reason: "three pushes", stuck: 14 }));
  const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { type: "noop", message: "already planned" },
    { type: "noop", message: "three pushes" },
    { type: "add_labels", labels: ["factory:stuck"], item_number: 14 },
  ]);
});

const HEAD = "ae7aea3b4c5d6e7f8091a2b3c4d5e6f708192a3b";
const OPENED = "2026-10-31T23:20:14Z";
const pull = (over = {}) => ({
  number: 14, state: "open", created_at: OPENED, html_url: "https://example.test/pull/14",
  head: { ref: "factory/issue-11-reject-non-kebab-skill-names-e7c51b047938a648", sha: HEAD }, ...over,
});
const commit = (login, date) => ({ author: login === null ? null : { login }, commit: { committer: { date } } });
const builderCommit = commit("td-software-factory[bot]", "2026-10-31T23:19:50Z");
const fixCommit = (n) => commit("td-software-factory[bot]", `2026-11-01T0${n}:00:00Z`);

test("fix attempts are the App's commits after the pull request opened; the builder's and a human's never count", () => {
  const commits = [builderCommit, commit("coderkhaleesi", "2026-11-01T01:00:00Z"), commit(null, "2026-11-01T01:30:00Z"), fixCommit(2), fixCommit(3)];
  assert.equal(fixAttempts(pull(), commits, "td-software-factory"), 2);
  assert.equal(fixAttempts(pull(), commits, "td-software-factory[bot]"), 2);
  assert.equal(fixAttempts(pull(), [builderCommit], "td-software-factory"), 0);
});

test("the fixer needs an open factory PR at the failing run's head with fewer than three fix pushes", () => {
  const bot = "td-software-factory";
  assert.match(decideFix({ pull: undefined, commits: [] }, "factory/issue-11-x", HEAD, bot).reason, /no open pull request has the head branch factory\/issue-11-x/);
  assert.match(decideFix({ pull: pull({ head: { ref: "feature/x", sha: HEAD } }), commits: [] }, "feature/x", HEAD, bot).reason, /not on a factory branch/);
  const moved = decideFix({ pull: pull({ head: { ref: "factory/issue-11-x", sha: "f".repeat(40) } }), commits: [] }, "factory/issue-11-x", HEAD, bot);
  assert.match(moved.reason, /moved since the failing run \(run ae7aea3, head fffffff\); the newer run decides/);
  assert.deepEqual(decideFix({ pull: pull(), commits: [builderCommit] }, pull().head.ref, HEAD, bot), { allowed: true, attempt: 1 });
  assert.deepEqual(decideFix({ pull: pull(), commits: [builderCommit, fixCommit(1), fixCommit(2)] }, pull().head.ref, HEAD, bot), { allowed: true, attempt: 3 });
  const exhausted = decideFix({ pull: pull(), commits: [builderCommit, fixCommit(1), fixCommit(2), fixCommit(3)] }, pull().head.ref, HEAD, bot);
  assert.equal(exhausted.allowed, false);
  assert.equal(exhausted.stuck, 14);
  assert.match(exhausted.reason, new RegExp(`has had ${FIX_ATTEMPTS} fix pushes by the factory App; a human must look`));
});

test("planComment returns the App's plan for this issue and nothing else", () => {
  const mine = comment("td-software-factory[bot]", `${PLAN_MARKER}6\n\n## Goal`);
  const comments = [comment("coderkhaleesi", `${PLAN_MARKER}6`), comment("td-software-factory[bot]", `${PLAN_MARKER}66`), mine];
  assert.equal(planComment(comments, "6", "td-software-factory"), mine);
  assert.equal(planComment(comments, "7", "td-software-factory"), undefined);
});
