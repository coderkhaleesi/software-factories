/**
 * The nightly mutation sweep. Runs the project's mutation command from factory.json, reads the
 * stats and results it leaves under reports/mutation/, and reports: one neutral check-run on the
 * commit, one comment on the rolling "Factory health" issue, and, when the score is below the
 * project's threshold, one issue "Strengthen tests in <module>" labelled factory:suggested. A
 * person promotes that issue to factory:ready; the sweep never does.
 *
 *   node ci/mutation.mjs --repo owner/repo --sha <commit> [--config factory.json] [--run-url URL]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.mjs";
import { createCheckRun, createComment, createIssue, listOpenIssues } from "./github.mjs";

export const REPORT_DIR = "reports/mutation";
export const CHECK_NAME = "mutation score";
export const HEALTH_ISSUE = "Factory health";
export const SUGGEST_LABEL = "factory:suggested";
const MUTANT = /^\s*([\w.]+)\.x_\w+__mutmut_\d+: (killed|survived|no tests|timeout|suspicious|skipped|not checked)\s*$/;

/** Score and the untested mutants per module. Timeouts count as killed, as mutmut does. */
export function summarize(stats, resultsText) {
  for (const key of ["killed", "survived", "no_tests", "timeout"]) {
    if (!Number.isInteger(stats[key])) throw new Error(`stats.json lacks an integer ${key}`);
  }
  const killed = stats.killed + stats.timeout;
  const judged = killed + stats.survived + stats.no_tests;
  if (judged === 0) throw new Error("no mutants were judged; the mutation command produced empty stats");
  const untestedByModule = {};
  for (const line of resultsText.split("\n")) {
    const m = MUTANT.exec(line);
    if (m === null || (m[2] !== "survived" && m[2] !== "no tests")) continue;
    untestedByModule[m[1]] = (untestedByModule[m[1]] ?? 0) + 1;
  }
  return { score: killed / judged, killed, survived: stats.survived, noTests: stats.no_tests, judged, untestedByModule };
}

/** The module with the most untested mutants, or undefined when every module is clean. */
export function weakestModule(summary) {
  const entries = Object.entries(summary.untestedByModule).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length === 0 ? undefined : entries[0][0];
}

const percent = (score) => `${(score * 100).toFixed(1)}%`;

export function renderReport(summary, threshold, runUrl) {
  const modules = Object.entries(summary.untestedByModule).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = [
    `Mutation score ${percent(summary.score)} (threshold ${percent(threshold)}): ${summary.killed} killed, ${summary.survived} survived, ${summary.noTests} without a test, of ${summary.judged} judged.`,
    "",
    "| Module | Survived or untested |",
    "|---|---|",
    ...modules.map(([module, n]) => `| \`${module}\` | ${n} |`),
  ];
  if (modules.length === 0) lines.push("| none | 0 |");
  lines.push("", `Run: ${runUrl}`);
  return lines.join("\n");
}

export const suggestionTitle = (module) => `Strengthen tests in ${module}`;

export async function report({ repo, sha, runUrl, summary, threshold, token }) {
  const body = renderReport(summary, threshold, runUrl);
  await createCheckRun(repo, {
    name: CHECK_NAME, head_sha: sha, status: "completed", conclusion: "neutral",
    output: { title: `${CHECK_NAME} ${percent(summary.score)}`, summary: body },
  }, token);
  const open = await listOpenIssues(repo, token);
  let health = open.find((i) => i.title === HEALTH_ISSUE && i.pull_request === undefined);
  if (health === undefined) health = await createIssue(repo, { title: HEALTH_ISSUE, body: "Rolling reports from the factory's nightly sweeps. Each sweep adds one comment." }, token);
  await createComment(repo, health.number, `## Mutation sweep ${new Date().toISOString().slice(0, 10)}\n\n${body}`, token);
  const actions = [`check-run ${CHECK_NAME} on ${sha.slice(0, 7)}`, `comment on #${health.number}`];
  if (summary.score < threshold) {
    const module = weakestModule(summary);
    const title = suggestionTitle(module);
    const existing = open.find((i) => i.title === title && i.pull_request === undefined);
    if (existing === undefined) {
      const issue = await createIssue(repo, {
        title, labels: [SUGGEST_LABEL],
        body: `${body}\n\nThe sweep's score is below the threshold in \`factory.json\`. \`${module}\` has the most mutants no test catches. Promote this to \`factory:ready\` to have the factory plan the tests, or close it with a reason.`,
      }, token);
      actions.push(`issue #${issue.number} "${title}" (${SUGGEST_LABEL})`);
    } else {
      actions.push(`issue #${existing.number} "${title}" already open`);
    }
  }
  return actions;
}

export function readReports(cwd) {
  const stats = join(cwd, REPORT_DIR, "stats.json");
  const results = join(cwd, REPORT_DIR, "results.txt");
  for (const f of [stats, results]) {
    if (!existsSync(f)) throw new Error(`the mutation command did not leave ${f}`);
  }
  return { stats: JSON.parse(readFileSync(stats, "utf8")), resultsText: readFileSync(results, "utf8") };
}

export async function main(argv, env = process.env, cwd = process.cwd()) {
  const { values } = parseArgs({
    args: argv,
    options: { repo: { type: "string" }, sha: { type: "string" }, config: { type: "string", default: "factory.json" }, "run-url": { type: "string", default: "" } },
  });
  for (const flag of ["repo", "sha"]) {
    if (values[flag] === undefined) throw new Error(`--${flag} is required`);
  }
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN === "") throw new Error("GITHUB_TOKEN is required");
  const config = loadConfig(join(cwd, values.config));
  if (config.mutation === undefined) throw new Error(`${values.config} has no mutation block; the sweep has nothing to run`);
  for (const [id, run] of [["install", config.commands.install.run], ["mutation", config.mutation.run]]) {
    process.stdout.write(`\n::group::${id}\n$ ${run}\n`);
    execFileSync("bash", ["-euo", "pipefail", "-c", run], { cwd, env, stdio: "inherit" });
    process.stdout.write("::endgroup::\n");
  }
  const { stats, resultsText } = readReports(cwd);
  const summary = summarize(stats, resultsText);
  const actions = await report({ repo: values.repo, sha: values.sha, runUrl: values["run-url"], summary, threshold: config.mutation.threshold, token: env.GITHUB_TOKEN });
  process.stdout.write(`mutation: score ${percent(summary.score)}, threshold ${percent(config.mutation.threshold)}; ${actions.join("; ")}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main(process.argv.slice(2));
}
