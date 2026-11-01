/**
 * Is this pull request ready for a person's last click? One commit status on the head SHA,
 * computed on the default branch from what the API says, so a pull request's own workflow file
 * never judges itself and an agent-written body cannot attest on a person's behalf.
 *
 *   node ci/pr-readiness.mjs --repo owner/repo --pr N
 *   node ci/pr-readiness.mjs --repo owner/repo --branch factory/issue-N-slug
 *
 * Writes ready, draft, factory, number, and head_sha to $GITHUB_OUTPUT when set. Exit 0 whether
 * the verdict is ready or not; the status carries the verdict. Exit 1 on a usage error, and any
 * API error propagates.
 *
 * @typedef {{ ready: boolean, problems: string[], attestedBy?: string }} Verdict
 */

import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ATTESTATION, BRANCH_PREFIX, CHECKS, PR_BODY_HEADINGS } from "./factory.mjs";
import { getPull, listOpenPullsByHead, listPullReviews, getPermission, postStatus } from "./github.mjs";

export const TITLE = /^(feat|fix|docs|test|chore|refactor|perf|build|ci|style|revert)(\([^)]+\))?!?: \S/;
const ATTESTERS = new Set(["admin", "maintain"]);
const FACTORY_BRANCH = new RegExp(`^${BRANCH_PREFIX.replace("/", "\\/")}(\\d+)-`);

/** The owner line and how many of the three declarations are checked, read from any text. */
export function parseAttestation(text) {
  const owner = /^Human owner: @([A-Za-z0-9-]+)\s*$/m.exec(text);
  const checked = ATTESTATION.declarations.filter((d) => text.includes(`- [x] ${d}`)).length;
  return { owner: owner === null ? undefined : owner[1], checked };
}

const attests = (text, login, permission) => {
  const { owner, checked } = parseAttestation(text);
  return owner !== undefined && owner.toLowerCase() === login.toLowerCase() && checked === ATTESTATION.declarations.length && ATTESTERS.has(permission);
};

/**
 * @param {{ pull: object, reviews: object[], permissions: Record<string, string> }} state
 *   permissions maps each login that could attest to its repository permission.
 * @returns {Verdict}
 */
export function judgeReadiness({ pull, reviews, permissions }) {
  const problems = [];
  if (pull.draft) problems.push("still a draft");
  if (!TITLE.test(pull.title)) problems.push(`title is not Conventional Commits: ${JSON.stringify(pull.title)}`);
  const body = pull.body === null ? "" : pull.body;
  const factory = FACTORY_BRANCH.exec(pull.head.ref);
  if (factory !== null) {
    for (const heading of PR_BODY_HEADINGS) {
      if (!body.split("\n").includes(heading)) problems.push(`body lacks the section ${heading}`);
    }
    const issue = Number(factory[1]);
    if (!new RegExp(`^Closes #${issue}(?!\\d)`, "m").test(body)) problems.push(`body lacks "Closes #${issue}"`);
  }
  const approving = reviews.filter((r) => r.state === "APPROVED" && r.commit_id === pull.head.sha && r.user.type === "User");
  const reviewer = approving.find((r) => attests(r.body === null ? "" : r.body, r.user.login, permissions[r.user.login]));
  let attestedBy;
  if (reviewer !== undefined) attestedBy = reviewer.user.login;
  else if (pull.user.type === "User" && attests(body, pull.user.login, permissions[pull.user.login])) attestedBy = pull.user.login;
  if (attestedBy === undefined) {
    problems.push(`no attestation: an approving review on ${pull.head.sha.slice(0, 7)} by an admin or maintainer must carry "${ATTESTATION.ownerPrefix}<their login>" and the three checked declarations`);
  }
  return attestedBy === undefined ? { ready: problems.length === 0, problems } : { ready: problems.length === 0, problems, attestedBy };
}

/** The logins whose permission the verdict may need: approving reviewers on the head, and the author. */
export function attesterLogins(pull, reviews) {
  const logins = reviews.filter((r) => r.state === "APPROVED" && r.commit_id === pull.head.sha && r.user.type === "User").map((r) => r.user.login);
  if (pull.user.type === "User") logins.push(pull.user.login);
  return [...new Set(logins)];
}

/** The commit status body for a verdict. GitHub caps the description at 140 characters. */
export function statusFor(verdict, targetUrl) {
  const description = verdict.ready ? `ready; attested by ${verdict.attestedBy}` : verdict.problems.join("; ");
  return { context: CHECKS.readiness, state: verdict.ready ? "success" : "failure", description: description.slice(0, 140), target_url: targetUrl };
}

function writeOutputs(file, values) {
  if (typeof file !== "string" || file === "") return;
  appendFileSync(file, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(""));
}

export async function main(argv, env) {
  const { values } = parseArgs({ args: argv, options: { repo: { type: "string" }, pr: { type: "string" }, branch: { type: "string" } } });
  if (values.repo === undefined) throw new Error("--repo is required");
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN === "") throw new Error("GITHUB_TOKEN is required");
  const token = env.GITHUB_TOKEN;
  let pull;
  if (values.pr !== undefined && values.pr !== "") {
    if (!/^\d+$/.test(values.pr)) throw new Error(`--pr must be a number, got ${JSON.stringify(values.pr)}`);
    pull = await getPull(values.repo, values.pr, token);
  } else if (values.branch !== undefined && values.branch !== "") {
    [pull] = await listOpenPullsByHead(values.repo, values.branch, token);
    if (pull === undefined) {
      process.stdout.write(`readiness: no open pull request has the head branch ${values.branch}; nothing to judge\n`);
      writeOutputs(env.GITHUB_OUTPUT, { ready: false, draft: false, factory: false, number: "", head_sha: "" });
      return 0;
    }
  } else {
    throw new Error("--pr or --branch is required");
  }
  const reviews = await listPullReviews(values.repo, pull.number, token);
  const permissions = {};
  for (const login of attesterLogins(pull, reviews)) permissions[login] = (await getPermission(values.repo, login, token)).permission;
  const verdict = judgeReadiness({ pull, reviews, permissions });
  const targetUrl = `${env.GITHUB_SERVER_URL}/${values.repo}/actions/runs/${env.GITHUB_RUN_ID}`;
  const status = statusFor(verdict, targetUrl);
  await postStatus(values.repo, pull.head.sha, status, token);
  process.stdout.write(`readiness: #${pull.number} at ${pull.head.sha.slice(0, 7)} is ${status.state}: ${status.description}\n`);
  writeOutputs(env.GITHUB_OUTPUT, {
    ready: verdict.ready, draft: pull.draft, factory: FACTORY_BRANCH.test(pull.head.ref), number: pull.number, head_sha: pull.head.sha,
  });
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
