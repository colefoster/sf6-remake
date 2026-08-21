/**
 * Counts the ways the derived figure comes out broken **between** two frames,
 * across every action of every fighter.
 *
 * `pose-audit.ts` is the same idea one frame at a time: it asks whether a pose
 * is wrong on its face and never whether it looks good, because the figure has
 * no ground truth to test against (ADR-0049). Every one of its seven predicates
 * reads a single frame, so a figure that is correct on every frame and still
 * teleports between two of them passes it — which is what happened to the walk
 * that played its forward gait while retreating, and to the moonwalk under it:
 * both shipped with `pose:audit` unchanged through the bug and through the fix.
 * This is the same negative check over Δt.
 *
 * The rule that makes the counts mean anything is that **a limb snapping to its
 * hitbox is correct, not a defect**. 1,679 of the 2,412 actions that carry a
 * hitbox — 70% — have no outboard hurtbox before their first active frame, so
 * easing a fist toward the box during startup would draw an extended limb on
 * frames where nothing is active — a lie about startup in a room built to show
 * startup. So every pair where a limb's `derived` flag *changes* is excluded
 * outright, and the counts below are only what moves while the box regime holds
 * still. ADR-0064 has the excluded totals.
 *
 * The threshold is not a taste: it is 0.30 of stature per frame, the 99th
 * percentile of the hips-relative displacement the **dump's own** hurtboxes
 * make from one frame to the next. A limb this project invented has no business
 * outrunning the limbs the game authored.
 *
 * usage: npm run pose:motion [-- <name filter>]
 */
import { loadGeometry } from "../src/data/load-geometry.js";
import { listCharacters } from "../src/data/index.js";
import { stanceAt, type GeometryAction } from "../src/data/geometry.js";
import { buildOf, headRadius, poseOf, type Limb, type Pose } from "../src/game/render.js";
import type { Fighter } from "../src/game/index.js";
import { pathToFileURL } from "node:url";

/**
 * How far a limb tip may travel in one frame, as a fraction of stature.
 *
 * Measured, not chosen: across the roster the tips that sit **on** a hurtbox
 * move less than this on 99% of frames, so it is the game's own limb speed.
 */
export const STEP_LIMIT = 0.3;

/** The same bound on the second difference — an acceleration, not a speed. */
export const JERK_LIMIT = 0.3;

/** `poseOf` reads only `state` and `position`, so a stub is the whole fighter. */
const stub = (action: unknown, frame: number): Fighter =>
  ({ state: { action, frame, facing: 1 }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;

/**
 * Which family an action belongs to, for the split the counts are reported in.
 *
 * `SPA` gathers the supers and criticals with the specials: they are the same
 * kind of animation and the same kind of geometry, and splitting them four ways
 * only thins the rows.
 */
export function familyOf(name: string): "ATK" | "SPA" | "BAS" | "reaction" | "other" {
  if (/(^|_)ATK_/.test(name)) return "ATK";
  if (/(^|_)(SPA|SAA|CAA|SA\d|CA\d|SP_)/.test(name)) return "SPA";
  if (/(^|_)BAS_/.test(name)) return "BAS";
  if (/(^|_)(DMG|GRD|DRD)_/.test(name)) return "reaction";
  return "other";
}

/**
 * The same action with its horizontal travel mirrored, or removed.
 *
 * Only `motion` is touched, so every hurtbox, hitbox and stance range is the one
 * the dump gave. What changes is the ground the action covers — the only clock
 * the gait runs on (ADR-0059) — which makes the pair of variants a probe: an
 * action whose legs move when the travel is *removed* has a gait, and one whose
 * legs are unchanged when the travel is *mirrored* has a gait that cannot tell
 * forwards from backwards.
 */
function retravelled(a: GeometryAction, f: (v: number) => number): GeometryAction {
  if (!a.motion) return a;
  const motion = { ...a.motion, travel: { ...a.motion.travel, x: f(a.motion.travel.x) } };
  if (a.motion.x) motion.x = a.motion.x.map(f);
  if (a.motion.velocity) motion.velocity = { ...a.motion.velocity, x: f(a.motion.velocity.x) };
  return { ...a, motion };
}

export interface MotionAudit {
  counts: Record<string, number>;
  /** The named actions each category was seen in. */
  offenders: Record<string, string[]>;
  first: Record<string, string>;
  /** Flagged occurrences and frames walked, per action family. */
  byFamily: Record<string, { flagged: number; frames: number }>;
  /** Pairs where the box regime flipped, excluded by the rule above. */
  excluded: { snapIn: number; snapOut: number };
  /** Actions whose gait is keyed to the ground they cover. */
  gaited: number;
}

export function motionAudit(filter: RegExp | null = null): MotionAudit {
  const counts: Record<string, number> = {};
  const where: Record<string, Set<string>> = {};
  const first: Record<string, string> = {};
  const byFamily: Record<string, { flagged: number; frames: number }> = {};
  const excluded = { snapIn: 0, snapOut: 0 };
  let gaited = 0;

  for (const entry of listCharacters() as unknown[]) {
    const id = typeof entry === "string" ? entry : ((entry as { id: string }).id ?? "");
    const geo = loadGeometry(id);
    if (!geo) continue;
    const radius = headRadius(geo);
    const build = buildOf(geo);
    const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction) ?? geo.actions[0]!;
    const idle = poseOf(stub(stand, 1), radius, undefined, build);
    // The yardstick is the *idle* stature, for ADR-0051's reason: measured
    // against the current one a crouch shrinks the ruler and every ordinary step
    // reads as a bound.
    const stature = Math.abs((idle.head?.y ?? idle.neck.y) - (idle.legs[0]?.tip.y ?? idle.hips.y));
    const step = stature * STEP_LIMIT;
    const jerk = stature * JERK_LIMIT;

    for (const action of geo.actions) {
      if (!action.hurt.length || (filter && !filter.test(action.name))) continue;
      const end = Math.min(80, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
      const family = familyOf(action.name);
      const fam = (byFamily[family] ??= { flagged: 0, frames: 0 });
      fam.frames += end;

      const flag = (kind: string, frame: number, detail: string): void => {
        counts[kind] = (counts[kind] ?? 0) + 1;
        (where[kind] ??= new Set()).add(`${id} ${action.name}`);
        first[kind] ??= `${id} ${action.name} f${frame} ${detail}`;
        fam.flagged++;
      };

      // The action is walked from the idle pose, exactly as `pose-audit` walks
      // it, so the two tools see the same figure. The idle-to-f1 step is not
      // compared: entering an action from a stand is a cut, not a movement.
      const poses: Pose[] = [];
      let last: Pose = idle;
      for (let f = 1; f <= end; f++) {
        last = poseOf(stub(action, f), radius, last, build);
        poses.push(last);
      }
      const tips = (p: Pose): Limb[] => [...p.arms, ...p.legs];
      const name = (k: number): string => (k < 2 ? `arm${k}` : `leg${k - 2}`);
      // **Measured against the hips, not against the world.** `poseOf` bakes the
      // action's own motion curve into the pose, so a launch translates the whole
      // figure -- A.K.I.'s `SPA_Kyosyutotu` lifts 59 units between f7 and f8 --
      // and reading a tip in action space charges the dump's arc to the limb. The
      // axis is the dump's and `pose-audit`'s `axis-pop` already polices it.
      const moved = (p: Pose, q: Pose, a: Limb, b: Limb): number =>
        Math.hypot(b.tip.x - a.tip.x - (q.hips.x - p.hips.x), b.tip.y - a.tip.y - (q.hips.y - p.hips.y));

      /** Whether the pair was flagged as a teleport, so `limb-jerk` can skip it. */
      const popped: boolean[][] = [];

      for (let i = 1; i < poses.length; i++) {
        const p0 = poses[i - 1]!,
          p1 = poses[i]!;
        const a = tips(p0),
          b = tips(p1);
        const row: boolean[] = [];
        for (let k = 0; k < Math.min(a.length, b.length); k++) {
          const was = a[k]!,
            now = b[k]!;
          if (was.derived !== now.derived) {
            // The honest snap, both ways round. Counted, never flagged.
            if (now.derived) excluded.snapIn++;
            else excluded.snapOut++;
            row.push(true);
            continue;
          }
          const d = moved(p0, p1, was, now);
          row.push(d > step);
          if (d <= step) continue;
          // A tip that is *on* a box moved because the box moved: that is the
          // dump's animation and not this project's invention. Left uncounted
          // for the same reason the snap is — the tool grades the invention.
          if (now.derived) continue;
          const detail = `${name(k)} d=${d.toFixed(0)} tall=${stature.toFixed(0)}`;
          // Attribution is ordered, and each frame is charged once: the stance
          // label is the loudest cause and `limb-teleport` is what is left when
          // nothing in the dump changed under the pose at all.
          if (stanceAt(action, i) !== stanceAt(action, i + 1)) flag("stance-snap", i + 1, detail);
          else if (
            p0.faded.head !== p1.faded.head ||
            p0.faded.body !== p1.faded.body ||
            p0.faded.leg !== p1.faded.leg
          )
            flag("fade-snap", i + 1, detail);
          else if (Math.abs(p1.stand - p0.stand) > stature * 0.05) flag("stand-snap", i + 1, detail);
          else flag("limb-teleport", i + 1, detail);
        }
        popped.push(row);
      }

      // -- Jerk: a limb that changes speed faster than it may move ------------
      //
      // Reported separately from the teleport it would otherwise double-count:
      // every pop is also a spike, so a pair already flagged above is skipped
      // and what is left is the limb that ramps and then stops dead.
      for (let i = 2; i < poses.length; i++) {
        const pz = poses[i - 2]!,
          pa = poses[i - 1]!,
          pb = poses[i]!;
        const z = tips(pz),
          a = tips(pa),
          b = tips(pb);
        for (let k = 0; k < Math.min(z.length, a.length, b.length); k++) {
          if (z[k]!.derived !== a[k]!.derived || a[k]!.derived !== b[k]!.derived) continue;
          if (b[k]!.derived) continue;
          if (popped[i - 2]?.[k] || popped[i - 1]?.[k]) continue;
          // Hips-relative, as above, and for the same reason.
          const rel = (p: Pose, l: Limb) => ({ x: l.tip.x - p.hips.x, y: l.tip.y - p.hips.y });
          const [rz, ra, rb] = [rel(pz, z[k]!), rel(pa, a[k]!), rel(pb, b[k]!)];
          const j = Math.hypot(rb.x - 2 * ra.x + rz.x, rb.y - 2 * ra.y + rz.y);
          if (j > jerk) flag("limb-jerk", i + 1, `${name(k)} j=${j.toFixed(0)}`);
        }
      }

      // -- The gait ------------------------------------------------------------
      //
      // Both checks below only apply where there *is* a gait, and that is asked
      // of `poseOf` rather than reproduced from it: an action whose legs move
      // when its travel is taken away is an action whose legs are keyed to the
      // ground. Asking is what keeps a jump — which covers as much ground as a
      // walk and has no floor to step off — out of the count.
      const dir = Math.sign(action.motion?.velocity?.x ?? action.motion?.travel?.x ?? 0);
      if (!dir) continue;
      const still = retravelled(action, () => 0);
      const onGait: boolean[] = [];
      let sl: Pose = idle;
      for (let f = 1; f <= end; f++) {
        sl = poseOf(stub(still, f), radius, sl, build);
        const p = poses[f - 1]!;
        onGait.push([0, 1].some((k) => Math.abs(sl.legs[k]!.tip.x - p.legs[k]!.tip.x) > 0.01));
      }
      if (!onGait.some(Boolean)) continue;
      gaited++;

      // **Cycle reversal.** A gait that traces the same leg cycle whichever way
      // the fighter is travelling is the forward walk played while retreating,
      // and every per-frame test passes it: mirrored, the cycle stays internally
      // consistent — the planted foot still slides against the travel, the
      // swinging one still gains ground — because reversing the travel reverses
      // what "against" means. Only the mirror shows it, so the mirror is the
      // predicate: the same action with `motion.x` negated must not produce the
      // byte-identical leg trajectory.
      const mirror = retravelled(action, (v) => -v);
      let blind = true;
      let ml: Pose = idle;
      for (let f = 1; f <= end && blind; f++) {
        ml = poseOf(stub(mirror, f), radius, ml, build);
        const p = poses[f - 1]!;
        for (let k = 0; k < 2; k++)
          if (Math.abs(ml.legs[k]!.tip.x - p.legs[k]!.tip.x) > 0.01) blind = false;
      }
      if (blind) flag("gait-blind", 1, `travel=${(action.motion?.travel?.x ?? 0).toFixed(0)}`);

      // **Plant slide.** Of the two feet the lower one is carrying the fighter,
      // and it must slide *against* the travel — that is what standing on the
      // ground while the body advances looks like. A planted foot moving with
      // the travel is a moonwalk. The pair is compared to each other rather than
      // to a floor height, because an action that leaves the ground has no
      // single floor to measure from.
      for (let i = 1; i < poses.length; i++) {
        if (!onGait[i - 1] || !onGait[i]) continue;
        for (let k = 0; k < 2; k++) {
          const was = poses[i - 1]!.legs[k]!,
            now = poses[i]!.legs[k]!;
          if (was.derived || now.derived) continue;
          const dx = now.tip.x - was.tip.x;
          if (Math.abs(dx) < 0.25) continue;
          const down = (p: Pose, l: Limb) => l.tip.y < p.legs[1 - k]!.tip.y - 0.5;
          if (!down(poses[i - 1]!, was) || !down(poses[i]!, now)) continue;
          if (Math.sign(dx) === dir) flag("plant-slide", i + 1, `dx=${dx.toFixed(1)} way=${dir}`);
        }
      }
    }
  }

  const offenders: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(where)) offenders[k] = [...v];
  return { counts, offenders, first, byFamily, excluded, gaited };
}

/**
 * Print the report, when run as a command.
 *
 * Guarded, unlike `pose-audit.ts`, because the counts below are locked by
 * `tests/pose-motion.test.ts` and importing the module to read them should not
 * also walk the roster and print it.
 */
function main(): void {
  const filter = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
  const report = motionAudit(filter);
  const rows = Object.keys(report.counts).sort((a, b) => report.counts[b]! - report.counts[a]!);
  if (!rows.length) console.log("nothing flagged");
  for (const kind of rows)
    console.log(
      `${kind.padEnd(16)} ${String(report.counts[kind]).padStart(6)} frames  ${String(report.offenders[kind]!.length).padStart(4)} actions   e.g. ${report.first[kind]}`,
    );
  const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
  const frames = Object.values(report.byFamily).reduce((a, b) => a + b.frames, 0);
  console.log(`${"".padEnd(16)} ${String(total).padStart(6)} frames of ${frames} walked`);
  console.log("-- by family --");
  for (const [k, v] of Object.entries(report.byFamily).sort((a, b) => b[1].flagged - a[1].flagged))
    console.log(
      `${k.padEnd(16)} ${String(v.flagged).padStart(6)} flagged  ${String(v.frames).padStart(6)} frames  ${((v.flagged / v.frames) * 100).toFixed(2)}%  ${((v.flagged / Math.max(1, total)) * 100).toFixed(1)}% of all`,
    );
  console.log(
    `-- excluded: ${report.excluded.snapIn} snaps onto a box, ${report.excluded.snapOut} off one; ${report.gaited} actions carry a gait`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
