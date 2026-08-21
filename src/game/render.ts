/**
 * Drawing the match: the transform, the boxes, and a body derived from them.
 *
 * This exists because `web/play.html` and `web/boxes.html` had each grown their
 * own copy of the game-unit-to-pixel arithmetic, camera and box drawing. ADR-0028
 * stopped the *logic* being written twice by bundling the runtime for the browser;
 * this is the same seam for the *view*. Nothing here may touch the file system.
 *
 * The figure is the interesting part. There is no skeleton in the dump — MMDK
 * dumps motion clip names and no bone transforms — so the pose is **derived from
 * the collision boxes**, which track the animation closely enough to read: the
 * head box is the head, the body box the torso, the leg box the legs, and the
 * *active hitbox is the limb*. See ADR-0049.
 */

import type { Box } from "../domain/types.js";
import type { GeometryAction, GeometryFile } from "../data/geometry.js";
import { hitboxesAt, hurtPartsAt, originAt, pushboxesAt, stanceAt } from "../data/geometry.js";
import type { Fighter } from "./index.js";

/**
 * What the drawing needs of a fighter: an action, a frame, a facing and a place
 * to stand. `Fighter` satisfies it, and so does the box viewer, which has an
 * action selected and no match running at all.
 */
export interface Posed {
  state: { action: GeometryAction; frame: number; facing: 1 | -1 };
  position(): { x: number; y: number };
}

export interface Point {
  x: number;
  y: number;
}

/** A fighter's boxes this frame, in world units. */
export interface WorldBoxes {
  hurt: Box[];
  hit: Box[];
  push: Box[];
}

/**
 * An arm or a leg: where it starts, where it bends, where it ends.
 *
 * `derived` says whether the boxes put the extremity there or whether it is the
 * invented resting pose. The distinction is worth carrying because most of the
 * time it is the invention: across the roster only **9.2% of 456,993 frames**
 * carry a hurtbox out past the footprint for a limb to be read from — 19.4% of
 * `ATK_*` frames, 17.0% of `SPA_*`, 0.4% of `BAS_*` and **zero** of the 646
 * reaction actions.
 */
export interface Limb {
  root: Point;
  joint: Point;
  tip: Point;
  derived: boolean;
}

/**
 * A stick figure in world units.
 *
 * `faded` marks a part whose hurtbox is not live this frame. The joints are
 * still there — held over from the last frame that had them — because a missing
 * hurtbox means *invulnerable*, not gone (ADR-0020). Drawing it dimmed is how
 * invulnerability becomes visible instead of becoming a hole in the figure.
 */
export interface Pose {
  head: { x: number; y: number; r: number } | null;
  neck: Point;
  hips: Point;
  /**
   * Hips to feet, and shoulders to hands. Two of each, trailing then leading.
   * At most one of each pair is `derived`: the boxes are 2D and cannot tell a
   * near limb from a far one, so the extension goes to the limb on the side it
   * is on and the other keeps the invented resting pose.
   */
  legs: Limb[];
  arms: Limb[];
  /**
   * An active hitbox, drawn as the limb that carries it. `joint` is the knee or
   * elbow: a limb drawn as one straight line from hip to hitbox is a beam, and
   * Ryu's roundhouse read as a laser fired through the opponent's chest.
   */
  limbs: (Limb & { kick: boolean })[];
  faded: { head: boolean; body: boolean; leg: boolean };
  /**
   * The pushbox's centre in action space — the axis the figure hangs on, kept so
   * a frame with no pushbox can hold the last one instead of snapping to the
   * fighter's own x.
   */
  footprint: number;
  /**
   * Hips to feet **before** ADR-0059's gait and tuck are applied.
   *
   * A frame with no leg box holds its stance at the last frame's hip-to-foot
   * distance, and reading that back off the drawn foot compounds: a jump has only
   * a body box, so every airborne frame tucked a leg that was already tucked and
   * the legs wound in to nothing over about fifteen frames. The invention is not
   * allowed to feed itself.
   */
  stand: number;
}

/** The screen transform: game units in, canvas pixels out. */
export interface View {
  width: number;
  height: number;
  scale: number;
  ground: number;
  x: (units: number) => number;
  y: (units: number) => number;
}

const union = (boxes: Box[]): [number, number, number, number] | null => {
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((b) => b.x)),
    Math.min(...boxes.map((b) => b.y)),
    Math.max(...boxes.map((b) => b.x + b.width)),
    Math.max(...boxes.map((b) => b.y + b.height)),
  ];
};

/**
 * The shortest sky the camera will frame, in world units. A standing fighter is
 * about 130 tall to the crown, so this is head height plus a little air.
 */
export const CAMERA_FLOOR = 210;

/**
 * How much room the camera keeps above the floor, following the fighters.
 *
 * A band framed for the tallest jump is a band that is mostly empty, because
 * nobody is jumping on most frames — and the old fixed 330 spent 45% of the
 * canvas on sky a standing pair never entered. So the band follows: it opens
 * the instant someone leaves the ground and closes slowly behind them, which
 * reads as a camera pulling back rather than as a zoom snapping about.
 *
 * Stateful on purpose. The smoothing *is* the feature, and a pure function
 * handed the same peak twice cannot smooth anything.
 */
export class Camera {
  private band = CAMERA_FLOOR;
  /** How fast the band closes once the fighters are down, per frame. */
  private readonly ease: number;

  constructor(ease = 0.05) {
    this.ease = ease;
  }

  /** Feed it the highest point in play; get the band to frame. */
  follow(peak: number): number {
    const want = Math.max(CAMERA_FLOOR, peak * 1.3);
    this.band = want > this.band ? want : this.band + (want - this.band) * this.ease;
    return this.band;
  }

  reset(): void {
    this.band = CAMERA_FLOOR;
  }
}

/**
 * The camera. Keeps both fighters and a margin on screen, stops at the walls so
 * a corner reads as one, and never shrinks the pair to nothing when they are far
 * apart.
 *
 * `band` is the sky to frame, in world units — {@link Camera} is what follows
 * the action with it. The horizontal margin is deliberately tight: the vertical
 * budget is the scarce one on a wide canvas, and a generous side margin was
 * capping the zoom and paying for it in empty sky.
 */
export function viewFor(
  canvas: { clientWidth: number; clientHeight: number },
  positions: [number, number],
  half: number,
  band = 330,
): View {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const span = Math.max(340, Math.abs(positions[1] - positions[0]) + 170);
  const room = half - span / 2;
  const centre = (positions[0] + positions[1]) / 2;
  const mid = room <= 0 ? 0 : Math.max(-room, Math.min(room, centre));
  const ground = height - 56;
  const scale = Math.min(width / span, Math.max(1, ground - 16) / band);
  return {
    width,
    height,
    scale,
    ground,
    x: (units) => width / 2 + (units - mid) * scale,
    y: (units) => ground - units * scale,
  };
}

/**
 * Everything an action's boxes cover, including where its travel takes them.
 *
 * The stage camera frames two fighters; the box viewer frames one action, and
 * has to hold still while the frame is scrubbed or the boxes swim. So the
 * bounds are the action's, not the frame's.
 */
export function boundsOf(action: GeometryAction, floor = { minX: -60, maxX: 160, maxY: 170 }): {
  minX: number;
  maxX: number;
  maxY: number;
} {
  let { minX, maxX, maxY } = floor;
  const travel = action.motion?.travel;
  const eat = (b: Box): void => {
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
    if (!travel) return;
    eat2({ ...b, x: b.x + travel.maxX, y: b.y + travel.maxY });
  };
  const eat2 = (b: Box): void => {
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  };
  for (const key of action.hit) key.boxes.forEach(eat);
  for (const key of action.prox) key.boxes.forEach(eat);
  for (const key of action.hurt) for (const part of [key.head, key.body, key.leg, key.throw]) part.forEach(eat);
  return { minX, maxX, maxY };
}

/**
 * The other camera: fit one action's own bounds to the canvas.
 *
 * `viewFor` follows two fighters around a stage. The box viewer has no stage and
 * no second fighter — it has an action and a distance slider — so it frames the
 * content instead, with the ground pinned so scrubbing does not move it.
 */
export function viewForAction(
  size: { width: number; height: number },
  bounds: { minX: number; maxX: number; maxY: number },
  pad = 40,
): View {
  const { width, height } = size;
  const scale = Math.min((width - pad * 2) / (bounds.maxX - bounds.minX), (height - pad * 2) / (bounds.maxY + 20));
  const left = (width - (bounds.maxX - bounds.minX) * scale) / 2;
  const ground = height - pad;
  return {
    width,
    height,
    scale,
    ground,
    x: (units) => left + (units - bounds.minX) * scale,
    y: (units) => ground - units * scale,
  };
}

/** A fighter's boxes in world space: the runtime's own placement, mirrored. */
export function worldBoxes(fighter: Posed): WorldBoxes {
  const { action, frame } = fighter.state;
  return {
    hurt: place(fighter, (a, f) => [...hurtPartsAt(a, f).head, ...hurtPartsAt(a, f).body, ...hurtPartsAt(a, f).leg]),
    hit: place(fighter, hitboxesAt),
    push: place(fighter, pushboxesAt),
  };
  function place(f: Posed, boxes: (a: GeometryAction, n: number) => Box[]): Box[] {
    return boxes(action, frame).map((b) => placeBox(f, b));
  }
}

/** One box from action space into world space. */
export function placeBox(fighter: Posed, box: Box): Box {
  const { action, frame, facing } = fighter.state;
  const origin = originAt(action, frame);
  const at = fighter.position();
  return {
    x: facing === 1 ? at.x + box.x : at.x - (box.x + box.width),
    y: box.y + origin.y,
    width: box.width,
    height: box.height,
  };
}

/**
 * How this fighter is proportioned, relative to the roster.
 *
 * The idle hurtbox stack is 166 units tall on 21 of the 24 characters and the
 * derived figure comes out 149 tall on 20 of them, so **Lily and Zangief draw at
 * the same size**. `PlData.Physique` is the only thing in the dump that tells
 * them apart, and it ranks them the way the roster looks (ADR-0059).
 *
 * What it does **not** give is an absolute: `leg / height` runs 0.61 to 0.71,
 * which is too high to be a standing hip joint, so these are bone chains in some
 * rest pose and not measurements of the standing body. Reading a hip height off
 * them would be inventing a number and calling it data. So only the *ratio to
 * the roster median* is taken, and it modulates the invented resting pose rather
 * than replacing it: `arm` 0.85 on Lily to **1.37 on Blanka**, `leg` 0.94 on
 * Zangief to 1.09 on A.K.I. and Kimberly.
 */
export interface Build {
  /** Resting arm length, x the roster median. */
  arm: number;
  /** Leg length and hip height, x the roster median. */
  leg: number;
  /**
   * The fighter's own idle hurtbox stack, in game units — 166 on 21 of the 24,
   * 172 on Dee Jay, 178 on JP, Marisa and Zangief.
   *
   * Derived, and it is here because a bone length is a property of the *body*
   * and not of how the body is standing. Measured against the current frame's
   * stature a crouching fighter grows short arms, which is the same mistake
   * ADR-0058 had to back out of in `pose:audit`. 0 means "no geometry to hand".
   */
  stature: number;
}

/** Roster medians of `arm / height` and `leg / height` over all 24 characters. */
const MEDIAN_ARM = 0.5391;
const MEDIAN_LEG = 0.652;

/** The neutral build, for a caller with no geometry to hand. */
export const EVEN_BUILD: Build = { arm: 1, leg: 1, stature: 0 };

export function buildOf(geo: GeometryFile): Build {
  const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction);
  const parts = stand ? hurtPartsAt(stand, 1) : null;
  const stack = parts ? union([...parts.head, ...parts.body, ...parts.leg]) : null;
  const stature = stack ? stack[3] - Math.min(0, stack[1]) : 0;
  const p = geo.fighter?.physique;
  if (!p?.height) return { ...EVEN_BUILD, stature };
  return { arm: p.arm / p.height / MEDIAN_ARM, leg: p.leg / p.height / MEDIAN_LEG, stature };
}

/**
 * The head's size, taken from the idle pose and then left alone.
 *
 * Sizing the skull to the current head box does not work: the box grows to cover
 * a lean, so the head balloons over the torso exactly when the fighter attacks.
 */
export function headRadius(geo: GeometryFile): number {
  const stand = geo.actions.find((a) => a.id === geo.calibration?.standAction);
  const box = stand ? union(hurtPartsAt(stand, 1).head) : null;
  return box ? Math.min(box[2] - box[0], box[3] - box[1]) / 2 : 14;
}

/**
 * Where a human body's joints sit, as fractions of its standing height.
 *
 * **These are not in either dump, and they are not measurements of SF6.** The
 * hip and the shoulder are the ordinary anthropometric ratios — the hip joint
 * (greater trochanter) at 0.53 of stature, the shoulder joint at 0.83 — and they
 * are here because the boxes do not carry a skeleton and ADR-0059 proved nothing
 * else in the dump does either. Every joint they place is invention, stated as
 * such in ADR-0060, and they are named constants rather than numbers buried in
 * expressions so that the invention can be *seen*.
 *
 * The **arm is deliberately not** its anthropometric length. Shoulder-to-wrist
 * is 0.37 of stature, and a 61-unit arm on Ryu cannot be drawn: the honesty cage
 * keeps an invented hand inside his own hurtboxes, which are ±40 at chest
 * height, so an arm that long is always folded double and its elbow sticks out
 * further than his torso. 0.25 is the longest arm that folds to a guard without
 * a wing, and it is a compromise with the box, not a reading of a body.
 *
 * What they replace is not data. It was the claim that **the top of the leg
 * hurtbox is the hip joint**, which put the hips at 32.5% of stature and drew a
 * tower of torso on two stumps. The crouch refutes it: standing, the leg/body
 * boundary sits at 54 of a 166 stack (32.5%); crouching, at 41 of 119 (34.5%).
 * A hit-height convention keeps its fraction of the body when the body folds. A
 * hip joint does not — a crouching fighter's hips drop to about half their
 * standing height while their head drops by a third.
 */
const HIP_OF_STATURE = 0.53;
/** The hip as a fraction of the neck's own height, which is what a frame has. */
const HIP_OF_NECK = 0.638;
/** Shoulder to wrist. Short of the 0.37 a body has — see above. */
const ARM_OF_STATURE = 0.25;
/** How much of a leg's own length is spare when standing, so the knee reads. */
const LEG_SLACK = 1.02;

/**
 * How a fighter with no extended-limb box is *carrying* itself.
 *
 * ADR-0058 gave every one of those frames the same hanging arms and the same
 * stance, which is why a blocked fighter, a knocked-back one and an idle one all
 * read identically: 90.8% of frames drew one pose. They are not the same pose,
 * and the action says which it is without any geometry being invented for it.
 *
 * `stance` is the action's own `StatusKey.PoseStatus` (ADR-0059) where it has
 * one — 1,482 of the 2,622 reactions do — and the name carries the rest.
 *
 * The *numbers* are invented. `lead` and `rear` are where each hand sits
 * relative to its own shoulder, as fractions of arm length: `+x` towards the
 * opponent, `+y` up. **The two arms are given separate offsets**, which is the
 * point — ADR-0059 sent both hands the same way with a 7% vertical nudge, so a
 * struck fighter drew one arm and a smear. `width` is the stance against
 * ADR-0050's baseline and `sink` drops the hips towards the floor.
 */
interface Attitude {
  lead: readonly [number, number];
  rear: readonly [number, number];
  width: number;
  sink: number;
}

/**
 * The fighting stance: lead fist out at the front of the chest, rear fist
 * tucked back near its own shoulder. Not hanging arms — a fighter at rest in
 * this game has their hands up, and hands up is also what stops the arms
 * reading as longer than the legs.
 */
const READY: Attitude = { lead: [0.46, -0.5], rear: [0.33, -0.72], width: 1, sink: 0 };

function attitudeOf(name: string, stance: 1 | 2 | 3 | null): Attitude {
  // Guarding and Drive-guarding: both hands in front, because a block is the one
  // pose where the arms are unambiguously between the fighter and the opponent.
  // `5000_GRD_STD_START` and its Drive twin `DRD`. Stacked rather than side by
  // side — a high hand and a low one is what a guard looks like from the side.
  if (/(^|_)(GRD|DRD)_/.test(name)) return { lead: [0.44, -0.35], rear: [0.62, -0.6], width: 0.95, sink: 0.02 };
  // Being hit: both arms thrown away from the opponent, and *not* on top of each
  // other — the lead arm flails high and the rear one drops behind the hip.
  if (/(^|_)DMG_/.test(name)) return { lead: [-0.75, -0.55], rear: [-0.35, -0.95], width: 1.1, sink: 0.03 };
  if (stance === 2) return { lead: [0.46, -0.44], rear: [0.26, -0.68], width: 1.2, sink: 0 };
  // Airborne: the guard opens and the hands come up, which is the only thing a
  // jump does that a hurtbox never records.
  if (stance === 3) return { lead: [0.38, 0.1], rear: [-0.33, 0.18], width: 0.9, sink: 0 };
  return READY;
}

/**
 * A pose for this fighter, in world units.
 *
 * Everything is derived. `last` is the previous frame's pose, used to hold a part
 * whose boxes are not describing a body this frame rather than dropping it — a
 * rising Shoryuken has no head or body box at all on its invulnerable frames.
 *
 * The figure hangs on **one vertical axis, taken from the pushbox**, because the
 * hurtbox unions cannot supply one: each part's union drifts differently as limbs
 * extend, so three joints meant three notions of where the fighter was and the
 * figure came apart. The pushbox is the body's authored footprint and does not
 * move. Heights still come from the hurtboxes; only the horizontal placement is
 * the pushbox's. See ADR-0050.
 */
export function poseOf(fighter: Posed, radius: number, last?: Pose, build: Build = EVEN_BUILD): Pose {
  const { action, frame, facing } = fighter.state;
  const at = fighter.position();
  const origin = originAt(action, frame);
  const parts = hurtPartsAt(action, frame);
  const flip = (x: number): number => (facing === 1 ? at.x + x : at.x - x);

  // The footprint, in action space: the pushbox, which does not move. A frame
  // with none holds the last one — the same rule as every other part — because
  // snapping to the fighter's own x teleports the whole figure sideways for one
  // frame wherever the pushbox was not centred on it.
  const push = union(pushboxesAt(action, frame));
  const footprint = push ? (push[0] + push[2]) / 2 : (last?.footprint ?? 0);
  const axis = flip(footprint);
  const half = push ? (push[2] - push[0]) / 2 : radius * 2.4;

  // A part is the boxes sitting over the footprint. A box centred out towards the
  // pushbox's edge or beyond is an extended limb carrying its own hurtbox, and
  // folding that into the union is what broke the figure: on Ryu's 5LK it made
  // the leg union 174 wide and 100 tall, so the hips rode up and forward and the
  // feet splayed. When *every* box of a part is out there — Dee Jay's sweep, where
  // both leg boxes are the sweeping leg — the part has no body left in it and is
  // held over from the last frame, not fallen back to. Falling back was drawing
  // his legs as a tent above his head.
  const middle = push ? (push[0] + push[2]) / 2 : 0;
  const tolerance = push ? ((push[2] - push[0]) / 2) * 0.6 : 0;

  // A box tagged to more than one part says nothing about which part it is.
  // Akuma's air fireball hangs one 80x120 box off head, body *and* leg at once,
  // and a figure that believed it put the hips level with the neck and stood the
  // whole man on 145-unit stilts. Where a part has a box of its own, that box is
  // the part; the shared one is only a fallback for a part with nothing else.
  const id = (b: Box): string => `${b.x},${b.y},${b.width},${b.height}`;
  const shared = new Map<string, number>();
  for (const which of ["head", "body", "leg"] as const)
    for (const k of new Set(parts[which].map(id))) shared.set(k, (shared.get(k) ?? 0) + 1);

  const box = (which: keyof typeof parts): [number, number, number, number] | null => {
    const all = parts[which];
    const core = push ? all.filter((b) => Math.abs(b.x + b.width / 2 - middle) < tolerance) : all;
    const own = core.filter((b) => shared.get(id(b)) === 1);
    const u = union(own.length ? own : core);
    return u ? [u[0], u[1] + origin.y, u[2], u[3] + origin.y] : null;
  };

  const head = box("head");
  const body = box("body");
  const leg = box("leg");
  // Invulnerable is *no box at all*, per ADR-0020 — not a part whose only boxes
  // are out on a limb, which is still a hurtbox and still hittable.
  const faded = { head: !parts.head.length, body: !parts.body.length, leg: !parts.leg.length };
  const torso = body ?? leg ?? null;

  // Nothing to stand on and nothing held over: the fighter is not drawable this
  // frame (a projectile's own action, an intro). Callers skip it.
  if (!torso && !last) {
    return {
      head: null,
      neck: { x: at.x, y: 0 },
      hips: { x: at.x, y: 0 },
      legs: [],
      arms: [],
      limbs: [],
      faded,
      footprint,
      stand: 0,
    };
  }

  // Which way is up for this body. Blanka's 5MK is a flip: the head key sits on
  // the floor and the leg key at 166, and a figure that assumed the legs were
  // below the torso drew him squashed with his skull inside his chest. The parts
  // are ordered along the spine, so their own order says which end is which.
  const mid = (b: [number, number, number, number]): number => (b[1] + b[3]) / 2;
  const up: 1 | -1 =
    head && leg ? (mid(head) >= mid(leg) ? 1 : -1) : head && body ? (mid(head) >= mid(body) ? 1 : -1) : 1;
  /** A box's edge at the head end of the spine, and at the foot end. */
  const toHead = (b: [number, number, number, number]): number => (up === 1 ? b[3] : b[1]);
  const toFeet = (b: [number, number, number, number]): number => (up === 1 ? b[1] : b[3]);

  // One axis. Heights still come from the boxes; only the horizontal placement
  // is the pushbox's, so the spine is vertical unless the fighter moves.
  //
  // A part with no usable box is held at its *distance* from the part above, not
  // at the height it last had: a jump keeps only its body box, and hips pinned to
  // an absolute height stay on the floor while the torso climbs 350 units away.
  const spine = last ? last.neck.y - last.hips.y : null;
  const stood = last?.legs.find((l) => !l.derived) ?? last?.legs[0];
  const drop = last?.stand ?? (stood ? last!.hips.y - stood.tip.y : 0);
  const held = leg ? toHead(leg) : body ? (spine === null ? toFeet(body) : toHead(body) - spine) : last!.hips.y;
  const neckY = body ? toHead(body) : held + (spine ?? 0);

  // The skull hangs off the head box's far edge, but stays on the neck. The head
  // key is often much taller than a head — Ryu's crouch carries two boxes over 50
  // units — which left a bare neck as long as the skull, and A.K.I.'s command
  // grab has a head box *below* the torso, which buried the skull in the chest.
  const gap = radius * (up === 1 ? 1 : -1);
  const skullY = head
    ? clamp(toHead(head) - gap, neckY + gap * 0.6, neckY + gap * 1.5)
    : neckY + gap;
  const skull = head || last?.head ? { x: axis, y: skullY, r: radius } : null;

  // How the fighter is carrying itself. Read here rather than with the rest of
  // the invention below because the hips are part of it: a guard settles and a
  // reaction is knocked off its base, and both move the pelvis.
  const stance = stanceAt(action, frame);
  const attitude = attitudeOf(action.name, stance);

  // -- The pelvis -----------------------------------------------------------
  //
  // **Invented, and it used to be invented while looking derived.** The hips
  // were the top of the leg hurtbox: 54 of a 166-unit stack on 21 of the 24
  // fighters, 32.5% of stature, which draws a tower of torso on two stumps and
  // is the single thing the figure was most obviously wrong about.
  //
  // The crouch says that boundary is not a joint. Standing it is 54 of 166
  // (32.5%); crouching it is 41 of 119 (34.5%) — the same fraction of a smaller
  // body. That is what a *hit-height* convention does: the line between a low
  // and a mid stays where it is on the silhouette. A hip joint does the
  // opposite, dropping to about half its standing height while the head drops
  // by a third. So the boxes do not carry a hip, in any pose, and the pelvis is
  // placed by human proportion instead — 0.638 of the neck's own height, which
  // is 0.53 of stature on a body whose neck sits at 0.83 (`HIP_OF_STATURE`).
  //
  // The one real thing in it is `build.leg`, ADR-0059's per-fighter leg ratio,
  // damped by half because it is a bone chain and not a hip height: A.K.I.'s
  // hips ride 5% higher than Zangief's rather than 16%.
  const footY = leg ? toFeet(leg) : held - drop;
  const legScale = 1 + (build.leg - 1) * 0.5;
  const hipY = leg
    ? footY + (neckY - footY) * HIP_OF_NECK * legScale * (1 - attitude.sink)
    : held;
  const hips: Point = { x: axis, y: hipY };
  const neck: Point = { x: axis, y: neckY };
  const standing = Boolean(leg) || Boolean(last?.legs.length);

  // An active hitbox is a limb, and which limb the action's own name usually
  // says: `ATK_5MK` is a kick, `ATK_5HP` a punch. Where the name does not say —
  // every special — fall back to height, since a box down at shin level is not
  // coming out of a shoulder.
  const named = /^[A-Z]+_[0-9\[\]]*[LMH](P|K)/.exec(action.name);
  const byName = named ? named[1] === "K" : null;

  // How far the fighter can be drawing a limb: as far as its own hurtboxes go,
  // plus an arm. A limb is a *body part*, and a body part is hittable — Dhalsim's
  // arm reaches 300 units and carries hurtboxes the whole way. A.K.I.'s snake is
  // a 524-wide hitbox with no hurtbox anywhere near it, and drawn as an arm it
  // was a yellow beam out of a man who was not there. Past the reach it is not a
  // limb; the hitbox is still drawn as a hitbox.
  // -- The shoulder line and the pelvis line --------------------------------
  //
  // The shoulders and the hips are the only joints an arm or a leg can hang off,
  // and neither is in the dump. ADR-0059 hung both off *one point each*, the
  // shoulders 18 units apart on Ryu — a hair wider than his own 34-unit skull —
  // so the two arms and the spine met at the throat in a Y and the two legs met
  // in a V, and a walk read as a stance opening and closing rather than as steps.
  //
  // They are spread across the **body hurtbox's** own width now, not the
  // pushbox's. The body box is the authored width of the torso (±40 on Ryu, ±49
  // on Zangief, ±46 on Marisa) where the pushbox is how close two fighters may
  // stand; a shoulder belongs on the first. The fractions of it are invented.
  const bodyHalf = body ? (body[2] - body[0]) / 2 : half * 1.2;
  const shoulderHalf = Math.max(bodyHalf * 0.55, radius * 1.15);
  const pelvisHalf = bodyHalf * 0.3;
  const shoulderY = neckY - gap * 0.3;
  const shoulder = (s: 1 | -1): Point => ({ x: axis + s * shoulderHalf, y: shoulderY });

  const stature = Math.abs((skull ? skullY + gap : neckY) - footY);
  // A bone is as long as the body it is on, not as long as the pose it is in:
  // measured against the current frame's stature a crouching fighter grows short
  // arms. `build.stature` is the fighter's own idle stack (ADR-0060).
  const frame0 = build.stature || stature || radius * 9.8;
  const armLength = frame0 * ARM_OF_STATURE * build.arm;
  const legLength = frame0 * HIP_OF_STATURE * legScale * LEG_SLACK;
  const reach = Math.max(
    stature * 1.1,
    ...[...parts.head, ...parts.body, ...parts.leg].map((b) => Math.abs(flip(b.x + b.width / 2) - axis) + b.width / 2),
  );
  const limbs = hitboxesAt(action, frame)
    .map((raw) => {
      const b = placeBox(fighter, raw);
      const tip = { x: facing === 1 ? b.x + b.width : b.x, y: b.y + b.height / 2 };
      const kick = byName ?? tip.y < hips.y + (neck.y - hips.y) * 0.35;
      const root = kick ? hips : shoulder(facing);
      // Both joints fold *downwards* on a swing — an elbow under a punch, a knee
      // under a kick — which is ADR-0057's rule and the one the tests pin.
      return { root, joint: jointOf(root, tip, kick ? legLength : armLength, 0, -1), tip, kick, derived: true };
    })
    // Too far out is not a limb (ADR-0051) and neither is too close in: E.Honda's
    // `ATK_8LK` puts its box on the hip it would hang off, and a four-unit limb
    // is a dot, not a knee. The box is still drawn as a box.
    .filter((l) => Math.abs(l.tip.x - axis) <= reach + radius && Math.hypot(l.tip.x - l.root.x, l.tip.y - l.root.y) > radius);

  // The arms and the legs.
  //
  // ADR-0050 measured the boxes out past the footprint and threw them away so
  // they would not corrupt the torso union. They are the only thing in the dump
  // that says where a limb is, and ADR-0049 and ADR-0051 both left "the extended
  // limb's hurtboxes are still discarded" open. This closes it.
  //
  // **The part the box was tagged to says arm or leg** — `leg` is a leg,
  // `head`/`body` an arm. Height does not: of the 20,526 non-core `leg` boxes
  // 15,700 sit below the hips but 535 sit above the neck, and 1,603 non-core
  // `body` boxes are above the neck too. A box tagged to more than one part is
  // skipped here for the same reason it is skipped for the torso — Akuma's air
  // fireball hangs one box off all three and it names no limb either.
  //
  // **Which side of the body cannot be told.** The boxes are 2D, there is no
  // near or far, and 54,208 of the 58,337 non-core boxes (93%) sit forward of
  // the axis. So the extension goes to the limb on the side the boxes are on and
  // its partner keeps the resting pose — and a part carrying several non-core
  // boxes (Dee Jay's sweep tags both leg keys to the sweeping leg) is one limb
  // segmented, not two limbs.
  //
  // **An active hitbox wins.** On the 9,381 frames that have both, the hitbox
  // and the matching non-core hurtbox are the same limb — 8 units between their
  // centres at the median — so drawing both would draw it twice. That leaves
  // the extension to the 32,820 wind-up and recovery frames, which is where it
  // was wanted.
  const outboard = (which: readonly (keyof typeof parts)[]): Box[] =>
    push
      ? which
          .flatMap((w) => parts[w])
          .filter((b) => shared.get(id(b)) === 1 && Math.abs(b.x + b.width / 2 - middle) >= tolerance)
      : [];
  /**
   * The far end of an extended limb: the hand, or the foot.
   *
   * The furthest-reaching box of the set, and then the end of *that* box's own
   * long axis — a box is a segment of the limb, and a segment points the way the
   * limb runs. Two measurements force both halves of the rule. A limb is boxed
   * in pieces, so the union of a shoulder box with a horizontal arm box is tall
   * even though the arm is not: read from the union, Dhalsim's 5HP reach came
   * out of his shoulder and ended on the floor. And the boxes are mostly
   * **taller than they are wide** — 77% of the leg ones and 73% of the arm ones,
   * median 1.8 and 1.6 — so a tip always taken at mid-height put a sweeping foot
   * halfway up the shin and a rising kick's foot at the knee.
   */
  const extremity = (boxes: Box[], from: Point): Point => {
    const off = (b: Box): number => Math.abs(b.x + b.width / 2 - middle) + b.width / 2;
    const end = boxes.reduce((a, b) => (off(b) > off(a) ? b : a));
    const lo = end.y + origin.y;
    const hi = lo + end.height;
    const out = end.x + end.width / 2 > middle;
    return end.width >= end.height
      ? { x: flip(out ? end.x + end.width : end.x), y: (lo + hi) / 2 }
      : {
          x: flip(end.x + end.width / 2),
          y: Math.abs(lo - from.y) >= Math.abs(hi - from.y) ? lo : hi,
        };
  };
  const armBoxes = limbs.some((l) => !l.kick) ? [] : outboard(["head", "body"]);
  const legBoxes = limbs.some((l) => l.kick) ? [] : outboard(["leg"]);

  // -- Everything below here is invented ------------------------------------
  //
  // 90.8% of frames carry no extended-limb box at all (ADR-0058) -- every idle,
  // every walk and jump, and all 646 reaction actions -- so on almost every frame
  // the arms and the legs are this project's geometry and not the game's. The
  // dump was asked again before any of it was written, and the answer is in
  // ADR-0059: `MotionKey` is a clip id and a frame range, `MergeKey` a pair of
  // blend curves, `SwitchKey` a bitfield, `BonePlaceKey` one axis of a thrown
  // partner's root on 245 actions. **There are no bone transforms anywhere.**
  //
  // What the same search did turn up is four real signals, and the invention
  // below is keyed to them rather than to constants:
  //
  //   `motion.x`  the ground the action covers, per frame -- already extracted
  //               and never read by the figure. The walk cycle keys off it.
  //   `motion.y`  the jump's own arc, which says where in the leap it is.
  //   `physique`  per-fighter arm and leg proportion, as `build`.
  //   `stance`    the action's own standing / crouching / airborne label.
  //
  // The base stance is still ADR-0050's 0.48 of the pushbox half-width; the hand
  // offsets in `attitudeOf` and the joint proportions are made up outright.
  const lead = facing;

  /**
   * Keep an invented point inside the fighter's own hurtboxes.
   *
   * This is a training room: what is drawn has to be hittable. A derived limb
   * gets this for free — it is *on* a box — but an invented hand is placed by a
   * proportion, and a proportion that puts a fist a few units past the torso is
   * drawing a body part nothing can hit. The span is the footprint-filtered core
   * boxes, so an arm already out on its own hurtbox does not widen the cage.
   */
  const core = [body, leg, head].filter((b): b is [number, number, number, number] => Boolean(b));
  const caged = core.length
    ? [flip(Math.min(...core.map((b) => b[0]))), flip(Math.max(...core.map((b) => b[2])))].sort((a, b) => a - b)
    : null;
  const inside = (x: number): number => (caged ? clamp(x, caged[0]!, caged[1]!) : x);

  // -- The jump is keyed to its own arc -------------------------------------
  //
  // `motion.y` is the leap, and how fast it is climbing says where in it the
  // fighter is: full speed at the launch and at the landing, nothing at the apex.
  // The legs tuck in proportion, which is the one thing every jump does and no
  // hurtbox records -- a neutral jump keeps the same body box the whole way up.
  //
  // The speed is taken from the curve rather than from `motion.velocity`, which
  // is only the speed *left over* where the authored frames run out (ADR-0040)
  // and is absent on a jump that lands inside its own action — Dhalsim's does,
  // and read from `velocity` his legs never tucked at all.
  const arc = action.motion?.y;
  const airborne = stance === 3 || Boolean(arc && (arc[frame - 1] ?? 0) > radius);
  const climb = arc ? Math.abs((arc[frame] ?? arc[frame - 1] ?? 0) - (arc[frame - 1] ?? 0)) : 0;
  const launch = arc ? Math.max(...arc.map((v, i) => (i ? Math.abs(v - arc[i - 1]!) : 0))) : 0;
  const tuck = airborne && launch > 0 ? clamp(1 - climb / launch, 0, 1) : 0;

  // -- The walk is keyed to the ground it covers ----------------------------
  //
  // ADR-0058 recorded that `BAS_FORWARD_Loop` moves no hurtbox on any of its 114
  // frames, so there is no footfall to read. What the action *does* carry is
  // `motion.x`: Ryu's walk is 4.7 units a frame and 531.1 over the loop, and that
  // is a per-fighter number -- Dhalsim shuffles at 2.8, Akuma covers 5.2. Stepping
  // the gait off distance rather than off a frame counter is what makes the two
  // look different, and it is the same clock a dash already runs on.
  //
  // The stride is quantised so a whole number of them fits the action's travel,
  // because a walk `Loop` restarts every 114 frames (ADR-0033) and a stride that
  // did not divide it would snap a foot on the wrap.
  const travel = Math.abs(action.motion?.travel?.x ?? 0);
  const nominal = stature * 0.42;
  const stride = travel > nominal ? travel / Math.round(travel / nominal) : nominal;
  // Airborne travel is not a walk: a jumping fighter covers as much ground as a
  // walking one and has no floor to step off.
  const walking = standing && !airborne && Boolean(action.motion?.velocity?.x) && travel > nominal;
  const phase = walking ? (origin.x / stride) * Math.PI : null;
  // The *rate* is the grounded part: a step per stride of ground covered. How far
  // the foot swings is not. ADR-0059 held it to 0.35 of a stride because a figure
  // whose legs came out of a single hip point had no pelvis to widen the V, and a
  // foot thrown further read as a lunge; the legs are rooted on a pelvis now, so
  // it goes to 0.5 and the gait is visible in motion rather than only on a sheet.
  //
  // How wide the stance is, and how far a foot may swing, are bounded by the
  // same cage as the hands: Ryu's whole silhouette is inside ±40 on every frame
  // of his walk, so a foot thrown to 59 is a foot nothing can hit. ADR-0059's
  // 0.35 of a stride happened to fit; 0.5 does not, and clamped it pinned both
  // feet to the box edge for most of the cycle and the gait stopped moving at
  // all. So a walking fighter brings its feet **in** to make room to swing them,
  // which is also what a walk looks like next to a planted stance.
  const stanceX = half * 0.78 * build.leg * attitude.width * (walking ? 0.45 : 1);
  const room = caged ? Math.max(8, Math.min(caged[1]! - axis, axis - caged[0]!) - stanceX) * 0.92 : stride;
  const swing = Math.min(stride * 0.5, room);
  // A foot lifts by a fraction of the stride, but never past the hips: on a
  // fighter whose leg box is short the two are not far apart.
  const lift = Math.min(stride * 0.18, Math.abs(hipY - footY) * 0.5);

  /**
   * A resting arm: the hand where the attitude carries it, in this fighter's
   * own units.
   *
   * The two arms are placed *separately* — the lead hand out at the front of the
   * chest, the rear one tucked back — because a side-on figure whose arms are
   * mirror images of each other draws a pair of parentheses, which is what made
   * the old figure read as an ape rather than as a fighter.
   */
  const restingArm = (s: 1 | -1): { root: Point; tip: Point } => {
    const root = shoulder(s);
    const [dx, dy] = s === lead ? attitude.lead : attitude.rear;
    return {
      root,
      tip: { x: root.x + dx * armLength * lead, y: root.y + dy * armLength * up },
    };
  };
  // The feet keep ADR-0050's inset on the pushbox; what is new is that they no
  // longer come out of a single point. A pelvis is what lets a stride read as a
  // stride instead of as a stance opening.
  const restingLeg = (s: 1 | -1): { root: Point; tip: Point } => ({
    root: { x: axis + s * pelvisHalf, y: hipY },
    tip: { x: axis + s * stanceX, y: footY },
  });

  /**
   * Where a *resting* hand or foot ends up: the stance, plus the gait and the
   * tuck. A limb the boxes describe is never passed through here -- the dump wins
   * over the invention wherever the dump says anything at all.
   */
  const carried = (tip: Point, s: 1 | -1, foot: boolean): Point => {
    let { x, y } = tip;
    if (phase !== null) {
      const th = phase + (s === lead ? 0 : Math.PI);
      // A foot only lifts on the half of the cycle it is swinging -- the other
      // one is on the floor. The hands do not counter-swing the way a walker's
      // do: this is a fighter, who walks with the guard up, so the arms *bob*
      // with the step (the vertical term) and drift only a little (the
      // horizontal). ADR-0059's 0.35 horizontal counter-swing was invisible
      // anyway, being 0.35 of a swing that was itself held back.
      if (foot) {
        x += Math.cos(th) * swing * lead;
        y += Math.max(0, Math.sin(th)) * lift * up;
      } else {
        x += Math.cos(th) * swing * lead * -0.16;
        y += Math.sin(th * 2) * lift * 0.35 * up;
      }
    }
    if (tuck > 0) {
      // A tucked leg is folded, not retracted into the hips: an airborne leg box
      // can sit within a few units of the torso already, and taking 45% off that
      // leaves a foot inside the pelvis. The fold stops at a head's radius.
      const toward = foot ? hips.y : shoulderY;
      const pull = foot ? Math.min(0.45, Math.max(0, 1 - (radius * 1.5) / Math.max(1, Math.abs(toward - y)))) : 0.25;
      y += (toward - y) * tuck * pull;
      x += (axis - x) * tuck * (foot ? 0.35 : 0.2);
    }
    return { x, y };
  };

  const limbFrom = (
    rest: { root: Point; tip: Point },
    reachedFor: Point | null,
    s: 1 | -1,
    foot: boolean,
  ): Limb => {
    // A resting hand or foot is caged inside the fighter's own hurtboxes: this
    // is a training room, and an invented extremity a few units past the torso
    // is a body part nothing can hit. It binds on a stride (the swinging foot
    // wants to go 12 units past Ryu's box) and on a guard.
    const swung = carried(rest.tip, s, foot);
    const tip = reachedFor ?? { x: inside(swung.x), y: swung.y };
    // Both cases fold the same way now: a two-bone chain of the fighter's own
    // length, solved for where the elbow or the knee has to be. The old rule
    // dropped the joint perpendicular by a *fraction of the reach*, which is
    // backwards — a limb that reaches nowhere is a limb that is folded hard, and
    // one at full stretch is straight. A resting hand sits about a third of an
    // arm from its shoulder, and under the old rule that drew a nearly straight
    // stick angled across the chest.
    //
    // A knee tracks forward, an elbow back and down: that is the way the two
    // joints go, and it is also what tells them apart in silhouette.
    const joint = jointOf(rest.root, tip, foot ? legLength : armLength, foot ? lead * 0.9 : -lead * 0.7, -1);
    // A folded elbow is the one invented point that can leave the body sideways,
    // so it is caged like the hand. A derived limb is left alone: its joint is
    // between two points the boxes chose.
    return {
      root: rest.root,
      joint: reachedFor ? joint : { x: inside(joint.x), y: joint.y },
      tip,
      derived: Boolean(reachedFor),
    };
  };

  // A part with no box at all is invulnerable, not gone (ADR-0020), and the rule
  // has to reach the extension: on 112 frames across the roster a part vanishes
  // on the frame right after it carried one, and snapping the limb back to the
  // stance there would animate a retraction the dump never asked for. Held at
  // its offset from the joint, like every other part (ADR-0050).
  const heldReach = (which: "arms" | "legs", gone: boolean, s: 1 | -1, root: Point): Point | null => {
    if (!gone || !last) return null;
    const was = last[which].find((l) => l.derived && (l.tip.x >= last.hips.x ? 1 : -1) === s);
    return was ? { x: root.x + (was.tip.x - was.root.x), y: root.y + (was.tip.y - was.root.y) } : null;
  };

  // The extension goes to the limb on the side of the body the box is on, which
  // is forward 93% of the time and behind on a sweep's bracing arm.
  const side = (p: Point | null): number => (p ? (p.x >= axis ? 1 : -1) : 0);
  const arms: Limb[] = [-1, 1].map((n) => {
    const s = n as 1 | -1;
    const rest = restingArm(s);
    const tip = armBoxes.length ? extremity(armBoxes, rest.root) : null;
    return limbFrom(rest, s === side(tip) ? tip : heldReach("arms", faded.head && faded.body, s, rest.root), s, false);
  });
  const legs: Limb[] = standing
    ? [-1, 1].map((n) => {
        const s = n as 1 | -1;
        const rest = restingLeg(s);
        const tip = legBoxes.length ? extremity(legBoxes, rest.root) : null;
        return limbFrom(rest, s === side(tip) ? tip : heldReach("legs", faded.leg, s, rest.root), s, true);
      })
    : [];
  // Trailing limb first, so `legs[0]` is the foot the fighter is standing on and
  // the audit's stance measurements do not move when the other leg kicks.
  if (lead === -1) {
    arms.reverse();
    legs.reverse();
  }

  // A part is invulnerable when *no* hurtbox covers it, not when its own key is
  // missing. The hit test merges the keys (`hurtboxesAt`), so a leg inside the
  // body box is hittable however it was tagged — and it usually is: on 28,857 of
  // the 38,165 frames whose leg key is absent, another part's box covers the
  // shin, which is why a jump used to draw its legs dimmed as though a neutral
  // jump were lower-body invulnerable. The head almost never is (90 frames of
  // 41,998), so the airborne head still fades, honestly: nothing in the dump
  // reaches it.
  const live = [...parts.head, ...parts.body, ...parts.leg];
  const over = (y: number): boolean =>
    live.some(
      (b) => footprint >= b.x && footprint <= b.x + b.width && y >= b.y + origin.y && y <= b.y + b.height + origin.y,
    );
  const shin = legs.find((l) => !l.derived);
  if (faded.head && skull) faded.head = !over(skull.y);
  if (faded.body) faded.body = !over((neckY + hipY) / 2);
  if (faded.leg && shin) faded.leg = !over((hipY + shin.tip.y) / 2);

  return { head: skull, neck, hips, legs, arms, limbs, faded, footprint, stand: hipY - footY };
}

/**
 * The knee or the elbow: where a two-bone chain of length `bone` has to fold to
 * put its tip on `tip`, bending towards `(px, py)`.
 *
 * This replaces ADR-0057's perpendicular droop, which offset the joint by a
 * *fraction of the reach*. That is the wrong way round. A limb whose hand is
 * near its shoulder is folded to nearly nothing; a limb at full stretch is
 * straight. Under the old rule they came out the other way about, which is why a
 * resting arm was a slightly-kinked stick and Dhalsim's 361-unit reach needed a
 * cap bolted on to stop its elbow sagging 57 units off the line.
 *
 * The bones are equal halves. A real humerus is a shade shorter than the forearm
 * and a femur a shade longer than the shin, and neither difference survives
 * being drawn three pixels wide.
 *
 * Where the tip is further away than the chain is long — an extended limb read
 * off a hurtbox, which is a real thing that happens on Dhalsim — the chain
 * cannot reach and is drawn straight, with a token bend so it does not read as a
 * beam.
 */
function jointOf(root: Point, tip: Point, bone: number, px: number, py: number): Point {
  const dx = tip.x - root.x;
  const dy = tip.y - root.y;
  const span = Math.hypot(dx, dy);
  const mid = { x: (root.x + tip.x) / 2, y: (root.y + tip.y) / 2 };
  if (span < 1) return mid;
  // Of the two perpendiculars, the one the joint is supposed to fold towards.
  let nx = -dy / span;
  let ny = dx / span;
  if (nx * px + ny * py < 0) {
    nx = -nx;
    ny = -ny;
  }
  const half = Math.max(bone, 1) / 2;
  // Capped at a 55%-extended chain. A real elbow folds much tighter than that,
  // and a guard's does; drawn as two sticks it becomes a wing sticking out
  // further than the fighter's own torso, which is worse than a shallow fold.
  const off =
    span < bone
      ? Math.min(Math.sqrt(half * half - (span / 2) ** 2), bone * 0.42)
      : Math.max(2, Math.min(bone * 0.11, span * 0.06));
  return { x: mid.x + nx * off, y: mid.y + ny * off };
}

const clamp = (v: number, a: number, b: number): number =>
  a <= b ? Math.min(Math.max(v, a), b) : Math.min(Math.max(v, b), a);

/* ---- canvas -------------------------------------------------------------- */

/** The 2D context methods this module uses. Kept structural so tests can fake it. */
export interface Ctx {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, from: number, to: number): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  setLineDash(pattern: number[]): void;
  fillText(text: string, x: number, y: number): void;
}

const P1 = "#38bdf8";
const P2 = "#fb7185";

/**
 * The floor, its distance marks, and the walls the camera stops at.
 *
 * The floor is a *surface*, not a hairline: the fighters used to stand on a
 * single grey pixel in the middle of a black field, and with nothing behind
 * them there was no reading where the ground was until they landed on it. The
 * bands below it and the receding grid above are drawn from flat rects rather
 * than a gradient so the structural {@link Ctx} stays the small interface the
 * tests can fake.
 */
export function drawStage(ctx: Ctx, view: View, half: number): void {
  const { width, height, ground, scale } = view;

  // The backdrop. The camera has to keep jump height in frame, so on most frames
  // a third of the canvas is sky whatever the zoom — and sky drawn as #000 reads
  // as a bug rather than as room. Banded rather than a gradient so the
  // structural `Ctx` the tests fake stays small.
  const sky = Math.max(1, ground);
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    ctx.fillStyle = `rgba(${Math.round(18 + t * 22)},${Math.round(23 + t * 33)},${Math.round(34 + t * 47)},1)`;
    ctx.fillRect(0, (sky * i) / 14, width, sky / 14 + 1);
  }

  // The apron: the floor seen edge-on, darkening away from the front.
  const apron = height - ground;
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(30,41,59,${0.5 - i * 0.07})`;
    ctx.fillRect(0, ground + (apron * i) / 6, width, apron / 6 + 1);
  }
  // Depth lines running back from the front edge. Spaced by a square so they
  // crowd towards the horizon the way a receding plane does.
  for (let i = 1; i <= 4; i++) {
    ctx.fillStyle = `rgba(148,163,184,${0.1 - i * 0.018})`;
    ctx.fillRect(0, ground + apron * (1 - (1 - i / 5) ** 2), width, 1);
  }
  // A wash above the floor, so the fighters are lit from below rather than
  // floating in a void.
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = `rgba(56,89,138,${0.05 - i * 0.009})`;
    ctx.fillRect(0, ground - 26 * (i + 1), width, 26);
  }

  ctx.strokeStyle = "#3d4757";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, ground + 0.5);
  ctx.lineTo(width, ground + 0.5);
  ctx.stroke();
  ctx.fillStyle = "#2b3341";
  const from = Math.ceil((-half) / 100) * 100;
  for (let x = from; x <= half; x += 100) {
    const px = view.x(x);
    if (px >= 0 && px <= width) ctx.fillRect(px, ground + 4, 1, 10);
  }
  for (const side of [-1, 1]) {
    const x = view.x(side * half);
    if (x < -20 || x > width + 20) continue;
    // On the inside of the wall: the camera stops at the corner, so a line hung
    // outside it lands off the canvas exactly when it matters.
    ctx.fillStyle = "rgba(148,163,184,.55)";
    ctx.fillRect(side === -1 ? x : x - 3, ground - 260 * scale, 3, 260 * scale);
    ctx.fillStyle = "rgba(148,163,184,.07)";
    if (side === -1 && x > 0) ctx.fillRect(0, 0, x, ground);
    if (side === 1 && x < width) ctx.fillRect(x, 0, width - x, ground);
  }
}

/**
 * The one palette. Both pages drew boxes in slightly different colours because
 * both pages drew boxes; ADR-0053 left one implementation, so there is one set
 * of colours and the box viewer's is it — it is the richer of the two, having
 * had to tell a throw box from a proximity box from a leg.
 */
export type BoxKind =
  | "hit"
  | "projectile"
  | "throw"
  | "hurt"
  | "head"
  | "body"
  | "leg"
  | "prox"
  | "push"
  | "opponent";

const PALETTE: Record<BoxKind, { ink: string; fill: number; dashed?: true }> = {
  hit: { ink: "#ff4d4d", fill: 0.3 },
  projectile: { ink: "#ff8a3d", fill: 0.3 },
  throw: { ink: "#26c99a", fill: 0.07, dashed: true },
  hurt: { ink: "#4d8cff", fill: 0.09 },
  head: { ink: "#6fa4ff", fill: 0.09 },
  body: { ink: "#4d8cff", fill: 0.09 },
  leg: { ink: "#3f74d8", fill: 0.09 },
  prox: { ink: "#d8b74a", fill: 0.1, dashed: true },
  push: { ink: "#a06cff", fill: 0.05 },
  opponent: { ink: "#6d7488", fill: 0.16, dashed: true },
};

const alpha = (hex: string, a: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** One box, in the colours its kind is drawn in. */
export function drawBox(ctx: Ctx, view: View, kind: BoxKind, box: Box): void {
  const style = PALETTE[kind];
  const x = view.x(box.x);
  const y = view.y(box.y + box.height);
  const w = box.width * view.scale;
  const h = box.height * view.scale;
  ctx.fillStyle = alpha(style.ink, style.fill);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = style.ink;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(style.dashed ? [4, 3] : []);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
}

/** Hurt, hit and pushboxes for one fighter. */
export function drawBoxes(ctx: Ctx, view: View, boxes: WorldBoxes): void {
  for (const b of boxes.push) drawBox(ctx, view, "push", b);
  for (const b of boxes.hurt) drawBox(ctx, view, "hurt", b);
  for (const b of boxes.hit) drawBox(ctx, view, "hit", b);
}

/** A fireball: a hitbox with nothing attached, which is what it is. */
export function drawProjectile(ctx: Ctx, view: View, box: Box): void {
  drawBox(ctx, view, "projectile", box);
}

/**
 * The figure. A faded part is one the fighter is invulnerable on: held over from
 * the last frame that had it, and drawn thin so the invulnerability reads.
 */
export function drawFigure(ctx: Ctx, view: View, pose: Pose, side: 0 | 1, flash = 0): void {
  const tint = side === 0 ? P1 : P2;
  // Struck: the whole figure blows out to white and thickens for the length of
  // the hitstop. Without it a 900-damage roundhouse looked exactly like standing
  // still, because the defender's reaction animation moves its boxes barely at
  // all and the boxes are all the figure has.
  const hot = flash > 0 ? Math.min(1, flash) : 0;
  // Amber, not white: the figure is already near-white, so flashing it white is
  // a change nobody sees.
  const HOT = "#ffd27a";
  const line = (a: Point, b: Point, colour: string, width: number, dim: boolean): void => {
    ctx.globalAlpha = dim ? 0.35 : 1;
    ctx.strokeStyle = hot > 0 ? HOT : colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(view.x(a.x), view.y(a.y));
    ctx.lineTo(view.x(b.x), view.y(b.y));
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const body = Math.max(2, 3 * view.scale) * (1 + hot * 0.8);

  // A limb the boxes describe is body-coloured; one this project invented keeps
  // the player tint, so the two players stay apart and the cyan reads as "the
  // dump did not say" rather than as decoration.
  //
  // The forearm and the shin are drawn thinner than the upper arm and the thigh.
  // Uniform sticks give a limb no direction, so a bent one reads as a kink in a
  // wire rather than as a joint.
  const chain = (limb: Limb, width: number, dim: boolean): void => {
    const ink = limb.derived ? "#e5e7eb" : tint;
    line(limb.root, limb.joint, ink, width, dim);
    line(limb.joint, limb.tip, ink, Math.max(1.2, width * 0.72), dim);
  };

  line(pose.neck, pose.hips, "#e5e7eb", body, pose.faded.body);
  // The shoulder line and the pelvis, joining the roots of each pair. Both are
  // torso, both are invented (ADR-0060 places them on the body hurtbox's own
  // width), and without them the arms met the spine at the throat in a Y and the
  // legs met it at the hips in a V — which is what a figure with no shoulders
  // and no pelvis looks like.
  if (pose.arms.length === 2) line(pose.arms[0]!.root, pose.arms[1]!.root, "#e5e7eb", body, pose.faded.body);
  if (pose.legs.length === 2) line(pose.legs[0]!.root, pose.legs[1]!.root, "#e5e7eb", body, pose.faded.leg);
  for (const leg of pose.legs) chain(leg, body, pose.faded.leg);
  if (pose.head) {
    ctx.globalAlpha = pose.faded.head ? 0.35 : 1;
    ctx.strokeStyle = hot > 0 ? HOT : "#e5e7eb";
    ctx.lineWidth = body;
    ctx.beginPath();
    ctx.arc(view.x(pose.head.x), view.y(pose.head.y), pose.head.r * view.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Under the active limb rather than instead of it: a punching fighter still
  // has a second arm.
  for (const arm of pose.arms) chain(arm, Math.max(1.5, body - 1), pose.faded.body);
  // Warm is the attack, cool is the body. The kick used to be cyan, which is
  // also P1's tint — so on the left-hand fighter a live roundhouse and an
  // invented resting arm were the same colour.
  for (const limb of pose.limbs) {
    const ink = limb.kick ? "#fb923c" : "#fcd34d";
    line(limb.root, limb.joint, ink, body + 1, false);
    line(limb.joint, limb.tip, ink, body + 1, false);
  }
}

/**
 * Lean a struck figure away from the blow.
 *
 * **Invented, and the only invented thing in the figure besides the resting
 * arms.** The recoil is not in the dump: measured across the roster, all 646
 * reaction actions — every `DMG_*` and `GRD_*` — hold **one static hurtbox
 * layout for their entire duration**, while 1254 of the 1523 attack actions
 * move theirs frame to frame. The boxes animate for a swing and are frozen for
 * a flinch, because the flinch lives in the animation clip and MMDK dumps clip
 * names, not bones.
 *
 * So a figure derived from the boxes cannot recoil, and a training room where a
 * 900-damage roundhouse leaves the defender standing perfectly still reads as a
 * hit that did not land. What is real here is the *timing* — the caller drives
 * `lean` off the hitstun the table published — and the direction. Only the
 * shape is this project's: the spine pivots at the hips, the feet stay planted,
 * and the head lags a little behind the chest.
 */
export function recoiled(pose: Pose, lean: number, away: 1 | -1): Pose {
  if (lean <= 0) return pose;
  const turn = (p: Point, radians: number): Point => {
    const dx = p.x - pose.hips.x;
    const dy = p.y - pose.hips.y;
    return {
      x: pose.hips.x + dx * Math.cos(radians) + dy * Math.sin(radians),
      y: pose.hips.y - dx * Math.sin(radians) + dy * Math.cos(radians),
    };
  };
  const spine = away * lean * 0.3;
  // The head carries a third again, which is the whiplash.
  const neck = turn(pose.neck, spine);
  return {
    ...pose,
    neck,
    head: pose.head ? { ...pose.head, ...turn(pose.head, spine * 1.35) } : null,
    // The arms hang off the shoulders, so they go with the spine; the legs do
    // not, because the feet are planted.
    arms: pose.arms.map((l) => ({
      ...l,
      root: turn(l.root, spine),
      joint: turn(l.joint, spine),
      tip: turn(l.tip, spine),
    })),
    limbs: pose.limbs.map((l) => ({
      ...l,
      root: turn(l.root, spine),
      joint: turn(l.joint, spine),
      tip: turn(l.tip, spine),
    })),
  };
}

/* ---- impact -------------------------------------------------------------- */

/** How long a spark is drawn for, in match frames. */
export const IMPACT_FRAMES = 10;

/**
 * A contact, as the view needs it: where it happened and how hard.
 *
 * The match reports every hit with a world-space `at`; this is that plus a clock.
 * Nothing here changes what happened — the sparks are drawn from the same record
 * the contact log prints, so a spark that appears in the wrong place is a
 * reading error, not decoration gone astray.
 */
export interface Impact {
  at: Point;
  /** Frames since it landed. */
  age: number;
  type: "hit" | "block" | "parry" | "counter" | "punishCounter";
  /** Damage, which is what sizes it. A jab should not read like a Super. */
  weight: number;
}

const IMPACT_INK: Record<Impact["type"], [string, string]> = {
  hit: ["#fff6da", "#fbbf24"],
  counter: ["#fff1f1", "#f87171"],
  punishCounter: ["#ffe9e9", "#ef4444"],
  block: ["#e8f6ff", "#38bdf8"],
  parry: ["#e9fff5", "#34d399"],
};

/**
 * The spark. A ring that opens and fades, with spokes for a strike and none for
 * a block — a blocked hit is a stop, not a burst, and drawing the two the same
 * made every exchange read as damage.
 */
export function drawImpact(ctx: Ctx, view: View, impact: Impact): void {
  const t = impact.age / IMPACT_FRAMES;
  if (t >= 1) return;
  const [core, edge] = IMPACT_INK[impact.type];
  const x = view.x(impact.at.x);
  const y = view.y(impact.at.y);
  // In world units, then scaled — a spark measured in pixels is a spark that
  // changes size when the camera does. Damage spans 200 to 4000 across the
  // roster, so it is read as a root: the difference between a jab and a heavy
  // should show, and a Super should not swamp the screen.
  const size = (5 + Math.sqrt(Math.max(impact.weight, 120)) * 0.32) * view.scale;
  const grow = 0.35 + t * 0.9;
  const fade = (1 - t) ** 1.6;

  ctx.globalAlpha = fade * 0.85;
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1.2, size * 0.14 * (1 - t));
  ctx.beginPath();
  ctx.arc(x, y, size * grow, 0, Math.PI * 2);
  ctx.stroke();

  if (impact.type !== "block") {
    const spokes = 6;
    ctx.strokeStyle = core;
    ctx.lineWidth = Math.max(1, size * 0.1 * (1 - t));
    for (let i = 0; i < spokes; i++) {
      // Fanned off a fixed phase per spoke: a spark that reseeds every frame
      // shimmers, and the frame stepper has to be able to look at one twice.
      const a = (i / spokes) * Math.PI * 2 + (i % 2 ? 0.5 : 0);
      const from = size * grow * 0.7;
      const to = size * (grow + 0.55 + (i % 3) * 0.18);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * from, y + Math.sin(a) * from);
      ctx.lineTo(x + Math.cos(a) * to, y + Math.sin(a) * to);
      ctx.stroke();
    }
  }

  // The flash at the centre, gone in the first third.
  if (t < 0.35) {
    ctx.globalAlpha = (1 - t / 0.35) * 0.9;
    ctx.fillStyle = core;
    const r = size * 0.45;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  ctx.globalAlpha = 1;
}

/**
 * How far to shove the camera this frame, in pixels.
 *
 * Hitstop is the game's own pause on contact and it is already in the dump —
 * both sides freeze for `hitStop.owner` frames. Freezing without moving reads as
 * a dropped frame, so the freeze is where the shake goes. Deterministic in the
 * frame number: the stepper has to draw the same frame twice and get the same
 * picture.
 */
export function shakeAt(hitstop: number, frame: number, weight = 1): Point {
  if (hitstop <= 0) return { x: 0, y: 0 };
  const amp = Math.min(9, hitstop * 0.8) * Math.min(1.4, 0.5 + weight / 1200);
  const wobble = (n: number): number => {
    const v = Math.sin(n * 12.9898) * 43758.5453;
    return (v - Math.floor(v)) * 2 - 1;
  };
  return { x: wobble(frame) * amp, y: wobble(frame + 101) * amp * 0.55 };
}

/** Health, Drive in its six bars, super in three. */
export function drawGauges(
  ctx: Ctx,
  view: View,
  side: 0 | 1,
  bars: {
    health: number;
    healthMax: number;
    recoverable: number;
    drive: number;
    driveMax: number;
    burnout: boolean;
    superMeter: number;
    superMax: number;
  },
): void {
  const { width } = view;
  const w = width / 2 - 40;
  const x = side === 0 ? 20 : width / 2 + 20;
  const right = side === 0;
  ctx.fillStyle = "#1b1f27";
  ctx.fillRect(x, 16, w, 12);
  const filled = (Math.max(0, bars.health) / bars.healthMax) * w;
  const grey = (Math.max(0, bars.recoverable) / bars.healthMax) * w;
  if (grey > 0) {
    ctx.fillStyle = "#6b7280";
    ctx.fillRect(right ? x + w - filled - grey : x + filled, 16, grey, 12);
  }
  ctx.fillStyle = side === 0 ? P1 : P2;
  ctx.fillRect(right ? x + w - filled : x, 16, filled, 12);

  const gauge = (y: number, value: number, max: number, segments: number, colour: string, height: number): void => {
    const gw = w * 0.62;
    const gx = side === 0 ? x + w - gw : x;
    ctx.fillStyle = "#161a21";
    ctx.fillRect(gx, y, gw, height);
    ctx.fillStyle = colour;
    const on = (Math.max(0, value) / max) * gw;
    ctx.fillRect(right ? gx + gw - on : gx, y, on, height);
    ctx.fillStyle = "#0b0d11";
    for (let s = 1; s < segments; s++) ctx.fillRect(gx + (gw * s) / segments, y, 1, height);
  };
  gauge(32, bars.drive, bars.driveMax, 6, bars.burnout ? "#ef4444" : "#22d3ee", 7);
  gauge(42, bars.superMeter, bars.superMax, 3, "#facc15", 5);
}
