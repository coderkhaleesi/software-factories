/**
 * May this agent run now, and on what? One deterministic answer per stage, computed from state
 * on GitHub before the agent starts, so re-labelling an issue or re-running a workflow cannot
 * repeat an agent's work.
 *
 *   node ci/gate.mjs --for plan|build --repo owner/repo --issue N --bot td-software-factory
 *
 * Exit 0 when the agent may run. When it may not: inside a gh-aw agent job (GH_AW_SAFE_OUTPUTS is
 * set) write a noop safe output with the reason and exit 0, so the run ends green with the agent
 * skipped; elsewhere exit 1 with the reason. Any API error propagates.
 *
 * @typedef {{ allowed: true } | { allowed: false, reason: string }} Decision
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { BRANCH_PREFIX } from "./factory.mjs";

export const PLAN_MARKER = "## Plan for #";

/** @returns {Decision} */
export function decidePlan(comments, issue, bot) {
  const existing = planComment(comments, issue, bot);
  if (existing !== undefined) {
    return { allowed: false, reason: `issue #${issue} already has a plan comment by ${existing.user.login}: ${existing.html_url}` };
  }
  return { allowed: true };
}

/** The App's plan comment for this issue, or undefined. "#6" must not match "#66". */
export function planComment(comments, issue, bot) {
  const login = bot.endsWith("[bot]") ? bot : `${bot}[bot]`;
  const marker = new RegExp(`^${PLAN_MARKER.replace("#", "\\#")}${issue}(?!\\d)`, "m");
  return comments.find((c) => c.user.login === login && marker.test(c.body));
}

/** @returns {Decision} */
export function decideBuild({ pulls, comments, labels }, issue, bot) {
  if (planComment(comments, issue, bot) === undefined) {
    return { allowed: false, reason: `issue #${issue} has no plan comment by the factory App; label it factory:ready first` };
  }
  if (!labels.includes("factory:planned")) return { allowed: false, reason: `issue #${issue} is not labelled factory:planned` };
  const prefix = `${BRANCH_PREFIX}${issue}-`;
  const open = pulls.find((pr) => pr.state === "open" && pr.head.ref.startsWith(prefix));
  if (open !== undefined) return { allowed: false, reason: `issue #${issue} already has an open factory pull request: ${open.html_url}` };
  return { allowed: true };
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "software-factories gate" },
  });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function listAll(url, token) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`, token);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

export const listIssueComments = (repo, issue, token) => listAll(`https://api.github.com/repos/${repo}/issues/${issue}/comments`, token);
export const listOpenPulls = (repo, token) => listAll(`https://api.github.com/repos/${repo}/pulls?state=open`, token);
export const getIssue = (repo, issue, token) => githubJson(`https://api.github.com/repos/${repo}/issues/${issue}`, token);

const STAGES = {
  plan: async (repo, issue, bot, token) => decidePlan(await listIssueComments(repo, issue, token), issue, bot),
  build: async (repo, issue, bot, token, planOut) => {
    const [pulls, comments, issueData] = await Promise.all([listOpenPulls(repo, token), listIssueComments(repo, issue, token), getIssue(repo, issue, token)]);
    const decision = decideBuild({ pulls, comments, labels: issueData.labels.map((l) => l.name) }, issue, bot);
    if (decision.allowed && planOut !== undefined) {
      mkdirSync(dirname(planOut), { recursive: true });
      writeFileSync(planOut, `${planComment(comments, issue, bot).body}\n`);
      process.stdout.write(`gate: wrote the plan comment to ${planOut}\n`);
    }
    return decision;
  },
};

/** Tell gh-aw to skip the agent with this reason. The file is JSONL, one safe output per line. */
export function writeNoop(file, reason) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ type: "noop", message: reason })}\n`);
}

export async function main(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      for: { type: "string" }, repo: { type: "string" }, issue: { type: "string" }, bot: { type: "string" },
      "plan-out": { type: "string" }, "safe-outputs": { type: "string" },
    },
  });
  for (const flag of ["for", "repo", "issue", "bot"]) {
    if (values[flag] === undefined) throw new Error(`--${flag} is required`);
  }
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN === "") throw new Error("GITHUB_TOKEN is required");
  if (!/^\d+$/.test(values.issue)) throw new Error(`--issue must be a number, got ${JSON.stringify(values.issue)}`);
  if (!(values.for in STAGES)) throw new Error(`--for ${values.for} is not a stage; stages: ${Object.keys(STAGES).join(", ")}`);
  const decision = await STAGES[values.for](values.repo, values.issue, values.bot, env.GITHUB_TOKEN, values["plan-out"]);
  if (!decision.allowed) {
    process.stdout.write(`gate: the ${values.for} agent will not run. ${decision.reason}\n`);
    const file = values["safe-outputs"] !== undefined && values["safe-outputs"] !== "" ? values["safe-outputs"] : env.GH_AW_SAFE_OUTPUTS;
    if (typeof file === "string" && file !== "") {
      writeNoop(file, decision.reason);
      process.stdout.write(`gate: wrote a noop safe output to ${file}; the agent is skipped and the run stays green\n`);
      return 0;
    }
    return 1;
  }
  process.stdout.write(`gate: the ${values.for} agent may run on #${values.issue}\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
