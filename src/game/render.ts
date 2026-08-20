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
import { hitboxesAt, hurtPartsAt, originAt, pushboxesAt } from "../data/geometry.js";
import type { Fighter } from "./index.js";

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
  feet: Point[];
  /** An active hitbox, drawn as the limb that carries it. */
  limbs: { root: Point; tip: Point; kick: boolean }[];
  faded: { head: boolean; body: boolean; leg: boolean };
  /**
   * The pushbox's centre in action space — the axis the figure hangs on, kept so
   * a frame with no pushbox can hold the last one instead of snapping to the
   * fighter's own x.
   */
  footprint: number;
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
 * The camera. Keeps both fighters and a margin on screen, stops at the walls so
 * a corner reads as one, and never shrinks the pair to nothing when they are far
 * apart.
 */
export function viewFor(
  canvas: { clientWidth: number; clientHeight: number },
  positions: [number, number],
  half: number,
): View {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const span = Math.max(560, Math.abs(positions[1] - positions[0]) + 420);
  const room = half - span / 2;
  const centre = (positions[0] + positions[1]) / 2;
  const mid = room <= 0 ? 0 : Math.max(-room, Math.min(room, centre));
  const scale = Math.min(width / span, height / 330);
  const ground = height - 56;
  return {
    width,
    height,
    scale,
    ground,
    x: (units) => width / 2 + (units - mid) * scale,
    y: (units) => ground - units * scale,
  };
}

/** A fighter's boxes in world space: the runtime's own placement, mirrored. */
export function worldBoxes(fighter: Fighter): WorldBoxes {
  const { action, frame } = fighter.state;
  return {
    hurt: place(fighter, (a, f) => [...hurtPartsAt(a, f).head, ...hurtPartsAt(a, f).body, ...hurtPartsAt(a, f).leg]),
    hit: place(fighter, hitboxesAt),
    push: place(fighter, pushboxesAt),
  };
  function place(f: Fighter, boxes: (a: GeometryAction, n: number) => Box[]): Box[] {
    return boxes(action, frame).map((b) => placeBox(f, b));
  }
}

/** One box from action space into world space. */
export function placeBox(fighter: Fighter, box: Box): Box {
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
export function poseOf(fighter: Fighter, radius: number, last?: Pose): Pose {
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
    return { head: null, neck: { x: at.x, y: 0 }, hips: { x: at.x, y: 0 }, feet: [], limbs: [], faded, footprint };
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
  const drop = last?.feet.length ? last.hips.y - last.feet[0]!.y : 0;
  const hipY = leg ? toHead(leg) : body ? (spine === null ? toFeet(body) : toHead(body) - spine) : last!.hips.y;
  const neckY = body ? toHead(body) : hipY + (spine ?? 0);

  // The skull hangs off the head box's far edge, but stays on the neck. The head
  // key is often much taller than a head — Ryu's crouch carries two boxes over 50
  // units — which left a bare neck as long as the skull, and A.K.I.'s command
  // grab has a head box *below* the torso, which buried the skull in the chest.
  const gap = radius * (up === 1 ? 1 : -1);
  const skullY = head
    ? clamp(toHead(head) - gap, neckY + gap * 0.6, neckY + gap * 1.5)
    : neckY + gap;
  const skull = head || last?.head ? { x: axis, y: skullY, r: radius } : null;

  const hips: Point = { x: axis, y: hipY };
  const neck: Point = { x: axis, y: neckY };
  // Feet inset a fixed fraction of the pushbox's half-width, on the far end of
  // the leg boxes. Not the leg union's own width: a kick doubles that.
  const footY = leg ? toFeet(leg) : hipY - drop;
  const feet: Point[] = leg || last?.feet.length ? [-1, 1].map((s) => ({ x: axis + s * half * 0.48, y: footY })) : [];

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
  const stature = Math.abs((skull ? skullY + gap : neckY) - footY);
  const reach = Math.max(
    stature * 1.1,
    ...[...parts.head, ...parts.body, ...parts.leg].map((b) => Math.abs(flip(b.x + b.width / 2) - axis) + b.width / 2),
  );
  const limbs = hitboxesAt(action, frame)
    .map((raw) => {
      const b = placeBox(fighter, raw);
      const tip = { x: facing === 1 ? b.x + b.width : b.x, y: b.y + b.height / 2 };
      const kick = byName ?? tip.y < hips.y + (neck.y - hips.y) * 0.35;
      return { root: kick ? hips : { x: neck.x, y: neck.y - radius * 0.4 }, tip, kick };
    })
    .filter((l) => Math.abs(l.tip.x - axis) <= reach + radius);

  return { head: skull, neck, hips, feet, limbs, faded, footprint };
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
  fillText(text: string, x: number, y: number): void;
}

const P1 = "#38bdf8";
const P2 = "#fb7185";

/** The floor, its distance marks, and the walls the camera stops at. */
export function drawStage(ctx: Ctx, view: View, half: number): void {
  const { width, ground, scale } = view;
  ctx.strokeStyle = "#20252e";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, ground + 0.5);
  ctx.lineTo(width, ground + 0.5);
  ctx.stroke();
  ctx.fillStyle = "#151920";
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

function rect(ctx: Ctx, view: View, box: Box, stroke: string, fill: string): void {
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  const x = view.x(box.x);
  const y = view.y(box.y + box.height);
  const w = box.width * view.scale;
  const h = box.height * view.scale;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Hurt, hit and pushboxes, in the colours the viewer has always used. */
export function drawBoxes(ctx: Ctx, view: View, boxes: WorldBoxes): void {
  for (const b of boxes.push) rect(ctx, view, b, "rgba(107,114,128,.6)", "rgba(107,114,128,.08)");
  for (const b of boxes.hurt) rect(ctx, view, b, "rgba(59,130,246,.75)", "rgba(59,130,246,.14)");
  for (const b of boxes.hit) rect(ctx, view, b, "rgba(239,68,68,.95)", "rgba(239,68,68,.28)");
}

/** A fireball: a hitbox with nothing attached, which is what it is. */
export function drawProjectile(ctx: Ctx, view: View, box: Box): void {
  rect(ctx, view, box, "rgba(251,191,36,.95)", "rgba(251,191,36,.3)");
}

/**
 * The figure. A faded part is one the fighter is invulnerable on: held over from
 * the last frame that had it, and drawn thin so the invulnerability reads.
 */
export function drawFigure(ctx: Ctx, view: View, pose: Pose, side: 0 | 1): void {
  const tint = side === 0 ? P1 : P2;
  const line = (a: Point, b: Point, colour: string, width: number, dim: boolean): void => {
    ctx.globalAlpha = dim ? 0.35 : 1;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(view.x(a.x), view.y(a.y));
    ctx.lineTo(view.x(b.x), view.y(b.y));
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const body = Math.max(2, 3 * view.scale);

  line(pose.neck, pose.hips, "#e5e7eb", body, pose.faded.body);
  for (const foot of pose.feet) line(pose.hips, foot, "#e5e7eb", body, pose.faded.leg);
  if (pose.head) {
    ctx.globalAlpha = pose.faded.head ? 0.35 : 1;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = body;
    ctx.beginPath();
    ctx.arc(view.x(pose.head.x), view.y(pose.head.y), pose.head.r * view.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Arms at rest, hanging off the shoulders. The dump says nothing about them —
  // an arm with no hitbox has no box of its own — so they are drawn under the
  // active limb rather than instead of it: a punching fighter still has a
  // second arm.
  for (const s of [-1, 1] as const) {
    const shoulder = { x: pose.neck.x + s * 10, y: pose.neck.y - 6 };
    line(shoulder, { x: shoulder.x + s * 8, y: pose.hips.y + 6 }, tint, Math.max(1.5, body - 1), pose.faded.body);
  }
  for (const limb of pose.limbs) {
    line(limb.root, limb.tip, limb.kick ? "#7dd3fc" : "#fcd34d", body + 1, false);
  }
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
