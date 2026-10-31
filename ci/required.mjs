/**
 * The one gate branch protection requires. Reads `toJSON(needs)` from the `required` job,
 * finds the Selection inside `needs.changes.outputs.selection`, and judges every lane by its
 * role. A selected lane passes only on success. A lane that is off must be skipped. A lane
 * that was not selected may be skipped or succeed, but a failure or a cancellation still
 * fails. A lane missing from `needs` fails, so a forgotten job is caught on the first run.
 */

import { LANES } from "./factory.mjs";

const RESULTS = new Set(["success", "failure", "cancelled", "skipped"]);
const PASS = Object.freeze({
  classifier: new Set(["success"]),
  selected: new Set(["success"]),
  "not selected": new Set(["success", "skipped"]),
  off: new Set(["skipped"]),
  other: new Set(["success"]),
});

export function parseNeeds(json) {
  const needs = JSON.parse(json);
  if (typeof needs !== "object" || needs === null || Array.isArray(needs)) throw new Error("needs must be a JSON object");
  for (const [job, entry] of Object.entries(needs)) {
    if (typeof entry !== "object" || entry === null || !RESULTS.has(entry.result)) {
      throw new Error(`needs.${job}.result must be one of ${[...RESULTS].join(", ")}`);
    }
  }
  if (!("changes" in needs)) throw new Error("needs.changes is missing; the required job must depend on the changes job");
  const raw = needs.changes.outputs !== undefined ? needs.changes.outputs.selection : undefined;
  if (typeof raw !== "string" || raw === "") {
    throw new Error("needs.changes.outputs.selection is missing; the changes job did not produce a selection");
  }
  const selection = JSON.parse(raw);
  if (selection.version !== 1) throw new Error(`selection.version must be 1, got ${JSON.stringify(selection.version)}`);
  for (const lane of LANES) {
    if (typeof selection.lanes[lane] !== "boolean") throw new Error(`selection.lanes.${lane} must be a boolean`);
  }
  return { needs, selection };
}

function roleOf(job, selection) {
  if (job === "changes") return "classifier";
  if (!LANES.includes(job)) return "other";
  if (job in selection.off) return "off";
  return selection.lanes[job] ? "selected" : "not selected";
}

/** @returns {{ pass: boolean, rows: { job: string, role: string, result: string, ok: boolean, why: string }[] }} */
export function judge({ needs, selection }) {
  const rows = [];
  const jobs = ["changes", ...LANES, ...Object.keys(needs).filter((j) => j !== "changes" && !LANES.includes(j))];
  for (const job of jobs) {
    const role = roleOf(job, selection);
    if (!(job in needs)) {
      rows.push({ job, role, result: "missing", ok: false, why: "not in needs; wire every lane into the required job" });
      continue;
    }
    const { result } = needs[job];
    const ok = PASS[role].has(result);
    let why = "";
    if (role === "off") why = `off: ${selection.off[job]}`;
    if (!ok && role === "selected" && result === "skipped") why = "selected lane did not run";
    if (!ok && why === "") why = `${role} lane may not report ${result}`;
    rows.push({ job, role, result, ok, why });
  }
  return { pass: rows.every((r) => r.ok), rows };
}

export function renderTable({ pass, rows }) {
  const width = (key) => Math.max(...rows.map((r) => String(r[key]).length), key.length);
  const pad = (s, n) => String(s).padEnd(n);
  const w = { job: width("job"), role: width("role"), result: width("result") };
  const lines = [`${pad("job", w.job)}  ${pad("role", w.role)}  ${pad("result", w.result)}  verdict`];
  for (const r of rows) {
    lines.push(`${pad(r.job, w.job)}  ${pad(r.role, w.role)}  ${pad(r.result, w.result)}  ${r.ok ? "ok  " : "FAIL"}  ${r.why}`.trimEnd());
  }
  const failed = rows.filter((r) => !r.ok).length;
  lines.push(pass ? `required: PASS (${rows.length} rows)` : `required: FAIL (${failed} of ${rows.length} rows)`);
  return `${lines.join("\n")}\n`;
}

export function main(env) {
  if (typeof env.NEEDS_JSON !== "string" || env.NEEDS_JSON === "") throw new Error("NEEDS_JSON is required: pass toJSON(needs) from the required job");
  const verdict = judge(parseNeeds(env.NEEDS_JSON));
  process.stdout.write(renderTable(verdict));
  return verdict.pass ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main(process.env);
}
