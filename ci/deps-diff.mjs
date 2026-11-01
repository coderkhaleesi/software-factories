/**
 * A pull request may add a dependency only when the change request names it. For every lockfile
 * in factory.json's paths.lockfiles that differs between the base and the head, the packages
 * the head adds must each appear in the linked issue's body (the PR body's "Closes #N"), or in
 * the PR body itself when the PR links no issue. Removals and upgrades pass; only new packages
 * are judged. A nightly or dispatch run has no base and judges nothing.
 *
 *   node ci/deps-diff.mjs --repo owner/repo --base <sha> --head <sha> --pr N [--config factory.json]
 */

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.mjs";
import { getIssue, getPull } from "./github.mjs";

/** Package names in a lockfile. uv.lock is TOML with [[package]] tables; package-lock.json maps node_modules paths. */
export function packagesIn(path, text) {
  if (path.endsWith("uv.lock")) {
    const names = new Set();
    for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
      const m = /^name = "([^"]+)"/m.exec(block);
      if (m === null) throw new Error(`${path}: a [[package]] table has no name`);
      names.add(m[1]);
    }
    return names;
  }
  if (path.endsWith("package-lock.json")) {
    const lock = JSON.parse(text);
    if (typeof lock.packages !== "object" || lock.packages === null) throw new Error(`${path}: no "packages" map (lockfileVersion 2 or 3 expected)`);
    return new Set(Object.keys(lock.packages).filter((k) => k !== "").map((k) => k.slice(k.lastIndexOf("node_modules/") + "node_modules/".length)));
  }
  throw new Error(`${path}: no parser for this lockfile; supported: uv.lock, package-lock.json`);
}

export function addedPackages(path, baseText, headText) {
  const base = packagesIn(path, baseText);
  return [...packagesIn(path, headText)].filter((name) => !base.has(name)).sort();
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
