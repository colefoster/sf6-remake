import { loadGeometry } from "../../src/data/load-geometry.js";
import { listCharacters } from "../../src/data/index.js";
import { hurtPartsAt, hitboxesAt, pushboxesAt, stanceAt } from "../../src/data/geometry.js";

// How often a body-only frame carries an *outboard* hurtbox while the action's
// own name says the live limb is a kick. On such a frame the part tag cannot
// name the limb -- everything is tagged `body` -- so the box is drawn as an arm.
let mismatch = 0;
let outboardOnBodyOnly = 0;
const actions = new Set<string>();
for (const entry of listCharacters() as unknown[]) {
  const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(id);
  if (!geo) continue;
  for (const action of geo.actions) {
    if (!action.hurt.length) continue;
    const named = /^[A-Z]+_[0-9[\]]*[LMH](P|K)/.exec(action.name);
    const byName = named ? named[1] === "K" : null;
    const end = Math.min(80, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    for (let f = 1; f <= end; f++) {
      const p = hurtPartsAt(action, f);
      if (p.head.length || p.leg.length || !p.body.length) continue;
      const push = pushboxesAt(action, f);
      if (!push.length) continue;
      const lo = Math.min(...push.map((b) => b.x));
      const hi = Math.max(...push.map((b) => b.x + b.width));
      const mid = (lo + hi) / 2;
      const tol = ((hi - lo) / 2) * 0.6;
      const out = p.body.filter((b) => Math.abs(b.x + b.width / 2 - mid) >= tol);
      if (!out.length) continue;
      outboardOnBodyOnly++;
      if (byName === true && hitboxesAt(action, f).length) {
        mismatch++;
        actions.add(`${id} ${action.name}`);
      }
    }
  }
}
console.log("body-only frames with an outboard hurtbox:", outboardOnBodyOnly);
console.log("  of those, a kick by name with a live hitbox (drawn as an arm):", mismatch, "over", actions.size, "actions");
console.log([...actions].slice(0, 15).join("\n"));
