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
  actionableFrame,
  originAt,
  type Command,
  type CommandStep,
  type GeometryAction,
  type GeometryFile,
  type Trigger,
  driveTickAt,
} from "../data/geometry.js";

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
   * The last `count` direction edges, oldest first — the input display.
   *
   * Edges rather than frames is the point: a display built from held frames says
   * "6 6 6 6 6" where the game read one forward, and a missed quarter-circle is
   * only visible against what the game actually read. See ADR-0049.
   */
  recent(count = 12): { dir: Direction; frame: number }[] {
    return this.edges.slice(-count);
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

/**
 * The quick-rise input, asserted rather than read.
 *
 * SF6 takes down or any two buttons; the dump states neither, because there is
 * no second down action for a quick rise to play. Down alone is what this
 * models. See ADR-0041.
 */
function holdingDown(dir: Direction): boolean {
  return dir === 1 || dir === 2 || dir === 3;
}

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

/**
 * A full Drive gauge, in the units the triggers are denominated in.
 *
 * Six bars of 10000. The bar size is the dump's — an OD special costs 20000 and
 * the game calls that two bars — but the **maximum is not in the dump**:
 * `char_info` states `Gauge: 30000` for the super gauge and nothing for Drive.
 * Six bars is the inference the whole codebase has been carrying in comments
 * since ADR-0009; this is the first place it has to be a number. See ADR-0031.
 */
export const DRIVE_MAX = 60000;

export class Fighter {
  readonly geo: GeometryFile;
  state: FighterState;
  /** Drive gauge, 0..{@link DRIVE_MAX}. */
  drive = DRIVE_MAX;
  /** Super Art gauge, 0..`superMax`. */
  superMeter = 0;
  /** The dump's own `char_info.Gauge` — 30000 on all 24. */
  readonly superMax: number;
  /**
   * Out of Drive. The dump carries the whole burnout state — a `_tired` twin of
   * every ground action and a type-47 branch pointing at it — and until there
   * was a gauge nothing could take it. What the dump does *not* say is how long
   * burnout lasts or what ends it. See ADR-0031.
   */
  burnout = false;
  /** Which jump is in the air, so `_START -> _AIR -> _LAND` can be walked. */
  private jumpFamily: string | null = null;
  readonly history = new InputHistory();
  /** The triggers available from neutral — the game's own list of what you can do. */
  private readonly neutral: { id: number; trigger: Trigger }[];
  /** The buttons that hold Drive Parry — `MP+MK` on all 24. */
  private readonly parryKeys: Button[];

  /**
   * Takes the geometry itself, never a name.
   *
   * Looking a character up reads the file system, and this module has to run in
   * a browser that fetched `<char>.boxes.json` and already holds the same bytes.
   * `src/game/load.ts` is the Node-side convenience; keeping the lookup out of
   * here is what lets the viewer run the real runtime instead of a second
   * implementation of it, which is the duplication ADR-0007 has been carrying.
   */
  constructor(geo: GeometryFile, x = 0, facing: 1 | -1 = 1) {
    this.geo = geo;
    this.superMax = geo.fighter?.superMax ?? 30000;
    this.state = {
      character: geo.character,
      action: this.require(MOVEMENT.stand),
      frame: 1,
      x,
      y: 0,
      facing,
      stance: "stand",
    };
    this.parryKeys = (Object.values(geo.triggers ?? {}).find((t) => t?.kind?.includes("Parry"))?.keys ?? []).filter(
      isButton,
    );
    const ids = new Set(geo.neutralGroups.flatMap((g) => geo.cancelGroups[String(g)] ?? []));
    this.neutral = [...ids]
      .map((id) => ({ id, trigger: geo.triggers[String(id)] }))
      .filter((e): e is { id: number; trigger: Trigger } => Boolean(e.trigger));
  }

  /**
   * Everything the fighter could do on this frame.
   *
   * From neutral that is the neutral list. Mid-attack it is whatever the
   * action's own cancel window has open — the same groups ADR-0008 extracted,
   * resolved to the same triggers. A move is cancellable into a special exactly
   * where the game says it is, which is the point of not authoring this.
   */
  private options(): Trigger[] {
    const { action, frame } = this.state;
    const open = (action.cancels ?? []).filter((c) => !c.buffered && frame >= c.start && frame <= c.end);
    if (!open.length) return this.actionable() ? this.neutral.map((e) => e.trigger) : [];
    const ids = new Set(open.flatMap((c) => this.geo.cancelGroups[String(c.group)] ?? []));
    const out: Trigger[] = [];
    for (const id of ids) {
      const trigger = this.geo.triggers[String(id)];
      if (trigger) out.push(trigger);
    }
    return out;
  }

  /**
   * Which option the player has just asked for, if any.
   *
   * Ordered deliberately: a trigger with a motion beats one without, and a more
   * specific direction beats a looser one. Otherwise holding down and pressing
   * MK gives 5MP's trigger as readily as 2MK's, and a quarter-circle plus punch
   * gives a standing jab.
   */
  private fired(input: InputFrame, presses: Button[]): GeometryAction | undefined {
    const ranked = this.options()
      .filter((t) => this.satisfied(t, input, presses))
      // What the gauges cannot pay for is not an option. This is the whole of
      // what a gauge *is* to the state machine: the dump prices every trigger,
      // and until now nothing checked the price. In burnout there is no Drive
      // to spend at all, which is what takes OD moves and Drive Rush away.
      .filter((t) => this.affords(t))
      .sort((a, b) => score(b) - score(a));
    for (const trigger of ranked) {
      const action = actionById(this.geo, trigger.action);
      if (!action) continue;
      this.spend(trigger);
      // Spend the press. A button stays "pressed" for its buffer so a cancel
      // can land a few frames late, and without spending it the same press
      // would fire the move again the moment the fighter is free.
      for (const key of trigger.keys ?? []) if (isButton(key)) this.pressedAt.delete(key);
      return action;
    }
    return undefined;
  }

  /** Can the gauges pay this trigger's price. */
  private affords(trigger: Trigger): boolean {
    return (trigger.drive ?? 0) <= this.drive && (trigger.super ?? 0) <= this.superMeter;
  }

  private spend(trigger: Trigger): void {
    this.drive -= trigger.drive ?? 0;
    this.superMeter -= trigger.super ?? 0;
    this.checkBurnout();
  }

  /**
   * Gauge movement that is not a purchase: what a hit banks, and regen.
   *
   * Clamped at both ends, and the moment Drive reaches zero the fighter is in
   * burnout. Leaving it is the assumption: SF6 refills the gauge and lets you
   * out at the top, and nothing in the dump states either the duration or the
   * exit, so the exit is "full again". See ADR-0031.
   */
  gain(gauge: "drive" | "super", amount: number): void {
    if (gauge === "super") {
      this.superMeter = Math.max(0, Math.min(this.superMax, this.superMeter + amount));
      return;
    }
    this.drive = Math.max(0, Math.min(DRIVE_MAX, this.drive + amount));
    this.checkBurnout();
  }

  private checkBurnout(): void {
    if (this.drive <= 0) {
      this.drive = 0;
      this.burnout = true;
    } else if (this.burnout && this.drive >= DRIVE_MAX) {
      this.burnout = false;
    }
  }

  /**
   * Drive regenerates every frame, at the rate `char_info` states for the
   * fighter's situation.
   *
   * `FocusRecoverNM` is 40 on the ground and `NMA` 20 in the air; burnout has
   * its own faster `IC` at 50, which is what refills the gauge and ends it. The
   * *period* those rates are quoted over is not in the dump — the extractor says
   * so — so this reads them as units per frame, which fills an empty gauge in
   * 1,200 frames of burnout. That is a decode, not a measurement.
   */
  private regenerate(): void {
    const rates = this.geo.fighter?.scales?.focusRecover;
    if (!rates) return;
    const air = this.state.stance === "air";
    const rate = this.burnout ? (air ? rates.burnoutAir : rates.burnout) : air ? rates.normalAir : rates.normal;
    this.gain("drive", rate);
    // And whatever the action itself says, per frame: holding Drive Parry drains
    // 50, walking forward regenerates 20, a throw tech hands back half a bar.
    // One rule, three mechanics, all of them the dump's own. See ADR-0054.
    const tick = driveTickAt(this.state.action, this.state.frame);
    if (tick) this.gain("drive", tick);
  }

  private satisfied(trigger: Trigger, input: InputFrame, _presses: Button[]): boolean {
    if (trigger.keys?.length) {
      const buttons = trigger.keys.filter(isButton);
      if (buttons.length) {
        // A three-button mask is "any two of these" — the game's OD input — and
        // a two-button mask (LP+LK, HP+HK) is both. One is one.
        const need = buttons.length === 3 ? 2 : buttons.length;
        // Pressed within this trigger's own buffer, not necessarily *this*
        // frame: `preceding_time` is the game's input buffer (ADR-0009), and it
        // is why a special cancel lands when the button went down a few frames
        // before the window opened.
        const fresh = buttons.filter((b) => this.clock - (this.pressedAt.get(b) ?? -99) < Math.max(1, trigger.buffer));
        if (fresh.length < need) return false;
      }
    } else if (!trigger.motions?.length) {
      return false;
    }
    if (trigger.dir?.length && !trigger.dir.every((d) => holding(d, input.dir, this.state.facing))) {
      return false;
    }
    if (!trigger.dir?.length && trigger.keys?.some(isButton) && !trigger.motions?.length) {
      // A neutral normal: any direction that is *not* one another trigger claims
      // would still reach it, which is what makes 2MK and 5MK distinguishable.
      if (holding("down", input.dir, this.state.facing)) return false;
    }
    if (trigger.motions?.length) {
      return trigger.motions.some((m) => this.history.matches(m, this.state.facing));
    }
    return true;
  }

  /** The motion-only options — this is what makes a dash a dash. */
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
    this.instance++;
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
    //
    // Strictly greater: `MarginFrame` is the action's last *committed* frame and
    // you are free on the one after, which is what `actionableFrame` means by
    // `marginFrame + 1`. Reading it as `>=` makes every move one frame more plus
    // than the scenario player says. See ADR-0011.
    // Holding Drive Parry is a commitment, whatever the margin says. The parry
    // actions all state `MarginFrame` −1, which everywhere else means "movement,
    // leave whenever" — but the stance takes no direction and the only options
    // it offers are its own cancel window's. Reading it as free made a parried
    // 2MK come out at −31 for a defender who could not in fact do anything.
    // See ADR-0054.
    if (this.parrying) return false;
    return action.marginFrame && action.marginFrame > 0 ? frame > action.marginFrame : true;
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
    this.clock++;
    const presses = input.buttons.filter((b) => !this.held.includes(b));
    for (const b of presses) this.pressedAt.set(b, this.clock);
    this.held = [...input.buttons];
    this.regenerate();
    if (this.stun > 0) {
      // In a reaction. The clock still runs, but nothing is asked of the player.
      this.stun--;
      this.state.frame++;
      if (this.stun === 0) {
        // The reaction is over. A knocked-down fighter does not stand up into
        // idle — they lie in `BAS_DN_STD_AO` for the hit row's `DownTime` and
        // then for that action's own recovery, and are actionable on its
        // `MarginFrame + 1`. The chain carries no branches at all, so it is
        // walked by name like the jump chain. See ADR-0033.
        if (this.floor > 0) {
          const down = actionByName(this.geo, "BAS_DN_STD_AO");
          const up = down ? actionableFrame(down) : undefined;
          if (down && up) {
            // Quick rise: the `DownTime` is the part of the floor the defender
            // can refuse. What is left is the get-up itself, which is the down
            // action's own recovery and is not optional. Whether it can be
            // refused at all is `hardKnockdown`, the rule the grader uses; the
            // *input* is asserted, because the dump has no down action for it —
            // there is one `BAS_DN_STD_AO` and it does not come in two lengths.
            // See ADR-0041.
            const rising = this.quickRisable && holdingDown(input.dir);
            this.enter(down, "stand");
            this.stun = (rising ? 0 : this.floor) + up.frame - 1;
            this.floor = 0;
            this.quickRisable = false;
            return;
          }
        }
        this.floor = 0;
        this.enter(this.require(stanceIdle(this.state.stance)), this.state.stance);
      }
      return;
    }
    this.takeBranch();
    const attack = this.fired(input, presses);
    if (attack && attack !== this.state.action) this.enter(attack);
    else this.applyInput(input);
    this.state.frame++;
    this.runOut();
  }

  /**
   * Put this fighter into a reaction for `frames` frames — a hit or a block.
   *
   * The action names the animation and the hit table names the duration: the
   * reaction's own `MarginFrame` is a generic 17 or 25 and agrees with the
   * table's stun on barely a hundred of 3,167 rows. The table wins. See ADR-0027.
   */
  react(action: GeometryAction, frames: number, floor?: number, quickRisable = false): void {
    this.enter(action, this.state.stance === "air" ? "air" : this.state.stance);
    this.stun = frames;
    this.floor = floor ?? 0;
    this.quickRisable = quickRisable;
  }

  /**
   * Enter an action outright, the way a branch the runtime chooses would.
   *
   * `react` is for being hit; this is for the thrower taking their own catch
   * branch, which is neither an input nor a hit. See ADR-0035.
   */
  play(action: GeometryAction): void {
    this.enter(action, this.state.stance === "air" ? "air" : "stand");
  }

  /** The buttons that hold Drive Parry, for a caller that wants to hold them. */
  get parryButtons(): Button[] {
    return [...this.parryKeys];
  }

  /** Are the parry buttons still down. The trigger names them; see ADR-0054. */
  private holdingParry(input: InputFrame): boolean {
    const keys = this.parryKeys;
    return keys.length > 0 && keys.every((k) => input.buttons.includes(k));
  }

  /** Is this fighter on the floor rather than merely in hitstun. */
  get down(): boolean {
    return this.state.action.name.startsWith("BAS_DN_");
  }

  /**
   * Is this fighter holding Drive Parry.
   *
   * The stance is `DPA_STD_START` into `DPA_STD_Loop`, and the catch reactions
   * `DPA_L`/`_M`/`_H` count too: parrying one hit of a string does not drop the
   * parry. `DPA_STD_END` is the release and does not. See ADR-0054.
   */
  get parrying(): boolean {
    const name = this.state.action.name;
    return name.startsWith("DPA_") && !name.endsWith("_END");
  }

  /** Frames of hitstun or blockstun still owed. */
  get stunned(): number {
    return this.stun;
  }

  /** Frames still owed on the floor once the knockdown reaction ends. */
  get floored(): number {
    return this.floor;
  }

  /**
   * The actions this fighter can start from neutral.
   *
   * The private list resolved to actions, for a caller asking *what could you do
   * from here* — the training room's punish window, which needs the startup and
   * the reach of everything on it. The state machine asks the same question
   * through `options()`, which also has to handle mid-action cancel windows.
   */
  get neutralActions(): GeometryAction[] {
    const out: GeometryAction[] = [];
    for (const entry of this.neutral) {
      const action = actionById(this.geo, entry.trigger.action);
      if (action) out.push(action);
    }
    return out;
  }

  /**
   * Bumped every time an action is entered. It is how a caller tells "still the
   * same swing" from "swung again" — a hitbox that is out for three frames must
   * only connect once, and hitstop is longer than the active window.
   */
  instance = 0;

  private stun = 0;
  /** Frames still owed on the floor once the knockdown reaction ends. */
  private floor = 0;
  /** Is the floor time this knockdown owes refusable. See ADR-0041. */
  private quickRisable = false;
  private held: Button[] = [];
  private clock = 0;
  /** When each button last went down, for the trigger's own input buffer. */
  private readonly pressedAt = new Map<Button, number>();

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
    // The parry stance loops the same way a walk does: `_START` branches into
    // `_Loop` and `_Loop` plays again for as long as the buttons are held. The
    // branch is type 0 and `takeBranch` only follows those inside a movement
    // family, so the chain is walked here by name instead.
    if (this.parrying) {
      const loop = actionByName(this.geo, "DPA_STD_Loop");
      if (loop) return this.enter(loop, stance === "crouch" ? "crouch" : "stand");
    }
    // A walk's `Loop` is a loop: 114 frames of animation the game plays again
    // for as long as the direction is held. Re-entering it banks the travel and
    // starts the motion over, which is what keeps the walk speed constant.
    if (action.name === MOVEMENT.walkForwardLoop || action.name === MOVEMENT.walkBackLoop) {
      return this.enter(action, "stand");
    }
    if (isWalk(action.name)) return this.enter(this.require(MOVEMENT.stand), "stand");
    // Anything that runs out while airborne has come down: an air action the
    // jump chain does not cover (Cammy's dive kick) would otherwise leave the
    // fighter standing in the idle loop and still flagged airborne, forever.
    const grounded = stance === "air" ? "stand" : stance;
    this.enter(this.require(grounded === "crouch" ? MOVEMENT.crouch : MOVEMENT.stand), grounded);
    if (stance === "air") this.state.y = 0;
  }

  private applyInput(input: InputFrame): void {
    // Holding Drive Parry is holding the buttons. Nothing else the stick says
    // reaches the fighter — a parry does not walk — so this comes first and the
    // release is the only way out of it.
    if (this.parrying) {
      if (this.holdingParry(input)) return;
      const end = actionByName(this.geo, "DPA_STD_END");
      if (end) return this.enter(end, this.state.stance === "crouch" ? "crouch" : "stand");
    }
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

const BUTTONS: Button[] = ["LP", "MP", "HP", "LK", "MK", "HK"];
const isButton = (key: string): key is Button => (BUTTONS as string[]).includes(key);

const stanceIdle = (stance: Stance): string =>
  stance === "crouch" ? MOVEMENT.crouch : MOVEMENT.stand;

/** Is the player holding a direction with this component, facing considered? */
function holding(key: string, dir: Direction, facing: 1 | -1): boolean {
  return FORBIDS[key]?.includes(relative(dir, facing)) ?? false;
}

/**
 * How specific an option is, for choosing between the ones the input satisfies.
 * A motion beats a bare button, and a required direction beats none — otherwise
 * pressing MK while crouching would find 5MK as readily as 2MK.
 */
function score(trigger: Trigger): number {
  const buttons = (trigger.keys ?? []).filter(isButton).length;
  return (
    (trigger.motions?.length ? 10 : 0) +
    (trigger.dir?.length ?? 0) * 3 +
    // A two-button option (throw, Drive Impact) is more specific than either
    // button alone, so LP+LK has to beat 5LP rather than tie with it.
    (buttons === 2 ? 4 : 0) +
    (trigger.super ? 2 : 0) +
    (trigger.drive ? 1 : 0)
  );
}

const isMovement = (name: string): boolean => /^BAS_(FORWARD|BACKWARD|STD|CRH|JUMP|DASH)/.test(name);
