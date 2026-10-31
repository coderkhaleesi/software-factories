/**
 * Classify a change into a Selection: the tier and the lanes CI runs.
 *
 * Every input is a rule with an effect, and an effect can only add lanes, raise the tier to
 * full, or record a fact. Nothing can remove a lane, so a label or a config entry cannot
 * weaken the gate. A changed path that no rule claims selects every lane that is on. Only the
 * schedule and dispatch events raise the tier to full, because full-tier commands may need
 * secrets that a pull request never receives.
 *
 * @typedef {{ event: "pull_request", base: string, head: string, labels: string[] }
 *         | { event: "schedule" | "workflow_dispatch" }} ClassifyInput
 * @typedef {{ version: 1, event: string, tier: "fast" | "full", lanes: Record<string, boolean>,
 *   off: Record<string, string>, facts: Facts | null, reasons: { rule: string, by: string }[] }} Selection
 * @typedef {{ files: number, docs_only: boolean, ci: boolean, deps: boolean, protected: boolean,
 *   unclaimed: string[] }} Facts
 */

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { LANES, LABELS, PROTECTED_GLOBS } from "./factory.mjs";
import { loadConfig, matchesAny } from "./config.mjs";

export const EVENTS = Object.freeze(["pull_request", "schedule", "workflow_dispatch"]);

/** Paths changed between base and head, with renames shown as a delete plus an add. */
export function changedPaths(base, head, cwd = process.cwd()) {
  for (const [name, sha] of [["base", base], ["head", head]]) {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`${name} must be a commit SHA, got ${JSON.stringify(sha)}`);
  }
  const out = execFileSync("git", ["diff", "--name-only", "--no-renames", `${base}...${head}`], { cwd, encoding: "utf8" });
  return out.split("\n").filter((line) => line !== "");
}

class Effects {
  constructor(onLanes) {
    this.onLanes = onLanes;
    this.lanes = new Set();
    this.full = false;
    this.reasons = [];
  }

  add(rule, by, effect) {
    const lanes = effect.lanes === "all" ? this.onLanes : effect.lanes;
    for (const lane of lanes) if (this.onLanes.includes(lane)) this.lanes.add(lane);
    if (effect.tier === "full") this.full = true;
    this.reasons.push({ rule, by });
  }
}

function pathFacts(paths, config, effects) {
  const protectedGlobs = [...PROTECTED_GLOBS, ...config.paths.protected];
  const facts = { files: paths.length, docs_only: paths.length > 0, ci: false, deps: false, protected: false, unclaimed: [] };
  for (const path of paths) {
    let claimed = false;
    let onlyDocs = false;
    if (matchesAny(path, config.paths.docs)) {
      claimed = true;
      onlyDocs = true;
      effects.reasons.push({ rule: "project:docs", by: path });
    }
    if (matchesAny(path, config.paths.lockfiles)) {
      claimed = true;
      onlyDocs = false;
      facts.deps = true;
      effects.add("factory:lockfile-selects-all", path, { lanes: "all" });
    }
    if (matchesAny(path, protectedGlobs)) {
      claimed = true;
      onlyDocs = false;
      facts.protected = true;
      if (matchesAny(path, [".github/**"])) facts.ci = true;
      effects.add("factory:protected-selects-all", path, { lanes: "all" });
    }
    for (const lane of effects.onLanes) {
      if (matchesAny(path, config.lanes[lane].paths)) {
        claimed = true;
        onlyDocs = false;
        effects.add(`project:lane-${lane}`, path, { lanes: [lane] });
      }
    }
    if (!claimed) {
      facts.unclaimed.push(path);
      effects.add("factory:unclaimed-selects-all", path, { lanes: "all" });
    }
    if (!onlyDocs) facts.docs_only = false;
  }
  return facts;
}

/** @returns {Selection} */
export function classify(input, paths, config) {
  if (!EVENTS.includes(input.event)) throw new Error(`event must be one of ${EVENTS.join(", ")}, got ${JSON.stringify(input.event)}`);
  const onLanes = LANES.filter((lane) => !("off" in config.lanes[lane]));
  const off = Object.fromEntries(LANES.filter((lane) => "off" in config.lanes[lane]).map((lane) => [lane, config.lanes[lane].off]));
  const effects = new Effects(onLanes);
  effects.add("factory:static-always", "*", { lanes: ["static"] });

  let facts = null;
  if (input.event === "pull_request") {
    if (!Array.isArray(input.labels)) throw new Error("labels must be a list");
    facts = pathFacts(paths, config, effects);
    for (const name of input.labels) {
      const label = LABELS.find((l) => l.name === name);
      if (label !== undefined && "ci" in label) effects.add(`label:${name}`, name, label.ci);
    }
  } else {
    effects.add("factory:full-tier-event", input.event, { lanes: "all", tier: "full" });
  }
  if (effects.full) effects.add("factory:full-tier-runs-every-lane", "tier", { lanes: "all" });

  return {
    version: 1,
    event: input.event,
    tier: effects.full ? "full" : "fast",
    lanes: Object.fromEntries(LANES.map((lane) => [lane, effects.lanes.has(lane)])),
    off,
    facts,
    reasons: effects.reasons,
  };
}

export function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      event: { type: "string" },
      base: { type: "string" },
      head: { type: "string" },
      "labels-json": { type: "string" },
      config: { type: "string", default: "factory.json" },
    },
  });
  if (values.event === undefined) throw new Error("--event is required");
  const config = loadConfig(values.config);
  let input;
  let paths = [];
  if (values.event === "pull_request") {
    for (const flag of ["base", "head", "labels-json"]) {
      if (values[flag] === undefined) throw new Error(`--${flag} is required for pull_request`);
    }
    input = { event: "pull_request", base: values.base, head: values.head, labels: JSON.parse(values["labels-json"]) };
    paths = changedPaths(values.base, values.head);
  } else {
    input = { event: values.event };
  }
  process.stdout.write(`${JSON.stringify(classify(input, paths, config))}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2));
}
