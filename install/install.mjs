/**
 * Install the factory's project-side footprint into a target repository.
 *
 *   node install/install.mjs [--dry-run] [--preset <name>] <target>
 *
 * The plan is computed first and printed one row per manifest entry; `--dry-run` stops there.
 * A second run after an install prints only `unchanged` and `kept`. Nothing is ever deleted.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MANIFEST } from "./manifest.mjs";
import { loadConfig, renderSection0, replaceSection0 } from "../ci/config.mjs";

export const FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FACTORY_REPO = "coderkhaleesi/software-factories";
const CHECKOUT_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1"; // actions/checkout v7.0.1

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** The commit every pinned `uses:` line points at. It must be committed and on a remote. */
export function factoryRef(root = FACTORY_ROOT) {
  if (git(root, "status", "--porcelain") !== "") throw new Error(`${root} has uncommitted changes; commit them so the pinned ref is real`);
  const sha = git(root, "rev-parse", "HEAD");
  if (git(root, "branch", "-r", "--contains", sha) === "") throw new Error(`${root} HEAD ${sha} is on no remote branch; push it so the pinned ref resolves`);
  return sha;
}

/** The factory's own copy of a template: its actions by local path, since the repo is the factory. */
export function renderOwnTemplate(text) {
  return renderTemplate(text, "0".repeat(40))
    .replace(/# Installed by software-factories \(install\.sh\)\. Pinned to factory ref [0-9a-f]{7}\./, "# The factory's own CI, rendered from templates/github/workflows by ci/render-own.mjs.")
    .replace(/coderkhaleesi\/software-factories\/actions\/([a-z-]+)@0{40} # software-factories 0{7}/g, "./actions/$1");
}

export function renderTemplate(text, ref) {
  return text.replaceAll("{{factory_repo}}", FACTORY_REPO).replaceAll("{{factory_ref}}", ref)
    .replaceAll("{{factory_ref7}}", ref.slice(0, 7)).replaceAll("{{checkout_sha}}", CHECKOUT_SHA);
}

/** The hook command names the checkout that generated the file; point it at the target instead. */
function renderCodexHooks(text, target) {
  const pattern = /python3 '[^']*\/\.codex\/hooks\/guard\.py'/g;
  if (!pattern.test(text)) throw new Error(".codex/hooks.json has no 'python3 '<path>/.codex/hooks/guard.py'' command to rewrite");
  return text.replace(pattern, `python3 '${target}/.codex/hooks/guard.py'`);
}

/** Desired bytes for one entry, or null when the entry does not apply to this preset. */
function desired(entry, ctx) {
  if (entry.when !== undefined && !entry.when.includes(ctx.preset)) return null;
  const source = join(ctx.factory, entry.source.replace("{preset}", ctx.preset));
  if (!existsSync(source)) throw new Error(`manifest source missing: ${source}`);
  const text = readFileSync(source);
  if (entry.ownership === "managed" || entry.ownership === "seeded") return text;
  if (entry.ownership === "block") return text.toString("utf8");
  if (entry.render === "agents") return Buffer.from(replaceSection0(text.toString("utf8"), renderSection0(ctx.config)));
  if (entry.render === "codex") return Buffer.from(renderCodexHooks(text.toString("utf8"), ctx.target));
  if (entry.render === "template") return Buffer.from(renderTemplate(text.toString("utf8"), ctx.ref));
  throw new Error(`manifest entry ${entry.path} has unknown render ${JSON.stringify(entry.render)}`);
}

function blockContent(existing, lines) {
  const present = new Set(existing.split("\n"));
  const missing = lines.split("\n").filter((l) => l !== "" && !present.has(l));
  if (missing.length === 0) return existing;
  const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
  return `${existing}${sep}${missing.join("\n")}\n`;
}

/** @returns {{ entry: object, status: string, content: Buffer | null }[]} */
export function plan(ctx) {
  return MANIFEST.map((entry) => {
    const want = desired(entry, ctx);
    const dest = join(ctx.target, entry.path);
    const exists = existsSync(dest);
    if (want === null) return { entry, status: "not applicable", content: null };
    if (entry.ownership === "seeded" && exists) return { entry, status: "kept", content: null };
    if (entry.ownership === "block") {
      const existing = exists ? readFileSync(dest, "utf8") : "";
      const next = blockContent(existing, want);
      if (next === existing) return { entry, status: "unchanged", content: null };
      return { entry, status: exists ? "update" : "create", content: Buffer.from(next) };
    }
    if (!exists) return { entry, status: "create", content: want };
    if (readFileSync(dest).equals(want)) return { entry, status: "unchanged", content: null };
    return { entry, status: "update", content: want };
  });
}

function writeAtomic(dest, content) {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.factory-install.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, dest);
}

function refuseIfDirty(target) {
  const paths = MANIFEST.map((e) => e.path).filter((p) => existsSync(join(target, p)));
  if (paths.length === 0) return;
  const dirty = git(target, "status", "--porcelain", "--", ...paths);
  if (dirty !== "") throw new Error(`target has uncommitted changes at factory paths; commit or stash them first:\n${dirty}`);
}

function refuseRuffShadow(target) {
  const pyproject = join(target, "pyproject.toml");
  if (existsSync(pyproject) && /^\[tool\.ruff[\].]/m.test(readFileSync(pyproject, "utf8"))) {
    throw new Error("target pyproject.toml has a [tool.ruff] section; ruff.toml would shadow it. Move those settings into ruff.toml by hand first");
  }
}

function resolvePreset(target, requested) {
  const file = join(target, "factory.json");
  if (existsSync(file)) {
    if (requested !== undefined) throw new Error(`${file} exists; --preset applies only to a first install`);
    return loadConfig(file).preset;
  }
  if (requested === undefined) throw new Error("--preset is required on a first install (factory.json does not exist in the target)");
  if (!existsSync(join(FACTORY_ROOT, "presets", requested))) throw new Error(`unknown preset ${JSON.stringify(requested)}; see presets/`);
  return requested;
}

function nextSteps(ctx) {
  const dir = join(ctx.factory, "workflows");
  const workflows = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [];
  const lines = workflows.map((f) => `  gh aw add ${FACTORY_REPO}/workflows/${f}@${ctx.ref}`);
  return lines.length === 0 ? "" : `Next, not run by install.sh:\n${lines.join("\n")}\n`;
}

export function run(argv, { factory = FACTORY_ROOT, out = (s) => process.stdout.write(s) } = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { "dry-run": { type: "boolean", default: false }, preset: { type: "string" } },
    allowPositionals: true,
  });
  if (positionals.length !== 1) throw new Error("usage: install.sh [--dry-run] [--preset <name>] <target-repo>");
  const target = resolve(positionals[0]);
  if (!existsSync(join(target, ".git")) || !statSync(join(target, ".git")).isDirectory()) throw new Error(`${target} is not a git repository`);
  const ref = factoryRef(factory);
  refuseIfDirty(target);
  refuseRuffShadow(target);
  const preset = resolvePreset(target, values.preset);
  const configSource = existsSync(join(target, "factory.json")) ? join(target, "factory.json") : join(factory, "presets", preset, "factory.json");
  const ctx = { factory, target, ref, preset, config: loadConfig(configSource) };
  const rows = plan(ctx);
  out(`factory ${ref.slice(0, 7)} ${FACTORY_REPO}, preset ${preset}, target ${target}\n`);
  for (const row of rows) out(`${row.status.padEnd(14)} ${row.entry.path}\n`);
  if (!values["dry-run"]) {
    for (const row of rows) if (row.content !== null) writeAtomic(join(target, row.entry.path), row.content);
  }
  out(nextSteps(ctx));
  return rows;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.on("uncaughtException", (error) => {
    console.error(`error: ${error.message}`);
    process.exit(2);
  });
  run(process.argv.slice(2));
}
