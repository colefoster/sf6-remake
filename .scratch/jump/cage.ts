/** ADR-0060's cage measurement, repeated: every *invented* hand, elbow, knee and
 * foot against the horizontal span of every live hurtbox that frame. Adds the
 * vertical test ADR-0063 needed, since the airborne fault was a foot below the
 * only box and a skull above it. */
import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { buildOf, headRadius, poseOf, type Pose } from "../../src/game/render.js";
import { hurtPartsAt, originAt } from "../../src/data/geometry.js";
import type { Fighter } from "../../src/game/index.js";

const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

let limbFrames = 0;
let outX = 0;
let worstX = 0;
let worstXAt = "";
let outY = 0;
let worstY = 0;
let worstYAt = "";
let headFaded = 0;
let headFramesNoKey = 0;
let headCovered = 0;

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
      const o = originAt(action, f);
      const parts = hurtPartsAt(action, f);
      const live = [...parts.head, ...parts.body, ...parts.leg];
      const at = `${id} ${action.name} f${f}`;
      if (!parts.head.length) {
        headFramesNoKey++;
        if (p.faded.head) headFaded++;
        else headCovered++;
      }
      if (live.length) {
        const lo = Math.min(...live.map((b) => b.x));
        const hi = Math.max(...live.map((b) => b.x + b.width));
        const bot = Math.min(...live.map((b) => b.y + o.y));
        const top = Math.max(...live.map((b) => b.y + b.height + o.y));
        for (const l of [...p.arms, ...p.legs].filter((q) => !q.derived))
          for (const pt of [l.tip, l.joint]) {
            limbFrames++;
            const dx = Math.max(lo - pt.x, pt.x - hi, 0);
            const dy = Math.max(bot - pt.y, pt.y - top, 0);
            if (dx > 0.5) {
              outX++;
              if (dx > worstX) {
                worstX = dx;
                worstXAt = at;
              }
            }
            if (dy > 0.5) {
              outY++;
              if (dy > worstY) {
                worstY = dy;
                worstYAt = at;
              }
            }
          }
      }
      last = p;
    }
  }
}
console.log("invented extremity/joint points tested:", limbFrames);
console.log("outside every hurtbox horizontally:", outX, "worst", worstX.toFixed(0), worstXAt);
console.log("outside every hurtbox vertically  :", outY, "worst", worstY.toFixed(0), worstYAt);
console.log("frames with no head key:", headFramesNoKey, " head faded:", headFaded, " covered:", headCovered);
