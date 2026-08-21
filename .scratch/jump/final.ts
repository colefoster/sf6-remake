import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { hurtPartsAt, pushboxesAt, stanceAt } from "../../src/data/geometry.js";

type B = { x: number; y: number; width: number; height: number };
let total = 0;
let solo = 0;
let soloTall = 0;
let soloTallAir = 0;
const tallActions = new Set<string>();
const tallGroundedActions = new Set<string>();
let tallGroundedFrames = 0;

for (const entry of listCharacters() as unknown[]) {
  const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(id);
  if (!geo) continue;
  for (const action of geo.actions) {
    if (!action.hurt.length) continue;
    const end = Math.min(80, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    const arc = action.motion?.y;
    let everAir = Boolean(arc && Math.max(...arc) > 17);
    for (let f = 1; f <= end; f++) if (stanceAt(action, f) === 3) everAir = true;
    for (let f = 1; f <= end; f++) {
      total++;
      const p = hurtPartsAt(action, f);
      if (p.head.length || p.leg.length || !p.body.length) continue;
      solo++;
      // the core filter, as `poseOf` applies it
      const push = pushboxesAt(action, f);
      const core: B[] = push.length
        ? (() => {
            const lo = Math.min(...push.map((b) => b.x));
            const hi = Math.max(...push.map((b) => b.x + b.width));
            const mid = (lo + hi) / 2;
            const tol = ((hi - lo) / 2) * 0.6;
            return p.body.filter((b) => Math.abs(b.x + b.width / 2 - mid) < tol);
          })()
        : p.body;
      if (!core.length) continue;
      const x0 = Math.min(...core.map((b) => b.x));
      const x1 = Math.max(...core.map((b) => b.x + b.width));
      const y0 = Math.min(...core.map((b) => b.y));
      const y1 = Math.max(...core.map((b) => b.y + b.height));
      if (y1 - y0 <= x1 - x0) continue;
      soloTall++;
      const air = stanceAt(action, f) === 3 || everAir;
      if (air) soloTallAir++;
      else {
        tallGroundedActions.add(`${id} ${action.name}`);
        tallGroundedFrames++;
      }
      tallActions.add(`${id} ${action.name}`);
    }
  }
}
console.log("frames", total);
console.log("body is the only hurt key:", solo, (((solo / total) * 100).toFixed(1)) + "%");
console.log("  and the box is taller than wide (`whole` fires):", soloTall, (((soloTall / total) * 100).toFixed(1)) + "%");
console.log("  of those, the action leaves the ground:", soloTallAir, (((soloTallAir / soloTall) * 100).toFixed(1)) + "%");
console.log("actions:", tallActions.size, " never-airborne actions:", tallGroundedActions.size, "frames", tallGroundedFrames);
console.log([...tallGroundedActions].slice(0, 12).join(" | "));
