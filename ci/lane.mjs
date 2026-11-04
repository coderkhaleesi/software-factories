/**
 * Run one lane's commands from factory.json: install first, then the fast commands, then the
 * full-tier commands when the selection's tier is full. Each command runs under
 * `bash -euo pipefail`, and the first failure stops the lane with that command's exit code.
 * A full-tier secret that is absent from the environment fails before anything runs. Every
 * command sees FACTORY_TIER, so a project runner can select its own cases by tier.
 */

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { LANES } from "./factory.mjs";
import { loadConfig, commandsForLane } from "./config.mjs";

/** The environment a lane command runs in: the caller's, plus the tier. */
export function laneEnv(env, tier) {
  return { ...env, FACTORY_TIER: tier };
}

export function missingSecrets(config, lane, tier, env) {
  if (tier !== "full") return [];
  return config.lanes[lane].full.secrets.filter((name) => typeof env[name] !== "string" || env[name] === "");
}

export function main(argv, env = process.env, cwd = process.cwd()) {
  const { values } = parseArgs({
    args: argv,
    options: { lane: { type: "string" }, selection: { type: "string" }, config: { type: "string", default: "factory.json" } },
  });
  if (values.lane === undefined || !LANES.includes(values.lane)) throw new Error(`--lane must be one of ${LANES.join(", ")}`);
  if (values.selection === undefined) throw new Error("--selection is required: the changes job's selection output");
  const selection = JSON.parse(values.selection);
  if (selection.lanes[values.lane] !== true) throw new Error(`lane ${values.lane} is not selected in this run; its job's if: condition should have skipped it`);
  const config = loadConfig(values.config);
  const missing = missingSecrets(config, values.lane, selection.tier, env);
  if (missing.length > 0) throw new Error(`missing secret ${missing.join(", ")} for the ${selection.tier} tier of lane ${values.lane}`);
  const commandEnv = laneEnv(env, selection.tier);
  for (const { id, run } of commandsForLane(config, values.lane, selection.tier)) {
    process.stdout.write(`\n::group::${values.lane}: ${id}\n$ ${run}\n`);
    execFileSync("bash", ["-euo", "pipefail", "-c", run], { cwd, env: commandEnv, stdio: "inherit" });
    process.stdout.write("::endgroup::\n");
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2));
}
