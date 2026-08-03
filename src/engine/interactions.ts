/**
 * Interaction math: punishes, blockstring gaps, cancels, and the flagship
 * "X into Y from scenario Z" sequence ending advantage.
 *
 * Pure functions over Move objects. See CONTEXT.md for the definitions each
 * one implements.
 */

import type { Move } from "../domain/types.js";
import { advantage, signOf, type Guard, type Sign } from "./frames.js";

export interface AdvantageResult {
  move: string;
  guard: Guard;
  meaty: number;
  advantage: number;
  sign: Sign;
  reaction?: NonNullable<Move["hitReaction"]>;
}

/** Advantage of a single move in a guard state, at a meaty depth. */
export function moveAdvantage(move: Move, guard: Guard, meaty = 0): AdvantageResult | undefined {
  const adv = advantage(move, guard, meaty);
  if (adv === undefined) return undefined;
  const result: AdvantageResult = {
    move: move.name,
    guard,
    meaty,
    advantage: adv,
    sign: signOf(adv),
  };
  if (guard === "hit" && move.hitReaction) result.reaction = move.hitReaction;
  return result;
}

export interface PunishResult {
  applicable: boolean;
  /** Frames the defender is advantaged after blocking (= −onBlock). */
  window: number;
  punishable: boolean;
  /** In SF6 a punish landed during recovery is always a Punish Counter. */
  punishCounter: boolean;
  by?: string;
}

/** Can `punisher` punish `blocked` after blocking it? */
export function punishAssessment(blocked: Move, punisher: Move): PunishResult {
  if (blocked.onBlock === undefined) {
    return { applicable: false, window: 0, punishable: false, punishCounter: false };
  }
  const window = -blocked.onBlock;
  const punishable = window > 0 && punisher.startup <= window;
  const result: PunishResult = {
    applicable: true,
    window,
    punishable,
    punishCounter: punishable,
  };
  if (punishable) result.by = punisher.name;
  return result;
}

export interface FastestPunish {
  window: number;
  best?: { move: Move; startup: number };
  options: { move: Move; startup: number }[];
}

/** Among candidates, the fastest move that punishes `blocked`. */
export function fastestPunish(blocked: Move, candidates: Move[]): FastestPunish {
  const window = blocked.onBlock === undefined ? 0 : -blocked.onBlock;
  const options = candidates
    .filter((m) => window > 0 && m.startup <= window)
    .map((m) => ({ move: m, startup: m.startup }))
    .sort((a, b) => a.startup - b.startup);
  const result: FastestPunish = { window, options };
  if (options[0]) result.best = options[0];
  return result;
}

export interface GapResult {
  applicable: boolean;
  gap: number;
  trueBlockstring: boolean;
  /** A defender move with startup ≤ this many frames can contest the gap. */
  interruptibleBy: number;
}

/**
 * Gap between two blocked moves A then B (B performed as early as possible).
 *   gap = B.startup − advantageAfter(A on block)
 */
export function blockGap(a: Move, b: Move): GapResult {
  const advA = advantage(a, "block", 0);
  if (advA === undefined) {
    return { applicable: false, gap: 0, trueBlockstring: false, interruptibleBy: 0 };
  }
  const gap = b.startup - advA;
  return {
    applicable: true,
    gap,
    trueBlockstring: gap <= 0,
    interruptibleBy: Math.max(0, gap),
  };
}

export interface CancelResult {
  cancelable: boolean;
  requiredTag: string;
  /** Ending advantage of the cancel (Y's own advantage, or an override). */
  endingAdvantage?: number;
  endingSign?: Sign;
  endingReaction?: NonNullable<Move["hitReaction"]>;
  note?: string;
}

function requiredCancelTag(target: Move): string {
  switch (target.category) {
    case "special":
      return "sp";
    case "super":
      return "su";
    case "normal":
      return "ch"; // chain / target normal
    default:
      return target.category;
  }
}

/** Cancel move X into move Y; report whether it's legal and the ending advantage. */
export function cancelInto(x: Move, y: Move, guard: Guard, meaty = 0): CancelResult {
  const requiredTag = requiredCancelTag(y);
  const tags = x.cancelTags ?? [];
  const cancelable = tags.some((t) => t === requiredTag || t.startsWith(requiredTag));

  const override = x.comboAdvantage?.[y.id]?.[guard === "block" ? "onBlock" : "onHit"];
  const adv = override ?? advantage(y, guard, meaty);

  const result: CancelResult = { cancelable, requiredTag };
  if (adv !== undefined) {
    result.endingAdvantage = adv;
    result.endingSign = signOf(adv);
  }
  if (guard === "hit" && y.hitReaction) result.endingReaction = y.hitReaction;
  if (override !== undefined) result.note = "using known cancel-advantage override";
  return result;
}

export interface StringStep {
  from: string;
  to: string;
  gap: GapResult;
}

export interface StringResult {
  moves: string[];
  guard: Guard;
  endingAdvantage?: number;
  endingSign?: Sign;
  endingReaction?: NonNullable<Move["hitReaction"]>;
  steps: StringStep[];
  /** True when every internal gap is ≤ 0 (uninterruptable on block). */
  trueBlockstring: boolean;
}

/**
 * The flagship query: "X into Y (into ...) from scenario Z".
 *
 * Ending advantage is the last move's advantage in the given guard state
 * (adjusted for meaty on the last move), because each earlier move's recovery
 * is consumed by the next. Every internal gap is reported so you can see
 * whether the sequence is actually a true blockstring / true combo.
 */
export function analyzeSequence(moves: Move[], guard: Guard, meaty = 0): StringResult {
  if (moves.length === 0) {
    return { moves: [], guard, steps: [], trueBlockstring: true };
  }
  const steps: StringStep[] = [];
  for (let i = 0; i < moves.length - 1; i++) {
    const a = moves[i]!;
    const b = moves[i + 1]!;
    steps.push({ from: a.name, to: b.name, gap: blockGap(a, b) });
  }
  const last = moves[moves.length - 1]!;
  const endAdv = advantage(last, guard, meaty);
  const result: StringResult = {
    moves: moves.map((m) => m.name),
    guard,
    steps,
    trueBlockstring: steps.every((s) => !s.gap.applicable || s.gap.trueBlockstring),
  };
  if (endAdv !== undefined) {
    result.endingAdvantage = endAdv;
    result.endingSign = signOf(endAdv);
  }
  if (guard === "hit" && last.hitReaction) result.endingReaction = last.hitReaction;
  return result;
}
