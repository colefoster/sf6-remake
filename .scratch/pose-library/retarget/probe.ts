/** Measuring the fixtures and the fit. `npx tsx .scratch/pose-library/retarget/probe.ts` */
import { readFileSync } from "node:fs";

import { actionByName } from "../../../src/data/geometry.js";
import { loadGeometry } from "../../../src/data/load-geometry.js";
import { loadPose } from "../../../src/data/load-poses.js";
import { overreach, resolveKeys } from "../../../src/game/pose-library.js";
import {
  extensionPeak,
  planeOf,
  projectPose,
  forwardKinematics,
  retargetClip,
  retargetFrame,
  overreachOf,
  reachOf,
  type SmplxClip,
} from "../../../src/game/retarget.js";

const load = (n: string): SmplxClip => JSON.parse(readFileSync(`tests/fixtures/smplx-${n}.json`, "utf8"));
const f3 = (v: number): string => v.toFixed(3);

const ryu = loadGeometry("ryu")!;

for (const name of ["straight-punch", "roundhouse-kick", "low-sweep", "lanky-punch"]) {
  const clip = load(name);
  const plane = planeOf(clip);
  console.log(`\n=== ${name}  ${clip.frames.length}f @${clip.fps}  stature ${f3(plane.stature)}m  lead ${plane.leadIsLeft ? "left" : "right"}`);
  const peak = extensionPeak(clip, plane);
  console.log(`peak frame ${peak}`);
  const p = projectPose(forwardKinematics(clip, peak), plane).pose;
  console.log(
    "peak naive:",
    JSON.stringify({
      pelvis: [f3(p.pelvis.x), f3(p.pelvis.y)],
      chest: [f3(p.chest.x), f3(p.chest.y)],
      head: [f3(p.head.x), f3(p.head.y)],
      hands: p.hands.map((h) => [f3(h.x), f3(h.y)]),
      feet: p.feet.map((h) => [f3(h.x), f3(h.y)]),
    }),
  );
  const r = reachOf(p);
  console.log("peak reach:", { hands: r.hands.map(f3), feet: r.feet.map(f3) }, "over", f3(overreachOf(p)));
  const fr = retargetFrame(clip, peak, plane);
  console.log("fitted over", f3(fr.fit.after), "sink", f3(fr.fit.sink), "moved", Object.fromEntries(Object.entries(fr.moved).map(([k, v]) => [k, f3(v)])));

  // frame 0 sanity — should look like a guard
  const g = projectPose(forwardKinematics(clip, 0), plane).pose;
  console.log("f0 naive:", JSON.stringify({ pelvis: [f3(g.pelvis.x), f3(g.pelvis.y)], chest: [f3(g.chest.x), f3(g.chest.y)], head: [f3(g.head.x), f3(g.head.y)], hands: g.hands.map((h) => [f3(h.x), f3(h.y)]), feet: g.feet.map((h) => [f3(h.x), f3(h.y)]) }), "over", f3(overreachOf(g)));
}

console.log("\n=== bound to actions");
const jobs: [string, string, string][] = [
  ["straight-punch", "5MP", "ATK_5MP"],
  ["roundhouse-kick", "5HK", "ATK_5HK"],
  ["low-sweep", "2HK", "ATK_2HK"],
  ["lanky-punch", "5HP", "ATK_5HP"],
];
for (const [clipName, move, actionName] of jobs) {
  const action = actionByName(ryu, actionName)!;
  const report = retargetClip(load(clipName), action, { character: "ryu", move });
  const bound = resolveKeys(report.file, action);
  console.log(
    `\n${clipName} -> ${actionName}  peak ${report.peak}  keys ${report.file.keys.length}  problems ${JSON.stringify(bound.problems)}  overreach ${f3(overreach(bound.keys))}`,
  );
  for (const k of report.keys)
    console.log(
      `  ${String(typeof k.at === "string" ? k.at : k.at.join(" ")).padEnd(12)} f${String(k.frame).padStart(2)} <- clip ${String(k.source).padStart(2)}  before ${f3(k.before)} after ${f3(k.after)} sink ${f3(k.sink)}  moved ${Object.entries(k.moved).filter(([, v]) => v > 0.0005).map(([n, v]) => `${n} ${f3(v)}`).join(" ") || "-"}`,
    );
  if (report.skipped.length) console.log("  skipped:", report.skipped);
  const hand = loadPose("ryu", move);
  if (hand) console.log(`  hand-authored ${move} overreach ${f3(overreach(resolveKeys(hand, action).keys))}`);
}
