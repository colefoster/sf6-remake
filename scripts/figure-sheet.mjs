/**
 * A contact sheet of stick figures, shot through the real page.
 *
 * The figure has no ground truth to test against — there is no skeleton in the
 * dump (ADR-0049) — so `npm run pose:audit` ranks poses that are wrong on their
 * face and this puts eyes on them. It drives `window.play` (ADR-0051), which can
 * put a fighter on any action and frame without inputting the move, and composes
 * the frames into one PNG so a whole move reads at a glance.
 *
 * The dev server must be up: `npm run play` in another shell.
 *
 *   npm run figure:sheet -- ryu:ATK_5LK:1,3,5,7,12
 *   npm run figure:sheet -- blanka:ATK_5MK:1,4,8 deejay:ATK_2HK:20,26 --no-boxes
 *
 * Each argument is `<character>:<action>:<frames>`. The action matches by exact
 * name first, then as a case-insensitive pattern, so `ryu:5LK:6` finds `ATK_5LK`.
 * Flags: --out <path>, --url <url>, --span <units>, --no-boxes, --cols <n>.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const out = flag("out", ".scratch/sheets/figures.png");
const url = flag("url", "http://localhost:8777/play.html");
const span = Number(flag("span", 460));
const cols = Number(flag("cols", 4));
const boxes = !args.includes("--no-boxes");

const jobs = args
  .filter((a) => !a.startsWith("--") && a.includes(":"))
  .map((a) => {
    const [char, action, frames] = a.split(":");
    return { char, action, frames: (frames ?? "1").split(",").map(Number) };
  });
if (!jobs.length) {
  console.error("usage: npm run figure:sheet -- <character>:<action>:<frames> [...] [--out p] [--no-boxes]");
  process.exit(1);
}

const browser = await chromium.launch();
// Wide enough that the camera's own floor of 560 game units still fills the
// frame: `viewFor` scales to fit, so a narrow window means a tiny fighter.
const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
try {
  await page.goto(url, { timeout: 5000 });
} catch {
  console.error(`cannot reach ${url} — is \`npm run play\` running?`);
  await browser.close();
  process.exit(1);
}
await page.waitForFunction(() => window.play, null, { timeout: 10000 });

const cells = [];
for (const job of jobs) {
  await page.evaluate(async ({ char, boxes, span }) => {
    if (window.play.state().p1.character.toLowerCase() !== char.toLowerCase()) await window.play.select(0, char);
    window.play.boxes(boxes);
    window.play.figures(true);
    window.play.frame(0, span, true);
  }, { char: job.char, boxes, span });
  for (const frame of job.frames) {
    cells.push(
      await page.evaluate(([action, n]) => {
        const shot = window.play.scrub(0, action, n);
        return { label: `${shot.action} f${n}`, url: document.getElementById("stage").toDataURL("image/png") };
      }, [job.action, frame]),
    );
  }
}

// Composed in the page rather than in node: it already has a canvas, and the
// alternative is a PNG library this repo does not need.
const sheet = await page.evaluate(
  async ({ cells, cols }) => {
    const imgs = await Promise.all(
      cells.map((c) => new Promise((done) => {
        const img = new Image();
        img.onload = () => done(img);
        img.src = c.url;
      })),
    );
    const across = Math.min(cols, imgs.length);
    const down = Math.ceil(imgs.length / across);
    const cw = 440;
    const ch = 600;
    const canvas = document.createElement("canvas");
    canvas.width = across * cw;
    canvas.height = down * (ch + 22);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    imgs.forEach((img, i) => {
      const x = (i % across) * cw;
      const y = ((i / across) | 0) * (ch + 22);
      // The stage is taller than a cell and the fighter stands at its foot.
      ctx.drawImage(img, (img.width - cw) / 2, img.height - ch, cw, ch, x, y, cw, ch);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "12px ui-monospace, monospace";
      ctx.fillText(cells[i].label, x + 6, y + ch + 15);
      ctx.strokeStyle = "#262b34";
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch + 21);
    });
    return canvas.toDataURL("image/png");
  },
  { cells, cols },
);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(sheet.split(",")[1], "base64"));
console.log(`${out} — ${cells.length} poses`);
await browser.close();
