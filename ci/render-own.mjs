/** Render this repository's own CI workflow from the template. Run after editing the template. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FACTORY_ROOT, renderOwnTemplate } from "../install/install.mjs";

export const OWN = Object.freeze({ "templates/github/workflows/ci.yml": ".github/workflows/ci.yml" });

for (const [source, dest] of Object.entries(OWN)) {
  writeFileSync(join(FACTORY_ROOT, dest), renderOwnTemplate(readFileSync(join(FACTORY_ROOT, source), "utf8")));
  process.stdout.write(`${dest} rendered from ${source}\n`);
}
