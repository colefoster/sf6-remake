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

import type { Box, Character, Geometry, Move } from "../domain/types.js";

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
  /**
   * What the box is invulnerable to, as a bitmask. Bit 2 is airborne strikes and
   * reads against FAT; the rest do not. See ADR-0014.
   */
  immune?: number;
  /**
   * Which kinds of attack the box answers to at all: bit 0 strikes, bit 1
   * projectiles. Absent means 3 — both, the ordinary case.
   */
  typeFlag?: number;
  /**
   * Armor: this box absorbs a hit instead of taking it. The number is a row in
   * an atemi table the dump does not ship, so it identifies *which* armor
   * without saying what it does. See ADR-0016.
   */
  atemi?: number;
}

/**
 * How an incoming attack presents itself to a hurtbox. `airborne-strike` is a
 * strike thrown by an opponent off the ground: the thing an anti-air is
 * invulnerable to, and a separate question from whether the box responds to
 * strikes at all.
 */
export type AttackKind = "strike" | "projectile" | "airborne-strike";

/** `TypeFlag` bits. A box with neither answers to nothing and cannot be hit. */
const RESPONDS_STRIKE = 1;
const RESPONDS_PROJECTILE = 2;

/**
 * `Immune` bit 2: invulnerable to strikes from an airborne opponent.
 *
 * This is the one bit of the mask that reads. FAT publishes "Invincible to
 * airborne strikes on frames A-B" in prose for 57 moves, and the frames a bit-2
 * key covers reproduce that range exactly on 45 of them. See ADR-0014.
 */
const IMMUNE_AIRBORNE = 4;

/**
 * Whether this box can be hit by that kind of attack on the frames it covers.
 *
 * Two independent gates, and they are not the same question. `TypeFlag` is what
 * the box responds to — a limb extension marked strike-only still eats
 * projectiles, which is exactly why FAT describes those boxes as "cannot
 * counter-poke projectiles". `Immune` is what it shrugs off on top of that.
 */
export function vulnerableTo(key: HurtKey, kind: AttackKind): boolean {
  const responds = key.typeFlag ?? (RESPONDS_STRIKE | RESPONDS_PROJECTILE);
  const bit = kind === "projectile" ? RESPONDS_PROJECTILE : RESPONDS_STRIKE;
  if (!(responds & bit)) return false;
  return !(kind === "airborne-strike" && ((key.immune ?? 0) & IMMUNE_AIRBORNE) !== 0);
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
  /**
   * `ConditionFlag` unpacked. `cond` is the part that resists reading — see
   * ADR-0013 — and the other three are kept so a later attempt at it starts
   * from the whole flag rather than a third of it.
   */
  cond: number;
  state?: number;
  input?: number;
  other?: number;
}

/**
 * `_State` bits that gate a cancel window on being airborne. Measured, not
 * assumed: keys carrying them sit on an airborne action 98-100% of the time
 * against a 9.6% base rate. See docs/adr/0013.
 */
const STATE_AIRBORNE = (1 << 18) | (1 << 19) | (1 << 20);

/** Whether this window only opens while the attacker is off the ground. */
export function airOnly(key: CancelKey): boolean {
  return ((key.state ?? 0) & STATE_AIRBORNE) !== 0;
}

export interface GeometryAction {
  id: number;
  name: string;
  frames: number | null;
  mainFrame: number | null;
  marginFrame: number | null;
  /**
   * Combo-scaling percentages the action carries, absent when the dump's −1
   * says unset. `start` is what opening a combo with this move scales it to and
   * is FAT's `dmgScaling` "20% Start". See ADR-0032.
   */
  scaling?: { start?: number; combo?: number; immediate?: number };
  /**
   * Hit-data rows named by a `LockKey` rather than by a hit key — how a throw's
   * damage reaches the table. `frame` is 1-indexed in the owning action.
   * See ADR-0035.
   */
  locks?: { frame: number; attackData: number }[];
  /**
   * A Super Art's cinematic freeze, in frames, from the action's `WorldKey` timer.
   * Everything after it sits `freeze - 1` frames later in the action's own timeline
   * than in FAT's numbers, so a comparison between the two has to net it out.
   * See ADR-0019.
   */
  freeze?: number;
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
  /**
   * Projectiles this action spawns, from its `ShotKey`. A fireball is its own
   * action with its own timeline, so the parent carries no hitbox at all and
   * `frame` — the frame the shot appears on — is the move's startup.
   * See ADR-0022.
   */
  shots?: { action: number; frame: number; offset: { x: number; y: number } }[];
  /** Where an airborne action puts itself down, and that action's own margin. */
  lands?: { action: number; margin: number };
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
  /**
   * Which reaction the defender plays: `strength` picks a `DMG_*`/`GRD_*`
   * action's L/M/H suffix and `part` its height prefix. See ADR-0025.
   */
  reaction: {
    strength: "L" | "M" | "H" | "S";
    kind: number;
    part: number;
    attr: [number, number, number, number];
  };
  combo: { add: number; none: boolean; black: boolean };
  /** Recoverable ("grey") damage, and stun points toward a dizzy. */
  recoverable: number;
  stunPoint: number;
  /** Frames the defender cannot be touched for afterwards. */
  invulnAfter: number;
  /** Present only where the hit does something at the wall. */
  wall?: {
    bounce: boolean;
    first: boolean;
    splat: boolean;
    dest: { x: number; y: number };
    stop: number;
    time: number;
  };
  floor?: { bounce: boolean; dest: { x: number; y: number }; time: number; boundDest: number };
  /** Drive gauge the defender loses: blocking costs, a just-parry costs less. */
  driveDamage?: { normal: number; just: number };
  /** Chip-damage rules, side switching, and the rest of the boolean column. */
  flags?: string[];
}

/**
 * A fighter's own constants, from `char_info.json`. `health` and `superMax` are
 * the game's numbers; the Drive maximum is **not** in the dump — ADR-0009
 * inferred 60000 from what an OD special costs. See ADR-0025.
 */
export interface FighterInfo {
  health: number;
  superMax: number;
  weight: number;
  armor: { point: number; timer: number };
  size: { up: number; front: number; back: number };
  driveRecover: { normal: number; just: number };
  scales?: {
    offensive: number;
    defensive: number;
    moveSpeed: number;
    gaugeGain: number;
    focusRecover: { normal: number; normalAir: number; burnout: number; burnoutAir: number };
  };
}

/**
 * One step of a motion input. `dir` is a numpad direction; `any` is the table's
 * wildcard, a step matched by anything it does not forbid. See ADR-0025.
 */
export interface CommandStep {
  /** How long this step stays satisfied while the next is waited for. */
  frames: number;
  dir?: number;
  any?: boolean;
  forbid?: string[];
  /** A charge release: `charge` is the slot, `dir` the inferred held direction. */
  release?: boolean;
  charge?: number;
}

/** One accepted way to input a move: the ordered steps and the whole window. */
export interface Command {
  steps: CommandStep[];
  window?: number;
  /** Bitmask of the charge slots this command consumes. */
  chargeSlots?: number;
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
  /** Net of the action's freeze, so it is in FAT's frame space. See ADR-0019. */
  startupDelta: number | null;
  /** Copied off the action when it has one, so a caller need not look it up. */
  freeze?: number;
  alternates: number[];
  category: string;
  /** Absent when the move cannot be cancelled into a special at all. */
  cancel?: CancelWindow;
}

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
  /** Buttons that fire it: `["LP","MP","HP"]` is any punch, i.e. OD. ADR-0025. */
  keys?: string[];
  forbid?: string[];
  /**
   * The direction the button must be pressed with — `["down"]` for a crouching
   * normal, `["forward"]` for a command normal. Absent means neutral. It is the
   * only thing separating Ryu's 5MP, 2MP and 6MP, which are one button and
   * three triggers. See ADR-0027.
   */
  dir?: string[];
  /** Accepted motions, any one of which satisfies it. Absent on a bare button. */
  motions?: Command[];
}

/** One bar of Drive or super gauge, in the units the triggers are denominated in. */
export const BAR = 10000;

/**
 * When a move can be cancelled into a special. `start` is at or after the move's
 * own first active frame — on it for a single-hit normal, later for a multi-hit
 * one — and `buffer` is where an input starts being held.
 */
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
  /** Health, meter maxima and Drive regen, from `char_info.json`. See ADR-0025. */
  fighter: FighterInfo | null;
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

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function actionById(geo: GeometryFile, id: number): GeometryAction | undefined {
  return geo.actions.find((a) => a.id === id);
}

/** By the game's own action name (`BAS_FORWARD_Loop`), exactly. */
export function actionByName(geo: GeometryFile, name: string): GeometryAction | undefined {
  return geo.actions.find((a) => a.name === name);
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

/** A projectile an action spawns: when, where, and the fireball's own action. */
export interface Spawn {
  /** Frame of the parent action the shot appears on — the move's startup. */
  frame: number;
  /** Game units from the character origin, the same frame as every box. */
  offset: { x: number; y: number };
  action: GeometryAction;
}

/**
 * The projectiles an action throws.
 *
 * A fireball's hitbox is not on the move that threw it: `ShotKey` names a
 * separate action which starts its own timeline at the spawn frame. That is why
 * a projectile special has no hitbox of its own, and why `reach` on the parent
 * says nothing. See ADR-0022.
 */
export function spawnsFrom(geo: GeometryFile, action: GeometryAction): Spawn[] {
  const out: Spawn[] = [];
  for (const shot of action.shots ?? []) {
    const spawned = actionById(geo, shot.action);
    if (spawned) out.push({ frame: shot.frame, offset: shot.offset, action: spawned });
  }
  return out;
}

/** Attack boxes live this frame, proximity boxes excluded. */
export function hitboxesAt(action: GeometryAction, frame: number): Box[] {
  return hitKeysAt(action, frame).flatMap((h) => h.boxes);
}

/**
 * The live hit *keys*, not their boxes flattened together.
 *
 * A caller that only draws boxes does not care which key they came from. One
 * deciding whether a move has connected does: ADR-0024 established that a hit is
 * a `HitID`, and two keys sharing a window with different ids are two hits. See
 * ADR-0032.
 */
export function hitKeysAt(action: GeometryAction, frame: number): HitKey[] {
  return action.hit.filter((h) => h.kind !== "proximity" && covers(h, frame));
}

/**
 * Every hurtbox live this frame. Throwable boxes are excluded by default.
 *
 * `to` narrows to the boxes a given kind of attack can actually hit, which is
 * what an anti-air or a fireball is asking. Left off, every live box counts —
 * the shape callers wanted before invulnerability was decoded.
 */
export function hurtboxesAt(
  action: GeometryAction,
  frame: number,
  options: boolean | { includeThrow?: boolean; to?: AttackKind } = false,
): Box[] {
  const { includeThrow = false, to } = typeof options === "boolean" ? { includeThrow: options } : options;
  const out: Box[] = [];
  for (const key of action.hurt) {
    if (!covers(key, frame)) continue;
    if (to && !vulnerableTo(key, to)) continue;
    out.push(...key.head, ...key.body, ...key.leg);
    if (includeThrow) out.push(...key.throw);
  }
  return out;
}

/** The last frame of an action's timeline, however the dump chose to state it. */
function lastFrame(action: GeometryAction): number {
  return Math.max(action.frames ?? 0, ...action.hurt.map((k) => k.end), 0);
}

/**
 * The frames on which the action carries **no hurtbox at all** — full
 * invulnerability, and the mechanism behind every "Fully invincible on frames
 * 1-N" FAT publishes.
 *
 * There is no flag for this. A Super Art's cinematic simply has nothing to hit
 * for the length of the freeze plus the published window, and the same trick
 * runs an EX reversal's start-up and one of Terry's target combos. Frames are
 * the action's own; `inFatFrames` converts. See ADR-0020.
 */
export function fullyInvulnerableWindows(action: GeometryAction): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let frame = 1; frame <= lastFrame(action); frame++) {
    if (action.hurt.some((k) => covers(k, frame))) continue;
    const last = out[out.length - 1];
    if (last && last.end === frame - 1) last.end = frame;
    else out.push({ start: frame, end: frame });
  }
  return out;
}

/**
 * The frames on which nothing that kind of attack can hit is live — the
 * character's own invulnerability, as opposed to one box's.
 *
 * A limb extension marked strike-invincible does not make the fighter
 * invincible: the ordinary body box is still there beside it, and this reports
 * only frames where every live box declines. That is the same distinction FAT
 * draws between "the extended leg hurtbox is strike invincible" and "invincible
 * to airborne strikes on frames 1-14". See ADR-0014.
 *
 * A frame with no live box at all counts for every kind: nothing to hit is the
 * strongest form of the same answer. See ADR-0020.
 */
export function invulnerableWindows(
  action: GeometryAction,
  kind: AttackKind,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let frame = 1; frame <= lastFrame(action); frame++) {
    const live = action.hurt.filter((k) => covers(k, frame));
    if (live.some((k) => vulnerableTo(k, kind))) continue;
    const last = out[out.length - 1];
    if (last && last.end === frame - 1) last.end = frame;
    else out.push({ start: frame, end: frame });
  }
  return out;
}

/**
 * A stretch of frames on which the fighter has armor, and what it covers.
 *
 * `covers` is the finding, not bookkeeping: armor is applied per hurtbox, so a
 * window that covers the body and not the leg is armor a low attack goes under.
 * FAT says exactly that about the moves whose window is body-only — "loses to Low
 * attacks", "attacks that hit low enough can go past the armor". See ADR-0016.
 */
export interface ArmorWindow {
  start: number;
  end: number;
  /** Which atemi table row applies. Drive Impact is 1 on every fighter. */
  index: number;
  covers: { head: boolean; body: boolean; leg: boolean };
}

/** Every armor window the action carries, merged per atemi index. */
export function armorWindows(action: GeometryAction): ArmorWindow[] {
  const byIndex = new Map<number, ArmorWindow>();
  for (const key of action.hurt) {
    if (key.atemi === undefined) continue;
    const found = byIndex.get(key.atemi);
    const covers = {
      head: key.head.length > 0,
      body: key.body.length > 0,
      leg: key.leg.length > 0,
    };
    if (!found) {
      byIndex.set(key.atemi, { start: key.start, end: key.end, index: key.atemi, covers });
      continue;
    }
    found.start = Math.min(found.start, key.start);
    found.end = Math.max(found.end, key.end);
    for (const part of ["head", "body", "leg"] as const) found.covers[part] ||= covers[part];
  }
  return [...byIndex.values()].sort((a, b) => a.start - b.start);
}

/** Whether an attack at this height is absorbed rather than landing. */
export function armoredAt(action: GeometryAction, frame: number, part: keyof ArmorWindow["covers"]): boolean {
  return armorWindows(action).some((w) => frame >= w.start && frame <= w.end && w.covers[part]);
}

/**
 * A frame of the action expressed in FAT's frame space.
 *
 * A Super Art's action runs its cinematic freeze first, and FAT's numbers start
 * counting after it. The two spaces differ by `freeze - 1` — the minus one is the
 * frame they share, the same off-by-one the `total` identity carries. Everything
 * else in the roster has no freeze and passes straight through. See ADR-0019.
 */
export function inFatFrames(action: GeometryAction, frame: number): number {
  return action.freeze ? frame - action.freeze + 1 : frame;
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
export function geometryFor(geo: GeometryFile | undefined, move: Move): Geometry | undefined {
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
 * The frame an airborne action returns to the ground, from its own motion
 * curve: the first frame at y = 0 after having left it. Undefined for anything
 * that never leaves the ground or carries no vertical motion.
 */
export function touchdownFrame(action: GeometryAction): number | undefined {
  const y = action.motion?.y;
  if (!y) return undefined;
  for (let i = 1; i < y.length; i++) {
    if (y[i]! <= 0 && y[i - 1]! > 0) return i + 1;
  }
  return undefined;
}

/** Where an action's recovery number came from. See docs/adr/0011 and 0012. */
export type RecoverySource = "action" | "landing" | "published";

export interface Actionable {
  /** 1-indexed frame of the action on which the attacker is free again. */
  frame: number;
  source: Exclude<RecoverySource, "published">;
}

/**
 * The frame the attacker can act again, 1-indexed in the action's own frames.
 *
 * `MarginFrame` is the action's last committed frame; you are free on the one
 * after. It is strictly less than the action's `frames` on every action in the
 * roster — the animation keeps playing past the point you can cancel out of it,
 * which is what makes this recovery rather than animation length.
 *
 * An action that ends in the air has no margin at all, because there is nothing
 * to recover from until you touch down. Its recovery lives on the landing action
 * it branches into, and the handoff happens where its own motion curve returns
 * to the ground. See docs/adr/0012.
 *
 * Undefined where neither is recorded, which is where the caller falls back on
 * the published `active + recovery`.
 */
/**
 * The `DmgType` of a hit that leaves the defender standing. Anything else puts
 * them on the floor — measured against FAT's own "KD" at 92.8%. See ADR-0033.
 */
export const UPRIGHT_DMG_TYPE = 3;

export const knocksDown = (outcome: HitOutcome): boolean => outcome.dmgType !== UPRIGHT_DMG_TYPE;

/**
 * How long the defender spends on the floor after the hitstun runs out.
 *
 * The knockdown chain is **not wired in the dump**: `DMG_*_DN`, `BAS_DN_STD_*`
 * and the `BAS_TECH_*` quick-rises all carry zero branches, exactly like the
 * jump chain ADR-0026 had to walk by name. So this is the seam, asserted: the
 * defender lies in `BAS_DN_STD_AO` until its own `MarginFrame` lets them up.
 *
 * `undefined` when the fighter has no down action, which is the honest answer
 * rather than a zero that would read as "gets up instantly".
 */
export function downRecovery(geo: GeometryFile): number | undefined {
  const down = actionByName(geo, "BAS_DN_STD_AO");
  if (!down) return undefined;
  const up = actionableFrame(down);
  return up ? up.frame - 1 : undefined;
}

export function actionableFrame(action: GeometryAction): Actionable | undefined {
  if (action.marginFrame && action.marginFrame > 0) {
    return { frame: action.marginFrame + 1, source: "action" };
  }
  const touchdown = touchdownFrame(action);
  if (action.lands && touchdown !== undefined) {
    return { frame: touchdown + action.lands.margin + 1, source: "landing" };
  }
  // An action that lands but carries no arc of its own is an air normal: it
  // inherits the jump's, so when it touches down depends on when it was pressed
  // and there is no single answer. Saying so beats inventing one.
  return undefined;
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

/**
 * How many times the action connects: distinct `HitID` per contiguous window, summed.
 *
 * Neither half reads on its own. Counting *keys* calls a single blow multi-hit —
 * the dump routinely splits one active window into three boxes that come and go —
 * and counting *windows* misses the back-to-back hits FAT writes `1*3`, which
 * share a window and are separated only by the id. `HitID` is the game's own
 * statement of what one hit is. See ADR-0024.
 *
 * `scripts/extract-geometry.mjs` carries its own copy, as it does for
 * `activeWindows`: it runs before there is a `GeometryFile` to read.
 */
export function hitCount(action: GeometryAction): number {
  const strikes = action.hit.filter((h) => h.kind !== "proximity");
  let hits = 0;
  for (const w of activeWindows(action)) {
    const ids = new Set<number>();
    for (const h of strikes) if (h.start >= w.start && h.start <= w.end) ids.add(h.hitId);
    hits += ids.size;
  }
  return hits;
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
