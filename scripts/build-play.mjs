/**
 * Bundles the runtime for the browser: src/game/browser.ts -> web/play.js.
 *
 * `web/play.html` runs the real `Fighter` and `Match` rather than a second
 * implementation of them. That is deliberate — ADR-0007 has been carrying a
 * duplicated advantage calculation in the box viewer since it was written, and
 * this is the seam that stops it happening again. See docs/adr/0028.
 */

import { build } from "esbuild";
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
