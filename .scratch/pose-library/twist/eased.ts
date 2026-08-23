/** Every frame of every file, eased blends included, against the gate. */
import { loadGeometry } from "../../../src/data/load-geometry.js";
import { authoredMoves, loadPose } from "../../../src/data/load-poses.js";
import { buildOf } from "../../../src/game/render.js";
import { overreach, resolveKeys, sampleAuthored } from "../../../src/game/pose-library.js";

const ryu = loadGeometry("ryu")!;
const build = buildOf(ryu);
for (const move of authoredMoves("ryu")) {
  const file = loadPose("ryu", move)!;
  const action = ryu.actions.find((a) => a.name === file.action)!;
  const r = resolveKeys(file, action);
  let worst = 0;
  let at = 0;
  for (let f = 1; f <= (action.frames ?? 0); f++) {
    const pose = sampleAuthored(r.keys, f);
    if (!pose) continue;
    for (const b of [build, { arm: 1, leg: 1, stature: 1 }]) {
      const v = overreach([{ frame: f, at: "start", pose }], b);
      if (v > worst) {
        worst = v;
        at = f;
      }
    }
  }
  console.log(`${move.padEnd(6)} worst over every frame ${worst.toFixed(3)} at f${at}`);
}
