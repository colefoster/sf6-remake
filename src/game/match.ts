/**
 * Two fighters on one clock: contact, reactions, health.
 *
 * This is the piece that turns the runtime into a game. Everything it resolves
 * comes from the dump — contact from box overlap, the outcome from the hit
 * table, the reaction animation from that row's own `strength`/`part`, the
 * defender's stun from the table's `HitStun` — and nothing from a published
 * number. `src/verify` still grades `src/sim`; this does not replace it.
 *
 * WHAT IT MODELS
 *   two fighters acting freely, pushbox separation, facing, blocking high and
 *   low, hit / counter / punish-counter selection from the defender's actual
 *   state, hitstop, knockback, hitstun and blockstun, damage and KO.
 *
 *   Projectiles too, as of ADR-0029: a fireball is a third body with its own
 *   action and clock, and two of them destroy each other.
 *
 * WHAT IT DOES NOT
 *   the corner, juggles and combo scaling, throws as a state, and the Drive and
 *   super gauges. See docs/adr/0027 and 0029.
 */

import {
  actionByName,
  activeWindows,
  hitDataFor,
  hitboxesAt,
  hurtboxesAt,
  overlaps,
  originAt,
  pushboxesAt,
  shift,
  spawnsFrom,
  type GeometryAction,
  type GeometryFile,
  type HitData,
  type HitOutcome,
} from "../data/geometry.js";
import type { Box } from "../domain/types.js";
import { Fighter, NEUTRAL, type Button, type Direction, type InputFrame } from "./index.js";

/**
 * Blocking holds the defender four frames past the point they can act
 * (ADR-0006). The table's `HitStun` on a block includes them, so the runtime
 * has to take them back off or every blocked move reads four frames more plus.
 */
const GUARD_RELEASE = 4;

export type Contact = "block" | "hit" | "counter" | "punishCounter";

export interface Hit {
  frame: number;
  attacker: 0 | 1;
  type: Contact;
  damage: number;
  stun: number;
  action: string;
  reaction: string;
}

export interface MatchOptions {
  /** Starting gap between the two origins, in game units. */
  distance?: number;
}

/**
 * A fireball in flight: a third body with its own action, clock and hit data.
 *
 * `src/sim` has modelled one since ADR-0023 and the match did not, so `sf6 fight
 * ryu ken 236+HPx3` threw nothing. Everything here is the same reading — the
 * shot keeps its own frame count from the moment it appears, travels on its own
 * origin motion, and carries the hit-data row of the action that owns the box.
 * See docs/adr/0029.
 */
export interface Projectile {
  owner: 0 | 1;
  action: GeometryAction;
  /** The projectile's own frame; it is on 1 the frame it appears. */
  frame: number;
  /** Where the thrower's origin was when it spawned, plus the shot offset. */
  x: number;
  y: number;
  facing: 1 | -1;
  data: HitData | undefined;
  /** Set once it has connected or been destroyed; it stops existing next frame. */
  spent: boolean;
}

export class Match {
  readonly fighters: [Fighter, Fighter];
  readonly health: [number, number];
  frame = 0;
  readonly hits: Hit[] = [];
  /** Frames of hitstop still owed. Both sides freeze together. */
  private freeze = 0;
  private knockback: ({ perFrame: number; left: number } | null)[] = [null, null];
  /** The action instance each fighter last connected with, so a swing hits once. */
  private connected: [number, number] = [-1, -1];
  /** Fireballs currently in the air, either side's. */
  readonly projectiles: Projectile[] = [];
  /** `<fighter>:<action instance>:<shot index>` for shots already spawned. */
  private thrown = new Set<string>();

  constructor(left: GeometryFile, right: GeometryFile, options: MatchOptions = {}) {
    const gap = options.distance ?? 200;
    this.fighters = [new Fighter(left, 0, 1), new Fighter(right, gap, -1)];
    this.health = [vitality(this.fighters[0].geo), vitality(this.fighters[1].geo)];
  }

  get over(): boolean {
    return this.health[0] <= 0 || this.health[1] <= 0;
  }

  /** One frame of the match. */
  advance(a: InputFrame = NEUTRAL, b: InputFrame = NEUTRAL): void {
    this.frame++;
    // Hitstop freezes both sides equally, so it never changes the difference
    // between them — but it does change when either can next act.
    if (this.freeze > 0) {
      this.freeze--;
      return;
    }
    this.face();
    this.fighters[0].advance(a);
    this.fighters[1].advance(b);
    this.separate();
    this.carry();
    this.throwShots(0);
    this.throwShots(1);
    this.resolve(0, b);
    this.resolve(1, a);
    this.flyProjectiles(a, b);
  }

  /**
   * Spawn any shot whose frame has come round on the action being played.
   *
   * Keyed on the fighter's action *instance* as well as the shot index, so
   * throwing the same fireball twice spawns two — and replaying the same action
   * frame during hitstop spawns none.
   */
  private throwShots(side: 0 | 1): void {
    const fighter = this.fighters[side]!;
    const { action, frame, facing } = fighter.state;
    if (!action.shots?.length) return;
    const shots = spawnsFrom(fighter.geo, action);
    for (const [index, shot] of shots.entries()) {
      if (shot.frame !== frame) continue;
      const key = `${side}:${fighter.instance}:${index}`;
      if (this.thrown.has(key)) continue;
      this.thrown.add(key);
      const at = fighter.position();
      this.projectiles.push({
        owner: side,
        action: shot.action,
        frame: 1,
        x: at.x + shot.offset.x * facing,
        y: shot.offset.y,
        facing,
        data: hitDataFor(fighter.geo, shot.action),
        spent: false,
      });
    }
  }

  /**
   * Advance every fireball, resolve what it touches, and retire the spent ones.
   *
   * Two projectiles that meet destroy each other — the thing ADR-0023 listed as
   * unmodelled. Nothing else can hit one: the defender's own hitboxes are tested
   * against it, but a fireball has no hurtbox the runtime consults.
   */
  private flyProjectiles(a: InputFrame, b: InputFrame): void {
    for (const shot of this.projectiles) {
      shot.frame++;
      if (shot.frame > (shot.action.frames ?? 0)) shot.spent = true;
    }
    // Fireball against fireball, before either reaches anybody.
    for (const one of this.projectiles) {
      if (one.spent) continue;
      for (const other of this.projectiles) {
        if (other === one || other.spent || other.owner === one.owner) continue;
        if (projectileBoxes(one).some((x) => projectileBoxes(other).some((y) => overlaps(x, y)))) {
          one.spent = true;
          other.spent = true;
        }
      }
    }
    for (const shot of this.projectiles) {
      if (shot.spent || !shot.data) continue;
      const side = shot.owner === 0 ? 1 : 0;
      const them = this.fighters[side]!;
      const boxes = projectileBoxes(shot);
      if (!boxes.length) continue;
      if (!worldHurtboxes(them).some((h) => boxes.some((box) => overlaps(box, h)))) continue;
      shot.spent = true;
      this.land(shot.owner, them, shot.data, shot.action, side === 0 ? a : b, shot.facing);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i]!.spent) this.projectiles.splice(i, 1);
    }
  }

  /** Each fighter turns to face the other whenever it is free to. */
  private face(): void {
    const [left, right] = this.fighters.map((f) => f.position().x) as [number, number];
    for (const [i, fighter] of this.fighters.entries()) {
      if (!fighter.actionable() || fighter.stunned > 0) continue;
      const other = i === 0 ? right : left;
      const self = i === 0 ? left : right;
      if (self !== other) fighter.state.facing = other > self ? 1 : -1;
    }
  }

  /** Pushboxes: two bodies cannot occupy the same space. */
  private separate(): void {
    const [a, b] = this.fighters;
    const boxA = worldPush(a);
    const boxB = worldPush(b);
    if (!boxA || !boxB) return;
    const overlap = Math.min(boxA.right, boxB.right) - Math.max(boxA.left, boxB.left);
    if (overlap <= 0) return;
    const push = overlap / 2;
    const aLeft = boxA.left < boxB.left;
    a.state.x += aLeft ? -push : push;
    b.state.x += aLeft ? push : -push;
  }

  /** Knockback plays out over the frames the hit table gives it. */
  private carry(): void {
    for (const [i, k] of this.knockback.entries()) {
      if (!k || k.left <= 0) continue;
      this.fighters[i]!.state.x += k.perFrame;
      k.left--;
    }
  }

  /**
   * Did `attacker` connect this frame, and what happened.
   *
   * `defenderInput` is needed for one thing only: whether they are holding back.
   */
  private resolve(attacker: 0 | 1, defenderInput: InputFrame): void {
    const me = this.fighters[attacker]!;
    const them = this.fighters[attacker === 0 ? 1 : 0]!;
    const data = hitDataFor(me.geo, me.state.action);
    if (!data) return;
    const mine = worldHitboxes(me);
    if (!mine.length) return;
    const theirs = worldHurtboxes(them);
    if (!theirs.some((h) => mine.some((box) => overlaps(box, h)))) return;
    // One contact per swing. The hitbox is out for three frames and hitstop is
    // eleven, so anything time-based re-hits; the action instance is the only
    // honest boundary. Multi-hit moves need juggles, which is a later stage.
    if (this.connected[attacker] === me.instance) return;
    this.connected[attacker] = me.instance;
    this.land(attacker, them, data, me.state.action, defenderInput, me.state.facing);
  }

  /**
   * Apply an outcome, whoever's box delivered it.
   *
   * Shared between a fighter's own hitbox and a fireball's, because the only
   * difference is which action owns the hit-data row. `facing` is the *box's*
   * facing, which for a projectile is the direction it was thrown in and not
   * where the thrower is looking now.
   */
  private land(
    attacker: 0 | 1,
    them: Fighter,
    data: HitData,
    attack: GeometryAction,
    defenderInput: InputFrame,
    facing: 1 | -1,
  ): void {
    const type = this.contactType(them, defenderInput, attack);
    const outcome = data[type] ?? data.hit;
    if (!outcome) return;

    const reaction = reactionFor(them.geo, outcome, type === "block", them.state.stance);
    const stun = outcome.stun - (type === "block" ? GUARD_RELEASE : 0);
    if (reaction) them.react(reaction, Math.max(0, stun));
    const damage = type === "block" ? 0 : outcome.damage;
    this.health[attacker === 0 ? 1 : 0] -= damage;
    this.freeze = outcome.hitStop.owner;
    if (outcome.knockback.frames) {
      this.knockback[attacker === 0 ? 1 : 0] = {
        // The table states knockback in the attacker's own space — positive is
        // away from them — so it is applied along the attacking box's facing.
        perFrame: (outcome.knockback.x / outcome.knockback.frames) * facing,
        left: outcome.knockback.frames,
      };
    }
    this.hits.push({
      frame: this.frame,
      attacker,
      type,
      damage,
      stun,
      action: attack.name,
      reaction: reaction?.name ?? "?",
    });
  }

  /**
   * How the hit landed.
   *
   * Blocking is holding back on the ground, and the height has to match: a low
   * has to be blocked crouching and an overhead standing. That rule is asserted
   * — the dump flags the attack, not what beats it. A defender caught in their
   * own move's start-up takes a counter hit, and one caught recovering takes a
   * punish counter, which is SF6's own rule and the reason ADR-0006's `counter`
   * and `punishCounter` rows exist at all.
   */
  private contactType(them: Fighter, input: InputFrame, attack: GeometryAction): Contact {
    const guarding =
      them.state.stance !== "air" &&
      them.stunned === 0 &&
      holdingBack(input.dir, them.state.facing) &&
      !(attack.flags.low && them.state.stance !== "crouch") &&
      !(attack.flags.overhead && them.state.stance === "crouch");
    if (guarding) return "block";
    if (them.stunned > 0) return "hit";
    if (!isAttack(them.state.action)) return "hit";
    // Caught in their own move. Before its last active frame is a counter hit;
    // after it, they are recovering and it is a punish counter. `actionable()`
    // cannot tell the two apart — it is false for both.
    const windows = activeWindows(them.state.action);
    const lastActive = windows.length ? windows[windows.length - 1]!.end : 0;
    return them.state.frame <= lastActive ? "counter" : "punishCounter";
  }
}

const vitality = (geo: GeometryFile): number => geo.fighter?.health ?? 10000;

const isAttack = (action: GeometryAction): boolean =>
  action.hit.some((h) => h.kind !== "proximity") || Boolean(action.shots?.length);

function holdingBack(dir: Direction, facing: 1 | -1): boolean {
  const back = facing === 1 ? [1, 4, 7] : [3, 6, 9];
  return back.includes(dir);
}

/** A local box placed in the world, mirrored when the fighter faces left. */
function place(box: Box, x: number, y: number, facing: 1 | -1): Box {
  const lifted = { ...box, y: box.y + y };
  return facing === 1
    ? { ...lifted, x: x + box.x }
    : { ...lifted, x: x - (box.x + box.width) };
}

/**
 * A fireball's boxes in world space.
 *
 * Its origin is where it spawned plus its own action's motion — it carries on
 * across the screen while the thrower stands still recovering, which is why a
 * projectile's advantage is a curve rather than a number (ADR-0023).
 */
export function projectileBoxes(shot: Projectile): Box[] {
  const origin = originAt(shot.action, shot.frame);
  return hitboxesAt(shot.action, shot.frame).map((b) =>
    place(shift(b, { x: 0, y: origin.y + shot.y }), shot.x + origin.x * shot.facing, 0, shot.facing),
  );
}

function worldHitboxes(f: Fighter): Box[] {
  const { action, frame, facing } = f.state;
  const at = f.position();
  const origin = originAt(action, frame);
  return hitboxesAt(action, frame).map((b) => place(shift(b, { x: 0, y: origin.y }), at.x, 0, facing));
}

function worldHurtboxes(f: Fighter): Box[] {
  const { action, frame, facing } = f.state;
  const at = f.position();
  const origin = originAt(action, frame);
  return hurtboxesAt(action, frame).map((b) => place(shift(b, { x: 0, y: origin.y }), at.x, 0, facing));
}

function worldPush(f: Fighter): { left: number; right: number } | undefined {
  const box = pushboxesAt(f.state.action, f.state.frame)[0];
  if (!box) return undefined;
  const placed = place(box, f.position().x, 0, f.state.facing);
  return { left: placed.x, right: placed.x + placed.width };
}

/**
 * Which reaction the defender plays.
 *
 * The row's `part` picks the height letter and its `strength` the suffix, and a
 * crouching defender uses the crouch pair instead. Every one of the 3,167 hit
 * rows on the roster names an action that exists under this reading, which is
 * the check: a wrong decode names a `DMG_*` that is not there. See ADR-0027.
 */
export function reactionFor(
  geo: GeometryFile,
  outcome: HitOutcome,
  blocked: boolean,
  stance: "stand" | "crouch" | "air",
): GeometryAction | undefined {
  const prefix = blocked ? "GRD" : "DMG";
  const strength = outcome.reaction.strength === "H" || outcome.reaction.strength === "S" ? "H" : "M";
  const standing = ["H", "M", "L", "L"][outcome.reaction.part] ?? "M";
  const crouching = outcome.reaction.part >= 2 ? "D" : "C";
  const letters = stance === "crouch" ? [crouching, standing] : [standing, crouching];
  for (const letter of letters) {
    for (const suffix of [strength, "M"]) {
      const found = actionByName(geo, `${prefix}_${letter}${suffix}`);
      if (found) return found;
    }
  }
  return undefined;
}

/** A convenience for scripts and tests: hold a direction and buttons for N frames. */
export function hold(dir: Direction, buttons: Button[] = []): InputFrame {
  return { dir, buttons };
}
