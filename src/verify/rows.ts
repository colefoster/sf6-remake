/**
 * Every graded row in the project, flattened to one addressable key each.
 *
 * This exists for one question: **how much of a residual is version skew?**
 * The geometry is extracted from a dump of one game build and graded against
 * FAT's current frame data, so any disagreement has two possible causes, and no
 * percentage in the project separated them until two trees could be graded side
 * by side (docs/agents/refresh-the-dump.md).
 *
 * A key is `<check>|<character>|<move>`, which is stable across trees as long as
 * the move mapping is — so the same row can be looked up in a second tree and
 * the two verdicts compared. `scripts/skew-audit.mjs` does the comparing; this
 * side only has to be complete and deterministic. See ADR-0043.
 */

import { loadGeometry } from "../data/load-geometry.js";
import { listCharacters, requireCharacter } from "../data/index.js";
import { verify } from "./index.js";
import { verifyArmor } from "./armor.js";
import { verifyProjectiles } from "./projectiles.js";
import { verifyThrows } from "./throws.js";

export interface GradedRow {
  /** What the dump says, as a number, or a string where the check is a range. */
  dump: number | string | null;
  fat: number | string | null;
  agrees: boolean;
  /** The clean population: an exact single-hit mapping. Only `verify` has one. */
  clean?: boolean;
}

/**
 * Which of the asked-for characters this tree actually has geometry for.
 *
 * Not the same list in every tree, and that is the point: the live dump is 21
 * fighters where the pinned snapshot is 24, so an audit has to intersect them
 * rather than compare a roster against a subset of itself.
 */
export function charactersWithGeometry(characters?: string[]): string[] {
  const names = characters?.length ? characters : listCharacters();
  return names.filter((n) => loadGeometry(requireCharacter(n).id));
}

/** Every row every grader produces, keyed `<check>|<character>|<move>`. */
export function gradedRows(characters?: string[]): Record<string, GradedRow> {
  const rows: Record<string, GradedRow> = {};

  for (const c of verify(characters).comparisons) {
    rows[`${c.check}|${c.character}|${c.input}`] = {
      dump: c.dump,
      fat: c.fat,
      agrees: c.agrees,
      clean: c.clean,
    };
  }
  for (const c of verifyArmor(characters).claims) {
    rows[`armorWindow|${c.character}|${c.input}`] = {
      dump: c.dump ? c.dump.join("-") : null,
      fat: c.fat.join("-"),
      agrees: c.agrees,
    };
    if (c.dumpHits !== undefined) {
      rows[`armorHits|${c.character}|${c.input}`] = { dump: c.dumpHits, fat: c.hits, agrees: c.dumpHits === c.hits };
    }
  }
  const proj = verifyProjectiles(characters);
  for (const r of proj.rows) {
    // Keyed by the shot as well: one move can put more than one body in the air.
    rows[`projSpeed|${r.character}|${r.input} ${r.shot}`] = {
      dump: r.launch ?? null,
      fat: r.published ?? null,
      agrees: r.agrees,
    };
  }
  for (const r of proj.counts) {
    rows[`projHits|${r.character}|${r.input}`] = { dump: r.bodies, fat: r.published, agrees: r.agrees };
  }
  for (const r of verifyThrows(characters).rows) {
    rows[`throwReach|${r.character}|throw`] = { dump: r.reach ?? null, fat: r.publishedReach ?? null, agrees: r.reachAgrees };
    rows[`throwHurt|${r.character}|throw`] = { dump: r.hurt ?? null, fat: r.publishedHurt ?? null, agrees: r.hurtAgrees };
  }
  return rows;
}
