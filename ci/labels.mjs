/**
 * The factory's labels on a repository, from LABELS in factory.mjs.
 *
 *   node ci/labels.mjs list                      one label name per line
 *   node ci/labels.mjs sync --repo <owner/repo>  create or update every label with gh, idempotently
 */

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { LABELS } from "./factory.mjs";

const COLORS = Object.freeze({ human: "0E8A16", agent: "1D76DB", step: "5319E7", shared: "FBCA04" });

export function colorFor(label) {
  return label.appliers.length === 1 ? COLORS[label.appliers[0]] : COLORS.shared;
}

export function ghArgs(label, repo) {
  const who = `Applied by: ${label.appliers.join(", ")}`;
  return ["label", "create", label.name, "--repo", repo, "--force", "--color", colorFor(label), "--description", `${label.description}. ${who}`];
}

export function sync(repo, runGh = (args) => execFileSync("gh", args, { stdio: "inherit" })) {
  for (const label of LABELS) runGh(ghArgs(label, repo));
  return LABELS.length;
}

export function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { repo: { type: "string" } }, allowPositionals: true });
  const [command] = positionals;
  if (command === "list") {
    process.stdout.write(`${LABELS.map((l) => l.name).join("\n")}\n`);
    return;
  }
  if (command === "sync") {
    if (values.repo === undefined || !/^[\w.-]+\/[\w.-]+$/.test(values.repo)) throw new Error("sync needs --repo <owner/repo>");
    const n = sync(values.repo);
    process.stdout.write(`synced ${n} labels on ${values.repo}\n`);
    return;
  }
  throw new Error("usage: node ci/labels.mjs list | sync --repo <owner/repo>");
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2));
}
