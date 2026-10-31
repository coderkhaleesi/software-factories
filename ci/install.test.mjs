import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FACTORY_ROOT, factoryRef, run } from "../install/install.mjs";

const SKIP = /\/(\.git|node_modules|\.agents|\.ruff_cache|__pycache__)(\/|$)/;
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function initRepo(dir) {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
}

/** A committed, pushed copy of this checkout, so the pinned ref is real. */
function factoryCopy() {
  const copy = mkdtempSync(join(tmpdir(), "factory-src-"));
  cpSync(FACTORY_ROOT, copy, { recursive: true, filter: (src) => !SKIP.test(src) });
  initRepo(copy);
  git(copy, "add", "-A");
  git(copy, "commit", "-q", "-m", "factory snapshot");
  const bare = mkdtempSync(join(tmpdir(), "factory-remote-"));
  git(bare, "init", "-q", "--bare", "-b", "main");
  git(copy, "remote", "add", "origin", bare);
  git(copy, "push", "-q", "origin", "main");
  return copy;
}

function targetRepo() {
  const target = mkdtempSync(join(tmpdir(), "factory-target-"));
  initRepo(target);
  writeFileSync(join(target, "pyproject.toml"), '[project]\nname = "pilot"\nversion = "0.0.0"\n');
  writeFileSync(join(target, ".gitignore"), ".venv/\n");
  git(target, "add", "-A");
  git(target, "commit", "-q", "-m", "init");
  return target;
}

const printed = [];
const discard = (s) => printed.push(s);
const statuses = (rows) => Object.fromEntries(rows.map((r) => [r.entry.path, r.status]));

test("a first install creates the footprint, renders section 0 and the pins, and a second run changes nothing", () => {
  const factory = factoryCopy();
  const target = targetRepo();
  const ref = factoryRef(factory);
  let printed = "";
  const first = run(["--preset", "python-uv", target], { factory, out: (s) => { printed += s; } });
  const s1 = statuses(first);
  assert.equal(s1["AGENTS.md"], "create");
  assert.equal(s1["factory.json"], "create");
  assert.equal(s1[".gitignore"], "update");
  assert.equal(s1["eslint.config.js"], "not applicable");
  assert.match(printed, new RegExp(`^factory ${ref.slice(0, 7)} `));

  const agents = readFileSync(join(target, "AGENTS.md"), "utf8");
  assert.match(agents, /<!-- commands:begin -->\n- Install: `uv sync`\n- Test: `uv run pytest`\n/);
  const ci = readFileSync(join(target, ".github/workflows/ci.yml"), "utf8");
  assert.ok(ci.includes(`actions/classify@${ref}`), "ci.yml pins the factory ref");
  assert.ok(!/\{\{(factory_|checkout_)/.test(ci), "every placeholder was rendered");
  const codex = readFileSync(join(target, ".codex/hooks.json"), "utf8");
  assert.ok(codex.includes(`'${target}/.codex/hooks/guard.py'`), "codex hooks point at the target");
  assert.ok(!codex.includes(FACTORY_ROOT), "codex hooks no longer name the factory checkout");
  assert.equal(readFileSync(join(target, ".gitignore"), "utf8"), ".venv/\n.agents/PLAN.md\n.agents/todo.md\n.agents/*.tsv\nreports/\n.github/aw/logs/\n");
  assert.ok(existsSync(join(target, ".github/actions/factory-setup/action.yml")));

  git(target, "add", "-A");
  git(target, "commit", "-q", "-m", "install factory");
  const second = run([target], { factory, out: discard });
  for (const row of second) assert.ok(["unchanged", "kept", "not applicable"].includes(row.status), `${row.entry.path}: ${row.status}`);
  assert.equal(statuses(second)["factory.json"], "kept");
  assert.throws(() => run(["--preset", "python-uv", target], { factory, out: discard }), /--preset applies only to a first install/);
});

test("dry run writes nothing; a dirty target, an unpushed factory, and a ruff shadow are refused", () => {
  const factory = factoryCopy();
  const target = targetRepo();
  run(["--dry-run", "--preset", "python-uv", target], { factory, out: discard });
  assert.ok(!existsSync(join(target, "AGENTS.md")), "dry run created AGENTS.md");
  assert.throws(() => run(["--dry-run", target], { factory, out: discard }), /--preset is required on a first install/);

  run(["--preset", "python-uv", target], { factory, out: discard });
  writeFileSync(join(target, "AGENTS.md"), "edited\n");
  assert.throws(() => run([target], { factory, out: discard }), /uncommitted changes at factory paths/);

  writeFileSync(join(factory, "README.md"), "changed\n");
  assert.throws(() => factoryRef(factory), /uncommitted changes/);
  git(factory, "commit", "-q", "-am", "local only");
  assert.throws(() => factoryRef(factory), /on no remote branch/);

  const shadow = targetRepo();
  writeFileSync(join(shadow, "pyproject.toml"), '[project]\nname = "x"\n[tool.ruff]\nline-length = 80\n');
  git(shadow, "commit", "-q", "-am", "ruff");
  const clean = factoryCopy();
  assert.throws(() => run(["--preset", "python-uv", shadow], { factory: clean, out: discard }), /\[tool\.ruff\] section/);
});
