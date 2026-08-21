import { loadGeometry } from "../../src/data/load-geometry.js";
import { headRadius, poseOf, type Pose } from "../../src/game/render.js";
import type { Fighter } from "../../src/game/index.js";

const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;
const geo = loadGeometry("ryu")!;
const radius = headRadius(geo);
const named = (n: string) => geo.actions.find((a) => a.name === n)!;
const show = (tag: string, p: Pose): void =>
  console.log(
    tag,
    "faded", JSON.stringify(p.faded),
    "hips", p.hips.y.toFixed(2),
    "neck", p.neck.y.toFixed(2),
    "head", p.head?.y.toFixed(2),
    "stand", p.stand.toFixed(3),
    "legs", p.legs.map((l) => `(${l.tip.x.toFixed(2)},${l.tip.y.toFixed(2)})`).join(""),
    "sum", (p.legs[0]!.tip.x + p.legs[1]!.tip.x).toFixed(2),
  );

const rising = named("SPA_SYORYU_START(2)");
const before = poseOf(stub(rising, 8), radius);
const during = poseOf(stub(rising, 14), radius, before);
show("shoryu f8 ", before);
show("shoryu f14", during);

const air = named("BAS_JUMP_N_AIR");
const grounded = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
show("stand     ", grounded);
let last = grounded;
for (const f of [1, 5, 10, 16]) last = poseOf(stub(air, f), radius, last);
show("jump f16  ", last);
console.log("grounded spine", (grounded.neck.y - grounded.hips.y).toFixed(2), "air spine", (last.neck.y - last.hips.y).toFixed(2));

let p = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
const stands: number[] = [];
for (let n = 1; n < air.motion!.y!.length; n++) {
  p = poseOf(stub(air, n), radius, p);
  stands.push(p.stand);
}
console.log("stand across the leap: min", Math.min(...stands).toFixed(4), "max", Math.max(...stands).toFixed(4), "grounded", grounded.stand.toFixed(4));

const drop = (f: number): number => {
  let q = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
  for (let n = 1; n <= f; n++) q = poseOf(stub(air, n), radius, q);
  return q.hips.y - q.legs[0]!.tip.y;
};
const apex = air.motion!.y!.indexOf(Math.max(...air.motion!.y!)) + 1;
console.log("apex", apex, "drop(3)", drop(3).toFixed(1), "drop(apex)", drop(apex).toFixed(1), "drop(len-2)", drop(air.motion!.y!.length - 2).toFixed(1));
