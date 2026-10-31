/**
 * Vocabulary shared by the factory's scripts, templates, and workflows.
 * Every cross-cutting string lives here once; tests in vocab.test.mjs fail the build when
 * a template, workflow, or document drifts from it.
 */

export const LANES = Object.freeze(["static", "unit", "integration", "acceptance", "artifact"]);

/**
 * Labels the factory uses. `appliers` says who may apply one: a human through the GitHub UI,
 * a deterministic workflow step through the App token, or an agent through `add-labels`.
 * `ci` is the label's effect on the classifier. Only human-only labels may carry one, and an
 * effect can only add lanes. The full tier, which runs the keyed commands, comes only from the
 * schedule and dispatch events, never from a pull request.
 */
export const LABELS = Object.freeze([
  { name: "factory:ready", appliers: ["human"], description: "Change request ready for the planner" },
  { name: "factory:approved", appliers: ["human", "step"], description: "Plan approved; the builder may start" },
  { name: "factory:full", appliers: ["human"], description: "Run every lane on this PR", ci: { lanes: "all" } },
  { name: "factory:auto-merge", appliers: ["human"], description: "Eligible for agent merge under the trust policy" },
  { name: "factory:planned", appliers: ["agent"], description: "The planner commented a plan" },
  { name: "factory:needs-spec", appliers: ["agent"], description: "The request needs a spec interview first" },
  { name: "factory:light", appliers: ["agent"], description: "Light change class per the trust policy" },
  { name: "factory:built", appliers: ["agent"], description: "The builder opened a draft PR" },
  { name: "factory:suggested", appliers: ["agent"], description: "Filed by a sweep; a human promotes it to ready" },
  { name: "factory:needs-input", appliers: ["agent", "step"], description: "A run stopped on a question for a human" },
  { name: "factory:stuck", appliers: ["agent", "step"], description: "A run stopped and a human must look" },
].map(Object.freeze));

export const HUMAN_ONLY_LABELS = Object.freeze(
  LABELS.filter((l) => l.appliers.length === 1 && l.appliers[0] === "human").map((l) => l.name),
);

export const BRANCH_PREFIX = "factory/issue-";
const BRANCH = /^factory\/issue-(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
export const SLUG_MAX = 40;

export function isFactoryBranch(name) {
  const m = BRANCH.exec(name);
  return m !== null && m[2].length <= SLUG_MAX;
}

export function issueNumberOf(branch) {
  if (!isFactoryBranch(branch)) throw new Error(`not a factory branch: ${branch}`);
  return Number(BRANCH.exec(branch)[1]);
}

export function branchFor(issue, title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, SLUG_MAX).replace(/-$/, "");
  if (!slug) throw new Error(`no slug can be made from title: ${JSON.stringify(title)}`);
  return `${BRANCH_PREFIX}${issue}-${slug}`;
}

/** Globs that AGENTS.md section 5 calls protected. A project may add to this list, never remove. */
export const PROTECTED_GLOBS = Object.freeze([
  "AGENTS.md", "CLAUDE.md", "no-fakes.allow", "no-fakes.profile",
  "scripts/check.sh", "scripts/check_no_fakes.py", "ruff.toml", "eslint.config.*",
  "factory.json", ".claude/**", ".github/**", "ci/**",
]);

export const PR_BODY_HEADINGS = Object.freeze(["## Plan", "## Evidence", "## Test Status", "## Human owner"]);

export const ATTESTATION = Object.freeze({
  ownerPrefix: "Human owner: @",
  declarations: Object.freeze([
    "I read the diff myself, not only the agent's summary.",
    "The Evidence section matches what the diff does.",
    "I own this change and accept responsibility for merging it.",
  ]),
});

/** The block a human pastes into an approving review, or the blank one in the PR template. */
export function attestationBlock(login = "", checked = login !== "") {
  const box = checked ? "[x]" : "[ ]";
  return [`${ATTESTATION.ownerPrefix}${login}`, ...ATTESTATION.declarations.map((d) => `- ${box} ${d}`)].join("\n");
}

export const ARTIFACTS = Object.freeze({
  baseline: "factory-artifact-baseline",
  forHead: (sha) => `factory-artifact-${sha.slice(0, 7)}`,
});

export const FIX_ATTEMPTS = 3;

export const CHECKS = Object.freeze({ required: "required", readiness: "factory/pr-readiness" });

export const SECTION0_MARKERS = Object.freeze({ begin: "<!-- commands:begin -->", end: "<!-- commands:end -->" });
