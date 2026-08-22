import { loadGeometry } from "../../../src/data/load-geometry.js";
import { authoredMoves, loadPose } from "../../../src/data/load-poses.js";
import { overreach, resolveKeys } from "../../../src/game/pose-library.js";
import { buildOf } from "../../../src/game/render.js";

const geo = loadGeometry("ryu")!;
const build = buildOf(geo);
for (const move of authoredMoves("ryu")) {
  const file = loadPose("ryu", move)!;
  const action = geo.actions.find((a) => a.name === file.action);
  if (!action) {
    console.log(move, "action missing", file.action);
    continue;
  }
  const resolved = resolveKeys(file, action);
  const frames = resolved.keys.map((k) => k.frame).join(",");
  console.log(
    `${move.padEnd(6)} ${file.action.padEnd(18)} frames ${frames.padEnd(20)} overreach ${overreach(resolved.keys).toFixed(3)}  onBuild ${overreach(resolved.keys, build).toFixed(3)}  problems ${resolved.problems.length ? JSON.stringify(resolved.problems) : "none"}`,
  );
}
