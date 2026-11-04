import { test } from "node:test";
import assert from "node:assert/strict";
import { laneEnv, missingSecrets } from "./lane.mjs";

const config = {
  lanes: { acceptance: { paths: [], fast: ["acceptance"], full: { commands: [], secrets: ["GOOGLE_API_KEY", "EVAL_BIBLE_AGENT_MODEL"] } } },
};

test("every lane command sees FACTORY_TIER set to the selection's tier", () => {
  assert.equal(laneEnv({ PATH: "/bin" }, "full").FACTORY_TIER, "full");
  assert.equal(laneEnv({ PATH: "/bin", FACTORY_TIER: "stale" }, "fast").FACTORY_TIER, "fast");
  assert.equal(laneEnv({ PATH: "/bin" }, "fast").PATH, "/bin");
});

test("the full tier names every absent or empty secret; the fast tier checks none", () => {
  assert.deepEqual(missingSecrets(config, "acceptance", "full", { GOOGLE_API_KEY: "" }), ["GOOGLE_API_KEY", "EVAL_BIBLE_AGENT_MODEL"]);
  assert.deepEqual(missingSecrets(config, "acceptance", "full", { GOOGLE_API_KEY: "k", EVAL_BIBLE_AGENT_MODEL: "m" }), []);
  assert.deepEqual(missingSecrets(config, "acceptance", "fast", {}), []);
});
