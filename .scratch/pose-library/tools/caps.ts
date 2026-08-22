import { actionByName } from "../../../src/data/geometry.js";
import { loadGeometry } from "../../../src/data/load-geometry.js";
import { authoredMoves, loadPose } from "../../../src/data/load-poses.js";
import { authoredPoseOf, clockOf } from "../../../src/game/pose-library.js";
import { buildOf, headRadius, type Posed } from "../../../src/game/render.js";

const ryu = loadGeometry("ryu")!;
const build = buildOf(ryu);
const bone = (l: { root: { x: number; y: number }; joint: { x: number; y: number }; tip: { x: number; y: number } }) =>
  Math.hypot(l.joint.x - l.root.x, l.joint.y - l.root.y) + Math.hypot(l.tip.x - l.joint.x, l.tip.y - l.joint.y);
const ARMB = 0.37 * build.stature * build.arm;
const LEGB = 0.53 * 1.02 * build.stature * build.leg;

for (const move of authoredMoves("ryu")) {
  const file = loadPose("ryu", move)!;
  const action = actionByName(ryu, file.action)!;
  const clock = clockOf(action);
  const last = Math.max(...file.keys.map((k) => (k.at === "activeEnd" ? (clock.activeEnd ?? 1) : 0)), clock.neutral ?? 1);
  let armMin = Infinity, armMax = 0, legMin = Infinity, legMax = 0;
  for (let f = 1; f <= last; f++) {
    const posed: Posed = { state: { action, frame: f, facing: 1 }, position: () => ({ x: 0, y: 0 }) };
    const pose = authoredPoseOf(file, posed, headRadius(ryu), build)!;
    for (const a of pose.arms) ((armMin = Math.min(armMin, bone(a))), (armMax = Math.max(armMax, bone(a))));
    for (const l of pose.legs) ((legMin = Math.min(legMin, bone(l))), (legMax = Math.max(legMax, bone(l))));
  }
  console.log(
    `${move.padEnd(6)} arm ${armMin.toFixed(1)}-${armMax.toFixed(1)} /${ARMB.toFixed(1)}   leg ${legMin.toFixed(1)}-${legMax.toFixed(1)} /${LEGB.toFixed(1)}`,
  );
}
