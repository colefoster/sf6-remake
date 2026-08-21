/**
 * The authored pose library: a second path into the same {@link Pose}.
 *
 * `poseOf` derives the figure from the collision boxes, which is the right
 * source for *what is hittable* and the wrong one for *what the move looks
 * like* — 902 of 1,311 attacks carry no outboard hurtbox at all before their
 * first active frame, so the wind-up is simply not in the dump. This module
 * inverts that: **the pose is authored and the timing is the dump's, exactly.**
 *
 * Nothing here reads a hurtbox to place a limb. Every point a pose file carries
 * is this project's invention, which is why every {@link Limb} it produces
 * reports `derived: false` and why {@link Pose.limbs} — the body-coloured
 * hitbox limb — is always empty. What *is* the dump's is the clock: the anchors
 * resolve against the action's own `MainFrame`, its active windows and its
 * `MarginFrame`, and `contact` lands exactly on the first active frame so the
 * hitstop (ADR-0057) plays over the pose that earned it.
 *
 * The derived path is untouched. See docs/adr/0067.
 */

import type { GeometryAction } from "../data/geometry.js";
import { activeWindows, hurtPartsAt, originAt, pushboxesAt } from "../data/geometry.js";
import type { Build, Limb, Point, Pose, Posed } from "./render.js";
import { jointOf } from "./render.js";

/* ---- the format ---------------------------------------------------------- */

/**
 * A point in a keyframe: **fractions of the fighter's idle stature**, origin at
 * the axis on the floor, `+x` forward (towards the opponent). Playback mirrors
 * by `facing` and scales by `Build.stature`, so one library serves any body.
 */
export interface Normalised {
  x: number;
  y: number;
}

/**
 * One keyframe: seven points and nothing else.
 *
 * Elbows and knees are **not** here. They are re-solved at playback by the same
 * two-bone {@link jointOf} the derived figure uses, so the bone length is a
 * property of the body rather than of the pose. `bend` flips the fold direction
 * of one limb where the default reads wrong; index 0 is the lead limb in both
 * pairs, index 1 the rear.
 */
export interface AuthoredPose {
  pelvis: Normalised;
  chest: Normalised;
  head: Normalised;
  /** Lead hand first. */
  hands: [Normalised, Normalised];
  /** Lead foot first. */
  feet: [Normalised, Normalised];
  bend?: { hands?: (1 | -1 | null)[]; feet?: (1 | -1 | null)[] };
}

/**
 * Where a key sits in the action, named relative to that action's own frame
 * data rather than as an absolute frame. A balance patch that moves a startup
 * replays the same file correctly.
 */
export type Anchor =
  | "start"
  | "contact"
  | "activeEnd"
  | "neutral"
  | readonly ["startup", number]
  | readonly ["recovery", number];

export interface AuthoredKey {
  at: Anchor;
  pose: AuthoredPose;
}

export interface PoseFile {
  character: string;
  move: string;
  /** The action's name, checked against the geometry at resolve time. */
  action: string;
  keys: AuthoredKey[];
}

/* ---- the clock ----------------------------------------------------------- */

/**
 * The four frames every anchor is expressed against, read off one action.
 *
 * A field is `null` where the action does not carry it, and the two cases where
 * that happens are both real and both measured:
 *
 * - **A projectile caster has no `MainFrame` and no active window.** Ryu's
 *   `SPA_HADO` is `MainFrame -1`, `activeWindows` empty; the move's startup is
 *   the frame its `ShotKey` spawns the fireball on (16 on the light version),
 *   and the fireball's 70 active frames belong to a different action entirely
 *   (ADR-0022). So `contact` and `activeEnd` are both taken from the shot.
 * - **An airborne action has no `MarginFrame`.** `ATK_8HK` and
 *   `SPA_SYORYU_START` are both `-1`: recovery is the landing action's, on the
 *   landing action's own clock (ADR-0056's restarting twin), so there is no
 *   frame in *this* action for `neutral` to name. It stays `null` and a file
 *   that asks for one is reported rather than guessed at.
 */
export interface Clock {
  start: 1;
  /** `MainFrame`: the last startup frame. */
  main: number | null;
  /** The first active frame — `main + 1`, or a projectile's spawn frame. */
  contact: number | null;
  activeEnd: number | null;
  /** `MarginFrame`: the first frame the fighter is free. */
  neutral: number | null;
  frames: number | null;
}

export function clockOf(action: GeometryAction): Clock {
  const windows = activeWindows(action);
  const shot = action.shots?.[0];
  const main = action.mainFrame !== null && action.mainFrame > 0 ? action.mainFrame : null;
  const first = windows[0]?.start ?? null;
  const contact = main !== null ? main + 1 : (first ?? shot?.frame ?? null);
  const activeEnd = windows.length ? windows[windows.length - 1]!.end : (shot?.frame ?? null);
  const margin = action.marginFrame !== null && action.marginFrame > 0 ? action.marginFrame : null;
  return {
    start: 1,
    main: main ?? (contact !== null ? contact - 1 : null),
    contact,
    activeEnd,
    neutral: margin,
    frames: action.frames,
  };
}

/** The name of an anchor, for a diagnostic. */
const anchorName = (at: Anchor): string => (typeof at === "string" ? at : `${at[0]} ${at[1]}`);

/**
 * The frame an anchor names, or `null` when the action does not carry the
 * frame data the anchor is expressed against.
 *
 * `contact` is the one anchor that is never rounded and never approximated: it
 * is `MainFrame + 1` and nothing else.
 */
export function resolveAnchor(clock: Clock, at: Anchor): number | null {
  if (at === "start") return clock.start;
  if (at === "contact") return clock.contact;
  if (at === "activeEnd") return clock.activeEnd;
  if (at === "neutral") return clock.neutral;
  const [phase, t] = at;
  if (phase === "startup") {
    if (clock.main === null) return null;
    return Math.round(1 + t * (clock.main - 1));
  }
  if (clock.activeEnd === null || clock.neutral === null) return null;
  return Math.round(clock.activeEnd + t * (clock.neutral - clock.activeEnd));
}

export interface ResolvedKey {
  frame: number;
  at: Anchor;
  pose: AuthoredPose;
}

export interface Resolved {
  keys: ResolvedKey[];
  /** Every reason this file does not bind cleanly to this action. Empty is the good case. */
  problems: string[];
}

/**
 * Bind a file's keys to an action's frames.
 *
 * Problems are collected rather than thrown: this runs inside a draw loop, and
 * a file that half-binds should still draw the keys that did bind. The tests
 * assert the shipped files bind with no problems at all.
 */
export function resolveKeys(file: PoseFile, action: GeometryAction): Resolved {
  const clock = clockOf(action);
  const problems: string[] = [];
  if (file.action !== action.name)
    problems.push(`file names action ${file.action}, resolved against ${action.name}`);
  const keys: ResolvedKey[] = [];
  for (const key of file.keys) {
    const frame = resolveAnchor(clock, key.at);
    if (frame === null) {
      problems.push(`${anchorName(key.at)} does not resolve on ${action.name}`);
      continue;
    }
    keys.push({ frame, at: key.at, pose: key.pose });
  }
  for (let i = 1; i < keys.length; i++)
    if (keys[i]!.frame <= keys[i - 1]!.frame)
      problems.push(
        `${anchorName(keys[i]!.at)} lands on frame ${keys[i]!.frame}, at or before ${anchorName(keys[i - 1]!.at)} on ${keys[i - 1]!.frame}`,
      );
  if (!keys.length) problems.push(`no key resolved on ${action.name}`);
  return { keys, problems };
}

/* ---- interpolation ------------------------------------------------------- */

/** Smoothstep. A linear blend between two keys reads as a machine changing gear. */
const ease = (t: number): number => t * t * (3 - 2 * t);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const between = (a: Normalised, b: Normalised, t: number): Normalised => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});

/**
 * The authored pose on a frame: the key that sits on it, or the eased blend of
 * the two either side.
 *
 * Before the first key and after the last the nearest key is held. **Holding is
 * not what the spec asked for past `neutral`** — it asked for a return to the
 * idle pose over the action's remaining frames — and that is not done here,
 * because there is no authored idle to return *to* until a `neutral` pose
 * exists for every fighter. Held is stated rather than dressed up.
 */
export function sampleAuthored(keys: ResolvedKey[], frame: number): AuthoredPose | null {
  if (!keys.length) return null;
  if (frame <= keys[0]!.frame) return keys[0]!.pose;
  const last = keys[keys.length - 1]!;
  if (frame >= last.frame) return last.pose;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1]!.frame <= frame) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  if (frame === a.frame) return a.pose;
  const t = ease((frame - a.frame) / (b.frame - a.frame));
  // The bend is a discrete choice, not a quantity: blending +1 towards -1 sends
  // an elbow through the straight line half way between two keys.
  const bend = (t < 0.5 ? a.pose.bend : b.pose.bend) ?? null;
  return {
    ...(bend ? { bend } : {}),
    pelvis: between(a.pose.pelvis, b.pose.pelvis, t),
    chest: between(a.pose.chest, b.pose.chest, t),
    head: between(a.pose.head, b.pose.head, t),
    hands: [between(a.pose.hands[0], b.pose.hands[0], t), between(a.pose.hands[1], b.pose.hands[1], t)],
    feet: [between(a.pose.feet[0], b.pose.feet[0], t), between(a.pose.feet[1], b.pose.feet[1], t)],
  };
}

/* ---- the invented body --------------------------------------------------- */

/**
 * Everything below is this project's and none of it is in either dump.
 *
 * The shoulder and pelvis half-widths are the fractions of stature that
 * ADR-0060's rule works out to on Ryu — his body hurtbox is ±40 on a 166 stack,
 * and 0.55 and 0.30 of that are 22 and 12 units, or 0.133 and 0.072 of stature.
 * They are frozen as fractions here rather than read off the box because an
 * authored figure is not allowed to claim a box put it anywhere.
 *
 * The **arm is the anthropometric length, 0.37**, and not the 0.25 the derived
 * figure draws. ADR-0060 records why the derived one is short: the honesty cage
 * keeps an invented hand inside the fighter's own hurtboxes, and a real-length
 * arm cannot extend inside a ±40 chest. There is no cage here — the whole
 * figure is invention and says so — so the compromise is not owed.
 */
const SHOULDER_HALF = 0.133;
const PELVIS_HALF = 0.072;
/** Shoulder to wrist, as a body has it. */
const ARM = 0.37;
/** Hip to sole, with ADR-0060's 2% of slack so a standing knee still reads. */
const LEG = 0.53 * 1.02;
/** How far under the chest point the shoulder line hangs, in skull radii. */
const SHOULDER_DROP = 0.3;
/** Which way an elbow and a knee fold by default: elbow back, knee forward. */
const ELBOW_FOLD = -0.7;
const KNEE_FOLD = 0.9;

/* ---- playback ------------------------------------------------------------ */

export interface AuthoredOptions {
  /** Pre-resolved keys, so a draw loop need not re-bind every frame. */
  resolved?: Resolved;
  /** Held over when a frame has no pushbox, exactly as the derived figure does. */
  last?: Pose;
}

/**
 * The authored figure for one frame, in the same world units and the same
 * {@link Pose} shape `drawFigure` already takes.
 *
 * Returns `null` when there is nothing to draw: no stature to scale by, or no
 * key that bound to this action.
 */
export function authoredPoseOf(
  file: PoseFile,
  fighter: Posed,
  radius: number,
  build: Build,
  options: AuthoredOptions = {},
): Pose | null {
  const { action, frame, facing } = fighter.state;
  const stature = build.stature;
  if (!stature) return null;
  const resolved = options.resolved ?? resolveKeys(file, action);
  const authored = sampleAuthored(resolved.keys, frame);
  if (!authored) return null;

  const at = fighter.position();
  const origin = originAt(action, frame);
  const push = pushboxesAt(action, frame);
  const footprint = push.length
    ? (Math.min(...push.map((b) => b.x)) + Math.max(...push.map((b) => b.x + b.width))) / 2
    : (options.last?.footprint ?? 0);
  const axis = facing === 1 ? at.x + footprint : at.x - footprint;

  /** Normalised, forward-facing, floor-origin -> world. */
  const world = (p: Normalised): Point => ({
    x: axis + facing * p.x * stature,
    y: origin.y + p.y * stature,
  });

  const hips = world(authored.pelvis);
  const neck = world(authored.chest);
  const skull = world(authored.head);
  const shoulderY = neck.y - radius * SHOULDER_DROP;
  const armBone = ARM * stature * build.arm;
  const legBone = LEG * stature * build.leg;

  /** `s` is +1 on the lead side of the body, -1 on the rear. */
  const chain = (tip: Point, root: Point, bone: number, fold: number): Limb => ({
    root,
    joint: jointOf(root, tip, bone, fold * facing, -1),
    tip,
    // The whole figure is invention. Nothing here was read off a box, so no
    // part of it may claim the dump put it there.
    derived: false,
  });

  const bendOf = (hint: (1 | -1 | null)[] | undefined, i: number): number => hint?.[i] ?? 1;

  /** Lead limb first, then rear — the file's order. */
  const armPair = [0, 1].map((i) => {
    const s = i === 0 ? 1 : -1;
    const root: Point = { x: neck.x + facing * s * SHOULDER_HALF * stature, y: shoulderY };
    return chain(world(authored.hands[i]!), root, armBone, ELBOW_FOLD * bendOf(authored.bend?.hands, i));
  });
  const legPair = [0, 1].map((i) => {
    const s = i === 0 ? 1 : -1;
    const root: Point = { x: hips.x + facing * s * PELVIS_HALF * stature, y: hips.y };
    return chain(world(authored.feet[i]!), root, legBone, KNEE_FOLD * bendOf(authored.bend?.feet, i));
  });
  // `Pose` orders each pair trailing-then-leading, so `legs[0]` is the foot the
  // audits measure a stance from. The file orders them lead-first.
  const arms = [armPair[1]!, armPair[0]!];
  const legs = [legPair[1]!, legPair[0]!];

  // The fade is the one thing here that is not invented: a part with no hurtbox
  // this frame is invulnerable (ADR-0020), and that is worth drawing whichever
  // figure is on screen. It says nothing about where the limb is.
  const parts = hurtPartsAt(action, frame);
  const live = [...parts.head, ...parts.body, ...parts.leg];
  const over = (y: number): boolean =>
    live.some(
      (b) =>
        footprint >= b.x &&
        footprint <= b.x + b.width &&
        y >= b.y + origin.y &&
        y <= b.y + b.height + origin.y,
    );
  const faded = {
    head: !parts.head.length && !over(skull.y),
    body: !parts.body.length && !over((neck.y + hips.y) / 2),
    leg: !parts.leg.length && !over((hips.y + Math.min(legs[0]!.tip.y, legs[1]!.tip.y)) / 2),
  };

  return {
    head: { x: skull.x, y: skull.y, r: radius },
    neck,
    hips,
    legs,
    arms,
    // The warm limb is the hitbox drawn as the limb that carries it — a derived
    // part, by construction. An authored figure has already drawn the striking
    // limb, and drawing the box's version over it would be the derived path
    // leaking back in.
    limbs: [],
    faded,
    footprint,
    stand: hips.y - Math.min(legs[0]!.tip.y, legs[1]!.tip.y),
    // Attitude is the derived figure's settle state (ADR-0065). An authored pose
    // has no attitude to ease: every frame of it is stated outright.
    attitude: { lead: [0, 0], rear: [0, 0], width: 1, sink: 0 },
    action: action.id,
  };
}

/**
 * How far past full extension the furthest limb of a resolved file reaches, as
 * a multiple of its own bone length.
 *
 * `jointOf` folds a chain to reach its tip, which is what keeps a bone length
 * constant — but a tip *further away than the chain is long* is drawn straight,
 * and that limb is stretched. Nothing forbids authoring one, so this measures
 * it: 1 or below is a figure whose every limb folds honestly.
 */
export function overreach(keys: ResolvedKey[], build: Build = { arm: 1, leg: 1, stature: 1 }): number {
  let worst = 0;
  const span = (a: Normalised, b: Normalised): number => Math.hypot(a.x - b.x, a.y - b.y);
  for (const key of keys) {
    const p = key.pose;
    for (const i of [0, 1]) {
      const s = i === 0 ? 1 : -1;
      const shoulder = { x: p.chest.x + s * SHOULDER_HALF, y: p.chest.y };
      const hip = { x: p.pelvis.x + s * PELVIS_HALF, y: p.pelvis.y };
      worst = Math.max(worst, span(shoulder, p.hands[i]!) / (ARM * build.arm));
      worst = Math.max(worst, span(hip, p.feet[i]!) / (LEG * build.leg));
    }
  }
  return worst;
}
