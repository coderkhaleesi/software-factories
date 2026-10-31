/**
 * The one reader of factory.json. Parses it into a ProjectConfig, validates every key,
 * matches paths against its globs, and renders AGENTS.md section 0 from its commands.
 *
 * @typedef {{ label: string, run: string, note?: string }} Command
 * @typedef {{ off: string }} OffLane
 * @typedef {{ paths: string[], fast: string[], full: { commands: string[], secrets: string[] } }} OnLane
 * @typedef {{
 *   version: 1, preset: string, commands: Record<string, Command>,
 *   paths: { docs: string[], lockfiles: string[], protected: string[] },
 *   lanes: Record<string, OffLane | OnLane>, artifact: { ships_bundle: boolean },
 * }} ProjectConfig
 */

import { readFileSync } from "node:fs";
import { LANES, SECTION0_MARKERS } from "./factory.mjs";

export class ConfigError extends Error {
  constructor(source, keyPath, message) {
    super(`${source}: ${keyPath}: ${message}`);
    this.name = "ConfigError";
    this.keyPath = keyPath;
  }
}

const REQUIRED_COMMANDS = ["install", "nofakes"];
const GATE_COMMAND = "bash scripts/check.sh";

/** Compile a glob with `**`, `*`, `?`, and literals into an anchored RegExp. */
export function compileGlob(glob) {
  if (/[{}[\]!]/.test(glob)) throw new Error(`unsupported glob syntax in ${JSON.stringify(glob)}: only ** * ? and literals`);
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slashAfter = glob[i + 2] === "/";
      re += slashAfter ? "(?:.*/)?" : ".*";
      i += slashAfter ? 2 : 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^$()|\\/]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path, globs) {
  return globs.some((g) => compileGlob(g).test(path));
}

function expect(source, keyPath, value, check, what) {
  if (!check(value)) throw new ConfigError(source, keyPath, `must be ${what}`);
  return value;
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isStringList = (v) => Array.isArray(v) && v.every(isNonEmptyString);

function parseStringList(source, keyPath, value) {
  return expect(source, keyPath, value, isStringList, "a list of non-empty strings");
}

function parseLane(source, name, raw, commandIds) {
  const keyPath = `lanes.${name}`;
  expect(source, keyPath, raw, isObject, "an object");
  if ("off" in raw) {
    const keys = Object.keys(raw);
    if (keys.length !== 1) throw new ConfigError(source, keyPath, `an off lane has only "off", got ${JSON.stringify(keys)}`);
    return { off: expect(source, `${keyPath}.off`, raw.off, isNonEmptyString, "a non-empty reason") };
  }
  const paths = parseStringList(source, `${keyPath}.paths`, raw.paths);
  const fast = parseStringList(source, `${keyPath}.fast`, raw.fast);
  expect(source, `${keyPath}.full`, raw.full, isObject, "an object");
  const commands = parseStringList(source, `${keyPath}.full.commands`, raw.full.commands);
  const secrets = parseStringList(source, `${keyPath}.full.secrets`, raw.full.secrets);
  for (const id of [...fast, ...commands]) {
    if (!commandIds.has(id)) throw new ConfigError(source, keyPath, `names command "${id}", which is not in commands`);
  }
  return { paths, fast, full: { commands, secrets } };
}

/** @returns {ProjectConfig} */
export function parseConfig(raw, source = "factory.json") {
  expect(source, "$", raw, isObject, "an object");
  if (raw.version !== 1) throw new ConfigError(source, "version", `must be 1, got ${JSON.stringify(raw.version)}`);
  const preset = expect(source, "preset", raw.preset, isNonEmptyString, "a non-empty string");

  expect(source, "commands", raw.commands, isObject, "an object");
  const commands = {};
  for (const [id, cmd] of Object.entries(raw.commands)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) throw new ConfigError(source, `commands.${id}`, "id must be lower-case kebab");
    expect(source, `commands.${id}`, cmd, isObject, "an object");
    const label = expect(source, `commands.${id}.label`, cmd.label, isNonEmptyString, "a non-empty string");
    const run = expect(source, `commands.${id}.run`, cmd.run, isNonEmptyString, "a non-empty string");
    commands[id] = "note" in cmd
      ? { label, run, note: expect(source, `commands.${id}.note`, cmd.note, isNonEmptyString, "a non-empty string") }
      : { label, run };
  }
  for (const id of REQUIRED_COMMANDS) {
    if (!(id in commands)) throw new ConfigError(source, `commands.${id}`, "is required");
  }
  if (commands.nofakes.run !== GATE_COMMAND) {
    throw new ConfigError(source, "commands.nofakes.run", `must be ${JSON.stringify(GATE_COMMAND)}`);
  }

  expect(source, "paths", raw.paths, isObject, "an object");
  const paths = {
    docs: parseStringList(source, "paths.docs", raw.paths.docs),
    lockfiles: parseStringList(source, "paths.lockfiles", raw.paths.lockfiles),
    protected: parseStringList(source, "paths.protected", raw.paths.protected),
  };
  for (const [key, list] of Object.entries(paths)) list.forEach((g) => compileGlob(g, `paths.${key}`));

  expect(source, "lanes", raw.lanes, isObject, "an object");
  const commandIds = new Set(Object.keys(commands));
  const lanes = {};
  for (const name of LANES) {
    if (!(name in raw.lanes)) throw new ConfigError(source, `lanes.${name}`, "is required");
    lanes[name] = parseLane(source, name, raw.lanes[name], commandIds);
  }
  for (const name of Object.keys(raw.lanes)) {
    if (!LANES.includes(name)) throw new ConfigError(source, `lanes.${name}`, `is not a lane; lanes are ${LANES.join(", ")}`);
  }
  if ("off" in lanes.static) throw new ConfigError(source, "lanes.static", "cannot be off; it carries the no-fakes gate");
  if (!lanes.static.fast.includes("nofakes")) throw new ConfigError(source, "lanes.static.fast", 'must include "nofakes"');
  for (const name of LANES) {
    if (!("off" in lanes[name])) lanes[name].paths.forEach((g) => compileGlob(g));
  }

  expect(source, "artifact", raw.artifact, isObject, "an object");
  const shipsBundle = expect(source, "artifact.ships_bundle", raw.artifact.ships_bundle, (v) => typeof v === "boolean", "a boolean");

  return { version: 1, preset, commands, paths, lanes, artifact: { ships_bundle: shipsBundle } };
}

export function loadConfig(file) {
  const text = readFileSync(file, "utf8");
  return parseConfig(JSON.parse(text), file);
}

/** The run strings a lane executes, install first, then fast, then full-tier extras. */
export function commandsForLane(config, lane, tier) {
  const spec = config.lanes[lane];
  if ("off" in spec) throw new Error(`lane ${lane} is off: ${spec.off}`);
  const ids = ["install", ...spec.fast, ...(tier === "full" ? spec.full.commands : [])];
  return ids.map((id) => ({ id, run: config.commands[id].run }));
}

/** The Markdown list AGENTS.md section 0 shows, one line per command. */
export function renderSection0(config) {
  return Object.values(config.commands)
    .map((c) => `- ${c.label}: \`${c.run}\`${"note" in c ? ` (${c.note})` : ""}`)
    .join("\n");
}

/** Replace the lines between the section 0 markers. The markers must each appear exactly once. */
export function replaceSection0(text, body) {
  const { begin, end } = SECTION0_MARKERS;
  for (const marker of [begin, end]) {
    const n = text.split(marker).length - 1;
    if (n !== 1) throw new Error(`expected exactly one ${marker} marker, found ${n}`);
  }
  const start = text.indexOf(begin) + begin.length;
  const stop = text.indexOf(end);
  if (stop < start) throw new Error(`${end} comes before ${begin}`);
  return `${text.slice(0, start)}\n${body}\n${text.slice(stop)}`;
}
