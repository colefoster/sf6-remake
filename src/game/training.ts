/**
 * What the training room asks the engine that a fight does not.
 *
 * Frame advantage and the punish window are not state the match keeps — they are
 * questions *about* it, answered by watching who becomes actionable first and by
 * asking what the free fighter could start before the other one recovers. Both
 * used to live inside `web/play.html` or not exist at all. Neither belongs in
 * `match.ts`, which resolves contact and has no opinion about what a player
 * should have pressed.
 */

import type { Box } from "../domain/types.js";
import type { GeometryAction } from "../data/geometry.js";
import { activeWindows, idleHurtboxes, reach } from "../data/geometry.js";
import type { Match } from "./match.js";

/** One thing the free fighter could have started, and whether it would land. */
export interface PunishOption {
  action: GeometryAction;
  name: string;
  /** First active frame. */
  startup: number;
  /** Furthest distance the move still touches, or 0 for one that cannot. */
  reach: number;
  reaches: boolean;
}

/**
 * What `side` can punish with, given `window` frames before the other fighter is
 * free again.
 *
 * Startup has to be *at most* the window: a 5-frame move into a 5-frame window
 * lands on the frame the opponent recovers, which is the frame it has to land
 * on. Reach is measured against the opponent's idle hurtboxes at the gap the two
 * are actually standing at, so a punish that whiffs is not offered.
 */
export function punishes(match: Match, side: 0 | 1, window: number): PunishOption[] {
  if (window <= 0) return [];
  const me = match.fighters[side];
  const them = match.fighters[side === 0 ? 1 : 0];
  const gap = Math.abs(them.position().x - me.position().x);
  const target: Box[] = idleHurtboxes(them.geo, them.state.stance === "crouch" ? "crouch" : "stand");

  const out: PunishOption[] = [];
  const seen = new Set<string>();
  for (const action of me.neutralActions) {
    const windows = activeWindows(action);
    if (!windows.length || seen.has(action.name)) continue;
    seen.add(action.name);
    const startup = windows[0]!.start;
    if (startup > window) continue;
    const far = reach(action, target) ?? 0;
    out.push({ action, name: action.name, startup, reach: far, reaches: far >= gap });
  }
  return out.sort((a, b) => a.startup - b.startup || b.reach - a.reach);
}

/**
 * Frame advantage, watched as it resolves.
 *
 * There is no frame on which the engine "knows" the advantage: it is the gap
 * between the two fighters becoming actionable again, so it can only be read by
 * watching both and subtracting. Feed it every advanced frame.
 */
export class Advantage {
  /** The last resolved advantage, from the attacker's side. */
  value: number | null = null;
  /** Who swung. Null between exchanges. */
  attacker: 0 | 1 | null = null;
  private watching: { attacker: 0 | 1; free: [number | null, number | null] } | null = null;
  private counted = 0;

  observe(match: Match): void {
    if (match.hits.length > this.counted && !this.watching) {
      const last = match.hits[match.hits.length - 1]!;
      this.watching = { attacker: last.attacker, free: [null, null] };
      this.attacker = last.attacker;
    }
    this.counted = match.hits.length;
    const watch = this.watching;
    if (!watch) return;
    for (const side of [0, 1] as const) {
      if (watch.free[side] === null && match.fighters[side].actionable()) watch.free[side] = match.frame;
    }
    if (watch.free[0] === null || watch.free[1] === null) return;
    const defender = watch.attacker === 0 ? 1 : 0;
    this.value = watch.free[defender]! - watch.free[watch.attacker]!;
    this.watching = null;
  }

  reset(): void {
    this.value = null;
    this.attacker = null;
    this.watching = null;
    this.counted = 0;
  }
}
