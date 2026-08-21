/** Drive Ryu's sweep into Ken and print the defender's figure, frame by frame. */
import { loadGeometry } from "../../src/data/load-geometry.js";
import { Match } from "../../src/game/match.js";
import { buildOf, headRadius, poseOf, type Pose } from "../../src/game/render.js";

const a = loadGeometry("ryu")!;
const b = loadGeometry("ken")!;
const match = new Match(a, b, { distance: 120 });
const radius = headRadius(b);
const build = buildOf(b);
let pose: Pose | undefined;

const press = (buttons: string[], dir = 5) => ({ dir, buttons }) as never;
const NEUTRAL = press([]);

for (let t = 1; t <= 120; t++) {
  match.advance(t <= 3 ? press(["HK"], 2) : NEUTRAL, NEUTRAL);
  const ken = match.fighters[1];
  pose = poseOf(ken, radius, pose, build);
  const s = ken.state;
  console.log(
    `f${String(t).padStart(3)} ${s.action.name.padEnd(18)} af${String(s.frame).padStart(3)}`,
    `down=${String(ken.down).padEnd(5)} floored=${String(ken.floored).padStart(3)} stun=${String(ken.stunned).padStart(3)}`,
    `| prone=${pose.prone.toFixed(2)}`,
    `neck=${pose.neck.y.toFixed(0).padStart(4)} hips=${pose.hips.y.toFixed(0).padStart(3)}`,
    `head=(${(pose.head?.x ?? 0).toFixed(0)},${(pose.head?.y ?? 0).toFixed(0)})`,
    `feet=${pose.legs.map((l) => `(${l.tip.x.toFixed(0)},${l.tip.y.toFixed(0)})`).join("")}`,
  );
}
