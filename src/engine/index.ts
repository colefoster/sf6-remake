/**
 * Public engine API. This is the deep module: a small surface (a handful of
 * ask-a-question functions taking plain strings) over the frame + interaction
 * math and the roster data.
 */

import { requireCharacter, requireMove } from "../data/index.js";
import type { Move } from "../domain/types.js";
import type { Guard } from "./frames.js";
import {
  analyzeSequence,
  cancelInto,
  fastestPunish,
  moveAdvantage,
  punishAssessment,
  blockGap,
  type StringResult,
  type CancelResult,
  type FastestPunish,
  type PunishResult,
  type AdvantageResult,
  type GapResult,
} from "./interactions.js";

export * from "./frames.js";
export * from "./interactions.js";

export interface Scenario {
  guard?: Guard;
  meaty?: number;
}

/** Advantage of a single move: `adv("ryu", "2mk", { guard: "block" })`. */
export function adv(character: string, move: string, s: Scenario = {}): AdvantageResult | undefined {
  const c = requireCharacter(character);
  return moveAdvantage(requireMove(c, move), s.guard ?? "block", s.meaty ?? 0);
}

/**
 * Flagship: does `moves` (a string / cancel chain) end plus or minus in a
 * scenario? `sequence("ryu", ["2mk", "236lp"], { guard: "block" })`.
 */
export function sequence(character: string, moves: string[], s: Scenario = {}): StringResult {
  const c = requireCharacter(character);
  const resolved: Move[] = moves.map((m) => requireMove(c, m));
  return analyzeSequence(resolved, s.guard ?? "block", s.meaty ?? 0);
}

/** Cancel X into Y and report legality + ending advantage. */
export function cancel(character: string, x: string, y: string, s: Scenario = {}): CancelResult {
  const c = requireCharacter(character);
  return cancelInto(requireMove(c, x), requireMove(c, y), s.guard ?? "block", s.meaty ?? 0);
}

/** Is `blocked` punishable, and by what? Punisher may be on another character. */
export function punish(
  attacker: string,
  blocked: string,
  defender: string,
  punisher?: string,
): PunishResult | FastestPunish {
  const atk = requireCharacter(attacker);
  const blockedMove = requireMove(atk, blocked);
  const def = requireCharacter(defender);
  if (punisher) {
    return punishAssessment(blockedMove, requireMove(def, punisher));
  }
  // No specific punisher: find the fastest *strike* that punishes. Restrict the
  // pool to real attacks — a hitting move with a startup ≥ 1 and damage — so
  // taunts, parries, and other non-attacks (which parse to 0/1f) don't win.
  const strikes = def.moves.filter(
    (m) =>
      (m.category === "normal" || m.category === "special" || m.category === "super") &&
      m.startup >= 1 &&
      m.damage !== undefined &&
      (m.onHit !== undefined || m.hitReaction !== undefined),
  );
  return fastestPunish(blockedMove, strikes);
}

/** Gap between two blocked moves. */
export function gap(character: string, a: string, b: string): GapResult {
  const c = requireCharacter(character);
  return blockGap(requireMove(c, a), requireMove(c, b));
}
