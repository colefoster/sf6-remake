import { loadGeometry } from "../../src/data/load-geometry.js";
import { buildOf, headRadius, poseOf, type Pose } from "../../src/game/render.js";
import { hurtPartsAt } from "../../src/data/geometry.js";
import type { Fighter } from "../../src/game/index.js";

const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

const id = process.argv[2] ?? "ryu";
const want = process.argv[3] ?? "BAS_JUMP_N_AIR";
const geo = loadGeometry(id)!;
const radius = headRadius(geo);
const build = buildOf(geo);
const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction) ?? geo.actions[0]!;
const idle = poseOf(stub(stand, 1), radius, undefined, build);
const act = geo.actions.find((a) => a.name === want)!;
const A = act as unknown as Record<string, unknown>;
console.log("action", act.name, "id", act.id, "frames", A.frames, "lands", A.lands, "stance", JSON.stringify(A.stance));
console.log("motion", JSON.stringify({ travel: act.motion?.travel, vel: act.motion?.velocity, yLen: act.motion?.y?.length }));
const arc = act.motion?.y;
if (arc) {
  const peak = Math.max(...arc);
  console.log("arc peak", peak.toFixed(1), "at f", arc.indexOf(peak), "of", arc.length, "last", arc.at(-1)!.toFixed(1));
}
const end = Math.min(80, Math.max(...act.hurt.map((h) => h.end ?? h.start ?? 1)));
let last: Pose = idle;
const fmt = (pt: { x: number; y: number }): string => `(${pt.x.toFixed(0)},${pt.y.toFixed(0)})`;
for (let f = 1; f <= end; f++) {
  const p = poseOf(stub(act, f), radius, last, build);
  const parts = hurtPartsAt(act, f);
  const l = p.legs;
  const a = p.arms;
  if (f % 4 === 1 || f === end)
    console.log(
      `f${String(f).padStart(2)} box=h${parts.head.length}/b${parts.body.length}/l${parts.leg.length}`,
      `hips=${p.hips.y.toFixed(0)} neck=${p.neck.y.toFixed(0)} head=${(p.head?.y ?? NaN).toFixed(0)}`,
      `L0 r${fmt(l[0]!.root)} k${fmt(l[0]!.joint)} t${fmt(l[0]!.tip)}`,
      `L1 k${fmt(l[1]!.joint)} t${fmt(l[1]!.tip)}`,
      `sep=${Math.abs(l[0]!.tip.x - l[1]!.tip.x).toFixed(1)}`,
      `dy=${(l[0]!.tip.y - l[1]!.tip.y).toFixed(1)}`,
      `arm ${fmt(a[0]!.tip)}${fmt(a[1]!.tip)}`,
      `fade=${p.faded.head ? "H" : "-"}${p.faded.body ? "B" : "-"}${p.faded.leg ? "L" : "-"}`,
      `arc=${(arc?.[f] ?? 0).toFixed(0)}`,
    );
  last = p;
}
