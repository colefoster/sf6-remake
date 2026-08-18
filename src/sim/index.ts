/**
 * The scenario player: two fighters on a shared 60 fps clock.
 *
 * Everything here is resolved from real data rather than from the advantage
 * numbers — positions from the extracted origin motion, contact from hitbox vs
 * hurtbox overlap, outcome from the game's hit-data table. The published
 * advantage is then something we can *check* the result against rather than
 * something we assume, which is what `tests/sim.test.ts` does.
 *
 * WHAT IT MODELS
 *   frame-accurate advance of one attacking action against a blocking or
 *   standing dummy, pushbox separation, contact detection at a given spacing,
 *   meaty depth, hitstop, knockback, and who becomes actionable first.
 *
 * WHAT IT DOES NOT
 *   inputs and buffers, the cancel/trigger state machine, drive and super
 *   systems beyond reporting gain, juggle chains, throws, projectiles as their
 *   own actors, and the corner. The dummy blocks or stands; it does not fight
 *   back. See docs/adr/0007-scenario-player.md.
 */

import type { Box, Character, Move } from "../domain/types.js";
import {
  actionFor,
  actionableFrame,
  activeWindows,
  hitDataFor,
  hurtboxesAt,
  idleHurtboxes,
  loadGeometry,
  minDistance,
  originAt,
  overlaps,
  pushHalfWidth,
  pushboxesAt,
  shift,
  worldHitboxes,
  type GeometryAction,
  type GeometryFile,
  type HitData,
  type HitOutcome,
  type Stance,
} from "../data/geometry.js";
import { requireCharacter, requireMove } from "../data/index.js";

/**
 * Blocking holds the defender four frames past the point they can act — see
 * ADR-0006. The sim has to subtract it or every blocked move reads four frames
 * more plus than the game gives it.
 */
const GUARD_RELEASE = 4;

export type Contact = "block" | "hit" | "counter" | "punishCounter";

export interface ScenarioOptions {
  /** Distance between the two origins when the move starts, in game units. */
  distance?: number;
  /** Defender character; defaults to the attacker (a mirror match). */
  defender?: string;
  defenderStance?: Stance;
  /** Does the dummy hold back? A standing dummy takes the hit. */
  guard?: boolean;
  /**
   * Land contact `depth` frames into the active window rather than on its first
   * frame — a meaty. Contact simply isn't tested until that frame comes round.
   */
  meaty?: number;
}

export interface FrameState {
  frame: number;
  attackerX: number;
  defenderX: number;
  /** Frame of the attacker's action, or null once it has run out. */
  actionFrame: number | null;
  phase: "startup" | "active" | "recovery" | "done";
  hitstop: boolean;
  /** Frames of stun the defender still owes, guard release included. */
  defenderStun: number;
}

export interface ScenarioEvent {
  frame: number;
  kind:
    | "first-active"
    | "contact"
    | "attacker-actionable"
    | "defender-actionable"
    | "recovered";
  detail: string;
}

export interface ScenarioResult {
  attacker: string;
  defender: string;
  move: string;
  action: string;
  distance: number;
  contact:
    | {
        frame: number;
        /** How far into the active window contact landed: 0 is the first frame. */
        depth: number;
        type: Contact;
        outcome: HitOutcome;
      }
    | null;
  /** Frames at which each side can act again, measured from contact. */
  attackerActionable: number | null;
  defenderActionable: number | null;
  /**
   * Where the attacker's recovery came from: the action's own MarginFrame, or
   * the published active + recovery when the action has no margin recorded.
   * Only the first makes the advantage a genuinely independent derivation.
   */
  recoverySource: "action" | "published" | null;
  /** Positive means the attacker recovers first. Null when the move whiffed. */
  advantage: number | null;
  damage: number;
  /** Distance once the knockback has played out. */
  endDistance: number;
  events: ScenarioEvent[];
  frames: FrameState[];
  /** Set when the scenario asked for something the data can't answer. */
  note?: string;
}

interface Resolved {
  character: Character;
  move: Move;
  geo: GeometryFile;
  action: GeometryAction;
  data: HitData | undefined;
}

function resolve(characterQuery: string, moveQuery: string): Resolved {
  const character = requireCharacter(characterQuery);
  const move = requireMove(character, moveQuery);
  const geo = loadGeometry(character.id);
  if (!geo) {
    throw new Error(
      `no geometry for ${character.name} — run: node scripts/fetch-mmdk.mjs ${character.name} && ` +
        `node scripts/extract-geometry.mjs ${character.name}`,
    );
  }
  const found = actionFor(geo, move);
  if (!found) throw new Error(`no action mapped to ${move.input} for ${character.name}`);
  return { character, move, geo, action: found.action, data: hitDataFor(geo, found.action) };
}

/** Mirror a defender box into world space: it faces the attacker, so it flips. */
function defenderBox(box: Box, x: number): Box {
  return { ...box, x: x - (box.x + box.width) };
}

/**
 * Which of the table's outcomes applies. A dummy that isn't blocking eats a
 * counter hit only if it were mid-move; a standing dummy just takes the hit.
 */
function contactType(guard: boolean): Contact {
  return guard ? "block" : "hit";
}

export function runScenario(
  characterQuery: string,
  moveQuery: string,
  options: ScenarioOptions = {},
): ScenarioResult {
  const attacker = resolve(characterQuery, moveQuery);
  const defenderChar = options.defender ? requireCharacter(options.defender) : attacker.character;
  const defenderGeo = loadGeometry(defenderChar.id);
  if (!defenderGeo) throw new Error(`no geometry for ${defenderChar.name}`);

  const stance = options.defenderStance ?? "stand";
  const guard = options.guard ?? true;
  const defenderHurt = idleHurtboxes(defenderGeo, stance);
  const defenderPush = defenderIdlePushbox(defenderGeo, stance);
  const closest = minDistance(attacker.geo, defenderGeo, { defender: stance }) ?? 0;
  const distance = Math.max(options.distance ?? closest, closest);

  const windows = activeWindows(attacker.action);
  const firstActive = windows[0]?.start ?? null;
  const meaty = clampMeaty(options.meaty ?? 0, attacker.move.active);

  const events: ScenarioEvent[] = [];
  const frames: FrameState[] = [];

  let defenderX = distance;
  let contact: ScenarioResult["contact"] = null;
  let hitstop = 0;
  let stun = 0;
  let knockback: { perFrame: number; left: number } | null = null;
  let damage = 0;
  let attackerActionable: number | null = null;
  let defenderActionable: number | null = null;
  let recoverySource: ScenarioResult["recoverySource"] = null;

  const total = attacker.action.frames ?? 0;
  // The dummy is only asked to survive the move plus whatever stun it owes.
  const limit = Math.min(total, (firstActive ?? 0) + attacker.move.recovery + 90);

  for (let frame = 1; frame <= limit; frame++) {
    const attackerX = originAt(attacker.action, frame).x;

    // Pushboxes keep the two apart: walking into the dummy shoves it back.
    const attackerPush = pushboxesAt(attacker.action, frame)[0];
    if (attackerPush && defenderPush) {
      const front = attackerX + attackerPush.x + attackerPush.width;
      const defenderFront = defenderX - (defenderPush.x + defenderPush.width);
      if (front > defenderFront) defenderX += front - defenderFront;
    }

    if (knockback && knockback.left > 0) {
      defenderX += knockback.perFrame;
      knockback.left--;
    }

    if (!contact && firstActive !== null && frame >= firstActive + meaty) {
      const landed = worldHitboxes(attacker.action).filter((h) => h.frame === frame);
      const hits = landed.some((h) =>
        defenderHurt.some((b) => overlaps(h.box, defenderBox(b, defenderX))),
      );
      if (hits) {
        const type = contactType(guard);
        const outcome = attacker.data?.[type] ?? attacker.data?.hit ?? emptyOutcome();
        const depth = frame - firstActive;
        contact = { frame, depth, type, outcome };
        damage = outcome.damage;
        stun = outcome.stun - (type === "block" ? GUARD_RELEASE : 0);
        hitstop = outcome.hitStop.owner;
        if (outcome.knockback.frames) {
          knockback = {
            perFrame: outcome.knockback.x / outcome.knockback.frames,
            left: outcome.knockback.frames,
          };
        }
        // Both sides count from the contact frame: the attacker owes the rest of
        // its recovery, the defender owes its stun. Hitstop freezes them
        // equally, so it never changes the difference.
        //
        // The attacker's side comes from the action's own MarginFrame where it
        // has one — the game's number, in the same frame space this loop is
        // already counting in. `active + recovery` is the published fallback,
        // and using it means the advantage is only half-derived. See ADR-0011.
        const free = actionableFrame(attacker.action);
        attackerActionable =
          free !== undefined ? free - frame : attacker.move.active - depth + attacker.move.recovery;
        recoverySource = free !== undefined ? "action" : "published";
        defenderActionable = stun;
        events.push({
          frame,
          kind: "contact",
          detail:
            `${type} at ${round(defenderX)}u` +
            (depth ? ` (meaty ${depth} deep)` : "") +
            ` \u2014 ${outcome.damage} damage, ${outcome.stun}f stun, ${outcome.hitStop.owner}f hitstop`,
        });
      }
    }

    if (frame === firstActive) {
      events.push({ frame, kind: "first-active", detail: `hitbox out at ${round(distance)}u` });
    }

    frames.push({
      frame,
      attackerX: round(attackerX),
      defenderX: round(defenderX),
      actionFrame: frame,
      phase: phaseAt(attacker.move, frame),
      hitstop: contact !== null && frame < contact.frame + hitstop,
      defenderStun: Math.max(0, stun),
    });
    if (stun > 0) stun--;
  }

  if (contact) {
    events.push({
      frame: contact.frame + (attackerActionable ?? 0),
      kind: "attacker-actionable",
      detail: `attacker (${attacker.character.name}) can act`,
    });
    events.push({
      frame: contact.frame + (defenderActionable ?? 0),
      kind: "defender-actionable",
      detail: `defender (${defenderChar.name}) can act`,
    });
    const rank: Record<ScenarioEvent["kind"], number> = {
      "first-active": 0,
      contact: 1,
      "defender-actionable": 2,
      "attacker-actionable": 3,
      recovered: 4,
    };
    events.sort((a, b) => a.frame - b.frame || rank[a.kind] - rank[b.kind]);
  } else {
    events.push({
      frame: limit,
      kind: "recovered",
      detail: `whiffed at ${round(distance)}u`,
    });
  }

  const result: ScenarioResult = {
    attacker: attacker.character.name,
    defender: defenderChar.name,
    move: `${attacker.move.name} (${attacker.move.input})`,
    action: attacker.action.name,
    distance: round(distance),
    contact,
    attackerActionable,
    defenderActionable,
    recoverySource,
    advantage:
      attackerActionable === null || defenderActionable === null
        ? null
        : defenderActionable - attackerActionable,
    damage,
    endDistance: round(defenderX),
    events,
    frames,
  };
  if (!attacker.data) result.note = "no hit-data entry for this action; outcome fields are empty";
  return result;
}

/** The dummy's idle pushbox, for keeping the two bodies apart. */
function defenderIdlePushbox(geo: GeometryFile, stance: Stance): Box | undefined {
  const half = pushHalfWidth(geo, stance);
  return half === undefined ? undefined : { x: -half, y: 0, width: half * 2, height: 1 };
}

function clampMeaty(meaty: number, active: number): number {
  return Math.min(Math.max(0, Math.trunc(meaty)), Math.max(0, active - 1));
}

function phaseAt(move: Move, frame: number): FrameState["phase"] {
  if (frame < move.startup) return "startup";
  if (frame < move.startup + move.active) return "active";
  if (frame < move.startup + move.active + move.recovery) return "recovery";
  return "done";
}

function emptyOutcome(): HitOutcome {
  return {
    damage: 0,
    stun: 0,
    hitStop: { owner: 0, target: 0 },
    knockback: { x: 0, y: 0, frames: 0 },
    downTime: 0,
    juggle: { start: 0, add: 0, limit: 0 },
    drive: { own: 0, target: 0 },
    super: { own: 0, target: 0 },
    dmgType: 0,
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** Hurtboxes of the attacker's own action, for a viewer to draw. */
export function attackerHurtboxes(action: GeometryAction, frame: number): Box[] {
  const origin = originAt(action, frame);
  return hurtboxesAt(action, frame).map((b) => shift(b, origin));
}
