/**
 * The opponent, beside the match rather than inside it.
 *
 * `Match.advance(p1, p2)` takes two input frames, which is already the whole
 * interface an opponent needs: **an opponent is a function that returns one**.
 * So nothing here is wired into `match.ts`, and `match.ts` does not know these
 * exist — it is 930 lines of gauges, combos, throws, armor and knockdowns
 * already, and a dummy controller landing in it would be the beginning of a
 * second state machine. See ADR-0049 and the spec at
 * `.scratch/training-room/spec.md`.
 *
 * These are the training-mode staples, in the order a player reaches for them.
 * They read the match rather than a script: `blockAll` crouches for a low
 * because the attack's own `low` flag says to, which is the same rule the
 * contact check applies on the other side.
 */

import type { GeometryAction } from "../data/geometry.js";
import { activeWindows } from "../data/geometry.js";
import { hold, type Match } from "./match.js";
import type { InputFrame } from "./index.js";

/** An opponent: everything `Match.advance` wants, and nothing more. */
export type Opponent = (match: Match, side: 0 | 1) => InputFrame;

/** The numpad direction that is *away* from the other fighter. */
const back = (facing: 1 | -1): 4 | 6 => (facing === 1 ? 4 : 6);
const backDown = (facing: 1 | -1): 1 | 3 => (facing === 1 ? 1 : 3);

/** Is the other fighter swinging something that has to be blocked crouching? */
function lowIncoming(match: Match, side: 0 | 1): boolean {
  const them = match.fighters[side === 0 ? 1 : 0];
  return isSwinging(them.state.action, them.state.frame) && them.state.action.flags.low === true;
}

/**
 * Mid-swing, counting the start-up: a dummy that waited for the active frames
 * would be blocking one frame after the hit landed.
 */
function isSwinging(action: GeometryAction, frame: number): boolean {
  const windows = activeWindows(action);
  return windows.length > 0 && frame <= windows[windows.length - 1]!.end;
}

/** Holds neutral and takes what it is given. The default, per the spec. */
export const stand: Opponent = () => hold(5);

/** Crouches, and takes what it is given. */
export const crouch: Opponent = () => hold(2);

/** Is there anything to block: a swing mid-flight, a fireball, or blockstun. */
function threatened(match: Match, side: 0 | 1): boolean {
  const them = match.fighters[side === 0 ? 1 : 0];
  if (match.fighters[side].stunned > 0) return true;
  if (isSwinging(them.state.action, them.state.frame)) return true;
  return match.projectiles.some((shot) => shot.owner !== side && !shot.spent);
}

/**
 * Blocks everything, high or low as the attack demands.
 *
 * Holding back is the whole of blocking (`contactType`), so this is the input
 * and the engine does the rest — including refusing the block when the height
 * is wrong, which is why the low flag is read here rather than guessed.
 *
 * Back is held only while there is something to block. Held always, the dummy
 * walks backwards between attacks and is in the corner within a few exchanges,
 * which is a different training scenario than the one that was asked for.
 */
export const blockAll: Opponent = (match, side) => {
  if (!threatened(match, side)) return hold(5);
  const { facing } = match.fighters[side].state;
  return hold(lowIncoming(match, side) ? backDown(facing) : back(facing));
};

/**
 * Stands until something lands, then blocks. What you set to check whether a
 * blockstring is actually tight.
 */
export const blockAfterFirstHit: Opponent = (match, side) =>
  match.hits.some((h) => h.attacker !== side) ? blockAll(match, side) : stand(match, side);

/**
 * Mashes 5LP.
 *
 * Alternating frames, not a held button: a trigger fires on the *press*, and a
 * button held down is one press however long it is held.
 */
export const mash: Opponent = (match) => hold(5, match.frame % 2 === 0 ? ["LP"] : []);

/**
 * Holds Drive Parry through anything on the way.
 *
 * The buttons are the parry: `Fighter` enters the stance off the trigger and
 * stays in it while they are down, so this behaviour is the same shape as
 * `blockAll` — hold while threatened, neutral otherwise, because a parry held
 * forever is half a bar of Drive a second going nowhere.
 */
export const parryAll: Opponent = (match, side) => {
  const keys = match.fighters[side].parryButtons;
  if (!keys.length) return hold(5);
  // Only while there is something to catch. Held past that the dummy never
  // releases, so it never recovers, and nothing downstream ever sees it free.
  return threatened(match, side) ? hold(5, keys) : hold(5);
};

/** The behaviours by name, for a page that puts them in a dropdown. */
export const DUMMIES: Record<string, Opponent> = {
  stand,
  crouch,
  blockAll,
  blockAfterFirstHit,
  parryAll,
  mash,
};
