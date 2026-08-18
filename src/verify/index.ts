/**
 * The grader: the game's dumped data checked against the published frame data.
 *
 * This project has two independent descriptions of the same fighter — MMDK's
 * dump of the game's own `CharacterAsset` tables (`data/geometry/`) and the
 * community FAT set (`data/raw/SF6FrameData.json`) — and every finding so far
 * has landed because one could be graded against the other. That grading has
 * been done ad hoc, once per ADR, and then written down as prose. This module
 * makes it a standing measurement.
 *
 * It belongs to neither derivation. `src/engine` answers frame questions from
 * FAT alone and `src/sim` plays them out from the dump alone; both are only
 * worth anything while they stay ignorant of each other, so **nothing under
 * `engine/` or `sim/` may import this**, and this must never become a source
 * either side reads. It reads `SF6FrameData.json` directly rather than through
 * the domain model, for the same reason: columns like `blockstun` are graders,
 * and putting them on `Move` would let them leak into `stunFrom` and quietly
 * couple the two sides together.
 *
 * Four of FAT's columns had never been read (`hitstun`, `blockstun`, `total`,
 * `hcWinSpCa`). They turn out to check the three claims the project rests on.
 *
 * It does import `src/sim` — the arrow points this way round on purpose. A
 * grader may read what it grades; what it must never do is be read back.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  inFatFrames,
  spawnsFrom,
  type GeometryAction,
  type GeometryFile,
  type MoveMapping,
} from "../data/geometry.js";
import { loadGeometry } from "../data/load-geometry.js";
import { listCharacters, requireCharacter } from "../data/index.js";
import { runScenario } from "../sim/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAT_PATH = join(HERE, "..", "..", "data", "raw", "SF6FrameData.json");

/**
 * Blocking holds the defender four frames past what advantage implies (ADR-0006).
 * The engine derives with the same constant; here it is the thing under test.
 */
export const GUARD_RELEASE = 4;

/**
 * A fireball's advantage depends on where it is blocked, and FAT publishes one
 * number. Measured across the roster, that number is the advantage **8 frames
 * after the shot appears** — a convention of FAT's rather than a mechanic, which
 * is why it lives in the grader and not in the sim. See ADR-0023.
 */
export const PROJECTILE_CONTACT = 8;

export type CheckName =
  | "hitstun"
  | "blockstun"
  | "total"
  | "cancelEnd"
  | "advantage"
  | "driveGain"
  | "driveOnHit"
  | "driveOnBlock"
  | "superGain"
  | "superGiven"
  | "juggleStart"
  | "juggleAdd"
  | "juggleLimit"
  | "startScaling";

export const CHECKS: Record<CheckName, string> = {
  hitstun: "the hit table's hitstun == FAT's published hitstun",
  blockstun: `the hit table's blockstun == FAT's published blockstun + ${GUARD_RELEASE}`,
  total: "the action's MarginFrame == FAT's published total",
  cancelEnd: "the cancel window's last frame == FAT's published hit-confirm window",
  advantage: "the sim played out from the dump alone == FAT's published on-block",
  driveGain: "the hit table's Drive gain for the attacker == FAT's DGain",
  driveOnHit: "the hit table's Drive damage on hit == FAT's DDoH",
  driveOnBlock: "the hit table's Drive damage on block == FAT's DDoB",
  superGain: "the hit table's super gain for the attacker == FAT's SelfSoH",
  superGiven: "the hit table's super gain for the defender == FAT's OppSoH",
  juggleStart: "the hit table's Juggle1st == FAT's jugStart",
  juggleAdd: "the hit table's JuggleAdd == FAT's jugIncr",
  juggleLimit: "the hit table's JuggleLimit == FAT's jugLimit",
  startScaling: "the action's _StartScaling == FAT's dmgScaling \"N% Start\"",
};

export interface Comparison {
  character: string;
  input: string;
  actionName: string;
  /**
   * FAT's own classification of the move. Worth carrying since ADR-0018 widened
   * the mapping past normals: a population of mixed categories is not one
   * population, and `super` in particular counts frames differently.
   */
  category: string;
  check: CheckName;
  /** What the dump says, and what FAT says the same number should be. */
  dump: number;
  fat: number;
  agrees: boolean;
  /** `clean` is an exact name-and-frame mapping of a single-hit move — the
   *  population where a disagreement means something rather than reflecting a
   *  mapping we already flagged. */
  clean: boolean;
}

export interface Tally {
  checked: number;
  agreeing: number;
}

export interface Report {
  /** Per check, split into the clean population and everything else. */
  totals: Record<CheckName, { clean: Tally; other: Tally }>;
  /** Per character, over the clean population only. */
  byCharacter: { character: string; clean: Tally }[];
  comparisons: Comparison[];
}

/** A FAT value we can compare against: a plain integer, not "11(13)" or "until land". */
function plainInt(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value, 10);
  return undefined;
}

/**
 * FAT states the starter penalty as prose: "20% Start", "30% Start". Only that
 * form is graded — "20% Immediate", "15% Multiplier (Mid-Combo)" and
 * "Combo (5% extra)" are different quantities wearing the same column.
 */
function startPercent(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d+)% Start/.exec(value.trim());
  return m ? Number.parseInt(m[1]!, 10) : undefined;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Drive drain as a positive amount.
 *
 * The dump signs it from the defender's side — `FocusTgt` is −4000, four
 * thousand off their gauge — and FAT publishes the same quantity as a positive
 * `DDoH`. Zero means the row states no drain, which is not the same as agreeing
 * with a published zero, so it is dropped rather than compared.
 */
function magnitude(value: number | undefined): number | undefined {
  return value === undefined || value === 0 ? undefined : Math.abs(value);
}

/** The raw FAT columns this module grades with — none of them reach the domain model. */
interface FatColumns {
  numCmd?: string;
  hitstun?: string | number;
  blockstun?: string | number;
  total?: string | number;
  hcWinSpCa?: string | number;
  /**
   * The *target-combo* confirm window. Not what the cancel check grades against
   * — the tests use it as the rival reading of the extracted window, and it
   * loses outright. See ADR-0015.
   */
  hcWinTc?: string | number;
  /**
   * The gauge columns. FAT publishes no cost column — a cost is a *negative*
   * `DGain` or `SelfSoH` — and the `plainInt` filter drops those along with the
   * multi-hit strings (`"2500*2500"`), which is deliberate: what these grade is
   * the per-hit gauge economy, and a move that spends is a different question.
   */
  DGain?: string | number;
  DDoH?: string | number;
  DDoB?: string | number;
  SelfSoH?: string | number;
  OppSoH?: string | number;
  /** The juggle system, which FAT states as often as not in multi-hit strings. */
  jugStart?: string | number;
  jugIncr?: string | number;
  jugLimit?: string | number;
  dmgScaling?: string | number;
}

let fatCache: Record<string, Record<string, FatColumns>> | undefined;

/** FAT's normals, by character, keyed on notation. */
function fatMoves(character: string): Record<string, FatColumns> {
  if (!fatCache) {
    const file = JSON.parse(readFileSync(FAT_PATH, "utf8")) as Record<
      string,
      { moves: { normal: Record<string, FatColumns> } }
    >;
    fatCache = {};
    for (const [name, entry] of Object.entries(file)) {
      const byInput: Record<string, FatColumns> = {};
      for (const move of Object.values(entry.moves.normal)) {
        if (move.numCmd) byInput[move.numCmd] = move;
      }
      fatCache[norm(name)] = byInput;
    }
  }
  return fatCache[norm(character)] ?? {};
}

/**
 * The dump's numbers for one move, or undefined where it has none.
 *
 * `MarginFrame` is the action's own last frame, which FAT publishes as `total`.
 * The cancel window's end is compared through the hit-confirm window FAT
 * publishes for it: `hcWinSpCa` counts from the move's startup to the last
 * cancellable frame, plus the attacker's hitstop, plus 2.
 */
function dumpNumbers(
  geo: GeometryFile,
  move: MoveMapping,
  character: string,
  projectileContact: number,
) {
  const action = geo.actions.find((a) => a.id === move.action);
  const key = action?.hit.find((h) => h.kind !== "proximity");
  const data = key ? geo.hitData?.[String(key.attackData)] : undefined;
  return {
    hitstun: data?.hit?.stun,
    blockstun: data?.block?.stun,
    // `MarginFrame` is in the action's own frames; FAT's `total` is not, for a
    // Super Art. Netting out the freeze puts them in one space. See ADR-0019.
    total:
      action && action.marginFrame && action.marginFrame > 0
        ? inFatFrames(action, action.marginFrame)
        : undefined,
    cancelEnd:
      move.cancel && data?.hit
        ? move.cancel.end - move.startup + data.hit.hitStop.owner + 2
        : undefined,
    advantage: add(simAdvantage(character, move.input), movingProjectile(geo, action) ? projectileContact : 0),
    // The gauge economy. The attacker's side reads off the hit and block rows
    // like everything else — but the Drive the *defender* loses does not live
    // there. The hit row's `FocusTgt` is 0 and the block row's is a positive
    // amount the defender gains; the drain FAT publishes is authored on the
    // punish-counter and driveHit rows instead, and matches there. See ADR-0031.
    driveGain: data?.hit?.drive.own,
    driveOnHit: magnitude(data?.punishCounter?.drive.target),
    driveOnBlock: magnitude(data?.driveHit?.drive.target),
    superGain: data?.hit?.super.own,
    superGiven: data?.hit?.super.target,
    juggleStart: data?.hit?.juggle.start,
    juggleAdd: data?.hit?.juggle.add,
    juggleLimit: data?.hit?.juggle.limit,
    startScaling: action?.scaling?.start,
  };
}

/**
 * A move whose hitbox is a fireball that **travels**.
 *
 * Both halves matter. No hitbox of its own and only a `ShotKey` makes it a
 * projectile move; the shot going somewhere is what gives FAT eight frames of
 * flight to measure at. Ryu's Hashogeki and A.K.I.'s Jatoben spawn a shot that
 * stays where it is put, and FAT measures those on contact like anything else.
 * See ADR-0023.
 */
function movingProjectile(geo: GeometryFile, action: GeometryAction | undefined): boolean {
  if (!action?.shots?.length || action.hit.some((h) => h.kind !== "proximity")) return false;
  return spawnsFrom(geo, action).some((s) => Math.max(0, ...(s.action.motion?.x ?? [0])) > 0);
}

/**
 * The scenario player's own answer, which reads nothing published at all — stun
 * from the hit table, recovery from `MarginFrame`, contact from box overlap.
 * That is what makes comparing it to FAT's `onBlock` a two-source check rather
 * than an identity restated. See ADR-0011.
 */
function simAdvantage(character: string, input: string): number | undefined {
  try {
    const result = runScenario(character, input, { guard: true });
    return result.advantage ?? undefined;
  } catch {
    return undefined;
  }
}

/** A signed FAT value: advantage columns run negative. */
function signedInt(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10);
  return undefined;
}

export interface VerifyOptions {
  characters?: string[];
  /**
   * The blockstun constant to test with. Defaults to the measured 4; the tests
   * sweep it, because a constant that is only ever asserted at its own value is
   * not being checked at all.
   */
  guardRelease?: number;
  /**
   * Which published confirm window the cancel check grades against. FAT
   * publishes two, and the extracted window is meant to be the special-cancel
   * one; the tests run both, because a window compared only to the column it was
   * assumed to be is not being checked either.
   */
  confirmColumn?: "hcWinSpCa" | "hcWinTc";
  /**
   * How many frames after the shot appears FAT measures a projectile's on-block.
   * Defaults to the measured 8; the tests sweep it for the same reason they sweep
   * the guard release. See ADR-0023.
   */
  projectileContact?: number;
}

/** Run every check over the characters that have geometry. */
export function verify(characters?: string[], options: VerifyOptions = {}): Report {
  const guardRelease = options.guardRelease ?? GUARD_RELEASE;
  const confirmColumn = options.confirmColumn ?? "hcWinSpCa";
  const projectileContact = options.projectileContact ?? PROJECTILE_CONTACT;
  const names = characters?.length ? characters : listCharacters();
  const comparisons: Comparison[] = [];
  const byCharacter: Report["byCharacter"] = [];

  for (const name of names) {
    const character = requireCharacter(name);
    const geo = loadGeometry(character.id);
    if (!geo) continue;
    const fat = fatMoves(geo.character);
    const tally: Tally = { checked: 0, agreeing: 0 };

    for (const move of geo.moves) {
      const columns = fat[move.input];
      if (!columns) continue;
      const dump = dumpNumbers(geo, move, geo.character, projectileContact);
      // An exact mapping of a single-hit move whose startup already agrees: the
      // population where a disagreement is a finding rather than a known-soft
      // mapping or a multi-hit move whose numbers describe a different hit.
      //
      // Super Arts were excluded outright by ADR-0018, because their action runs
      // the cinematic freeze and FAT's numbers do not. ADR-0019 found the freeze
      // in the dump, so the two are in one frame space again and supers are back
      // in on the same terms as everything else.
      const clean = move.match === "exact" && move.hits === 1 && !move.startupDelta;

      const expected: Record<CheckName, number | undefined> = {
        hitstun: plainInt(columns.hitstun),
        blockstun: add(plainInt(columns.blockstun), guardRelease),
        total: plainInt(columns.total),
        cancelEnd: plainInt(columns[confirmColumn]),
        advantage: signedInt(move.fat.onBlock),
        driveGain: plainInt(columns.DGain),
        driveOnHit: plainInt(columns.DDoH),
        driveOnBlock: plainInt(columns.DDoB),
        superGain: plainInt(columns.SelfSoH),
        superGiven: plainInt(columns.OppSoH),
        juggleStart: plainInt(columns.jugStart),
        juggleAdd: plainInt(columns.jugIncr),
        juggleLimit: plainInt(columns.jugLimit),
        startScaling: startPercent(columns.dmgScaling),
      };

      for (const check of Object.keys(CHECKS) as CheckName[]) {
        const mine = dump[check];
        const theirs = expected[check];
        if (mine === undefined || theirs === undefined) continue;
        const agrees = mine === theirs;
        comparisons.push({
          character: geo.character,
          input: move.input,
          actionName: move.actionName,
          category: move.category,
          check,
          dump: mine,
          fat: theirs,
          agrees,
          clean,
        });
        if (clean) {
          tally.checked++;
          if (agrees) tally.agreeing++;
        }
      }
    }
    if (tally.checked) byCharacter.push({ character: geo.character, clean: tally });
  }

  const totals = {} as Report["totals"];
  for (const check of Object.keys(CHECKS) as CheckName[]) {
    totals[check] = { clean: { checked: 0, agreeing: 0 }, other: { checked: 0, agreeing: 0 } };
  }
  for (const c of comparisons) {
    const bucket = totals[c.check][c.clean ? "clean" : "other"];
    bucket.checked++;
    if (c.agrees) bucket.agreeing++;
  }

  byCharacter.sort((a, b) => rate(a.clean) - rate(b.clean));
  return { totals, byCharacter, comparisons };
}

const add = (n: number | undefined, k: number): number | undefined => (n === undefined ? undefined : n + k);

/** Agreement as a fraction, 1 for an empty tally so it sorts last. */
export function rate(tally: Tally): number {
  return tally.checked ? tally.agreeing / tally.checked : 1;
}

/** Just the disagreements, worst check first — what a human wants to look at. */
export function disagreements(report: Report, options: { cleanOnly?: boolean } = {}): Comparison[] {
  return report.comparisons.filter((c) => !c.agrees && (!options.cleanOnly || c.clean));
}
