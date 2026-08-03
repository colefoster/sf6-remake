/**
 * Frame math: the pure, data-independent core of the engine.
 *
 * All functions here derive from the identities documented in CONTEXT.md.
 * They take plain numbers / Moves and return plain results — no I/O, no data
 * loading — which is what makes them cheap to test exhaustively.
 */

import type { Move } from "../domain/types.js";

export type Guard = "block" | "hit";

/** Total duration of a move if it whiffs. */
export function totalFrames(move: Pick<Move, "startup" | "active" | "recovery">): number {
  return move.startup + move.active + move.recovery;
}

/**
 * Derive blockstun (or hitstun) from listed advantage.
 *
 *   onBlock = stun − ((active − 1) + recovery)
 *   =>  stun = onBlock + (active − 1) + recovery
 *
 * This keeps advantage as the single source of truth in the data.
 */
export function stunFrom(move: Move, guard: Guard): number | undefined {
  const adv = guard === "block" ? move.onBlock : move.onHit;
  if (adv === undefined) return undefined;
  return adv + (move.active - 1) + move.recovery;
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
