import { describe, it, expect } from "vitest";

import { type Command } from "../src/data/geometry.js";
import { loadGeometry } from "../src/data/load-geometry.js";
import { listCharacters, requireCharacter } from "../src/data/index.js";

/**
 * The motion inputs, graded against FAT's notation.
 *
 * `commands.json` says what to *press*; FAT's `numCmd` says the same thing in
 * numpad notation. Neither was derived from the other, so they check each other
 * the way every other decode in this project has been checked. See ADR-0025.
 */

/** The directions a command pins, in order. Wildcard steps contribute nothing. */
const pinned = (m: Command): number[] => m.steps.filter((s) => s.dir).map((s) => s.dir!);

/** Is `a` an ordered subsequence of `b`? */
function subsequence(a: number[], b: number[]): boolean {
  let i = 0;
  for (const x of b) if (x === a[i]) i++;
  return i === a.length;
}

interface Row {
  character: string;
  input: string;
  fat: number[];
  motions: number[][];
}

const rows: Row[] = [];
for (const name of listCharacters()) {
  const geo = loadGeometry(requireCharacter(name).id);
  if (!geo) continue;
  for (const move of geo.moves) {
    if (move.match !== "exact" || !/^(special|super)$/.test(move.category)) continue;
    const triggers = Object.values(geo.triggers).filter(
      (t) => t.action === move.action && t.motions?.length,
    );
    if (!triggers.length) continue;
    const fat = [...((move.input.match(/^[1-9]+/) ?? [""])[0])].map(Number);
    if (!fat.length) continue;
    rows.push({
      character: geo.character,
      input: move.input,
      fat,
      motions: triggers.flatMap((t) => t.motions!).map(pinned),
    });
  }
}

const agrees = (r: Row) => r.motions.some((m) => subsequence(m, r.fat));

describe("the motion inputs against FAT's notation", () => {
  it("reads the direction nibble the way the notation spells it", () => {
    expect(rows.length).toBeGreaterThan(250);
    const ok = rows.filter(agrees).length;
    expect(ok / rows.length).toBeGreaterThan(0.85);
  });

  it("anchors on the three motions the whole decode was read off", () => {
    const of = (character: string, input: string) => {
      const row = rows.find((r) => r.character === character && r.input === input)!;
      return row.motions.map((m) => m.join("")).join("|");
    };
    // A quarter-circle is pinned outright — and the table lists the game's own
    // lenient alternates beside it, which no published source states. A double
    // quarter-circle is stored with a wildcard standing in for one direction of
    // each half, and the table gives both ways round. A charge move pins the
    // inferred hold and the release.
    expect(of("Ryu", "236LP")).toBe("236|4236|4136");
    expect(of("Akuma", "236236K")).toBe("23626|26236|23626|26236");
    expect(of("Guile", "28KK")).toBe("28");
  });

  it("says the game's dragon punch is 626, where FAT writes 623", () => {
    // The only systematic disagreement, and it is the dump telling us something
    // FAT does not: the table pins forward, down, forward. `623` is what players
    // are taught, `626` is what the game accepts. Eleven fighters, every
    // strength, no exception — which is what makes it a finding and not a bug.
    const missed = rows.filter((r) => !agrees(r));
    const dp = missed.filter((r) => r.input.startsWith("623"));
    expect(dp.length).toBeGreaterThan(30);
    for (const r of dp) expect(`${r.character} ${r.input}: ${r.motions[0]!.join("")}`).toBe(
      `${r.character} ${r.input}: 626`,
    );
    // And once the dragon punch is accounted for, almost nothing else is left.
    expect(missed.length - dp.length).toBeLessThan(5);
  });

  it("gives every mapped special a button, and OD means all three", () => {
    let checked = 0;
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      for (const [, trigger] of Object.entries(geo.triggers)) {
        if (!trigger.kind?.includes("Special") || !trigger.keys) continue;
        checked++;
        // The button bits are a union, so an OD special is literally all three
        // punches or all three kicks rather than a separate flag.
        if (trigger.kind.includes("Extra")) {
          expect(`${trigger.keys.length} buttons`).toBe("3 buttons");
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });
});
