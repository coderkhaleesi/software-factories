import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attesterLogins, judgeReadiness, main, parseAttestation, statusFor, TITLE } from "./pr-readiness.mjs";
import { ATTESTATION, CHECKS, attestationBlock } from "./factory.mjs";
import { FACTORY_ROOT } from "../install/install.mjs";

const SHA = "ae7aea38242047d9b91b53122f354f07353105cf";
const OWNER = "coderkhaleesi";
const factoryBody = (extra = "") => `## Plan\n- [x] T1\n\n## Evidence\n...\n\n## Test Status\nunit pass\n\n## Human owner\n\n${attestationBlock()}\n\nCloses #11\n${extra}`;
const pull = (over = {}) => ({
  number: 14, draft: false, title: "feat: reject non-kebab-case names", body: factoryBody(),
  user: { login: "td-software-factory[bot]", type: "Bot" }, head: { sha: SHA, ref: "factory/issue-11-reject-non-kebab-e7c51b047938a648" }, ...over,
});
const review = (over = {}) => ({ state: "APPROVED", commit_id: SHA, user: { login: OWNER, type: "User" }, body: attestationBlock(OWNER), ...over });
const perms = { [OWNER]: "admin" };

test("the blank block attests nothing and the filled block attests its owner", () => {
  const blank = parseAttestation(readFileSync(join(FACTORY_ROOT, "templates/github/pull_request_template.md"), "utf8"));
  assert.deepEqual(blank, { owner: undefined, checked: 0 });
  assert.deepEqual(parseAttestation(attestationBlock(OWNER)), { owner: OWNER, checked: ATTESTATION.declarations.length });
  assert.deepEqual(parseAttestation(`Looks good.\n\n${attestationBlock(OWNER, false)}`), { owner: OWNER, checked: 0 });
});

test("an approving review on the head by an admin with the full block makes a factory PR ready", () => {
  const v = judgeReadiness({ pull: pull(), reviews: [review()], permissions: perms });
  assert.deepEqual(v, { ready: true, problems: [], attestedBy: OWNER });
});

test("reviews that do not count: wrong commit, not approved, a bot, a non-admin, a block naming someone else, boxes unchecked", () => {
  const cases = [
    review({ commit_id: "f".repeat(40) }),
    review({ state: "COMMENTED" }),
    review({ user: { login: "td-software-factory[bot]", type: "User" }, body: attestationBlock("td-software-factory[bot]") }),
    review({ user: { login: "guest", type: "User" }, body: attestationBlock("guest") }),
    review({ body: attestationBlock("someone-else") }),
    review({ body: attestationBlock(OWNER, false) }),
  ];
  for (const r of cases) {
    const v = judgeReadiness({ pull: pull(), reviews: [r], permissions: { ...perms, guest: "write", "td-software-factory[bot]": "write" } });
    assert.equal(v.ready, false, JSON.stringify(r));
    assert.match(v.problems[0], /^no attestation: an approving review on ae7aea3 by an admin or maintainer/);
  }
});

test("a body attestation counts only when the author is that admin; an App-authored body never attests", () => {
  const human = pull({ user: { login: OWNER, type: "User" }, body: factoryBody().replace(attestationBlock(), attestationBlock(OWNER)) });
  assert.deepEqual(judgeReadiness({ pull: human, reviews: [], permissions: perms }), { ready: true, problems: [], attestedBy: OWNER });
  const app = pull({ body: factoryBody().replace(attestationBlock(), attestationBlock(OWNER)) });
  assert.equal(judgeReadiness({ pull: app, reviews: [], permissions: perms }).ready, false);
});

test("drafts, bad titles, and factory bodies without the sections or Closes line are not ready, and every problem is listed", () => {
  const v = judgeReadiness({ pull: pull({ draft: true, title: "Reject names", body: "## Plan\nonly" }), reviews: [review()], permissions: perms });
  assert.equal(v.ready, false);
  assert.deepEqual(v.problems, [
    "still a draft",
    'title is not Conventional Commits: "Reject names"',
    "body lacks the section ## Evidence",
    "body lacks the section ## Test Status",
    "body lacks the section ## Human owner",
    'body lacks "Closes #11"',
  ]);
  for (const t of ["feat(skills): x", "fix!: y", "docs: z"]) assert.ok(TITLE.test(t), t);
  for (const t of ["feat:x", "Feat: x", "feature: x", "feat: "]) assert.ok(!TITLE.test(t), t);
});

test("a non-factory PR needs only a title and an attestation", () => {
  const human = pull({ head: { sha: SHA, ref: "docs/trust" }, body: attestationBlock(OWNER), user: { login: OWNER, type: "User" } });
  assert.deepEqual(judgeReadiness({ pull: human, reviews: [], permissions: perms }), { ready: true, problems: [], attestedBy: OWNER });
  assert.equal(judgeReadiness({ pull: human, reviews: [], permissions: { [OWNER]: "write" } }).ready, false);
});

test("attester logins are the approving reviewers on the head plus a human author, once each", () => {
  assert.deepEqual(attesterLogins(pull(), [review(), review(), review({ commit_id: "0".repeat(40), user: { login: "old", type: "User" } })]), [OWNER]);
  assert.deepEqual(attesterLogins(pull({ user: { login: OWNER, type: "User" } }), [review({ user: { login: "x", type: "User" } })]), ["x", OWNER]);
});

test("the status names the readiness context and caps its description", () => {
  const ok = statusFor({ ready: true, problems: [], attestedBy: OWNER }, "https://example.test/run");
  assert.deepEqual(ok, { context: CHECKS.readiness, state: "success", description: `ready; attested by ${OWNER}`, target_url: "https://example.test/run" });
  const bad = statusFor({ ready: false, problems: ["a".repeat(100), "b".repeat(100)] }, "u");
  assert.equal(bad.state, "failure");
  assert.equal(bad.description.length, 140);
});

test("usage errors name the flag", async () => {
  await assert.rejects(main([], { GITHUB_TOKEN: "x" }), /--repo is required/);
  await assert.rejects(main(["--repo", "o/r"], {}), /GITHUB_TOKEN is required/);
  await assert.rejects(main(["--repo", "o/r"], { GITHUB_TOKEN: "x" }), /--pr or --branch is required/);
  await assert.rejects(main(["--repo", "o/r", "--pr", "x"], { GITHUB_TOKEN: "x" }), /--pr must be a number/);
});
