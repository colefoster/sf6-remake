import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { buildOf, headRadius, poseOf, type Pose } from "../../src/game/render.js";
import type { Fighter } from "../../src/game/index.js";

const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

const hits = new Map<string, { n: number; eg: string }>();
for (const entry of listCharacters() as unknown[]) {
  const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(id);
  if (!geo) continue;
  const radius = headRadius(geo);
  const build = buildOf(geo);
  const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction) ?? geo.actions[0]!;
  const idle = poseOf(stub(stand, 1), radius, undefined, build);
  const idleSpine = idle.neck.y - idle.hips.y;
  for (const action of geo.actions) {
    if (!action.hurt.length) continue;
    const end = Math.min(80, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    let last: Pose = idle;
    for (let f = 1; f <= end; f++) {
      const p = poseOf(stub(action, f), radius, last, build);
      const spine = p.neck.y - p.hips.y;
      if (spine > 0 && spine < idleSpine * 0.35) {
        const k = `${id} ${action.name}`;
        const cur = hits.get(k) ?? { n: 0, eg: `f${f} spine=${spine.toFixed(0)} idle=${idleSpine.toFixed(0)}` };
        cur.n++;
        hits.set(k, cur);
      }
      last = p;
    }
  }
}
for (const [k, v] of [...hits].sort((a, b) => b[1].n - a[1].n)) console.log(String(v.n).padStart(5), k, v.eg);
