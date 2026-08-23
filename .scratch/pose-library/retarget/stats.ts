/** Numbers for the ADR. `npx tsx .scratch/pose-library/retarget/stats.ts` */
import { readFileSync } from "node:fs";

import { extensionPeak, planeOf, retargetFrame, type SmplxClip } from "../../../src/game/retarget.js";

const f3 = (v: number): string => v.toFixed(3);
const names = ["straight-punch", "roundhouse-kick", "low-sweep", "lanky-punch"];
const worst: Record<string, number> = {};
let frames = 0;
let needed = 0;
let worstBefore = 0;

console.log("| clip | frames | stature | peak | naive p50 | naive max | fitted max | worst point moved |");
console.log("|---|---|---|---|---|---|---|---|");
for (const name of names) {
  const clip: SmplxClip = JSON.parse(readFileSync(`tests/fixtures/smplx-${name}.json`, "utf8"));
  const plane = planeOf(clip);
  const befores: number[] = [];
  let after = 0;
  let big = ["", 0] as [string, number];
  for (let f = 0; f < clip.frames.length; f++) {
    const r = retargetFrame(clip, f, plane);
    befores.push(r.fit.before);
    after = Math.max(after, r.fit.after);
    frames++;
    if (r.fit.before > 0.94) needed++;
    worstBefore = Math.max(worstBefore, r.fit.before);
    for (const [k, v] of Object.entries(r.moved)) {
      worst[k] = Math.max(worst[k] ?? 0, v);
      if (v > big[1]) big = [k, v];
    }
  }
  befores.sort((a, b) => a - b);
  console.log(
    `| \`${name}\` | ${clip.frames.length} | ${f3(plane.stature)} m | ${extensionPeak(clip, plane)} | ${f3(befores[Math.floor(befores.length / 2)]!)} | ${f3(befores[befores.length - 1]!)} | ${f3(after)} | ${big[0]} ${f3(big[1])} |`,
  );
}
console.log(`\nframes ${frames}, needing the fit ${needed} (${((needed / frames) * 100).toFixed(0)}%), worst naive ${f3(worstBefore)}`);
console.log("\n| point | worst displacement, stature | Ryu units (166) |");
console.log("|---|---|---|");
for (const [k, v] of Object.entries(worst)) console.log(`| ${k} | ${f3(v)} | ${(v * 166).toFixed(1)} |`);
