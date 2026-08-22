import { actionById } from "../../../src/data/geometry.js";
import { loadGeometry } from "../../../src/data/load-geometry.js";
import { buildOf, headRadius, poseOf, type Posed } from "../../../src/game/render.js";

const geo = loadGeometry("ryu")!;
const build = buildOf(geo);
const idle = actionById(geo, geo.calibration!.standAction!)!;
const posed = (frame: number): Posed => ({
  state: { action: idle, frame, facing: 1 },
  position: () => ({ x: 0, y: 0 }),
});
let pose = poseOf(posed(1), headRadius(geo), undefined, build);
for (let f = 1; f <= 8; f++) pose = poseOf(posed(f), headRadius(geo), pose, build);
const S = build.stature;
const n = (p: { x: number; y: number }) => ({
  x: +((p.x - pose.footprint) / S).toFixed(4),
  y: +(p.y / S).toFixed(4),
});
console.log("action", idle.name, "stature", S, "radius", headRadius(geo), "build", build);
console.log("footprint", pose.footprint, "frames", idle.frames);
console.log("pelvis", n(pose.hips));
console.log("chest ", n(pose.neck));
console.log("head  ", n(pose.head!));
console.log("hand lead", n(pose.arms[1]!.tip), "rear", n(pose.arms[0]!.tip));
console.log("foot lead", n(pose.legs[1]!.tip), "rear", n(pose.legs[0]!.tip));
console.log("shoulder lead", n(pose.arms[1]!.root), "rear", n(pose.arms[0]!.root));
console.log("hip lead", n(pose.legs[1]!.root), "rear", n(pose.legs[0]!.root));
