import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNeeds, judge, renderTable, main } from "./required.mjs";

const selection = (lanes, off = {}) => JSON.stringify({ version: 1, event: "pull_request", tier: "fast", lanes, off, facts: null, reasons: [] });
const fastDocs = selection({ static: true, unit: false, integration: false, acceptance: false, artifact: false },
  { integration: "no container dependency until tracing code lands (T8)" });
const needs = (results, sel = fastDocs) => JSON.stringify({
  changes: { result: "success", outputs: { selection: sel } },
  ...Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }])),
});

test("a selected lane that was skipped fails; off and unselected skipped lanes pass", () => {
  const ok = judge(parseNeeds(needs({ static: "success", unit: "skipped", integration: "skipped", acceptance: "skipped", artifact: "skipped" })));
  assert.equal(ok.pass, true);
  const sel = selection({ static: true, unit: true, integration: false, acceptance: false, artifact: false });
  const bad = judge(parseNeeds(needs({ static: "success", unit: "skipped", integration: "skipped", acceptance: "skipped", artifact: "skipped" }, sel)));
  assert.equal(bad.pass, false);
  const unit = bad.rows.find((r) => r.job === "unit");
  assert.equal(unit.role, "selected");
  assert.equal(unit.why, "selected lane did not run");
  assert.match(renderTable(bad), /unit +selected +skipped +FAIL +selected lane did not run/);
  assert.match(renderTable(bad), /required: FAIL \(1 of 6 rows\)/);
});

test("an unselected lane that failed or was cancelled still fails; an off lane that ran fails", () => {
  for (const result of ["failure", "cancelled"]) {
    const v = judge(parseNeeds(needs({ static: "success", unit: result, integration: "skipped", acceptance: "skipped", artifact: "skipped" })));
    assert.equal(v.pass, false, result);
    assert.equal(v.rows.find((r) => r.job === "unit").why, `not selected lane may not report ${result}`);
  }
  const ran = judge(parseNeeds(needs({ static: "success", unit: "skipped", integration: "success", acceptance: "skipped", artifact: "skipped" })));
  assert.equal(ran.pass, false);
  assert.equal(ran.rows.find((r) => r.job === "integration").role, "off");
});

test("a lane missing from needs fails, and so does a failed classifier or a stray failed job", () => {
  const missing = judge(parseNeeds(needs({ static: "success", unit: "skipped", integration: "skipped", acceptance: "skipped" })));
  assert.equal(missing.pass, false);
  assert.equal(missing.rows.find((r) => r.job === "artifact").result, "missing");
  const stray = judge(parseNeeds(needs({ static: "success", unit: "skipped", integration: "skipped", acceptance: "skipped", artifact: "skipped", lint: "failure" })));
  assert.equal(stray.rows.find((r) => r.job === "lint").role, "other");
  assert.equal(stray.pass, false);
});

test("malformed input fails with the missing key named", () => {
  assert.throws(() => parseNeeds("[]"), /needs must be a JSON object/);
  assert.throws(() => parseNeeds(JSON.stringify({ static: { result: "success" } })), /needs\.changes is missing/);
  assert.throws(() => parseNeeds(JSON.stringify({ changes: { result: "success", outputs: {} } })), /outputs\.selection is missing/);
  assert.throws(() => parseNeeds(JSON.stringify({ changes: { result: "maybe" } })), /needs\.changes\.result must be one of/);
  assert.throws(() => main({}), /NEEDS_JSON is required/);
});
