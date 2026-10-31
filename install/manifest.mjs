/**
 * The one list of files the factory installs into a project.
 *
 * Ownership decides what a re-install does:
 *   managed   byte copy of a factory file, overwritten on every install
 *   rendered  a pure function of factory sources, the target's factory.json, and the factory ref; overwritten
 *   seeded    written once from a factory source, then owned by the project; never overwritten
 *   block     lines kept present in a project-owned file; missing lines are appended
 *
 * `when` limits an entry to projects whose preset is in the list. `source` is relative to the
 * factory checkout; for a seeded entry it may contain `{preset}`.
 */
export const MANIFEST = Object.freeze([
  { path: "AGENTS.md", ownership: "rendered", source: "AGENTS.md", render: "agents",
    role: "the agent contract; section 0 is rendered from factory.json" },
  { path: "CLAUDE.md", ownership: "managed", source: "CLAUDE.md", role: "Claude Code pointer to AGENTS.md and the hooks" },
  { path: "factory.json", ownership: "seeded", source: "presets/{preset}/factory.json", role: "the project's commands, paths, and lanes" },
  { path: "no-fakes.allow", ownership: "seeded", source: "no-fakes.allow", role: "the project's approved exceptions, header only at first" },
  { path: "no-fakes.profile", ownership: "managed", source: "no-fakes.profile", role: "strict" },
  { path: "ruff.toml", ownership: "managed", source: "ruff.toml", role: "ruff rules the no-fakes gate relies on" },
  { path: "eslint.config.js", ownership: "managed", source: "eslint.config.js", when: ["node-npm"], role: "ESLint rules the no-fakes gate relies on" },
  { path: "scripts/check.sh", ownership: "managed", source: "scripts/check.sh", role: "the no-fakes gate" },
  { path: "scripts/check_no_fakes.py", ownership: "managed", source: "scripts/check_no_fakes.py", role: "the no-fakes checker" },
  { path: ".claude/settings.json", ownership: "managed", source: ".claude/settings.json", role: "Claude Code hooks" },
  { path: ".claude/hooks/guard.py", ownership: "managed", source: ".claude/hooks/guard.py", role: "hook implementation" },
  { path: ".codex/hooks.json", ownership: "rendered", source: ".codex/hooks.json", render: "codex", role: "Codex hooks, paths rewritten to the project" },
  { path: ".codex/hooks/guard.py", ownership: "managed", source: ".codex/hooks/guard.py", role: "hook implementation" },
  { path: ".github/workflows/ci.yml", ownership: "rendered", source: "templates/github/workflows/ci.yml", render: "template",
    role: "classifier, five lanes, and the required gate, pinned to the factory ref" },
  { path: ".github/workflows/factory-light-approve.yml", ownership: "rendered", source: "templates/github/workflows/factory-light-approve.yml", render: "template",
    role: "applies factory:approved to light-class issues through the App" },
  { path: ".github/pull_request_template.md", ownership: "managed", source: "templates/github/pull_request_template.md",
    role: "PR body sections and the blank attestation block" },
  { path: ".github/ISSUE_TEMPLATE/change-request.yml", ownership: "managed", source: "templates/github/ISSUE_TEMPLATE/change-request.yml",
    role: "the change-request issue form the planner reads" },
  { path: ".github/actions/factory-setup/action.yml", ownership: "seeded", source: "presets/{preset}/setup.yml",
    role: "the project's toolchain action, owned by the project" },
  { path: ".gitignore", ownership: "block", source: "install/gitignore.lines", role: "ignores the agent work log and reports" },
].map(Object.freeze));

export const OWNERSHIPS = Object.freeze(["managed", "rendered", "seeded", "block"]);

/** The footprint table README.md shows. A test checks README carries it verbatim. */
export function renderFootprint() {
  const rows = MANIFEST.map((e) => `| \`${e.path}\` | ${e.ownership} | ${e.role} |`);
  return ["| File | Ownership | Role |", "|---|---|---|", ...rows].join("\n");
}
