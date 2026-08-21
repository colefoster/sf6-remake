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
import { originAt } from "../src/data/geometry.js";
import { buildOf, grounded, headRadius, poseOf, type Pose } from "../src/game/render.js";
import type { Fighter } from "../src/game/index.js";

const filter = process.argv[2] ? new RegExp(process.argv[2], "i") : null;

/** `poseOf` reads only `state` and `position`, so a stub is the whole fighter. */
const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

/**
 * How the counts below treat a fighter who is lying on the floor.
 *
 * **Every predicate in this file encodes standing.** `spine-inverted` fires when
 * the neck is not above the hips, `foot-above-hips` when a planted foot is above
 * the pelvis, `head-detached` when the skull is not one radius over the neck.
 * A prone fighter breaks all three by being prone, and drawing one correctly
 * takes the total from 1,233 to 7,336: **+1,856 `head-detached`, +1,711
 * `foot-above-hips`, +1,614 `spine-inverted` and +922 `spine-squashed`**, 6,103
 * flags over 150 actions, every one of them a knockdown, a get-up, a quick-rise
 * or a bound. Squashing the figure to keep the count down would be gaming the
 * grader; see ADR-0066.
 *
 * So the rule, stated: **a frame whose live pushbox is the downed rect is
 * graded by the prone predicates instead of the standing ones, and a frame on
 * the way back up is not graded at all.** The exempted totals are printed with
 * the counts, because an exemption nobody can see is an exemption nobody can
 * check. This is what ADR-0058 did for Blanka's somersault and ADR-0060 for
 * Dhalsim's reach.
 *
 * The prone predicates are not weaker, they are the same kind of check with the
 * body's own axis for "up": the figure must be flat, must be inside the volume
 * the pushbox allows, and must be laid out to something like its own length.
 * `prone-standing` is the regression this ADR exists for — a figure that draws
 * a standing man through the knockdown fails it on every frame.
 */
const counts: Record<string, number> = {};
const where: Record<string, Set<string>> = {};
const firstOf: Record<string, string> = {};
/** Frames flat on the floor, graded by the prone predicates instead. */
let exempted = 0;
/** Frames part way back up, graded by neither. */
let rising = 0;
const exemptedIn = new Set<string>();
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
  const build = buildOf(geo);
  const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction) ?? geo.actions[0]!;
  const idle = poseOf(stub(stand, 1), radius, undefined, build);
  const idleSpine = idle.neck.y - idle.hips.y;
  const idleLeg = idle.hips.y - (idle.legs[0]?.tip.y ?? 0);
  // How long a limb may be is a property of the body, not of how it is standing:
  // measured against the *current* stature a crouching low reads as overlong on
  // 140 frames purely because crouching shortens the yardstick.
  const idleStature = Math.abs((idle.head?.y ?? idle.neck.y) - (idle.legs[0]?.tip.y ?? idle.hips.y));
  /** The yardstick `poseOf` reads the downed pushbox against. See ADR-0066. */
  const stature0 = build.stature || radius * 9.8;
  /** The leg that is standing, not the one that may be out on a kick. */
  const planted = (p: Pose) => p.legs.find((l) => !l.derived) ?? p.legs[0];

  for (const action of geo.actions) {
    if (!action.hurt.length || (filter && !filter.test(action.name))) continue;
    const end = Math.min(80, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
    let last: Pose = idle;
    for (let f = 1; f <= end; f++) {
      const p = poseOf(stub(action, f), radius, last, build);
      const at = `${id} ${action.name} f${f}`;

      // -- On the floor, and on the way up ---------------------------------
      if (p.prone > 0) {
        // The slab moves with the action's own origin: `BAS_TECH_FN_UT` rolls and
        // lifts 20 units, and `poseOf` places the figure in world space.
        const top = (grounded(action, stature0)?.top ?? 0) + originAt(action, f).y;
        if (p.prone < 1) rising++;
        else {
          exempted++;
          exemptedIn.add(`${id} ${action.name}`);
          const points = [p.neck, p.hips, ...p.legs.map((l) => l.tip), ...p.arms.map((l) => l.tip)];
          if (p.head) points.push({ x: p.head.x, y: p.head.y });
          const high = points.find((q) => q.y > top + 0.5);
          if (high) flag("prone-above-box", at, `y=${high.y.toFixed(0)} box=${top}`);
          const under = points.find((q) => q.y < -0.5);
          if (under) flag("prone-underfloor", at, `y=${under.y.toFixed(0)}`);
          if (Math.abs(p.neck.y - p.hips.y) > idleSpine * 0.25)
            flag("prone-standing", at, `spine=${(p.neck.y - p.hips.y).toFixed(0)}`);
          const ends = [p.head ? p.head.x : p.neck.x, ...p.legs.map((l) => l.tip.x)];
          const laidOut = Math.max(...ends) - Math.min(...ends);
          if (laidOut < idleStature * 0.6) flag("prone-folded", at, `len=${laidOut.toFixed(0)} tall=${idleStature.toFixed(0)}`);
        }
        last = p;
        continue;
      }

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
console.log(
  `-- on the floor: ${exempted} frames over ${exemptedIn.size} actions graded prone instead of standing, ${rising} more on the way up graded by neither. See ADR-0066.`,
);
