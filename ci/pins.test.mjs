import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FACTORY_ROOT } from "../install/install.mjs";

const git = (...args) => execFileSync("git", args, { cwd: FACTORY_ROOT, encoding: "utf8" }).trim();
const PIN = /uses: coderkhaleesi\/software-factories\/actions\/([a-z-]+)@([0-9a-f]{40})/g;

/**
 * A workflow pins one of this repository's actions at a commit. That commit must carry the
 * action and the scripts it runs exactly as HEAD does, or the pinned run executes stale code,
 * as the builder did on issue #11 when its gate pin predated the plan-out input.
 */
test("every action pin in workflows/*.md carries the current action and ci/ scripts", () => {
  const dir = join(FACTORY_ROOT, "workflows");
  const stale = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    for (const [, action, sha] of readFileSync(join(dir, file), "utf8").matchAll(PIN)) {
      assert.equal(git("cat-file", "-t", sha), "commit", `${file}: ${sha} is not a commit`);
      const diff = git("diff", "--name-only", sha, "HEAD", "--", `actions/${action}`, "ci/", ":!ci/*.test.mjs");
      if (diff !== "") stale.push(`${file}: actions/${action}@${sha.slice(0, 7)} predates changes to ${diff.split("\n").join(", ")}; re-pin it`);
    }
  }
  assert.deepEqual(stale, []);
});
