import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BRANCH_PREFIX, LANES, PR_BODY_HEADINGS, SECTION0_MARKERS, attestationBlock } from "./factory.mjs";
import { loadConfig, renderSection0 } from "./config.mjs";
import { MANIFEST, OWNERSHIPS, renderFootprint } from "../install/manifest.mjs";
import { FACTORY_ROOT } from "../install/install.mjs";
import { OWN, renderOwn } from "./render-own.mjs";

const read = (p) => readFileSync(join(FACTORY_ROOT, p), "utf8");

test("AGENTS.md section 0 equals the render of this repo's factory.json", () => {
  const agents = read("AGENTS.md");
  const { begin, end } = SECTION0_MARKERS;
  const block = agents.slice(agents.indexOf(begin) + begin.length, agents.indexOf(end)).trim();
  assert.equal(block, renderSection0(loadConfig(join(FACTORY_ROOT, "factory.json"))));
});

test("README.md carries the footprint table generated from the manifest", () => {
  assert.ok(read("README.md").includes(renderFootprint()), "run: node -e to regenerate the table");
});

test("every manifest entry has a known ownership and an existing source for every preset", () => {
  const presets = readdirSync(join(FACTORY_ROOT, "presets"));
  for (const entry of MANIFEST) {
    assert.ok(OWNERSHIPS.includes(entry.ownership), entry.path);
    for (const preset of presets.filter((p) => entry.when === undefined || entry.when.includes(p))) {
      assert.ok(existsSync(join(FACTORY_ROOT, entry.source.replace("{preset}", preset))), `${entry.path} source for ${preset}`);
    }
  }
});

test("the PR template carries the body headings and the blank attestation block", () => {
  const tpl = read("templates/github/pull_request_template.md");
  for (const h of PR_BODY_HEADINGS) assert.ok(tpl.includes(`${h}\n`), h);
  assert.ok(tpl.includes(attestationBlock("")), "blank attestation block");
});

test("the CI template wires changes, every lane, and required with if: always()", () => {
  const ci = read("templates/github/workflows/ci.yml");
  const jobs = [...ci.slice(ci.indexOf("\njobs:\n")).matchAll(/^  ([a-z_]+):$/gm)].map((m) => m[1]);
  assert.deepEqual(jobs, ["changes", ...LANES, "required"]);
  assert.ok(ci.includes(`    needs: [changes, ${LANES.join(", ")}]\n    if: \${{ always() }}`));
  for (const lane of LANES) assert.ok(ci.includes(`if: \${{ fromJSON(needs.changes.outputs.selection).lanes.${lane} }}`), lane);
  assert.ok(!ci.includes("schedule") && !ci.includes("workflow_dispatch"), "the CI template runs on pull requests only; the full tier is nightly.yml");
});

test("only the nightly template references the nightly environment, and it runs only on schedule and dispatch", () => {
  const dir = "templates/github/workflows";
  for (const f of readdirSync(join(FACTORY_ROOT, dir))) {
    const text = read(join(dir, f));
    if (f !== "nightly.yml") {
      assert.ok(!text.includes("environment:"), `${f} must not reference a GitHub environment`);
      continue;
    }
    const on = text.slice(text.indexOf("\non:\n") + 1, text.indexOf("\npermissions:"));
    assert.deepEqual([...on.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]), ["schedule", "workflow_dispatch"]);
    const jobs = [...text.slice(text.indexOf("\njobs:\n")).matchAll(/^  ([a-z_]+):$/gm)].map((m) => m[1]);
    assert.deepEqual(jobs, ["changes", ...LANES, "required"]);
    assert.equal(text.split("    environment: nightly\n{{nightly_env}}\n").length - 1, LANES.length, "every lane job runs under the nightly environment with the env placeholder");
  }
});

test("every uses: line is pinned to a commit SHA with its version, or to the factory ref, or is local", () => {
  const files = ["templates/github/workflows/ci.yml", "templates/github/workflows/nightly.yml", "templates/github/workflows/factory-light-approve.yml", "templates/github/workflows/pr-readiness.yml", "templates/github/workflows/review-relay.yml", "templates/github/workflows/release-please.yml", "templates/github/workflows/mutation.yml", "presets/python-uv/setup.yml", "presets/node-npm/setup.yml"];
  for (const f of files) {
    for (const line of read(f).split("\n").filter((l) => /^\s*(- )?uses:/.test(l))) {
      const ok = /uses: \.\//.test(line) || /@\{\{factory_ref\}\} # software-factories/.test(line) || /@[0-9a-f]{40} # v\d/.test(line)
        || /@\{\{checkout_sha\}\} # v\d/.test(line);
      assert.ok(ok, `${f}: ${line.trim()}`);
    }
  }
});

test("the factory's own CI and nightly workflows equal the templates rendered with local actions", () => {
  for (const [source, dest] of Object.entries(OWN)) {
    const own = renderOwn(source, read(source));
    assert.equal(read(dest), own, `run: node ci/render-own.mjs (${dest})`);
    assert.ok(own.includes("uses: ./actions/classify"));
    assert.ok(!/\{\{(factory_|checkout_|nightly_)/.test(own), "every placeholder was rendered");
  }
});

/** The YAML frontmatter of a workflow, as lines, without parsing: the checks below are shape checks on known keys. */
function frontmatter(file) {
  const text = read(file);
  const end = text.indexOf("\n---\n", 4);
  assert.ok(text.startsWith("---\n") && end > 0, `${file}: no frontmatter`);
  return text.slice(4, end).split("\n");
}

const WORKFLOWS = readdirSync(join(FACTORY_ROOT, "workflows")).filter((f) => f.endsWith(".md")).map((f) => `workflows/${f}`);

test("every agentic workflow sets timeout-minutes, max-turns, and max-ai-credits", () => {
  for (const file of WORKFLOWS) {
    const lines = frontmatter(file);
    for (const key of ["timeout-minutes", "max-turns", "max-ai-credits"]) {
      assert.ok(lines.some((l) => new RegExp(`^${key}: \\d+$`).test(l)), `${file}: no top-level ${key}`);
    }
  }
});

/**
 * Section 5: threat detection fails the run on a finding in any workflow that pushes code. The
 * compiled builder shipped with the default, which warns and continues, until a diff of two lock
 * files showed it; this test reads the source instead.
 */
test("every workflow that pushes code sets threat-detection continue-on-error: false", () => {
  const pushes = /^  (create-pull-request|push-to-pull-request-branch):/;
  for (const file of WORKFLOWS) {
    const lines = frontmatter(file);
    if (!lines.some((l) => pushes.test(l))) continue;
    const at = lines.indexOf("  threat-detection:");
    assert.ok(at >= 0, `${file}: pushes code but has no safe-outputs threat-detection block`);
    assert.equal(lines[at + 1], "    continue-on-error: false", `${file}: threat-detection must fail the run on a finding`);
  }
});

test("the reviewer and the fixer trigger only on the builder's branch prefix", () => {
  assert.match(read("workflows/factory-review.md"), new RegExp(`startsWith\\(github\\.event\\.pull_request\\.head\\.ref, '${BRANCH_PREFIX}'\\)`));
  assert.match(read("workflows/factory-pr-fix.md"), new RegExp(`branches: \\["${BRANCH_PREFIX}\\*\\*"\\]`));
});
