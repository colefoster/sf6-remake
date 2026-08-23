/**
 * The two sheets ADR-0070 shows, drawn through `drawFigure` itself so what is
 * on the page is what the game draws.
 *
 * The canvas is an SVG-emitting `Ctx` shim rather than a real one: the figure is
 * strokes and arcs and nothing else, so a shim is the whole of it, and the
 * output is text a diff can read.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { loadGeometry } from "../../../src/data/load-geometry.js";
import { loadPose } from "../../../src/data/load-poses.js";
import { actionByName } from "../../../src/data/geometry.js";
import { authoredPoseOf, resolveKeys, overreach, type PoseFile, type AuthoredPose } from "../../../src/game/pose-library.js";
import { buildOf, drawFigure, headRadius, type Ctx, type Pose, type Posed, type View } from "../../../src/game/render.js";
import {
  extensionPeak,
  planeOf,
  retargetFrame,
  reachOf,
  type SmplxClip,
} from "../../../src/game/retarget.js";

const ryu = loadGeometry("ryu")!;
const build = buildOf(ryu);
const radius = headRadius(ryu);

const W = 330;
const H = 330;
const SCALE = 1.55;

/** An SVG `Ctx`. Only what `drawFigure` calls is implemented. */
function svgCtx(): { ctx: Ctx; out: string[] } {
  const out: string[] = [];
  let path: string[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "",
    beginPath: () => {
      path = [];
    },
    moveTo: (x: number, y: number) => path.push(`M${x.toFixed(2)} ${y.toFixed(2)}`),
    lineTo: (x: number, y: number) => path.push(`L${x.toFixed(2)} ${y.toFixed(2)}`),
    arc: (x: number, y: number, r: number, _a: number, _b: number) =>
      path.push(
        `M${(x - r).toFixed(2)} ${y.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(r * 2).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-r * 2).toFixed(2)} 0`,
      ),
    stroke: () =>
      out.push(
        `<path d="${path.join("")}" fill="none" stroke="${ctx.strokeStyle}" stroke-width="${ctx.lineWidth.toFixed(2)}" stroke-linecap="round" opacity="${ctx.globalAlpha}"/>`,
      ),
    fillRect: () => {},
    strokeRect: () => {},
    setLineDash: () => {},
    fillText: () => {},
  } as unknown as Ctx;
  return { ctx, out };
}

/** One figure as an `<svg>`, floor on the bottom edge, axis in the middle. */
function cell(pose: Pose, label: string, note: string): string {
  const view: View = {
    width: W,
    height: H,
    scale: SCALE,
    ground: H - 24,
    x: (u: number) => W / 2 + u * SCALE,
    y: (u: number) => H - 24 - u * SCALE,
  };
  const { ctx, out } = svgCtx();
  drawFigure(ctx, view, pose, 0, 0, true);
  return `<figure><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0a0c10"/>
  <line x1="0" y1="${H - 24}" x2="${W}" y2="${H - 24}" stroke="#2b3140"/>
  <line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="#1b2029"/>
  ${out.join("\n  ")}
</svg><figcaption><b>${label}</b><br><span>${note}</span></figcaption></figure>`;
}

const posed = (action: ReturnType<typeof actionByName>, frame: number): Posed =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Posed;

/** Draw one authored file at the frame an anchor resolves to. */
function drawAt(file: PoseFile, anchorFrame: number): Pose {
  const action = actionByName(ryu, file.action)!;
  return authoredPoseOf(file, posed(action, anchorFrame), radius, build)!;
}

const contactOf = (file: PoseFile): number => {
  const action = actionByName(ryu, file.action)!;
  return resolveKeys(file, action).keys.find((k) => k.at === "contact")!.frame;
};

/* ---- sheet 1: the three punches, before and after ------------------------ */

const rows: string[] = [];
for (const move of ["5LP", "5MP", "5HP"]) {
  const now = loadPose("ryu", move)!;
  const was = JSON.parse(
    execFileSync("git", ["show", `HEAD:data/poses/ryu/${move}.json`], { encoding: "utf8" }),
  ) as PoseFile;
  const frame = contactOf(now);
  const action = actionByName(ryu, now.action)!;
  const hand = (f: PoseFile): AuthoredPose => f.keys.find((k) => k.at === "contact")!.pose;
  const desc = (f: PoseFile): string => {
    const p = hand(f);
    const r = reachOf(p);
    const which = p.hands[1].x > p.hands[0].x ? "rear" : "lead";
    const tip = which === "rear" ? p.hands[1] : p.hands[0];
    return `twist ${p.twist ?? 0}&deg; &middot; ${which} hand to x ${tip.x.toFixed(3)} &middot; that arm ${(which === "rear" ? r.hands[1] : r.hands[0]).toFixed(3)} of bone &middot; file ${overreach(resolveKeys(f, action).keys).toFixed(3)}`;
  };
  rows.push(`<div class="row"><h3>${move} &mdash; ${now.action}, contact = f${frame}</h3><div class="pair">
${cell(drawAt(was, frame), `${move} before`, desc(was))}
${cell(drawAt(now, frame), `${move} after`, desc(now))}
</div></div>`);
}

/* ---- sheet 2: ADR-0069's comparison, redone ------------------------------ */

const clip = JSON.parse(readFileSync("tests/fixtures/smplx-straight-punch.json", "utf8")) as SmplxClip;
const plane = planeOf(clip);
const peak = extensionPeak(clip, plane);
const frame = retargetFrame(clip, peak, plane);
const mp = loadPose("ryu", "5MP")!;
const mpAction = actionByName(ryu, "ATK_5MP")!;
const mpContact = contactOf(mp);

const asFile = (pose: AuthoredPose): PoseFile => ({
  character: "ryu",
  move: "x",
  action: "ATK_5MP",
  keys: [{ at: "contact", pose }],
});
const describe = (pose: AuthoredPose): string => {
  const r = reachOf(pose);
  return `twist ${(pose.twist ?? 0).toFixed(1)}&deg; &middot; rear hand x ${pose.hands[1].x.toFixed(3)} &middot; rear arm ${r.hands[1].toFixed(3)} of bone`;
};
const untwisted: AuthoredPose = { ...frame.naive, twist: 0 };

const two = `<div class="row"><h3>the ADR-0069 comparison, with the twist derived &mdash; clip frame ${peak}, drawn on ATK_5MP f${mpContact}</h3><div class="quad">
${cell(drawAt(mp, mpContact), "hand-authored 5MP", describe(mp.keys.find((k) => k.at === "contact")!.pose))}
${cell(authoredPoseOf(asFile(untwisted), posed(mpAction, mpContact), radius, build)!, "naive projection, twist forced to 0", describe(untwisted))}
${cell(authoredPoseOf(asFile(frame.naive), posed(mpAction, mpContact), radius, build)!, "naive projection, twist derived", describe(frame.naive))}
${cell(authoredPoseOf(asFile(frame.fitted), posed(mpAction, mpContact), radius, build)!, "fitted retarget", describe(frame.fitted))}
</div></div>`;

const style = `body{background:#0a0c10;color:#e5e7eb;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:0;padding:24px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;color:#9aa4b2;font-weight:500;margin:28px 0 8px}
h3{font-size:13px;color:#8b93a1;font-weight:500;margin:18px 0 6px;font-family:ui-monospace,monospace}
figure{margin:0}figcaption{font-family:ui-monospace,monospace;font-size:11px;padding:6px 2px;color:#9aa4b2}
figcaption b{color:#e5e7eb}
.pair,.quad{display:flex;gap:14px;flex-wrap:wrap}
svg{border:1px solid #262b34;border-radius:3px;display:block}
p{color:#9aa4b2;max-width:70ch}`;

mkdirSync(".scratch/pose-library/twist", { recursive: true });
writeFileSync(
  ".scratch/pose-library/twist/punches.html",
  `<!doctype html><meta charset="utf-8"><title>the three punches, before and after the twist</title><style>${style}</style>
<h1>5LP / 5MP / 5HP at their contact frames, before and after ADR-0070</h1>
<p>Left is the file as it shipped under ADR-0067: all three punches thrown with the lead hand, because the rear one could not reach. Right is the same file with a torso twist. Nothing but <code>twist</code> and the two hands changed &mdash; pelvis, chest, head and both feet are the same numbers.</p>
${rows.join("\n")}`,
);
writeFileSync(
  ".scratch/pose-library/twist/retarget.html",
  `<!doctype html><meta charset="utf-8"><title>hand-authored, projected and fitted, with the twist derived</title><style>${style}</style>
<h1>ADR-0069's comparison, redone with the twist derived from the source skeleton</h1>
<p>The fixture's straight punch at its extension peak, projected onto the seven-point figure. Second cell is the same projection with the twist forced back to 0 &mdash; the figure ADR-0069 measured at 1.345 of an arm. Third is the twist the source body is actually in. Fourth is what the fit does to it, which is now nothing.</p>
${two}`,
);
console.log("wrote .scratch/pose-library/twist/{punches,retarget}.html");
console.log(`peak ${peak} twist ${frame.naive.twist!.toFixed(1)} rear reach ${reachOf(frame.naive).hands[1].toFixed(3)} (untwisted ${reachOf(untwisted).hands[1].toFixed(3)})`);
