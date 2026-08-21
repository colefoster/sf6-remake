/** Scratch: the figure's proportions and its honesty cage, per fighter. */
import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { buildOf, headRadius, poseOf, type Pose } from "../../src/game/render.js";
import { hurtPartsAt } from "../../src/data/geometry.js";
import type { Fighter } from "../../src/game/index.js";

const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

let outside = 0, frames = 0, worst = 0, worstAt = "";
const rows: string[] = [];
for (const entry of listCharacters() as unknown[]) {
  const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(id);
  if (!geo) continue;
  const radius = headRadius(geo);
  const build = buildOf(geo);
  const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction) ?? geo.actions[0]!;
  const p = poseOf(stub(stand, 1), radius, undefined, build);
  const foot = p.legs[0]!.tip;
  const stature = (p.head?.y ?? p.neck.y) + radius - foot.y;
  const shoulder = Math.abs(p.arms[1]!.root.x - p.arms[0]!.root.x);
  const armSeg = (l: Pose["arms"][number]) =>
    Math.hypot(l.joint.x - l.root.x, l.joint.y - l.root.y) + Math.hypot(l.tip.x - l.joint.x, l.tip.y - l.joint.y);
  rows.push(
    [id, stature.toFixed(0), (((p.hips.y - foot.y) / stature) * 100).toFixed(1),
     (shoulder / (radius * 2)).toFixed(2),
     (Math.abs(p.legs[1]!.tip.x - p.legs[0]!.tip.x)).toFixed(0),
     armSeg(p.arms[0]!).toFixed(0),
     (armSeg(p.arms[0]!) / (p.hips.y - foot.y)).toFixed(2)].join("\t"),
  );

  // How far an invented extremity strays outside every live hurtbox.
  for (const action of geo.actions) {
    if (!action.hurt.length) continue;
    const end = Math.min(60, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    let last: Pose = p;
    for (let f = 1; f <= end; f++) {
      const q = poseOf(stub(action, f), radius, last, build);
      const parts = hurtPartsAt(action, f);
      const live = [...parts.head, ...parts.body, ...parts.leg];
      if (live.length) {
        const lo = Math.min(...live.map((b) => b.x));
        const hi = Math.max(...live.map((b) => b.x + b.width));
        for (const l of [...q.arms, ...q.legs].filter((x) => !x.derived)) {
          frames++;
          const over = Math.max(lo - l.tip.x, l.tip.x - hi, 0);
          if (over > 0.5) {
            outside++;
            if (over > worst) { worst = over; worstAt = `${id} ${action.name} f${f}`; }
          }
        }
      }
      last = q;
    }
  }
}
console.log("id\tstature\thip%\tshoulder/head\tstance\tarmSeg\tarm/leg");
console.log(rows.join("\n"));
console.log(`\ninvented extremities outside every hurtbox: ${outside} of ${frames} (${((outside / frames) * 100).toFixed(1)}%), worst ${worst.toFixed(0)}u at ${worstAt}`);
