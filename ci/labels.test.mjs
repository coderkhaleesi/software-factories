import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { HUMAN_ONLY_LABELS, LABELS } from "./factory.mjs";
import { colorFor, ghArgs, sync } from "./labels.mjs";

test("list prints every label name once, in LABELS order", () => {
  const out = execFileSync(process.execPath, [new URL("./labels.mjs", import.meta.url).pathname, "list"], { encoding: "utf8" });
  assert.deepEqual(out.trimEnd().split("\n"), LABELS.map((l) => l.name));
  assert.equal(new Set(LABELS.map((l) => l.name)).size, LABELS.length, "no duplicate label names");
});

test("every gh call is a forced create naming the repo, so sync converges", () => {
  const calls = [];
  const n = sync("owner/repo", (args) => calls.push(args));
  assert.equal(n, LABELS.length);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 2), ["label", "create"]);
    assert.ok(args.includes("--force"));
    assert.equal(args[args.indexOf("--repo") + 1], "owner/repo");
  }
});

test("human-only labels share one color and say who applies them", () => {
  for (const label of LABELS) {
    const args = ghArgs(label, "o/r");
    const description = args[args.indexOf("--description") + 1];
    assert.ok(description.endsWith(`Applied by: ${label.appliers.join(", ")}`), label.name);
    if (HUMAN_ONLY_LABELS.includes(label.name)) assert.equal(colorFor(label), "0E8A16", label.name);
  }
});
