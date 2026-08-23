/**
 * Bundles the runtime for the browser: src/game/browser.ts -> web/play.js, and
 * stages the authored pose library as web/poses.json.
 *
 * `web/play.html` runs the real `Fighter` and `Match` rather than a second
 * implementation of them. That is deliberate — ADR-0007 has been carrying a
 * duplicated advantage calculation in the box viewer since it was written, and
 * this is the seam that stops it happening again. See docs/adr/0028.
 *
 * `web/boxes.html` loads the same bundle, so both pages are built here and both
 * read the same pose library. `src/data/load-poses.ts` is Node's half of the
 * library and cannot run in a page, so the files are collected here into one
 * fetchable object — the same arrangement as `web/*.boxes.json`, generated
 * beside authored source and gitignored. See docs/adr/0068.
 */

import { build } from "esbuild";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  entryPoints: [path.join(root, "src/game/browser.ts")],
  outfile: path.join(root, "web/play.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  // A guard, not a convenience: if anything under src/game ever reaches for the
  // file system again, this fails the build rather than failing in the page.
  external: [],
  logLevel: "warning",
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`web/play.js  ${(bytes / 1024).toFixed(1)} KB`);

/* ---- the authored pose library, as one object a page can fetch ------------ */

const posesDir = path.join(root, "data", "poses");
/** `{ "<character>": [PoseFile, ...] }` — whole files, so a page keeps the anchors. */
const library = {};
let files = 0;
for (const character of readdirSync(posesDir).sort()) {
  const dir = path.join(posesDir, character);
  if (!statSync(dir).isDirectory()) continue;
  const moves = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
  if (!moves.length) continue;
  library[character] = moves;
  files += moves.length;
}
const out = path.join(root, "web", "poses.json");
writeFileSync(out, `${JSON.stringify(library)}\n`);
console.log(
  `web/poses.json  ${files} authored move${files === 1 ? "" : "s"} across ${Object.keys(library).length} character${Object.keys(library).length === 1 ? "" : "s"}`,
);
