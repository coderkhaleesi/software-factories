import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LANES, PR_BODY_HEADINGS, SECTION0_MARKERS, attestationBlock } from "./factory.mjs";
import { loadConfig, renderSection0 } from "./config.mjs";
import { MANIFEST, OWNERSHIPS, renderFootprint } from "../install/manifest.mjs";
import { FACTORY_ROOT } from "../install/install.mjs";

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
    for (const preset of presets) assert.ok(existsSync(join(FACTORY_ROOT, entry.source.replace("{preset}", preset))), `${entry.path} source for ${preset}`);
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
});

test("every uses: line is pinned to a commit SHA with its version, or to the factory ref, or is local", () => {
  const files = ["templates/github/workflows/ci.yml", "presets/python-uv/setup.yml", "presets/node-npm/setup.yml"];
  for (const f of files) {
    for (const line of read(f).split("\n").filter((l) => l.includes("uses:"))) {
      const ok = /uses: \.\//.test(line) || /@\{\{factory_ref\}\} # software-factories/.test(line) || /@[0-9a-f]{40} # v\d/.test(line)
        || /@\{\{checkout_sha\}\} # v\d/.test(line);
      assert.ok(ok, `${f}: ${line.trim()}`);
    }
  }
});
