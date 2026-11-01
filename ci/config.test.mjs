import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compileGlob, matchesAny, parseConfig, loadConfig, commandsForLane, renderSection0, replaceSection0 } from "./config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const valid = () => JSON.parse(readFileSync(join(ROOT, "presets/python-uv/factory.json"), "utf8"));

test("every shipped factory.json parses", () => {
  for (const f of ["factory.json", "presets/python-uv/factory.json", "presets/node-npm/factory.json"]) {
    const config = loadConfig(join(ROOT, f));
    assert.equal(config.version, 1, f);
  }
});

test("globs: ** crosses directories, * and ? do not", () => {
  assert.ok(compileGlob("docs/**").test("docs/a/b.md"));
  assert.ok(compileGlob("**/*.md").test("README.md"));
  assert.ok(compileGlob("**/*.md").test("docs/x/y.md"));
  assert.ok(!compileGlob("*.md").test("docs/x.md"));
  assert.ok(compileGlob("scripts/check*").test("scripts/check_no_fakes.py"));
  assert.ok(compileGlob("eslint.config.*").test("eslint.config.js"));
  assert.ok(!compileGlob("src/?.py").test("src/ab.py"));
  assert.ok(matchesAny("uv.lock", ["package-lock.json", "uv.lock"]));
  assert.throws(() => compileGlob("src/{a,b}"), /unsupported glob syntax/);
});

test("a missing key fails naming its path", () => {
  const raw = valid();
  delete raw.paths.lockfiles;
  assert.throws(() => parseConfig(raw, "x.json"), /x\.json: paths\.lockfiles: must be a list/);
  const noInstall = valid();
  delete noInstall.commands.install;
  assert.throws(() => parseConfig(noInstall), /commands\.install: is required/);
});

test("lanes: all five required, no extras, static carries the gate", () => {
  const extra = valid();
  extra.lanes.perf = { off: "x" };
  assert.throws(() => parseConfig(extra), /lanes\.perf: is not a lane/);
  const missing = valid();
  delete missing.lanes.artifact;
  assert.throws(() => parseConfig(missing), /lanes\.artifact: is required/);
  const staticOff = valid();
  staticOff.lanes.static = { off: "no" };
  assert.throws(() => parseConfig(staticOff), /lanes\.static: cannot be off/);
  const unknownCommand = valid();
  unknownCommand.lanes.unit.fast = ["bench"];
  assert.throws(() => parseConfig(unknownCommand), /lanes\.unit: names command "bench"/);
  const wrongGate = valid();
  wrongGate.commands.nofakes.run = "true";
  assert.throws(() => parseConfig(wrongGate), /commands\.nofakes\.run: must be "bash scripts\/check\.sh"/);
});

test("commandsForLane runs install first and adds full-tier commands only on full", () => {
  const raw = valid();
  raw.commands.bench = { label: "Bench", run: "uv run bench" };
  raw.lanes.unit.full.commands = ["bench"];
  const config = parseConfig(raw);
  assert.deepEqual(commandsForLane(config, "unit", "fast").map((c) => c.id), ["install", "test"]);
  assert.deepEqual(commandsForLane(config, "unit", "full").map((c) => c.id), ["install", "test", "bench"]);
  assert.throws(() => commandsForLane(config, "integration", "fast"), /lane integration is off/);
});

test("section 0 renders one line per command and replaces exactly one marked block", () => {
  const config = parseConfig(valid());
  const body = renderSection0(config);
  assert.equal(body.split("\n")[0], "- Install: `uv sync`");
  const doc = "intro\n<!-- commands:begin -->\nold\n<!-- commands:end -->\nrest";
  assert.equal(replaceSection0(doc, body), `intro\n<!-- commands:begin -->\n${body}\n<!-- commands:end -->\nrest`);
  assert.throws(() => replaceSection0("no markers", body), /expected exactly one/);
  assert.throws(() => replaceSection0(`${doc}\n<!-- commands:end -->`, body), /found 2/);
});
