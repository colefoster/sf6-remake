/** What a pelvis twist would cost, measured before deciding not to have one. */
import { readFileSync } from "node:fs";
import { loadPose, authoredMoves } from "../../../src/data/load-poses.js";
import { forwardKinematics, planeOf, projectPose, type SmplxClip } from "../../../src/game/retarget.js";

const LEG = 0.53 * 1.02;
const ARM = 0.37;
const PELVIS_HALF = 0.072;

const clips: SmplxClip[] = ["straight-punch", "roundhouse-kick", "low-sweep", "lanky-punch"].map(
  (n) => JSON.parse(readFileSync(`tests/fixtures/smplx-${n}.json`, "utf8")) as SmplxClip,
);

console.log("## fixtures: leg reach with the hip line welded vs turned");
console.log("| clip | welded max | turned max | worst frame |");
console.log("|---|---|---|---|");
for (const clip of clips) {
  const plane = planeOf(clip);
  let weld = 0;
  let turn = 0;
  let at = "";
  for (let i = 0; i < clip.frames.length; i++) {
    const joints = forwardKinematics(clip, i);
    const t = plane.travel[i] ?? 0;
    const fwd = (j: number) =>
      ((joints[j]![0] - plane.origin[0]) * plane.forward[0] + (joints[j]![2] - plane.origin[1]) * plane.forward[1]) /
        plane.stature -
      t;
    const lat = (j: number) =>
      ((joints[j]![0] - plane.origin[0]) * plane.left[0] + (joints[j]![2] - plane.origin[1]) * plane.left[1]) /
      plane.stature;
    const [leadHip, rearHip] = plane.leadIsLeft ? [1, 2] : [2, 1];
    const az = Math.atan2(Math.abs(lat(leadHip) - lat(rearHip)), fwd(leadHip) - fwd(rearHip));
    const half = PELVIS_HALF * Math.cos(az);
    const p = projectPose(joints, plane, { travel: t }).pose;
    const span = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    for (const k of [0, 1] as const) {
      const s = k === 0 ? 1 : -1;
      const w = span({ x: p.pelvis.x + s * PELVIS_HALF, y: p.pelvis.y }, p.feet[k]) / LEG;
      const u = span({ x: p.pelvis.x + s * half, y: p.pelvis.y }, p.feet[k]) / LEG;
      if (u > turn) at = `f${i} leg${k} az=${((az * 180) / Math.PI).toFixed(0)}deg half=${half.toFixed(3)}`;
      weld = Math.max(weld, w);
      turn = Math.max(turn, u);
    }
  }
  console.log(`| ${clip.name} | ${weld.toFixed(3)} | ${turn.toFixed(3)} | ${at} |`);
}

console.log("\n## the eleven: what a hip half of 0.034 (the fixtures' widest) would do");
console.log("| move | leg reach welded | leg reach at 0.034 |");
console.log("|---|---|---|");
for (const move of authoredMoves("ryu")) {
  const file = loadPose("ryu", move)!;
  let weld = 0;
  let turn = 0;
  for (const k of file.keys) {
    const p = k.pose;
    for (const i of [0, 1] as const) {
      const s = i === 0 ? 1 : -1;
      const f = p.feet[i]!;
      weld = Math.max(weld, Math.hypot(p.pelvis.x + s * PELVIS_HALF - f.x, p.pelvis.y - f.y) / LEG);
      turn = Math.max(turn, Math.hypot(p.pelvis.x + s * 0.034 - f.x, p.pelvis.y - f.y) / LEG);
    }
  }
  console.log(`| ${move} | ${weld.toFixed(3)} | ${turn.toFixed(3)} |`);
}
void ARM;
