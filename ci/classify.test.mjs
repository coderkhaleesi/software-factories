import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.mjs";
import { LANES, LABELS, HUMAN_ONLY_LABELS } from "./factory.mjs";
import { classify, changedPaths } from "./classify.mjs";

const config = loadConfig(new URL("../presets/python-uv/factory.json", import.meta.url).pathname);
const pr = (paths, labels = []) => classify({ event: "pull_request", base: "a".repeat(40), head: "b".repeat(40), labels }, paths, config);
const onLanes = LANES.filter((l) => !("off" in config.lanes[l]));

test("docs-only PR runs static and artifact only, on the fast tier", () => {
  const s = pr(["docs/research/judges.md", "README.md"]);
  assert.equal(s.tier, "fast");
  // The secret scan and the dependency check judge every change, so artifact joins static.
  assert.deepEqual(s.lanes, { static: true, unit: false, integration: false, acceptance: false, artifact: true });
  assert.equal(s.facts.docs_only, true);
  assert.deepEqual(s.facts.unclaimed, []);
  assert.deepEqual(s.off, Object.fromEntries(LANES.filter((l) => "off" in config.lanes[l]).map((l) => [l, config.lanes[l].off])));
});

test("a source change selects unit; an unclaimed path selects every on lane", () => {
  assert.equal(pr(["src/evaluation_bible/agents/retail.py"]).lanes.unit, true);
  const s = pr(["newtool/thing.cfg"]);
  assert.deepEqual(s.facts.unclaimed, ["newtool/thing.cfg"]);
  for (const lane of onLanes) assert.equal(s.lanes[lane], true, lane);
  assert.equal(s.tier, "fast");
  assert.ok(s.reasons.some((r) => r.rule === "factory:unclaimed-selects-all" && r.by === "newtool/thing.cfg"));
});

test("protected and lockfile paths select every lane, keep the fast tier, and are never docs-only", () => {
  const s = pr([".github/workflows/ci.yml"]);
  assert.equal(s.tier, "fast");
  for (const lane of onLanes) assert.equal(s.lanes[lane], true, lane);
  assert.equal(s.facts.protected, true);
  assert.equal(s.facts.ci, true);
  assert.equal(s.facts.docs_only, false);
  const d = pr(["uv.lock"]);
  assert.equal(d.facts.deps, true);
  for (const lane of onLanes) assert.equal(d.lanes[lane], true, lane);
  assert.equal(pr(["AGENTS.md"]).facts.docs_only, false);
});

test("off lanes are never selected, even on the full tier", () => {
  const s = classify({ event: "schedule" }, [], config);
  assert.equal(s.tier, "full");
  assert.equal(s.facts, null);
  for (const lane of LANES) assert.equal(s.lanes[lane], !("off" in config.lanes[lane]), lane);
});

test("labels only add: lanes and tier are monotone over label subsets", () => {
  const names = LABELS.map((l) => l.name);
  const paths = ["docs/a.md"];
  const base = pr(paths);
  for (let mask = 0; mask < 2 ** names.length; mask += 1) {
    const labels = names.filter((_, i) => mask & (1 << i));
    const s = pr(paths, labels);
    for (const lane of LANES) assert.ok(!base.lanes[lane] || s.lanes[lane], `${labels} removed ${lane}`);
    assert.equal(s.tier, "fast", `${labels} changed the tier of a pull request`);
  }
  for (const lane of onLanes) assert.equal(pr(paths, ["factory:full"]).lanes[lane], true, lane);
  assert.equal(pr(paths, ["factory:planned", "bug"]).tier, "fast");
});

test("only human-only labels carry a classifier effect", () => {
  for (const label of LABELS) {
    if ("ci" in label) assert.ok(HUMAN_ONLY_LABELS.includes(label.name), label.name);
  }
});

test("changedPaths reads a real diff and shows a rename as delete plus add", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-classify-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/x.py"), "print(1)\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  mkdirSync(join(dir, "docs"));
  renameSync(join(dir, "src/x.py"), join(dir, "docs/x.md"));
  git("add", "-A");
  git("commit", "-q", "-m", "move");
  const head = git("rev-parse", "HEAD");
  const paths = changedPaths(base, head, dir);
  assert.deepEqual(paths.sort(), ["docs/x.md", "src/x.py"]);
  const s = classify({ event: "pull_request", base, head, labels: [] }, paths, config);
  assert.equal(s.facts.docs_only, false);
  assert.equal(s.lanes.unit, true);
  assert.throws(() => changedPaths("main", head, dir), /base must be a commit SHA/);
});
