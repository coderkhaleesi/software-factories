/**
 * May this agent run now, and on what? One deterministic answer per stage, computed from state
 * on GitHub before the agent starts, so re-labelling an issue or re-running a workflow cannot
 * repeat an agent's work.
 *
 *   node ci/gate.mjs --for plan|build --repo owner/repo --issue N --bot td-software-factory
 *   node ci/gate.mjs --for fix --repo owner/repo --branch factory/issue-N-slug --head-sha SHA --bot td-software-factory
 *
 * Exit 0 when the agent may run. When it may not: given a gh-aw safe-outputs file (--safe-outputs
 * or GH_AW_SAFE_OUTPUTS) write a noop safe output with the reason and exit 0, so the run ends green
 * with the agent skipped; elsewhere exit 1 with the reason. Any API error propagates.
 *
 * @typedef {{ allowed: true, attempt?: number } | { allowed: false, reason: string, stuck?: number }} Decision
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { BRANCH_PREFIX, FIX_ATTEMPTS } from "./factory.mjs";

export const PLAN_MARKER = "## Plan for #";

/** @returns {Decision} */
export function decidePlan(comments, issue, bot) {
  const existing = planComment(comments, issue, bot);
  if (existing !== undefined) {
    return { allowed: false, reason: `issue #${issue} already has a plan comment by ${existing.user.login}: ${existing.html_url}` };
  }
  return { allowed: true };
}

const botLogin = (bot) => (bot.endsWith("[bot]") ? bot : `${bot}[bot]`);

/** The App's plan comment for this issue, or undefined. "#6" must not match "#66". */
export function planComment(comments, issue, bot) {
  const login = botLogin(bot);
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

/**
 * Fix pushes so far: commits the App made on the pull request after it was opened. The builder's
 * commits predate the pull request, so they never count.
 */
export function fixAttempts(pull, commits, bot) {
  const login = botLogin(bot);
  const opened = Date.parse(pull.created_at);
  return commits.filter((c) => c.author !== null && c.author.login === login && Date.parse(c.commit.committer.date) > opened).length;
}

/** @returns {Decision} */
export function decideFix({ pull, commits }, branch, headSha, bot) {
  if (pull === undefined) return { allowed: false, reason: `no open pull request has the head branch ${branch}` };
  if (!pull.head.ref.startsWith(BRANCH_PREFIX)) return { allowed: false, reason: `${pull.html_url} is not on a factory branch` };
  if (pull.head.sha !== headSha) {
    return { allowed: false, reason: `${pull.html_url} moved since the failing run (run ${headSha.slice(0, 7)}, head ${pull.head.sha.slice(0, 7)}); the newer run decides` };
  }
  const attempts = fixAttempts(pull, commits, bot);
  if (attempts >= FIX_ATTEMPTS) {
    return { allowed: false, reason: `${pull.html_url} has had ${attempts} fix pushes by the factory App; a human must look`, stuck: pull.number };
  }
  return { allowed: true, attempt: attempts + 1 };
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
export const listOpenPullsByHead = (repo, branch, token) => listAll(`https://api.github.com/repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${branch}`, token);
export const listPullCommits = (repo, number, token) => listAll(`https://api.github.com/repos/${repo}/pulls/${number}/commits`, token);
export const getIssue = (repo, issue, token) => githubJson(`https://api.github.com/repos/${repo}/issues/${issue}`, token);

function writeJson(file, value, what) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${value}\n`);
  process.stdout.write(`gate: wrote ${what} to ${file}\n`);
}

/** Each stage names the flags it needs beyond --for, --repo, and --bot, and decides from `values`. */
const STAGES = {
  plan: {
    needs: ["issue"],
    run: async ({ repo, issue, bot }, token) => decidePlan(await listIssueComments(repo, issue, token), issue, bot),
  },
  build: {
    needs: ["issue"],
    run: async ({ repo, issue, bot, "plan-out": planOut }, token) => {
      const [pulls, comments, issueData] = await Promise.all([listOpenPulls(repo, token), listIssueComments(repo, issue, token), getIssue(repo, issue, token)]);
      const decision = decideBuild({ pulls, comments, labels: issueData.labels.map((l) => l.name) }, issue, bot);
      if (decision.allowed && planOut !== undefined) writeJson(planOut, planComment(comments, issue, bot).body, "the plan comment");
      return decision;
    },
  },
  fix: {
    needs: ["branch", "head-sha"],
    run: async ({ repo, branch, "head-sha": headSha, bot, "fix-out": fixOut }, token) => {
      const [pull] = await listOpenPullsByHead(repo, branch, token);
      const commits = pull === undefined ? [] : await listPullCommits(repo, pull.number, token);
      const decision = decideFix({ pull, commits }, branch, headSha, bot);
      if (decision.allowed && fixOut !== undefined) {
        const facts = { pull_request: pull.number, url: pull.html_url, branch, head_sha: headSha, attempt: decision.attempt, attempts_allowed: FIX_ATTEMPTS };
        writeJson(fixOut, JSON.stringify(facts, null, 2), `the pull request facts (attempt ${decision.attempt} of ${FIX_ATTEMPTS})`);
      }
      return decision;
    },
  },
};

/** Append safe outputs for gh-aw to apply instead of running the agent. The file is JSONL, one per line. */
export function writeSafeOutputs(file, entries) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
}

/** What a blocked decision asks gh-aw to do: always a noop; for an exhausted fixer, also the stuck label. */
export function safeOutputsFor(decision) {
  const entries = [{ type: "noop", message: decision.reason }];
  if (decision.stuck !== undefined) entries.push({ type: "add_labels", labels: ["factory:stuck"], item_number: decision.stuck });
  return entries;
}

export async function main(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      for: { type: "string" }, repo: { type: "string" }, issue: { type: "string" }, bot: { type: "string" },
      branch: { type: "string" }, "head-sha": { type: "string" },
      "plan-out": { type: "string" }, "fix-out": { type: "string" }, "safe-outputs": { type: "string" },
    },
  });
  for (const flag of ["for", "repo", "bot"]) {
    if (values[flag] === undefined) throw new Error(`--${flag} is required`);
  }
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN === "") throw new Error("GITHUB_TOKEN is required");
  if (!(values.for in STAGES)) throw new Error(`--for ${values.for} is not a stage; stages: ${Object.keys(STAGES).join(", ")}`);
  for (const flag of STAGES[values.for].needs) {
    if (values[flag] === undefined || values[flag] === "") throw new Error(`--${flag} is required for the ${values.for} stage`);
  }
  if (values.issue !== undefined && !/^\d+$/.test(values.issue)) throw new Error(`--issue must be a number, got ${JSON.stringify(values.issue)}`);
  if (values["head-sha"] !== undefined && !/^[0-9a-f]{40}$/.test(values["head-sha"])) throw new Error(`--head-sha must be a full commit SHA, got ${JSON.stringify(values["head-sha"])}`);
  const subject = values.issue !== undefined ? `#${values.issue}` : values.branch;
  const decision = await STAGES[values.for].run(values, env.GITHUB_TOKEN);
  if (!decision.allowed) {
    process.stdout.write(`gate: the ${values.for} agent will not run. ${decision.reason}\n`);
    const file = values["safe-outputs"] !== undefined && values["safe-outputs"] !== "" ? values["safe-outputs"] : env.GH_AW_SAFE_OUTPUTS;
    if (typeof file === "string" && file !== "") {
      const entries = safeOutputsFor(decision);
      writeSafeOutputs(file, entries);
      process.stdout.write(`gate: wrote ${entries.map((e) => e.type).join(" and ")} to ${file}; the agent is skipped and the run stays green\n`);
      return 0;
    }
    return 1;
  }
  process.stdout.write(`gate: the ${values.for} agent may run on ${subject}\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
