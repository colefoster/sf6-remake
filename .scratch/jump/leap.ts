import { loadGeometry } from "../../src/data/load-geometry.js";
import { headRadius, poseOf, type Pose } from "../../src/game/render.js";
import { hurtPartsAt, originAt } from "../../src/data/geometry.js";
import type { Fighter } from "../../src/game/index.js";

const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;
const geo = loadGeometry("ryu")!;
const radius = headRadius(geo);
const named = (n: string) => geo.actions.find((a) => a.name === n)!;
const air = named("BAS_JUMP_N_AIR");
let p: Pose = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
console.log("| f | crown | skull | neck | hips | feet | sep | dy | box | out |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (let f = 1; f <= 40; f++) {
  p = poseOf(stub(air, f), radius, p);
  if (f % 4 !== 1 && f !== 40 && f !== 21) continue;
  const o = originAt(air, f).y;
  const b = hurtPartsAt(air, f).body[0]!;
  const lo = b.y + o;
  const hi = b.y + b.height + o;
  const pts = [p.head!.y + p.head!.r, p.head!.y - p.head!.r, p.neck.y, p.hips.y, ...p.legs.map((l) => l.tip.y)];
  const out = Math.max(0, ...pts.map((y) => Math.max(lo - y, y - hi)));
  console.log(
    `| ${f} | ${(p.head!.y + p.head!.r).toFixed(0)} | ${p.head!.y.toFixed(0)} | ${p.neck.y.toFixed(0)} | ${p.hips.y.toFixed(0)} | ${p.legs.map((l) => l.tip.y.toFixed(0)).join(" / ")} | ${Math.abs(p.legs[1]!.tip.x - p.legs[0]!.tip.x).toFixed(1)} | ${(p.legs[1]!.tip.y - p.legs[0]!.tip.y).toFixed(1)} | ${lo.toFixed(0)}–${hi.toFixed(0)} | ${out.toFixed(0)} |`,
  );
}
