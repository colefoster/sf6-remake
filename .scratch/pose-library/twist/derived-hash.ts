/**
 * Pin the derived figure. Walks every action of every fighter, every frame,
 * and hashes every limb root/joint/tip plus head/neck/hips. Reports the record
 * count and a sha256. Nothing here writes.
 */
import { createHash } from "node:crypto";
import { loadGeometry } from "../../../src/data/load-geometry.js";
import { listCharacters } from "../../../src/data/index.js";
import { buildOf, headRadius, poseOf, type Pose } from "../../../src/game/render.js";
import type { Fighter } from "../../../src/game/index.js";

const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

const hash = createHash("sha256");
let records = 0;
const q = (v: number): string => (Math.round(v * 1e6) / 1e6).toFixed(6);

for (const entry of listCharacters() as unknown[]) {
  const c = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(c);
  if (!geo) continue;
  const build = buildOf(geo);
  const radius = headRadius(geo);
  for (const action of geo.actions) {
    let last: Pose | undefined;
    for (let f = 1; f <= (action.frames ?? 0); f++) {
      const pose = poseOf(stub(action, f), radius, last, build);
      if (!pose) continue;
      last = pose;
      const parts: string[] = [];
      for (const limb of [...pose.arms, ...pose.legs, ...pose.limbs]) {
        parts.push(q(limb.root.x), q(limb.root.y), q(limb.joint.x), q(limb.joint.y), q(limb.tip.x), q(limb.tip.y));
        records++;
      }
      if (pose.head) parts.push(q(pose.head.x), q(pose.head.y), q(pose.head.r));
      parts.push(q(pose.neck.x), q(pose.neck.y), q(pose.hips.x), q(pose.hips.y));
      hash.update(`${c}|${action.name}|${f}|${parts.join(",")}\n`);
    }
  }
}
console.log(`${records} records  sha256 ${hash.digest("hex")}`);
