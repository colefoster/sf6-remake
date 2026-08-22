/**
 * Renders `sheet.html` in a real browser and writes the PNGs it produced.
 * Scratch tooling for issue 04 pass 2.
 *
 *   node scripts/build-play.mjs
 *   python3 -m http.server 8785 --directory .        # from the repo root
 *   node .scratch/pose-library/tools/shoot.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "seeds");
const URL = process.argv[2] ?? "http://127.0.0.1:8785/.scratch/pose-library/tools/sheet.html?v=1";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.SHEETS_READY === true, null, { timeout: 30000 });
const shots = await page.evaluate(() => window.SHEETS);
for (const { name, url } of shots) {
  const buf = Buffer.from(url.split(",")[1], "base64");
  writeFileSync(join(OUT, name), buf);
  console.log(`${name}  ${(buf.length / 1024).toFixed(0)} KB`);
}
await browser.close();
