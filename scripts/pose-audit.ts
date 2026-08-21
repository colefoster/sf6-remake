/**
 * Counts the ways the derived figure comes out broken, across every action of
 * every fighter.
 *
 * The figure has no ground truth to test against — there is no skeleton in the
 * dump (ADR-0049) — so the check is negative: a pose that puts the hips above
 * the neck, the head off the shoulders or an arm longer than the body is wrong
 * whatever the animation was. Run it before and after touching `poseOf`; the
 * counts are the evidence in ADR-0051, and a category that grows is a
 * regression. A count is never expected to reach zero: a somersault really does
 * put the legs above the torso, and the residuals are named in the ADR.
 *
 * usage: npm run pose:audit [-- <name filter>]
 */
import { loadGeometry } from "../src/data/load-geometry.js";
import { listCharacters } from "../src/data/index.js";
import { headRadius, poseOf, type Pose } from "../src/game/render.js";
import type { Fighter } from "../src/game/index.js";

const filter = process.argv[2] ? new RegExp(process.argv[2], "i") : null;

/** `poseOf` reads only `state` and `position`, so a stub is the whole fighter. */
const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

const counts: Record<string, number> = {};
const where: Record<string, Set<string>> = {};
const firstOf: Record<string, string> = {};
function flag(kind: string, at: string, detail: string): void {
  counts[kind] = (counts[kind] ?? 0) + 1;
  (where[kind] ??= new Set()).add(at.replace(/ f\d+$/, ""));
  firstOf[kind] ??= `${at} ${detail}`;
}

for (const entry of listCharacters() as unknown[]) {
  const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
  const geo = loadGeometry(id);
  if (!geo) continue;
  const radius = headRadius(geo);
  const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction) ?? geo.actions[0]!;
  const idle = poseOf(stub(stand, 1), radius);
  const idleSpine = idle.neck.y - idle.hips.y;
  const idleLeg = idle.hips.y - (idle.legs[0]?.tip.y ?? 0);
  // How long a limb may be is a property of the body, not of how it is standing:
  // measured against the *current* stature a crouching low reads as overlong on
  // 140 frames purely because crouching shortens the yardstick.
  const idleStature = Math.abs((idle.head?.y ?? idle.neck.y) - (idle.legs[0]?.tip.y ?? idle.hips.y));
  /** The leg that is standing, not the one that may be out on a kick. */
  const planted = (p: Pose) => p.legs.find((l) => !l.derived) ?? p.legs[0];

  for (const action of geo.actions) {
    if (!action.hurt.length || (filter && !filter.test(action.name))) continue;
    const end = Math.min(80, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    let last: Pose = idle;
    for (let f = 1; f <= end; f++) {
      const p = poseOf(stub(action, f), radius, last);
      const at = `${id} ${action.name} f${f}`;
      const spine = p.neck.y - p.hips.y;
      const legs = planted(p) ? p.hips.y - planted(p)!.tip.y : idleLeg;
      const stature = Math.abs((p.head?.y ?? p.neck.y) - (planted(p)?.tip.y ?? p.hips.y));

      if (spine <= 0) flag("spine-inverted", at, `spine=${spine.toFixed(0)}`);
      else if (spine > idleSpine * 2.2) flag("spine-stretched", at, `spine=${spine.toFixed(0)}`);
      else if (spine < idleSpine * 0.35) flag("spine-squashed", at, `spine=${spine.toFixed(0)}`);
      if (p.head && Math.abs(p.head.y - p.head.r - p.neck.y) > radius * 0.9)
        flag("head-detached", at, `gap=${(p.head.y - p.head.r - p.neck.y).toFixed(0)}`);
      // Only the stance: a *derived* leg above the hips is a high kick, which is
      // what the boxes said and not a fault.
      if (p.legs.some((l) => !l.derived && l.tip.y > p.hips.y + 1)) flag("foot-above-hips", at, "");
      if (planted(p) && legs > idleLeg * 2.2) flag("legs-stretched", at, `leg=${legs.toFixed(0)}`);
      // The fighter stands still in this harness, so any horizontal move of the
      // axis is the pushbox's, not travel.
      if (Math.abs(p.hips.x - last.hips.x) > 6) flag("axis-pop", at, `dx=${(p.hips.x - last.hips.x).toFixed(0)}`);
      // The limbs read off the extended-limb hurtboxes, which the stance ones
      // cannot fail: a hand or a foot further from its joint than the fighter is
      // tall is a box that was not a limb.
      for (const limb of [...p.arms, ...p.legs].filter((l) => l.derived)) {
        const len = Math.hypot(limb.tip.x - limb.root.x, limb.tip.y - limb.root.y);
        if (len > idleStature * 1.35) flag("reach-overlong", at, `len=${len.toFixed(0)} tall=${idleStature.toFixed(0)}`);
      }
      for (const limb of p.limbs) {
        const len = Math.hypot(limb.tip.x - limb.root.x, limb.tip.y - limb.root.y);
        if (len > idleStature * 1.35) flag("limb-overlong", at, `len=${len.toFixed(0)} tall=${idleStature.toFixed(0)}`);
        if (len < 6) flag("limb-degenerate", at, `len=${len.toFixed(0)}`);
      }
      last = p;
    }
  }
}

const rows = Object.keys(counts).sort((a, b) => counts[b]! - counts[a]!);
if (!rows.length) console.log("nothing flagged");
for (const kind of rows)
  console.log(
    `${kind.padEnd(16)} ${String(counts[kind]).padStart(6)} frames  ${String(where[kind]!.size).padStart(4)} actions   e.g. ${firstOf[kind]}`,
  );
