/**
 * May this agent run now, and on what? One deterministic answer per stage, computed from state
 * on GitHub before the agent starts, so re-labelling an issue or re-running a workflow cannot
 * repeat an agent's work.
 *
 *   node ci/gate.mjs --for plan --repo owner/repo --issue N --bot td-software-factory
 *
 * Exit 0 when the agent may run. Exit 1 with the reason when it may not. Any API error propagates.
 *
 * @typedef {{ allowed: true } | { allowed: false, reason: string }} Decision
 */

import { parseArgs } from "node:util";

export const PLAN_MARKER = "## Plan for #";

/** @returns {Decision} */
export function decidePlan(comments, issue, bot) {
  const login = bot.endsWith("[bot]") ? bot : `${bot}[bot]`;
  const existing = comments.find((c) => c.user.login === login && c.body.includes(`${PLAN_MARKER}${issue}`));
  if (existing !== undefined) {
    return { allowed: false, reason: `issue #${issue} already has a plan comment by ${login}: ${existing.html_url}` };
  }
  return { allowed: true };
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "software-factories gate" },
  });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

export async function listIssueComments(repo, issue, token) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(`https://api.github.com/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`, token);
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
}

export async function main(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: { for: { type: "string" }, repo: { type: "string" }, issue: { type: "string" }, bot: { type: "string" } },
  });
  for (const flag of ["for", "repo", "issue", "bot"]) {
    if (values[flag] === undefined) throw new Error(`--${flag} is required`);
  }
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN === "") throw new Error("GITHUB_TOKEN is required");
  if (!/^\d+$/.test(values.issue)) throw new Error(`--issue must be a number, got ${JSON.stringify(values.issue)}`);
  if (values.for !== "plan") throw new Error(`--for ${values.for} is not implemented yet; stages: plan`);
  const comments = await listIssueComments(values.repo, values.issue, env.GITHUB_TOKEN);
  const decision = decidePlan(comments, values.issue, values.bot);
  if (!decision.allowed) {
    process.stdout.write(`gate: the planner will not run. ${decision.reason}\n`);
    return 1;
  }
  process.stdout.write(`gate: no plan comment on #${values.issue} yet; the planner may run\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
