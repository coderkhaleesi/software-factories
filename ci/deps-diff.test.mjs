import { test } from "node:test";
import assert from "node:assert/strict";
import { addedPackages, directDependencies, judge, linkedIssue, main, names } from "./deps-diff.mjs";

/** A uv.lock with these direct dev dependencies, each also present as a registry package, plus one transitive package. */
const UV = (pkgs) => [
  'version = 1\nrevision = 3\n',
  ...pkgs.map((p) => `[[package]]\nname = "${p}"\nversion = "1.0.0"\nsource = { registry = "https://pypi.org/simple" }\ndependencies = [\n    { name = "transitive-${p}" },\n]\n`),
  ...pkgs.map((p) => `[[package]]\nname = "transitive-${p}"\nversion = "1.0.0"\nsource = { registry = "https://pypi.org/simple" }\n`),
  `[[package]]\nname = "proj"\nversion = "0.0.0"\nsource = { editable = "." }\n\n[package.dev-dependencies]\ndev = [\n${pkgs.map((p) => `    { name = "${p}" },`).join("\n")}\n]\n\n[package.metadata.requires-dev]\ndev = [\n${pkgs.map((p) => `    { name = "${p}", specifier = "==1.0.0" },`).join("\n")}\n]\n`,
].join("\n");
const NPM = (pkgs, transitive = []) => JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "x", devDependencies: Object.fromEntries(pkgs.map((p) => [p, "1.0.0"])) }, ...Object.fromEntries([...pkgs, ...transitive].map((p) => [`node_modules/${p}`, { version: "1.0.0" }])) } });

test("uv.lock and package-lock.json yield the project's direct dependencies, not transitive ones; other lockfiles are refused", () => {
  assert.deepEqual([...directDependencies("uv.lock", UV(["pytest", "mutmut"]))], ["pytest", "mutmut"]);
  assert.deepEqual([...directDependencies("package-lock.json", NPM(["eslint", "@types/node"], ["acorn"]))], ["eslint", "@types/node"]);
  assert.throws(() => directDependencies("Cargo.lock", ""), /no parser for this lockfile/);
  assert.throws(() => directDependencies("uv.lock", '[[package]]\nname = "x"\nversion = "1"\nsource = { registry = "r" }\n'), /no \[\[package\]\] table with source editable or virtual/);
  assert.throws(() => directDependencies("package-lock.json", "{}"), /no "packages" map/);
});

test("added packages are the head's names the base lacks; upgrades and removals do not count", () => {
  assert.deepEqual(addedPackages("uv.lock", UV(["pytest", "ruff"]), UV(["pytest", "textual", "mutmut"])), ["mutmut", "textual"]);
  assert.deepEqual(addedPackages("uv.lock", "", UV(["a"])), ["a"]);
  assert.deepEqual(addedPackages("uv.lock", UV(["a"]), UV(["a"]).replace('version = "1.0.0"', 'version = "2.0.0"')), []);
  assert.deepEqual(addedPackages("package-lock.json", NPM(["eslint"]), NPM(["eslint"], ["acorn", "espree"])), []);
});

test("a package is named when it appears as a whole word, in any case", () => {
  assert.ok(names("Add `mutmut` as a dev dependency.", "mutmut"));
  assert.ok(names("use MutMut 3", "mutmut"));
  assert.ok(names("needs @types/node", "@types/node"));
  assert.ok(!names("mutmut-extras is fine", "mutmut"));
  assert.ok(!names("the textual-ui package", "textual"));
  assert.ok(!names("", "x"));
});

test("the verdict lists unnamed packages per lockfile", () => {
  const v = judge({ "uv.lock": ["mutmut", "textual"] }, "Add mutmut for the sweep.");
  assert.deepEqual(v, { ok: false, judged: { "uv.lock": ["mutmut", "textual"] }, unnamed: { "uv.lock": ["textual"] } });
  assert.equal(judge({ "uv.lock": ["mutmut"] }, "mutmut and its deps").ok, true);
  assert.equal(judge({}, "").ok, true);
});

test("the linked issue is the Closes line, on its own line", () => {
  assert.equal(linkedIssue("## Plan\n...\nCloses #11\n"), 11);
  assert.equal(linkedIssue("Closes #11 and more"), undefined);
  assert.equal(linkedIssue(null), undefined);
});

test("usage errors name the flag, and no base judges nothing", async () => {
  await assert.rejects(main([], { GITHUB_TOKEN: "x" }), /--repo is required/);
  await assert.rejects(main(["--repo", "o/r", "--base", "a", "--config", "presets/python-uv/factory.json"], { GITHUB_TOKEN: "x" }), /--head is required with --base/);
  await assert.rejects(main(["--repo", "o/r", "--base", "a", "--head", "b", "--pr", "1", "--config", "presets/python-uv/factory.json"], {}), /GITHUB_TOKEN is required/);
  assert.equal(await main(["--repo", "o/r", "--config", "presets/python-uv/factory.json"], {}), 0);
});
