/**
 * Every derived limb point in the roster, one line per (fighter, action, frame).
 *
 * Written before and after a change to `poseOf` so the two can be diffed: a line
 * that moves is a frame where geometry the boxes placed came out differently.
 * usage: npx tsx .scratch/knockdown/derived.ts > /tmp/before.txt
 */
import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { buildOf, headRadius, poseOf, type Pose, type Limb } from "../../src/game/render.js";
import type { Fighter } from "../../src/game/index.js";

const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

const pt = (p: { x: number; y: number }): string => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
const out: string[] = [];
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
    const end = Math.min(80, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    let last: Pose = idle;
    for (let f = 1; f <= end; f++) {
      const p = poseOf(stub(action, f), radius, last, build);
      const derived: Limb[] = [...p.arms, ...p.legs, ...p.limbs].filter((l) => l.derived);
      if (derived.length)
        out.push(`${id}|${action.name}|${f}|` + derived.map((l) => `${pt(l.root)};${pt(l.joint)};${pt(l.tip)}`).join(" "));
      last = p;
    }
  }
}
console.log(out.join("\n"));
console.error(`${out.length} frames carry a derived limb`);
