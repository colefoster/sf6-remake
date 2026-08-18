/**
 * The runtime: a fighter on a fixed 60 Hz clock, moving under its own power.
 *
 * `src/sim` plays *one action* against a passive dummy and reports a number.
 * This plays a *fighter*: it holds a position and a stance, takes a held
 * direction each frame, and walks, crouches, dashes and jumps on the game's own
 * actions and the game's own origin motion. Nothing here reads a published
 * number, and nothing here decides what a hit does — attacks arrive in a later
 * stage, and contact stays where it already is.
 *
 * WHAT COMES FROM THE DUMP
 *   every action played, its length, its `MarginFrame`, its per-frame origin
 *   motion, and the frame a `START` hands off to its `Loop` (a type-0 branch).
 *
 * WHAT IS ASSERTED RATHER THAN READ
 *   the transitions *between* stances. Holding forward starting a walk is not
 *   in the dump; only the walk itself is. `MOVEMENT` below is that table, kept
 *   in one place so the assumption is visible. See docs/adr/0026.
 */

import {
  actionById,
  actionByName,
  loadGeometry,
  originAt,
  type Command,
  type CommandStep,
  type GeometryAction,
  type GeometryFile,
  type Trigger,
} from "../data/geometry.js";
import { requireCharacter } from "../data/index.js";

/** Numpad directions. 5 is neutral. */
export type Direction = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type Button = "LP" | "MP" | "HP" | "LK" | "MK" | "HK";

/** What the player is holding on one frame. */
export interface InputFrame {
  dir: Direction;
  /** Buttons *held*. Presses are the frames a button appears; see `pressed`. */
  buttons: Button[];
}

export const NEUTRAL: InputFrame = { dir: 5, buttons: [] };

/** Which way a direction leans once facing is applied. */
export function lean(dir: Direction, facing: 1 | -1): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  const raw = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ];
  const row = raw.findIndex((r) => r.includes(dir));
  const col = raw[row]!.indexOf(dir);
  return { x: ((col - 1) * facing) as -1 | 0 | 1, y: (row - 1) as -1 | 0 | 1 };
}

/**
 * The directions the player has been through, as **edges** rather than frames.
 *
 * A motion is a sequence of distinct directions, so holding forward for 40
 * frames is one entry and not forty. That is what makes the table's wildcard
 * steps mean anything: a `66` dash is stored as wildcard-`6`-wildcard-`6`, and
 * against a per-frame history a *held* forward would satisfy it. Against an edge
 * list it cannot, which is the difference between a dash and a walk.
 */
export class InputHistory {
  /** Newest last. `frame` is when the direction was entered. */
  private edges: { dir: Direction; frame: number }[] = [];
  private clock = 0;

  push(dir: Direction): void {
    this.clock++;
    if (this.edges[this.edges.length - 1]?.dir !== dir) {
      this.edges.push({ dir, frame: this.clock });
      if (this.edges.length > 32) this.edges.shift();
    }
  }

  get now(): number {
    return this.clock;
  }

  /**
   * Does the tail of the history satisfy this command?
   *
   * Walked backwards from the newest edge, because a motion is recognised by
   * what just finished it. Each step may look back over its own `frames` window;
   * a step with no window falls back to the command's, and then to 10 — the
   * table's own commonest value.
   */
  matches(command: Command, facing: 1 | -1): boolean {
    let i = this.edges.length - 1;
    let since = this.clock;
    for (let s = command.steps.length - 1; s >= 0; s--) {
      const step = command.steps[s]!;
      // A wildcard may match nothing at all. The leading step of a `66` dash is
      // one, and it stands for "whatever you were doing before" — requiring an
      // edge for it means the very first dash of a match never comes out.
      if (i < 0) {
        if (step.dir) return false;
        continue;
      }
      const window = step.frames > 0 ? step.frames : (command.window ?? 10);
      const deadline = since - window;
      let found = -1;
      for (let k = i; k >= 0 && this.edges[k]!.frame >= deadline; k--) {
        if (satisfies(step, this.edges[k]!.dir, facing)) {
          found = k;
          break;
        }
      }
      if (found < 0) return false;
      since = this.edges[found]!.frame;
      i = found - 1;
    }
    return true;
  }
}

/** Facing-relative: `6` is always toward the opponent. */
function relative(dir: Direction, facing: 1 | -1): Direction {
  if (facing === 1) return dir;
  const mirror: Record<Direction, Direction> = { 1: 3, 2: 2, 3: 1, 4: 6, 5: 5, 6: 4, 7: 9, 8: 8, 9: 7 };
  return mirror[dir];
}

const FORBIDS: Record<string, Direction[]> = {
  up: [7, 8, 9],
  down: [1, 2, 3],
  back: [1, 4, 7],
  forward: [3, 6, 9],
};

function satisfies(step: CommandStep, dir: Direction, facing: 1 | -1): boolean {
  const rel = relative(dir, facing);
  if (step.forbid?.some((k) => FORBIDS[k]?.includes(rel))) return false;
  if (step.dir) return rel === step.dir;
  // A wildcard, or a charge release, which the recogniser treats as satisfied by
  // anything: how long the slot was actually held is not tracked yet.
  return true;
}

export type Stance = "stand" | "crouch" | "air";

export interface FighterState {
  character: string;
  /** The action being played, and the 1-indexed frame of it. */
  action: GeometryAction;
  frame: number;
  /** World position of the character origin, and height off the ground. */
  x: number;
  y: number;
  facing: 1 | -1;
  stance: Stance;
}

/**
 * The stance transitions, which the dump does not state.
 *
 * Each entry names the action a fighter enters when it wants to be doing that
 * thing, and (for a walk) the action its `START` runs into. The `START -> Loop`
 * frame is *not* here: it is the action's own type-0 branch, read at runtime.
 */
const MOVEMENT: {
  stand: string;
  crouch: string;
  toCrouch: string;
  toStand: string;
  walkForward: string;
  walkForwardLoop: string;
  walkForwardEnd: string;
  walkBack: string;
  walkBackLoop: string;
  walkBackEnd: string;
  jump: Record<4 | 5 | 6, string>;
} = {
  stand: "BAS_STD_Loop",
  crouch: "BAS_CRH_Loop",
  toCrouch: "BAS_STD_CRH",
  toStand: "BAS_CRH_STD",
  walkForward: "BAS_FORWARD_START",
  walkForwardLoop: "BAS_FORWARD_Loop",
  walkForwardEnd: "BAS_FORWARD_END",
  walkBack: "BAS_BACKWARD_START",
  walkBackLoop: "BAS_BACKWARD_Loop",
  walkBackEnd: "BAS_BACKWARD_END",
  jump: { 5: "BAS_JUMP_N", 6: "BAS_JUMP_F", 4: "BAS_JUMP_B" },
};

/** The walk actions, as one set — a fighter already walking should not restart. */
const WALK_FORWARD = new Set([
  MOVEMENT.walkForward,
  MOVEMENT.walkForwardLoop,
  MOVEMENT.walkForwardEnd,
]);
const WALK_BACK = new Set([MOVEMENT.walkBack, MOVEMENT.walkBackLoop, MOVEMENT.walkBackEnd]);

/**
 * A branch the game takes on its own. Type 0 is the sequential handoff — the
 * frame a walk's `START` becomes its `Loop`. Type 47 is the burnout swap, which
 * every ground state carries and which nothing here is in a position to take.
 * See docs/adr/0026.
 */
const BRANCH_SEQUENTIAL = 0;

export class Fighter {
  readonly geo: GeometryFile;
  state: FighterState;
  /** Which jump is in the air, so `_START -> _AIR -> _LAND` can be walked. */
  private jumpFamily: string | null = null;
  readonly history = new InputHistory();
  /** The triggers available from neutral — the game's own list of what you can do. */
  private readonly neutral: { id: number; trigger: Trigger }[];

  constructor(character: string, x = 0, facing: 1 | -1 = 1) {
    const resolved = requireCharacter(character);
    const geo = loadGeometry(resolved.id);
    if (!geo) throw new Error(`no geometry for ${resolved.name} — run: npm run geometry`);
    this.geo = geo;
    this.state = {
      character: resolved.name,
      action: this.require(MOVEMENT.stand),
      frame: 1,
      x,
      y: 0,
      facing,
      stance: "stand",
    };
    const ids = new Set(geo.neutralGroups.flatMap((g) => geo.cancelGroups[String(g)] ?? []));
    this.neutral = [...ids]
      .map((id) => ({ id, trigger: geo.triggers[String(id)] }))
      .filter((e): e is { id: number; trigger: Trigger } => Boolean(e.trigger));
  }

  /**
   * The neutral options whose input the player has just made.
   *
   * A trigger with no motion is a bare button and is not offered here: this
   * stage only moves, and the only motion-only options from neutral are the two
   * dashes. Buttons arrive with attacks.
   */
  private firedByMotion(): GeometryAction | undefined {
    for (const { trigger } of this.neutral) {
      if (!trigger.motions?.length || trigger.kind?.length) continue;
      if (!trigger.motions.some((m) => this.history.matches(m, this.state.facing))) continue;
      const action = actionById(this.geo, trigger.action);
      if (action) return action;
    }
    return undefined;
  }

  private require(name: string): GeometryAction {
    const action = actionByName(this.geo, name);
    if (!action) throw new Error(`${this.state?.character ?? "fighter"} has no action ${name}`);
    return action;
  }

  /**
   * Where the origin sits this frame, relative to where the action began.
   *
   * Clamped to the action's own length: the clock is allowed to tick one frame
   * past the end before the handover runs, and reading the motion there would
   * find nothing and silently bank a jump's whole arc as zero.
   */
  private offset(frame: number): { x: number; y: number } {
    const last = this.state.action.frames ?? 1;
    return originAt(this.state.action, Math.min(Math.max(1, frame), last));
  }

  /**
   * Enter an action, keeping the world position the origin has already reached.
   *
   * An action's motion is stated *from where it began*, so switching mid-walk
   * has to bank what the old action had travelled before the new one's zero
   * takes over. Getting this wrong is what makes a fighter teleport home every
   * time a `START` becomes a `Loop`.
   */
  private enter(action: GeometryAction, stance: Stance = this.state.stance): void {
    const here = this.offset(this.state.frame);
    this.state.x += here.x * this.state.facing;
    this.state.y += here.y;
    this.state.action = action;
    this.state.frame = 1;
    this.state.stance = stance;
  }

  /** World position of the origin right now, motion included. */
  position(): { x: number; y: number } {
    const here = this.offset(this.state.frame);
    return { x: this.state.x + here.x * this.state.facing, y: this.state.y + here.y };
  }

  /** Is the fighter free to start something else? */
  actionable(): boolean {
    const { action, frame } = this.state;
    // A movement action has no recovery of its own: `MarginFrame` is -1 and the
    // fighter can leave it whenever. A dash states a real margin and holds.
    return action.marginFrame && action.marginFrame > 0 ? frame >= action.marginFrame : true;
  }

  /** The name of the action being played — the thing a test or a viewer reads. */
  get actionName(): string {
    return this.state.action.name;
  }

  /**
   * One frame. The order matters: the action's own branch first (the game's
   * decision), then whether the player wants something else (ours), then the
   * clock.
   */
  advance(input: InputFrame = NEUTRAL): void {
    this.history.push(input.dir);
    this.takeBranch();
    this.applyInput(input);
    this.state.frame++;
    this.runOut();
  }

  /** A type-0 branch on this frame is the game handing one action to the next. */
  private takeBranch(): void {
    const { action, frame } = this.state;
    const branch = action.branches?.find((b) => b.frame === frame && b.type === BRANCH_SEQUENTIAL);
    const next = branch && actionById(this.geo, branch.action);
    // Only follow it inside a movement family. Elsewhere a type-0 branch is a
    // follow-up the player has to ask for, and taking it unasked would play
    // Ryu's whole target combo from one button.
    if (next && isMovement(next.name)) this.enter(next);
  }

  /**
   * Past its last frame, an action hands over: a jump walks its own chain, a
   * walk drops to idle, everything else falls back to the stance it left in.
   */
  private runOut(): void {
    const { action, frame, stance } = this.state;
    if (frame <= (action.frames ?? 0)) return;
    if (this.jumpFamily) {
      // The jump chain carries no branches at all — `_START` is the crouch
      // before the leap, `_AIR` the arc, `_LAND` the recovery — so it is walked
      // by name. The fighter is grounded again the moment `_LAND` begins.
      if (action.name.endsWith("_START")) return this.enter(this.require(`${this.jumpFamily}_AIR`), "air");
      if (action.name.endsWith("_AIR")) {
        this.enter(this.require(`${this.jumpFamily}_LAND`), "stand");
        // The arc's last recorded frame is still 23 units up: `_AIR` stops
        // short and `_LAND` is the touchdown. Banking that residue would leave
        // the fighter permanently hovering, a little higher after every jump.
        this.state.y = 0;
        return;
      }
      this.jumpFamily = null;
    }
    // A walk's `Loop` is a loop: 114 frames of animation the game plays again
    // for as long as the direction is held. Re-entering it banks the travel and
    // starts the motion over, which is what keeps the walk speed constant.
    if (action.name === MOVEMENT.walkForwardLoop || action.name === MOVEMENT.walkBackLoop) {
      return this.enter(action, "stand");
    }
    if (isWalk(action.name)) return this.enter(this.require(MOVEMENT.stand), "stand");
    this.enter(this.require(stance === "crouch" ? MOVEMENT.crouch : MOVEMENT.stand), stance);
  }

  private applyInput(input: InputFrame): void {
    if (!this.actionable()) return;
    const { x, y } = lean(input.dir, this.state.facing);
    const name = this.actionName;

    if (this.state.stance === "air") return;

    // A motion beats a hold: tapping forward twice is a dash, not a walk.
    const fired = this.firedByMotion();
    if (fired && fired !== this.state.action) return this.enter(fired, "stand");

    if (y > 0) return this.startJump(x);
    if (y < 0) return this.crouch();
    if (this.state.stance === "crouch") return this.stand();

    if (x > 0) {
      if (!WALK_FORWARD.has(name)) this.enter(this.require(MOVEMENT.walkForward), "stand");
      return;
    }
    if (x < 0) {
      if (!WALK_BACK.has(name)) this.enter(this.require(MOVEMENT.walkBack), "stand");
      return;
    }
    // Neutral: a walk plays its own END, anything else drops to idle.
    if (WALK_FORWARD.has(name) && name !== MOVEMENT.walkForwardEnd) {
      this.enter(this.require(MOVEMENT.walkForwardEnd), "stand");
    } else if (WALK_BACK.has(name) && name !== MOVEMENT.walkBackEnd) {
      this.enter(this.require(MOVEMENT.walkBackEnd), "stand");
    }
  }

  private crouch(): void {
    if (this.state.stance === "crouch") return;
    this.enter(this.require(MOVEMENT.toCrouch), "crouch");
  }

  private stand(): void {
    this.enter(this.require(MOVEMENT.toStand), "stand");
  }

  private startJump(x: -1 | 0 | 1): void {
    const family = MOVEMENT.jump[x > 0 ? 6 : x < 0 ? 4 : 5];
    this.enter(this.require(`${family}_START`), "air");
    this.jumpFamily = family;
  }
}

const isWalk = (name: string): boolean => WALK_FORWARD.has(name) || WALK_BACK.has(name);

const isMovement = (name: string): boolean => /^BAS_(FORWARD|BACKWARD|STD|CRH|JUMP|DASH)/.test(name);
