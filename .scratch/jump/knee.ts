import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { buildOf, headRadius, poseOf, type Pose } from "../../src/game/render.js";
import { hurtPartsAt, originAt, stanceAt } from "../../src/data/geometry.js";
import type { Fighter } from "../../src/game/index.js";

const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

let knees = 0;
let pinned = 0;
let overshoot: number[] = [];
for (const entry of listCharacters() as unknown[]) {
  const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(id);
  if (!geo) continue;
  const radius = headRadius(geo);
  const build = buildOf(geo);
  const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction) ?? geo.actions[0]!;
  const idle = poseOf(stub(stand, 1), radius, undefined, build);
  for (const action of geo.actions) {
    if (!action.hurt.length) continue;
    const end = Math.min(60, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    let last: Pose = idle;
    for (let f = 1; f <= end; f++) {
      const p = poseOf(stub(action, f), radius, last, build);
      const parts = hurtPartsAt(action, f);
      const o = originAt(action, f).y;
      const one = !parts.head.length && !parts.leg.length && parts.body.length > 0;
      if (one) {
        const lo = Math.min(...parts.body.map((b) => b.x));
        const hi = Math.max(...parts.body.map((b) => b.x + b.width));
        for (const l of p.legs.filter((q) => !q.derived)) {
          knees++;
          if (Math.abs(l.joint.x - lo) < 0.6 || Math.abs(l.joint.x - hi) < 0.6) pinned++;
        }
      }
      void o;
      void stanceAt;
      last = p;
    }
  }
}
console.log("invented airborne knees:", knees, " sitting on the cage edge:", pinned, `${((pinned / knees) * 100).toFixed(0)}%`);
void overshoot;
