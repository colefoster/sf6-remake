/**
 * The grader for invulnerability: the dump's per-frame immunity flags checked
 * against FAT's `extraInfo` prose.
 *
 * The rest of `src/verify` compares a number to a number. This one compares a
 * *frame range* to a sentence, because that is the only place FAT records
 * invulnerability at all — there is no column for it. "Invincible to airborne
 * strikes on frames 1-14" is a published claim like any other, and the dump
 * either reproduces those frames or it does not.
 *
 * Prose is a softer grader than a column and the parsing is where it can go
 * wrong, so the classifier is deliberately narrow: a claim counts only when it
 * names one frame range and falls into one of three phrasings the roster uses
 * consistently. Everything else is left out rather than guessed at. See ADR-0014.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  fullyInvulnerableWindows,
  inFatFrames,
  type GeometryAction,
  type HurtKey,
} from "../data/geometry.js";
import { loadGeometry } from "../data/load-geometry.js";
import { listCharacters, requireCharacter } from "../data/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAT_PATH = join(HERE, "..", "..", "data", "raw", "SF6FrameData.json");

/**
 * What a published claim says the fighter is invulnerable to, and which field of
 * the dump answers it.
 */
export type InvulnKind = "airborne-strike" | "projectile" | "strike" | "full";

export const INVULN_CHECKS: Record<InvulnKind, string> = {
  "airborne-strike": "Immune bit 2 == FAT's 'invincible to airborne strikes on frames A-B'",
  projectile: "TypeFlag without bit 1 == FAT's 'projectile invincible on frames A-B'",
  strike: "TypeFlag without bit 0 == FAT's 'strike invincible on frame N'",
  full: "no hurtbox at all == FAT's 'fully invincible on frames A-B'",
};

/**
 * Ordered, and the order matters: "air strike invincible" is an airborne-strike
 * claim, not a strike one, and Dhalsim phrases it that way six times. `full`
 * comes last for the same reason — it is the claim with no kind named in it.
 */
const PHRASINGS: { kind: InvulnKind; re: RegExp }[] = [
  { kind: "airborne-strike", re: /(?:airborne|air)\s+(?:strike\s+)?(?:attacks?\s+)?invinc/i },
  { kind: "airborne-strike", re: /invincible\s+(?:to|against)\s+air/i },
  { kind: "projectile", re: /project\w*\s+invincib/i },
  { kind: "strike", re: /strike\s+invincible/i },
  { kind: "full", re: /(?:fully|full|completely)\s+invinc|^invincible\s+(?:on|from|during)/i },
];

/** `frames 4-10`, `frame 9`, `frames 8~15` — and only when the line has exactly one. */
function soleRange(line: string): [number, number] | undefined {
  const found: [number, number][] = [];
  const re = /frames?\s+(\d+)\s*(?:[-~–]\s*(\d+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) found.push([Number(m[1]), Number(m[2] ?? m[1])]);
  return found.length === 1 ? found[0] : undefined;
}

/**
 * FAT also writes down the *absence* of invulnerability — Terry's 2HP is
 * "solid anti-air on frames 10-13 (but has no air invincibility frames)".
 * Grading that as a claim scores the dump wrong for being right.
 */
const NEGATED = /\b(?:no|not|without|lacks?|isn't|does not)\b[^.]{0,40}invinc/i;

function classify(line: string): InvulnKind | undefined {
  if (NEGATED.test(line)) return undefined;
  return PHRASINGS.find((p) => p.re.test(line))?.kind;
}

/** Whether a key is the thing the claim describes. */
function keyAnswers(key: HurtKey, kind: InvulnKind, airborneBit: number): boolean {
  const responds = key.typeFlag ?? 3;
  if (kind === "airborne-strike") return ((key.immune ?? 0) & (1 << airborneBit)) !== 0;
  if (kind === "projectile") return (responds & 2) === 0;
  return (responds & 1) === 0;
}

/**
 * The frames the dump says the claim is about, in FAT's frame space.
 *
 * `full` is a different question from the other three and answered by a
 * different part of the data: not a flag on a box but the absence of every box.
 * A Super Art's cinematic has nothing to hit, so the window runs from frame 1
 * of the action through the freeze and out the far side, and `inFatFrames` is
 * what makes it comparable to a published number. See ADR-0020.
 *
 * An action can have more than one no-box window — a target combo's is in the
 * middle of the move — so the one overlapping the claim is the one graded.
 */
function windowFor(
  action: GeometryAction,
  kind: InvulnKind,
  airborneBit: number,
  fat: [number, number],
): [number, number] | undefined {
  const fatFrames = (w: { start: number; end: number }): [number, number] => [
    Math.max(1, inFatFrames(action, w.start)),
    inFatFrames(action, w.end),
  ];

  if (kind === "full") {
    const windows = fullyInvulnerableWindows(action).map(fatFrames).filter((w) => w[1] >= 1);
    if (!windows.length) return undefined;
    return windows.find((w) => w[0] <= fat[1] && w[1] >= fat[0]) ?? windows[0];
  }

  const answering = action.hurt.filter((k) => keyAnswers(k, kind, airborneBit));
  if (!answering.length) return undefined;
  return fatFrames({
    start: Math.min(...answering.map((k) => k.start)),
    end: Math.max(...answering.map((k) => k.end)),
  });
}

/**
 * Whether the action simply has no hurtbox across the whole claimed range.
 *
 * A claim that names a kind — "projectile invincible on frames 13-41" — is
 * still a true statement when there is nothing there to hit, and Lily's
 * Thunderbird is exactly that: FAT writes "fully invincible 1-12" and
 * "projectile invincible 13-41" about an action with no hurtbox until frame 41.
 * The `TypeFlag` check has no business scoring that as a miss.
 */
function coversByAbsence(action: GeometryAction, fat: [number, number]): boolean {
  return fullyInvulnerableWindows(action).some(
    (w) => inFatFrames(action, w.start) <= fat[0] && inFatFrames(action, w.end) >= fat[1],
  );
}

export interface InvulnComparison {
  character: string;
  input: string;
  actionName: string;
  kind: InvulnKind;
  /** FAT's published frames, and the dump's, 1-indexed inclusive. */
  fat: [number, number];
  dump: [number, number] | undefined;
  /** Total frames of disagreement across both ends; undefined when the dump has none. */
  drift: number | undefined;
  agrees: boolean;
  claim: string;
  /**
   * The action has no hurtbox at all across the claimed frames, so a kinded
   * claim is answered by absence rather than by the flag this check reads.
   * Those rows are counted separately: scoring them as `TypeFlag` failures
   * would mark the dump wrong for being right. See ADR-0020.
   */
  byAbsence: boolean;
}

export interface InvulnTally {
  checked: number;
  /** Both ends to the frame. */
  exact: number;
  /** Both ends within a frame either way — the skew every other check sees. */
  within1: number;
  /** No key of that kind on the action at all. */
  absent: number;
  /** Kinded claims the action answers by having no hurtbox; out of `checked`. */
  byAbsence: number;
}

export interface InvulnReport {
  totals: Record<InvulnKind, InvulnTally>;
  comparisons: InvulnComparison[];
}

interface FatMove {
  numCmd?: string;
  extraInfo?: string[];
}

let fatCache: Record<string, Record<string, FatMove>> | undefined;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Every FAT move by character and notation, across all categories — not just normals. */
function fatMoves(character: string): Record<string, FatMove> {
  if (!fatCache) {
    const file = JSON.parse(readFileSync(FAT_PATH, "utf8")) as Record<
      string,
      { moves?: Record<string, Record<string, FatMove>> }
    >;
    fatCache = {};
    for (const [name, entry] of Object.entries(file)) {
      const byInput: Record<string, FatMove> = {};
      for (const category of Object.values(entry.moves ?? {})) {
        // First wins — see ADR-0048.
        for (const move of Object.values(category)) if (move.numCmd) byInput[move.numCmd] ??= move;
      }
      fatCache[norm(name)] = byInput;
    }
  }
  return fatCache[norm(character)] ?? {};
}

export interface InvulnOptions {
  /**
   * Which `Immune` bit to test as the airborne-strike gate. Defaults to the
   * measured 2; the tests sweep every bit, because a bit that is only ever
   * asserted at its own index is not being checked at all.
   */
  airborneBit?: number;
}

/** Grade every published invulnerability claim we can parse against the dump. */
export function verifyInvuln(characters?: string[], options: InvulnOptions = {}): InvulnReport {
  const airborneBit = options.airborneBit ?? 2;
  const names = characters?.length ? characters : listCharacters();
  const comparisons: InvulnComparison[] = [];

  for (const name of names) {
    const geo = loadGeometry(requireCharacter(name).id);
    if (!geo) continue;
    const fat = fatMoves(geo.character);

    for (const move of geo.moves) {
      const info = fat[move.input]?.extraInfo;
      const action = geo.actions.find((a) => a.id === move.action);
      // Supers are in: ADR-0018 kept them out because their action includes the
      // cinematic freeze and FAT's frames do not, and ADR-0019 found the freeze.
      // Every window here is stated in FAT's frame space.
      if (!info || !action) continue;

      for (const claim of info) {
        const kind = classify(claim);
        const range = soleRange(claim);
        if (!kind || !range) continue;
        const dump = windowFor(action, kind, airborneBit, range);
        const drift = dump ? Math.abs(dump[0] - range[0]) + Math.abs(dump[1] - range[1]) : undefined;
        const byAbsence = kind !== "full" && coversByAbsence(action, range);
        comparisons.push({
          character: geo.character,
          input: move.input,
          actionName: move.actionName,
          kind,
          fat: range,
          dump,
          drift,
          agrees: drift === 0,
          claim,
          byAbsence,
        });
      }
    }
  }

  const totals = {} as Record<InvulnKind, InvulnTally>;
  for (const kind of Object.keys(INVULN_CHECKS) as InvulnKind[]) {
    totals[kind] = { checked: 0, exact: 0, within1: 0, absent: 0, byAbsence: 0 };
  }
  for (const c of comparisons) {
    const t = totals[c.kind];
    if (c.byAbsence) {
      t.byAbsence++;
      continue;
    }
    t.checked++;
    if (c.drift === undefined) t.absent++;
    else {
      if (c.drift === 0) t.exact++;
      if (Math.abs(c.dump![0] - c.fat[0]) <= 1 && Math.abs(c.dump![1] - c.fat[1]) <= 1) t.within1++;
    }
  }

  return { totals, comparisons };
}

/** Just the claims the dump does not reproduce — what a human wants to look at. */
export function invulnDisagreements(report: InvulnReport): InvulnComparison[] {
  return report.comparisons.filter((c) => !c.agrees && !c.byAbsence);
}
