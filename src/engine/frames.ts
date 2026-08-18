/**
 * Frame math: the pure, data-independent core of the engine.
 *
 * All functions here derive from the identities documented in CONTEXT.md.
 * They take plain numbers / Moves and return plain results — no I/O, no data
 * loading — which is what makes them cheap to test exhaustively.
 */

import type { Move } from "../domain/types.js";

export type Guard = "block" | "hit";

/**
 * Total duration of a move if it whiffs.
 *
 * The `- 1` is not a fudge: startup counts up to and including the first active
 * frame, so adding `active` to it counts that frame twice. Ryu 5LP is 4 startup,
 * 3 active, 7 recovery and occupies 13 frames — which is what FAT publishes as
 * its `total` and what the game stores as the action's `MarginFrame`. Two
 * independent sources, one number; the prose in `CONTEXT.md` said 14.
 */
export function totalFrames(move: Pick<Move, "startup" | "active" | "recovery">): number {
  return move.startup + move.active + move.recovery - 1;
}

/**
 * Blocking holds the defender for four frames longer than the advantage implies:
 * the tail of the guard animation is stun the defender can already act out of.
 *
 * Measured, not assumed. Against the game's own hit-data table, blockstun comes
 * out at exactly `onBlock + active + recovery + 4` on all 13 of Akuma's mapped
 * moves and 8 of Ryu's 12 — and the four Ryu stragglers are the same moves whose
 * startup the two sources already disagree about, which is patch skew between a
 * 2024 dump and a newer frame-data set. Hitstun carries no such constant.
 */
const GUARD_RELEASE = 4;

/**
 * Derive blockstun (or hitstun) from listed advantage. This is a *fallback*:
 * where a character has extracted geometry, `hitDataFor` carries the game's own
 * numbers and should be preferred. Ryu 5MP (onBlock −1, onHit 7, active 4,
 * recovery 11) derives to blockstun 18 and hitstun 22, which is what the hit
 * data says to the frame:
 *
 *   stun = advantage + active + recovery (+ 4 when blocking)
 */
export function stunFrom(move: Move, guard: Guard): number | undefined {
  const adv = guard === "block" ? move.onBlock : move.onHit;
  if (adv === undefined) return undefined;
  return adv + move.active + move.recovery + (guard === "block" ? GUARD_RELEASE : 0);
}

/**
 * Advantage of a move accounting for meaty depth.
 *
 * Hitting `deep` frames late (on active frame `deep + 1`) means the attacker
 * spends `deep` fewer frames after contact, so advantage improves by `deep`.
 * `deep` is clamped to the move's active window (0 .. active − 1).
 */
export function advantage(
  move: Move,
  guard: Guard,
  deep = 0,
): number | undefined {
  const base = guard === "block" ? move.onBlock : move.onHit;
  if (base === undefined) return undefined;
  const maxDeep = Math.max(0, move.active - 1);
  const d = Math.min(Math.max(0, Math.trunc(deep)), maxDeep);
  return base + d;
}

/** The largest meaty depth possible for a move (its last active frame). */
export function maxMeatyDepth(move: Move): number {
  return Math.max(0, move.active - 1);
}

export type Sign = "plus" | "minus" | "neutral";

export function signOf(adv: number): Sign {
  if (adv > 0) return "plus";
  if (adv < 0) return "minus";
  return "neutral";
}
