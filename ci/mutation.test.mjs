import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECK_NAME, HEALTH_ISSUE, SUGGEST_LABEL, readReports, renderReport, suggestionTitle, summarize, weakestModule, main } from "./mutation.mjs";
import { parseConfig } from "./config.mjs";

// mutmut 3.8.1's export-cicd-stats on the pilot, 2026-11-01.
const STATS = { killed: 77, survived: 10, total: 123, no_tests: 36, skipped: 0, suspicious: 0, timeout: 0, check_was_interrupted_by_user: 0, segfault: 0 };
const RESULTS = [
  "    tools.validate_structure.x_frontmatter_fields__mutmut_19: survived",
  "    tools.validate_structure.x_skill_problems__mutmut_6: survived",
  "    tools.validate_structure.x_count_skills__mutmut_1: no tests",
  "    tools.validate_structure.x_count_skills__mutmut_2: no tests",
  "    evaluation_bible.slug.x_kebab__mutmut_1: killed",
  "    evaluation_bible.slug.x_kebab__mutmut_2: survived",
  "noise line",
].join("\n");

test("the score counts timeouts as killed and untested mutants against the project", () => {
  const s = summarize(STATS, RESULTS);
  assert.equal(s.judged, 123);
  assert.equal(s.score, 77 / 123);
  assert.deepEqual(s.untestedByModule, { "tools.validate_structure": 4, "evaluation_bible.slug": 1 });
  assert.equal(summarize({ ...STATS, timeout: 3 }, "").killed, 80);
  assert.throws(() => summarize({ killed: 0, survived: 0, no_tests: 0, timeout: 0 }, ""), /no mutants were judged/);
  assert.throws(() => summarize({ killed: 1 }, ""), /lacks an integer survived/);
});

test("the weakest module has the most untested mutants, ties by name, none when clean", () => {
  assert.equal(weakestModule(summarize(STATS, RESULTS)), "tools.validate_structure");
  assert.equal(weakestModule(summarize(STATS, "a.b.x_f__mutmut_1: survived\na.a.x_f__mutmut_1: survived")), "a.a");
  assert.equal(weakestModule(summarize(STATS, "")), undefined);
  assert.equal(suggestionTitle("tools.validate_structure"), "Strengthen tests in tools.validate_structure");
});

test("the report states the score, the threshold, the counts, and one row per module", () => {
  const text = renderReport(summarize(STATS, RESULTS), 0.8, "https://example.test/run");
  assert.match(text, /^Mutation score 62\.6% \(threshold 80\.0%\): 77 killed, 10 survived, 36 without a test, of 123 judged\./);
  assert.match(text, /\| `tools\.validate_structure` \| 4 \|\n\| `evaluation_bible\.slug` \| 1 \|/);
  assert.match(text, /Run: https:\/\/example\.test\/run$/);
  assert.match(renderReport(summarize(STATS, ""), 0.5, "u"), /\| none \| 0 \|/);
  assert.equal(CHECK_NAME, "mutation score");
  assert.equal(HEALTH_ISSUE, "Factory health");
  assert.equal(SUGGEST_LABEL, "factory:suggested");
});

test("reports are read from reports/mutation and a missing file is named", () => {
  const dir = mkdtempSync(join(tmpdir(), "mutation-"));
  assert.throws(() => readReports(dir), /did not leave .*stats\.json/);
  mkdirSync(join(dir, "reports/mutation"), { recursive: true });
  writeFileSync(join(dir, "reports/mutation/stats.json"), JSON.stringify(STATS));
  writeFileSync(join(dir, "reports/mutation/results.txt"), RESULTS);
  assert.deepEqual(readReports(dir), { stats: STATS, resultsText: RESULTS });
});

test("factory.json's mutation block is optional and validated", () => {
  const base = { version: 1, preset: "p", commands: { install: { label: "i", run: "x" }, nofakes: { label: "n", run: "bash scripts/check.sh" } },
    paths: { docs: [], lockfiles: [], protected: [] },
    lanes: { static: { paths: [], fast: ["nofakes"], full: { commands: [], secrets: [] } }, unit: { off: "x" }, integration: { off: "x" }, acceptance: { off: "x" }, artifact: { off: "x" } },
    artifact: { ships_bundle: false } };
  assert.equal(parseConfig(base).mutation, undefined);
  assert.deepEqual(parseConfig({ ...base, mutation: { run: "uv run mutmut run", threshold: 0.8 } }).mutation, { run: "uv run mutmut run", threshold: 0.8 });
  assert.throws(() => parseConfig({ ...base, mutation: { run: "x", threshold: 1.5 } }), /mutation\.threshold/);
  assert.throws(() => parseConfig({ ...base, mutation: { threshold: 0.5 } }), /mutation\.run/);
});

test("usage errors name what is missing", async () => {
  await assert.rejects(main(["--sha", "a"], { GITHUB_TOKEN: "x" }), /--repo is required/);
  await assert.rejects(main(["--repo", "o/r", "--sha", "a"], {}), /GITHUB_TOKEN is required/);
  const dir = mkdtempSync(join(tmpdir(), "mutation-"));
  writeFileSync(join(dir, "factory.json"), JSON.stringify({ version: 1, preset: "p", commands: { install: { label: "i", run: "true" }, nofakes: { label: "n", run: "bash scripts/check.sh" } },
    paths: { docs: [], lockfiles: [], protected: [] },
    lanes: { static: { paths: [], fast: ["nofakes"], full: { commands: [], secrets: [] } }, unit: { off: "x" }, integration: { off: "x" }, acceptance: { off: "x" }, artifact: { off: "x" } },
    artifact: { ships_bundle: false } }));
  await assert.rejects(main(["--repo", "o/r", "--sha", "a"], { GITHUB_TOKEN: "x" }, dir), /has no mutation block/);
});
