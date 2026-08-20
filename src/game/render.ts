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
 * whose hurtbox has gone rather than dropping it — a rising Shoryuken has no head
 * or body box at all on its invulnerable frames.
 *
 * The figure hangs on **one vertical axis, taken from the pushbox**, because the
 * hurtbox unions cannot supply one: each part's union drifts differently as limbs
 * extend, so three joints meant three notions of where the fighter was and the
 * figure came apart. The pushbox is the body's authored footprint and does not
 * move. Heights still come from the hurtboxes; only the horizontal placement is
 * the pushbox's. See issue 06.
 */
export function poseOf(fighter: Fighter, radius: number, last?: Pose): Pose {
  const { action, frame, facing } = fighter.state;
  const at = fighter.position();
  const origin = originAt(action, frame);
  const parts = hurtPartsAt(action, frame);
  const flip = (x: number): number => (facing === 1 ? at.x + x : at.x - x);

  // The footprint, in action space: the pushbox, which does not move.
  const push = union(pushboxesAt(action, frame));
  const axis = push ? flip((push[0] + push[2]) / 2) : at.x;
  const half = push ? (push[2] - push[0]) / 2 : radius * 2.4;

  // A part is the boxes sitting over the footprint. A box centred out towards the
  // pushbox's edge or beyond is an extended limb carrying its own hurtbox, and
  // folding that into the union is what broke the figure: on 5LK it made the leg
  // union 174 wide and 100 tall, so the hips rode up and forward and the feet
  // splayed, and on 2MK a thigh box centred exactly on the pushbox edge put the
  // hips above the neck. The core boxes sit near the axis; the limbs do not.
  const middle = push ? (push[0] + push[2]) / 2 : 0;
  const tolerance = push ? ((push[2] - push[0]) / 2) * 0.6 : 0;
  const box = (which: keyof typeof parts): [number, number, number, number] | null => {
    const all = parts[which];
    const core = push ? all.filter((b) => Math.abs(b.x + b.width / 2 - middle) < tolerance) : all;
    const u = union(core.length ? core : all);
    return u ? [u[0], u[1] + origin.y, u[2], u[3] + origin.y] : null;
  };

  const head = box("head");
  const body = box("body");
  const leg = box("leg");
  const faded = { head: !head, body: !body, leg: !leg };
  const torso = body ?? leg ?? null;

  // Nothing to stand on and nothing held over: the fighter is not drawable this
  // frame (a projectile's own action, an intro). Callers skip it.
  if (!torso && !last) {
    return { head: null, neck: { x: at.x, y: 0 }, hips: { x: at.x, y: 0 }, feet: [], limbs: [], faded };
  }

  // One axis. Heights still come from the boxes; only the horizontal placement
  // is the pushbox's, so the spine is vertical unless the fighter moves.
  //
  // A part with no box is held at its *distance* from the part above, not at the
  // height it last had: a jump keeps only its body box, and hips pinned to an
  // absolute height stay on the floor while the torso climbs 350 units away.
  const spine = last ? last.neck.y - last.hips.y : null;
  const drop = last?.feet.length ? last.hips.y - last.feet[0]!.y : 0;
  const hipY = leg ? leg[3] : body ? (spine === null ? body[1] : body[3] - spine) : last!.hips.y;
  const neckY = body ? body[3] : hipY + (spine ?? 0);

  const hips: Point = { x: axis, y: hipY };
  const neck: Point = { x: axis, y: neckY };
  const skull = head || last?.head ? { x: axis, y: head ? head[3] - radius : neckY + radius, r: radius } : null;
  const footY = leg ? leg[1] : hipY - drop;
  const feet: Point[] = leg || last?.feet.length ? [-1, 1].map((s) => ({ x: axis + s * half * 0.48, y: footY })) : [];

  // An active hitbox is a limb, and which limb the action's own name usually
  // says: `ATK_5MK` is a kick, `ATK_5HP` a punch. Where the name does not say —
  // every special — fall back to height, since a box down at shin level is not
  // coming out of a shoulder.
  const named = /^[A-Z]+_[0-9\[\]]*[LMH](P|K)/.exec(action.name);
  const byName = named ? named[1] === "K" : null;
  const limbs = hitboxesAt(action, frame).map((raw) => {
    const b = placeBox(fighter, raw);
    const tip = { x: facing === 1 ? b.x + b.width : b.x, y: b.y + b.height / 2 };
    const kick = byName ?? tip.y < hips.y + (neck.y - hips.y) * 0.35;
    return { root: kick ? hips : { x: neck.x, y: neck.y - radius * 0.4 }, tip, kick };
  });

  return { head: skull, neck, hips, feet, limbs, faded };
}

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
