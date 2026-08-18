/**
 * Per-frame collision geometry: the boxes behind the frame numbers.
 *
 * Loaded from `data/geometry/<char>.json`, produced by
 * `scripts/extract-geometry.mjs` out of MMDK's dump of the game's own
 * CharacterAsset data. Coordinates are game units: `x = 0` is the character
 * origin, `y = 0` the ground, `+x` forward. See docs/adr/0004.
 *
 * The engine proper still answers frame questions from frame data alone; this
 * module is what spacing questions ("does 2MK reach from here?") are built on.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { Box, Character, Geometry, Move } from "../domain/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..", "..", "data", "geometry");

/** What an attack box can be. Proximity boxes only trigger guard animations. */
export type HitKind = "strike" | "projectile" | "throw" | "proximity";

export interface HitKey {
  /** 1-indexed inclusive frames of the owning action. */
  start: number;
  end: number;
  kind: HitKind;
  /** Index into the fighter's hit-data table (damage, hitstun, ...). */
  attackData: number;
  guardBit: number | null;
  hitId: number;
  boxes: Box[];
  /** Set when the key came from a spliced continuation action. */
  from?: number;
}

export interface HurtKey {
  start: number;
  end: number;
  head: Box[];
  body: Box[];
  leg: Box[];
  throw: Box[];
  /** Non-zero when the hurtbox is invulnerable to something this frame. */
  immune?: number;
}

/** A pushbox: what stops two characters occupying the same space. */
export interface PushKey {
  start: number;
  end: number;
  /** Index into the fighter's push rect lists; 1 standing, 2 crouching, 3 airborne. */
  boxNo: number;
  box: Box;
}

/**
 * The path of the character origin during an action, in game units from where
 * it began: `x[frame - 1]`, `y[frame - 1]`. Absent when the action doesn't move.
 */
export interface Motion {
  x?: number[];
  y?: number[];
  travel: { x: number; maxX: number; maxY: number };
}

/**
 * A cancel window: one trigger group held open over a frame range. `buffered`
 * marks the key in front of the live window, where an input is held and fires
 * when the window opens for real — the game's input buffer, made explicit.
 * See docs/adr/0008.
 */
export interface CancelKey {
  start: number;
  end: number;
  /** Index into `GeometryFile.cancelGroups`. */
  group: number;
  buffered: boolean;
  /** Raw condition bits. The phase structure is understood; the bits are not. */
  cond: number;
}

export interface GeometryAction {
  id: number;
  name: string;
  frames: number | null;
  mainFrame: number | null;
  marginFrame: number | null;
  flags: {
    high: boolean;
    low: boolean;
    overhead: boolean;
    invincible: number;
    strikeInvuln: boolean;
    throwInvuln: boolean;
    fullInvuln: boolean;
  };
  hit: HitKey[];
  prox: { start: number; end: number; boxes: Box[] }[];
  hurt: HurtKey[];
  push: PushKey[];
  motion?: Motion;
  cancels?: CancelKey[];
  branches?: { frame: number; action: number; type: number | null }[];
  continues?: number;
  mot?: string;
}

/** What a hit does, once it lands. Distances are game units, times are frames. */
export interface HitOutcome {
  damage: number;
  /** Hitstun, or blockstun on the `block` condition. */
  stun: number;
  hitStop: { owner: number; target: number };
  /** Where the defender is carried, over `frames` frames. */
  knockback: { x: number; y: number; frames: number };
  downTime: number;
  juggle: { start: number; add: number; limit: number };
  drive: { own: number; target: number };
  super: { own: number; target: number };
  dmgType: number;
  armor?: number;
}

/**
 * One attack's outcomes, by how it landed. `counter` and `punishCounter` are the
 * game's own numbers, not derived — and they come out at exactly hit + 2 and
 * hit + 4 frames of stun, which is the rule of thumb stated as fact.
 */
export interface HitData {
  hit?: HitOutcome;
  block?: HitOutcome;
  counter?: HitOutcome;
  punishCounter?: HitOutcome;
  driveHit?: HitOutcome;
  airHit?: HitOutcome;
}

export type HitCondition = keyof HitData;

/** How a FAT move was matched to a game action. `weak` means don't trust it. */
export type MatchQuality = "exact" | "close" | "frame-unique" | "weak";

export interface MoveMapping {
  input: string;
  name: string;
  action: number;
  actionName: string;
  match: MatchQuality;
  startup: number;
  active: number;
  hits: number;
  fat: {
    startup: string | number | null;
    active: string | number | null;
    recovery: string | number | null;
    onBlock: string | number | null;
    onHit: string | number | null;
  };
  startupDelta: number | null;
  alternates: number[];
  category: string;
  /** Absent when the move cannot be cancelled into a special at all. */
  cancel?: CancelWindow;
}

/**
 * When a move can be cancelled into a special. `start` is at or after the move's
 * own first active frame — on it for a single-hit normal, later for a multi-hit
 * one — and `buffer` is where an input starts being held.
 */
/**
 * One way into an action: what it costs, how long the input buffers, and the
 * game's own classification of it.
 *
 * Costs are gauge units. Drive is 60000 across six bars and super 30000 across
 * three, so `drive: 20000` is an EX special's two bars and `super: 30000` is a
 * level 3. See docs/adr/0009.
 */
export interface Trigger {
  action: number;
  /** Input buffer in frames — 4 nearly everywhere, 6 on air specials. */
  buffer: number;
  drive?: number;
  /** Super meter. Absent on everything that isn't a super. */
  super?: number;
  /** The game's own flags, `_Is` stripped: `Extra` is EX, `Lv1`..`Lv4` supers. */
  kind?: string[];
}

/** One bar of Drive or super gauge, in the units the triggers are denominated in. */
export const BAR = 10000;

export interface CancelWindow {
  start: number;
  end: number;
  buffer: number | null;
  groups: number[];
}

export interface GeometryFile {
  character: string;
  id: string;
  source: Record<string, string>;
  calibration: {
    standingHeight: number;
    standingHalfWidth: number;
    standAction: number;
    crouchAction: number | null;
    /** Pushbox half-widths: what sets the closest two characters can stand. */
    pushHalfWidth: { stand: number | null; crouch: number | null };
  } | null;
  counts: Record<string, number>;
  moves: MoveMapping[];
  unmapped: { input: string; name: string; category: string }[];
  actions: GeometryAction[];
  /** Outcome table, keyed by the `attackData` index a hit key carries. */
  hitData: Record<string, HitData>;
  /** Cancel lists: group id -> the trigger indices that group makes available. */
  cancelGroups: Record<string, number[]>;
  /** What each cancel option costs and buffers, by trigger index. */
  triggers: Record<string, Trigger>;
  /** The groups the idle actions open — everything available from neutral. */
  neutralGroups: number[];
}

const cache = new Map<string, GeometryFile | undefined>();

export function loadGeometry(characterId: string): GeometryFile | undefined {
  if (!cache.has(characterId)) {
    const path = join(DIR, `${characterId}.json`);
    cache.set(characterId, existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as GeometryFile) : undefined);
  }
  return cache.get(characterId);
}

export function hasGeometry(character: Character): boolean {
  return loadGeometry(character.id) !== undefined;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function actionById(geo: GeometryFile, id: number): GeometryAction | undefined {
  return geo.actions.find((a) => a.id === id);
}

/** The action a move maps to, plus how much to trust the mapping. */
export function actionFor(
  geo: GeometryFile,
  move: Move,
): { action: GeometryAction; mapping: MoveMapping } | undefined {
  const mapping =
    geo.moves.find((m) => norm(m.input) === norm(move.input)) ??
    geo.moves.find((m) => norm(m.name) === norm(move.name));
  if (!mapping) return undefined;
  const action = actionById(geo, mapping.action);
  return action ? { action, mapping } : undefined;
}

const covers = (key: { start: number; end: number }, frame: number): boolean =>
  frame >= key.start && frame <= key.end;

/** Attack boxes live this frame, proximity boxes excluded. */
export function hitboxesAt(action: GeometryAction, frame: number): Box[] {
  return action.hit.filter((h) => h.kind !== "proximity" && covers(h, frame)).flatMap((h) => h.boxes);
}

/** Every hurtbox live this frame. Throwable boxes are excluded by default. */
export function hurtboxesAt(action: GeometryAction, frame: number, includeThrow = false): Box[] {
  const out: Box[] = [];
  for (const key of action.hurt) {
    if (!covers(key, frame)) continue;
    out.push(...key.head, ...key.body, ...key.leg);
    if (includeThrow) out.push(...key.throw);
  }
  return out;
}

/** Where the character origin is on this frame, relative to where it started. */
export function originAt(action: GeometryAction, frame: number): { x: number; y: number } {
  const motion = action.motion;
  if (!motion) return { x: 0, y: 0 };
  return { x: motion.x?.[frame - 1] ?? 0, y: motion.y?.[frame - 1] ?? 0 };
}

/** A box moved into world space by the origin it hangs off. */
export function shift(box: Box, origin: { x: number; y: number }): Box {
  return { ...box, x: box.x + origin.x, y: box.y + origin.y };
}

/**
 * Every attack box the action produces, placed where the moving origin puts it,
 * tagged with the frame it lands on. This is what spacing has to be measured
 * against: Ryu's 2MK steps 46 units forward before its hitbox appears, so from
 * where he started the move it reaches that much further than the box implies.
 */
export function worldHitboxes(action: GeometryAction): { frame: number; box: Box }[] {
  const out: { frame: number; box: Box }[] = [];
  for (const key of action.hit) {
    if (key.kind === "proximity") continue;
    for (let frame = key.start; frame <= key.end; frame++) {
      const origin = originAt(action, frame);
      for (const box of key.boxes) out.push({ frame, box: shift(box, origin) });
    }
  }
  return out;
}

/** The frame-keyed shape `Move.geometry` is typed for, built on demand. */
export function geometryFor(character: Character, move: Move): Geometry | undefined {
  const geo = loadGeometry(character.id);
  const found = geo && actionFor(geo, move);
  if (!found) return undefined;
  const { action } = found;
  const hitboxes: Record<number, Box[]> = {};
  const hurtboxes: Record<number, Box[]> = {};
  for (let frame = 1; frame <= (action.frames ?? 0); frame++) {
    const hit = hitboxesAt(action, frame);
    if (hit.length) hitboxes[frame] = hit;
    const hurt = hurtboxesAt(action, frame);
    if (hurt.length) hurtboxes[frame] = hurt;
  }
  return { hitboxes, hurtboxes };
}

/** What the action's first damaging hit does. */
export function hitDataFor(geo: GeometryFile, action: GeometryAction): HitData | undefined {
  const key = action.hit.find((h) => h.kind !== "proximity");
  return key ? geo.hitData?.[String(key.attackData)] : undefined;
}

/** Every distinct outcome the action can produce, in hit order (multi-hit moves). */
export function hitDataSequence(geo: GeometryFile, action: GeometryAction): HitData[] {
  const seen = new Set<number>();
  const out: HitData[] = [];
  for (const key of action.hit) {
    if (key.kind === "proximity" || seen.has(key.attackData)) continue;
    seen.add(key.attackData);
    const data = geo.hitData?.[String(key.attackData)];
    if (data) out.push(data);
  }
  return out;
}

/** A cancel option: the trigger that opens it and the action it leads to. */
export interface CancelOption {
  trigger: Trigger;
  action: GeometryAction;
}

/**
 * What a move can be cancelled into, resolved group -> trigger -> action.
 *
 * A cancel list holds one trigger per strength, so the same action appears
 * several times over; each is kept, because they are separate options with
 * separate costs (an EX special is its own trigger, not a modifier on one).
 * Options whose action has no collision data of its own — a stance handoff, a
 * system action — are dropped rather than surfaced as a nameless id.
 */
export function cancelOptions(geo: GeometryFile, move: MoveMapping): CancelOption[] {
  const out: CancelOption[] = [];
  for (const group of move.cancel?.groups ?? []) {
    for (const index of geo.cancelGroups?.[String(group)] ?? []) {
      const trigger = geo.triggers?.[String(index)];
      const action = trigger && actionById(geo, trigger.action);
      if (trigger && action) out.push({ trigger, action });
    }
  }
  return out;
}

/** The distinct actions a move can be cancelled into. */
export function cancelTargets(geo: GeometryFile, move: MoveMapping): GeometryAction[] {
  const seen = new Map<number, GeometryAction>();
  for (const { action } of cancelOptions(geo, move)) seen.set(action.id, action);
  return [...seen.values()];
}

/** The options a fighter can actually pay for, given what's in the gauges. */
export function affordable(
  options: CancelOption[],
  meter: { drive?: number; super?: number },
): CancelOption[] {
  const drive = meter.drive ?? 0;
  const superMeter = meter.super ?? 0;
  return options.filter((o) => (o.trigger.drive ?? 0) <= drive && (o.trigger.super ?? 0) <= superMeter);
}

/** Whether a special can be cancelled in on this frame of the move (not buffered). */
export function cancellableAt(move: MoveMapping, frame: number): boolean {
  const window = move.cancel;
  return !!window && frame >= window.start && frame <= window.end;
}

/**
 * The frame the attacker can act again, 1-indexed in the action's own frames.
 *
 * `MarginFrame` is the action's last committed frame; you are free on the one
 * after. It is strictly less than the action's `frames` on every action in the
 * roster — the animation keeps playing past the point you can cancel out of it,
 * which is what makes this recovery rather than animation length.
 *
 * Undefined where the action has no margin recorded, which is where the caller
 * has to fall back on the published `active + recovery`. See docs/adr/0011.
 */
export function actionableFrame(action: GeometryAction): number | undefined {
  return action.marginFrame && action.marginFrame > 0 ? action.marginFrame + 1 : undefined;
}

export type Stance = "stand" | "crouch";

/** Pushboxes live this frame. */
export function pushboxesAt(action: GeometryAction, frame: number): Box[] {
  return action.push.filter((p) => covers(p, frame)).map((p) => p.box);
}

function idleAction(geo: GeometryFile, stance: Stance): GeometryAction | undefined {
  const id = stance === "crouch" ? geo.calibration?.crouchAction : geo.calibration?.standAction;
  const byId = typeof id === "number" ? actionById(geo, id) : undefined;
  return byId ?? geo.actions.find((a) => a.hurt.length);
}

/** Idle hurtboxes for the defender side of a spacing question. */
export function idleHurtboxes(geo: GeometryFile, stance: Stance = "stand"): Box[] {
  const src = idleAction(geo, stance);
  if (!src) return [];
  return hurtboxesAt(src, src.hurt[0]?.start ?? 1);
}

/** How far a character's pushbox reaches in front of its own origin. */
export function pushHalfWidth(geo: GeometryFile, stance: Stance = "stand"): number | undefined {
  const fromCalibration = geo.calibration?.pushHalfWidth?.[stance];
  if (typeof fromCalibration === "number") return fromCalibration;
  const box = idleAction(geo, stance)?.push[0]?.box;
  return box ? Math.max(Math.abs(box.x), Math.abs(box.x + box.width)) : undefined;
}

/**
 * The closest the two characters' origins can be: their pushboxes touch. Any
 * spacing question below this is asking about a position the game can't produce.
 */
export function minDistance(
  attacker: GeometryFile,
  defender: GeometryFile,
  stances: { attacker?: Stance; defender?: Stance } = {},
): number | undefined {
  const a = pushHalfWidth(attacker, stances.attacker ?? "stand");
  const d = pushHalfWidth(defender, stances.defender ?? "stand");
  return a === undefined || d === undefined ? undefined : a + d;
}

/**
 * Where a move can connect, as a distance band. `min` is the closest the
 * characters can legally stand, `max` the furthest the boxes still touch;
 * `reachable` is false for a move that can't reach even point blank.
 */
export interface ContactBand {
  min: number;
  max: number | undefined;
  reachable: boolean;
}

export function contactBand(
  action: GeometryAction,
  opponent: Box[],
  closest: number,
): ContactBand {
  const max = reach(action, opponent);
  return { min: closest, max, reachable: max !== undefined && max > closest };
}

/**
 * An opponent standing at `distance` faces the other way, so its boxes are
 * mirrored about its own origin before being placed in the attacker's space.
 */
export function mirrored(box: Box, distance: number): Box {
  return { ...box, x: distance - (box.x + box.width) };
}

export function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/**
 * The furthest distance at which the move still touches those hurtboxes.
 *
 * For attacker box `A` and opponent box `B` (in the opponent's own space),
 * overlap holds while `distance < A.x2 + B.x2`, so the reach is the largest
 * such sum over every pair whose heights overlap. Undefined when nothing can
 * connect at any distance (a box that only covers the attacker's own space).
 */
export function reach(action: GeometryAction, opponent: Box[]): number | undefined {
  let best: number | undefined;
  for (const { box: a } of worldHitboxes(action)) {
    for (const b of opponent) {
      if (!(a.y < b.y + b.height && b.y < a.y + a.height)) continue;
      const d = a.x + a.width + b.x + b.width;
      if (best === undefined || d > best) best = d;
    }
  }
  return best;
}

/**
 * Which of the move's frames connect at `distance`, where distance is measured
 * from where the attacker stood when the move began — the question a player is
 * actually asking, and the reason the moving origin matters.
 */
export function connectFrames(action: GeometryAction, opponent: Box[], distance: number): number[] {
  const frames = new Set<number>();
  for (const { frame, box } of worldHitboxes(action)) {
    if (opponent.some((b) => overlaps(box, mirrored(b, distance)))) frames.add(frame);
  }
  return [...frames].sort((a, b) => a - b);
}

/** Contiguous active spans, the way frame data reads them. */
export function activeWindows(action: GeometryAction): { start: number; end: number }[] {
  const hits = action.hit
    .filter((h) => h.kind !== "proximity")
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.start <= last.end + 1) last.end = Math.max(last.end, h.end);
    else out.push({ start: h.start, end: h.end });
  }
  return out;
}
