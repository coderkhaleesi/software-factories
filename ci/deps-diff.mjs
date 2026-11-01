/**
 * A pull request may add a dependency only when the change request names it. For every lockfile
 * in factory.json's paths.lockfiles that differs between the base and the head, the direct
 * dependencies the head adds must each appear in the linked issue's body (the PR body's
 * "Closes #N"), or in the PR body itself when the PR links no issue. Removals, upgrades, and
 * transitive packages pass; only new direct dependencies are judged. A nightly or dispatch run
 * has no base and judges nothing.
 *
 *   node ci/deps-diff.mjs --repo owner/repo --base <sha> --head <sha> --pr N [--config factory.json]
 */

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.mjs";
import { getIssue, getPull } from "./github.mjs";

/**
 * The project's direct dependencies in a lockfile, dev groups included. Transitive packages are
 * not judged: naming the direct dependency is what the change request can do. uv.lock keeps the
 * project's own [[package]] table (source editable or virtual "."); package-lock.json keeps the
 * root "" package.
 */
export function directDependencies(path, text) {
  if (path.endsWith("uv.lock")) {
    const blocks = text.split(/^\[\[package\]\]\s*$/m).slice(1);
    const project = blocks.find((b) => /^source = \{ (editable|virtual) = "\."\s*\}/m.test(b));
    if (project === undefined) throw new Error(`${path}: no [[package]] table with source editable or virtual "." (the project itself)`);
    return new Set([...project.matchAll(/\{ name = "([^"]+)"/g)].map((m) => m[1]));
  }
  if (path.endsWith("package-lock.json")) {
    const lock = JSON.parse(text);
    if (typeof lock.packages !== "object" || lock.packages === null || typeof lock.packages[""] !== "object") {
      throw new Error(`${path}: no "packages" map with a root "" entry (lockfileVersion 2 or 3 expected)`);
    }
    const root = lock.packages[""];
    return new Set(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((k) => (k in root ? Object.keys(root[k]) : [])));
  }
  throw new Error(`${path}: no parser for this lockfile; supported: uv.lock, package-lock.json`);
}

export function addedPackages(path, baseText, headText) {
  const base = baseText === "" ? new Set() : directDependencies(path, baseText);
  return [...directDependencies(path, headText)].filter((name) => !base.has(name)).sort();
}

/** Whether the request names the package, as a whole word, case-insensitively. */
export function names(text, pkg) {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_.-])${escaped}(?![A-Za-z0-9_.-])`, "im").test(text);
}

/** The issue number a PR body closes, or undefined. */
export function linkedIssue(body) {
  const m = /^Closes #(\d+)\s*$/m.exec(body === null ? "" : body);
  return m === null ? undefined : Number(m[1]);
}

/** @returns {{ ok: boolean, judged: Record<string, string[]>, unnamed: Record<string, string[]> }} */
export function judge(added, requestText) {
  const unnamed = {};
  for (const [path, packages] of Object.entries(added)) {
    const missing = packages.filter((pkg) => !names(requestText, pkg));
    if (missing.length > 0) unnamed[path] = missing;
  }
  return { ok: Object.keys(unnamed).length === 0, judged: added, unnamed };
}

const show = (ref, path, cwd) => execFileSync("git", ["show", `${ref}:${path}`], { cwd, encoding: "utf8" });
const changed = (base, head, cwd) => execFileSync("git", ["diff", "--name-only", "--no-renames", base, head], { cwd, encoding: "utf8" }).split("\n").filter((l) => l !== "");
const exists = (ref, path, cwd) => execFileSync("git", ["ls-tree", "--name-only", ref, "--", path], { cwd, encoding: "utf8" }).trim() === path;

export async function main(argv, env = process.env, cwd = process.cwd()) {
  const { values } = parseArgs({
    args: argv,
    options: { repo: { type: "string" }, base: { type: "string" }, head: { type: "string" }, pr: { type: "string" }, config: { type: "string", default: "factory.json" } },
  });
  if (values.repo === undefined) throw new Error("--repo is required");
  const config = loadConfig(values.config);
  if (values.base === undefined || values.base === "") {
    process.stdout.write(`deps-diff: no base commit (not a pull request); lockfiles ${config.paths.lockfiles.join(", ")} are not judged\n`);
    return 0;
  }
  for (const flag of ["head", "pr"]) {
    if (values[flag] === undefined || values[flag] === "") throw new Error(`--${flag} is required with --base`);
  }
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN === "") throw new Error("GITHUB_TOKEN is required");
  const touched = changed(values.base, values.head, cwd).filter((p) => config.paths.lockfiles.some((lock) => p === lock || p.endsWith(`/${lock}`)));
  const added = {};
  for (const path of touched) {
    const baseText = exists(values.base, path, cwd) ? show(values.base, path, cwd) : "";
    const headText = exists(values.head, path, cwd) ? show(values.head, path, cwd) : "";
    added[path] = addedPackages(path, baseText, headText);
  }
  if (Object.values(added).every((list) => list.length === 0)) {
    process.stdout.write(`deps-diff: ${touched.length === 0 ? "no lockfile changed" : `${touched.join(", ")} changed without adding a package`}; nothing to judge\n`);
    return 0;
  }
  const pull = await getPull(values.repo, values.pr, env.GITHUB_TOKEN);
  const issue = linkedIssue(pull.body);
  const bodyText = (body) => (body === null ? "" : body);
  const request = issue === undefined ? { where: `the pull request body (#${values.pr} links no issue)`, text: bodyText(pull.body) }
    : { where: `issue #${issue}`, text: bodyText((await getIssue(values.repo, issue, env.GITHUB_TOKEN)).body) };
  const verdict = judge(added, request.text);
  for (const [path, packages] of Object.entries(verdict.judged)) process.stdout.write(`deps-diff: ${path} adds ${packages.join(", ")}\n`);
  if (verdict.ok) {
    process.stdout.write(`deps-diff: every added package is named in ${request.where}\n`);
    return 0;
  }
  for (const [path, packages] of Object.entries(verdict.unnamed)) {
    process.stdout.write(`::error::${path} adds ${packages.join(", ")}, not named in ${request.where}. Name each dependency in the change request, or drop it.\n`);
  }
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main(process.argv.slice(2));
}
