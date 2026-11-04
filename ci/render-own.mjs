/** Render this repository's own CI and nightly workflows from the templates. Run after editing a template. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FACTORY_ROOT, renderNightly, renderOwnTemplate } from "../install/install.mjs";
import { loadConfig } from "./config.mjs";

export const OWN = Object.freeze({
  "templates/github/workflows/ci.yml": ".github/workflows/ci.yml",
  "templates/github/workflows/nightly.yml": ".github/workflows/nightly.yml",
});

/** The factory's own copy of one template: the nightly env from its own factory.json, actions by local path. */
export function renderOwn(source, text) {
  const rendered = source.endsWith("nightly.yml") ? renderNightly(text, "0".repeat(40), loadConfig(join(FACTORY_ROOT, "factory.json"))) : text;
  return renderOwnTemplate(rendered);
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  for (const [source, dest] of Object.entries(OWN)) {
    writeFileSync(join(FACTORY_ROOT, dest), renderOwn(source, readFileSync(join(FACTORY_ROOT, source), "utf8")));
    process.stdout.write(`${dest} rendered from ${source}\n`);
  }
}
