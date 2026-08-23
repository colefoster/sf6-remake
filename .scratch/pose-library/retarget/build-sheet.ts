/**
 * The contact sheet: one move, three figures.
 *
 * `npx tsx .scratch/pose-library/retarget/build-sheet.ts`
 *
 * Draws the hand-authored 5MP, the naive projection of the punch clip onto the
 * same frame, and the fitted retarget of it — all through the library's own
 * geometry, so what is on screen is what `authoredPoseOf` would draw: the
 * shoulders at `chest.x ± 0.133` and `chest.y − 0.3r`, the hips at
 * `pelvis.x ± 0.072`, and every elbow and knee solved by `jointOf` against the
 * real bone. Nothing is redrawn by hand.
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";

import { actionByName } from "../../../src/data/geometry.js";
import { loadGeometry } from "../../../src/data/load-geometry.js";
import { loadPose } from "../../../src/data/load-poses.js";
import { clockOf, overreach, resolveKeys, sampleAuthored, type AuthoredPose } from "../../../src/game/pose-library.js";
import { buildOf, headRadius, jointOf, type Point } from "../../../src/game/render.js";
import {
  displacement,
  overreachOf,
  planeOf,
  projectPose,
  forwardKinematics,
  extensionPeak,
  retargetClip,
  retargetFrame,
  type SmplxClip,
} from "../../../src/game/retarget.js";

const ARM = 0.37;
const LEG = 0.53 * 1.02;
const SHOULDER_HALF = 0.133;
const PELVIS_HALF = 0.072;
const SHOULDER_DROP = 0.3;
const ELBOW_FOLD = -0.7;
const KNEE_FOLD = 0.9;

const ryu = loadGeometry("ryu")!;
const build = buildOf(ryu);
const R = headRadius(ryu) / build.stature;

/** The seven points as the drawn stick figure, in normalised space. */
function sticks(p: AuthoredPose): { segments: Point[][]; head: { x: number; y: number; r: number } } {
  const neck = p.chest;
  const shoulderY = neck.y - R * SHOULDER_DROP;
  const chainOf = (root: Point, tip: Point, bone: number, fold: number): Point[] => [
    root,
    jointOf(root, tip, bone, fold, -1),
    tip,
  ];
  const segments: Point[][] = [[p.pelvis, neck]];
  for (const i of [0, 1]) {
    const s = i === 0 ? 1 : -1;
    segments.push(
      chainOf({ x: neck.x + s * SHOULDER_HALF, y: shoulderY }, p.hands[i]!, ARM, ELBOW_FOLD),
      chainOf({ x: p.pelvis.x + s * PELVIS_HALF, y: p.pelvis.y }, p.feet[i]!, LEG, KNEE_FOLD),
    );
  }
  segments.push([
    { x: neck.x - SHOULDER_HALF, y: shoulderY },
    { x: neck.x + SHOULDER_HALF, y: shoulderY },
  ]);
  return { segments, head: { x: p.head.x, y: p.head.y, r: R } };
}

const clip: SmplxClip = JSON.parse(readFileSync("tests/fixtures/smplx-straight-punch.json", "utf8"));
const action = actionByName(ryu, "ATK_5MP")!;
const clock = clockOf(action);
const plane = planeOf(clip);
const peak = extensionPeak(clip, plane);

const authored = sampleAuthored(resolveKeys(loadPose("ryu", "5MP")!, action).keys, clock.contact!)!;
const frame = retargetFrame(clip, peak, plane);
const naive = frame.naive;
const fitted = frame.fitted;

const report = retargetClip(clip, action, { character: "ryu", move: "5MP-retargeted" });
writeFileSync(".scratch/pose-library/retarget/5MP-retargeted.json", `${JSON.stringify(report.file, null, 2)}\n`);

const panels = [
  {
    title: "hand-authored",
    sub: `data/poses/ryu/5MP.json, contact frame ${clock.contact}`,
    pose: authored,
    over: overreachOf(authored),
    note: "The eleven shipped files. Authored inside the gate by eye.",
  },
  {
    title: "naive projection",
    sub: `smplx-straight-punch clip frame ${peak}, joints copied straight in`,
    pose: naive,
    over: overreachOf(naive),
    note: "Every point is the SMPL-X joint's, projected onto the fight plane. The rear arm asks for 1.34 of itself.",
  },
  {
    title: "fitted retarget",
    sub: `same clip frame, sunk ${frame.fit.sink.toFixed(3)} and clipped to 0.94`,
    pose: fitted,
    over: overreachOf(fitted),
    note: "Same line from the shoulder, shortened to the bone. The punch survives; its reach does not.",
  },
];

/* ---- svg ----------------------------------------------------------------- */

const W = 340;
const H = 380;
const PAD = 26;
const SCALE = (H - 2 * PAD) / 1.05;
// The axis sits left of centre: a strike reaches forward and would crop out.
const X = (x: number): number => W * 0.33 + x * SCALE;
const Y = (y: number): number => H - PAD - y * SCALE;
const f3 = (v: number): string => v.toFixed(3);

const svgOf = (p: AuthoredPose, over: number): string => {
  const { segments, head } = sticks(p);
  const bad = over >= 0.95;
  const stroke = bad ? "#e0603a" : "#3aa0e0";
  const lines = segments
    .map(
      (seg) =>
        `<polyline points="${seg.map((q) => `${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join(" ")}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  const dots = [p.hands[0], p.hands[1], p.feet[0], p.feet[1]]
    .map((q) => `<circle cx="${X(q.x).toFixed(1)}" cy="${Y(q.y).toFixed(1)}" r="3.5" fill="${stroke}"/>`)
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="var(--panel)"/>
  <line x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(0)}" stroke="var(--rule)" stroke-width="1"/>
  <line x1="${X(0)}" y1="0" x2="${X(0)}" y2="${H}" stroke="var(--rule)" stroke-width="1" stroke-dasharray="3 4"/>
  ${lines}
  <circle cx="${X(head.x).toFixed(1)}" cy="${Y(head.y).toFixed(1)}" r="${(head.r * SCALE).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="4"/>
  ${dots}
</svg>`;
};

const move = displacement(naive, fitted);
const rows = Object.entries(move)
  .map(([k, v]) => `<tr><td>${k}</td><td class="n">${f3(v)}</td><td class="n">${(v * 166).toFixed(1)}</td></tr>`)
  .join("");

const keyRows = report.keys
  .map(
    (k) =>
      `<tr><td>${typeof k.at === "string" ? k.at : k.at.join(" ")}</td><td class="n">${k.frame}</td><td class="n">${k.source}</td><td class="n">${f3(k.before)}</td><td class="n">${f3(k.after)}</td><td class="n">${f3(k.sink)}</td></tr>`,
  )
  .join("");

const html = `<!doctype html>
<meta charset="utf-8"><title>retarget contact sheet — ryu 5MP</title>
<style>
  :root { --bg:#14161a; --panel:#1c1f25; --rule:#3a4048; --ink:#dfe3e8; --dim:#8b939c; }
  body { margin:0; padding:32px; background:var(--bg); color:var(--ink);
         font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size:18px; margin:0 0 4px; font-weight:600; }
  .lede { color:var(--dim); margin:0 0 28px; max-width:70ch; }
  .row { display:flex; gap:20px; flex-wrap:wrap; }
  .cell { width:${W}px; }
  .cell h2 { font-size:14px; margin:0 0 2px; font-weight:600; }
  .cell .sub, .cell .note { color:var(--dim); font-size:12px; margin:0 0 8px; }
  .cell .sub { min-height:3em; }
  .cell .note { margin:8px 0 0; min-height:3em; }
  .over { font-size:13px; }
  .over b { font-weight:600; }
  .pass { color:#5fbf7f; } .fail { color:#e0603a; }
  table { border-collapse:collapse; margin:28px 0 0; font-size:13px; }
  th, td { text-align:left; padding:3px 16px 3px 0; border-bottom:1px solid var(--rule); }
  th { color:var(--dim); font-weight:600; }
  td.n { text-align:right; font-variant-numeric:tabular-nums; }
  h3 { font-size:14px; margin:32px 0 0; }
</style>
<h1>ryu 5MP — hand-authored, naive projection, fitted retarget</h1>
<p class="lede">One frame: <code>ATK_5MP</code> frame ${clock.contact}, the first active frame. The clip is
<code>smplx-straight-punch</code>, a rear-hand cross from a bladed stance at 1.723&nbsp;m. The gate is
<code>overreach &lt; 0.95</code>.</p>
<div class="row">
${panels
  .map(
    (p) => `<div class="cell">
  <h2>${p.title}</h2>
  <p class="sub">${p.sub}</p>
  ${svgOf(p.pose, p.over)}
  <p class="over">overreach <b class="${p.over < 0.95 ? "pass" : "fail"}">${f3(p.over)}</b></p>
  <p class="note">${p.note}</p>
</div>`,
  )
  .join("\n")}
</div>
<h3>what the fit cost, naive &rarr; fitted</h3>
<table><tr><th>point</th><th>stature</th><th>Ryu units</th></tr>${rows}</table>
<h3>the whole clip, resampled onto ATK_5MP's own clock</h3>
<table><tr><th>anchor</th><th>action f</th><th>clip f</th><th>before</th><th>after</th><th>sink</th></tr>${keyRows}</table>
`;

writeFileSync(".scratch/pose-library/retarget/index.html", html);
console.log("wrote .scratch/pose-library/retarget/index.html");
console.log("authored", f3(overreachOf(authored)), "naive", f3(overreachOf(naive)), "fitted", f3(overreachOf(fitted)));
console.log("file overreach", f3(overreach(resolveKeys(report.file, action).keys)));
