import { describe, it, expect } from "vitest";

import { Match, hold, reactionFor } from "../src/game/match.js";
import type { Button, Direction } from "../src/game/index.js";
import { loadGeometry } from "../src/data/geometry.js";
import { listCharacters, requireCharacter } from "../src/data/index.js";
import { runScenario } from "../src/sim/index.js";

/**
 * Two fighters, checked against the two things that can check them: the dump
 * (does every reaction the hit table asks for exist?) and `src/sim` (does the
 * advantage a *played* blocked move leaves match the one the scenario player
 * computes and FAT publishes?). See ADR-0027.
 */

interface Script {
  /** Attacker input, as [direction, buttons, frames]. */
  p1: [Direction, Button[], number][];
  /** What the dummy holds. 6 is *back* for the right-hand fighter. */
  p2?: Direction;
  distance?: number;
  frames?: number;
}

function fight({ p1, p2 = 5, distance = 130, frames = 160 }: Script) {
  const match = new Match("Ryu", "Ken", { distance });
  const flat: [Direction, Button[]][] = [];
  for (const [dir, buttons, n] of p1) for (let i = 0; i < n; i++) flat.push([dir, buttons]);
  const free: { attacker: number | null; defender: number | null } = { attacker: null, defender: null };
  for (let i = 0; i < frames; i++) {
    const [dir, buttons] = flat[i] ?? [5, []];
    match.advance(hold(dir, buttons), hold(p2));
    const hit = match.hits[0];
    if (!hit) continue;
    const [a, d] = match.fighters;
    if (free.attacker === null && a.actionable()) free.attacker = match.frame - hit.frame;
    if (free.defender === null && d.stunned === 0) free.defender = match.frame - hit.frame;
  }
  return { match, free };
}

describe("two fighters", () => {
  it("blocks when the dummy holds back, and takes it when it does not", () => {
    const blocked = fight({ p1: [[5, ["MP"], 3]], p2: 6, distance: 110 });
    const clean = fight({ p1: [[5, ["MP"], 3]], p2: 5, distance: 110 });
    expect(blocked.match.hits.map((h) => h.type)).toEqual(["block"]);
    expect(clean.match.hits.map((h) => h.type)).toEqual(["hit"]);
    // Blocking costs no health; the hit costs exactly the table's damage.
    expect(blocked.match.health[1]).toBe(10000);
    expect(clean.match.health[1]).toBeLessThan(10000);
  });

  it("connects once per swing, not once per frame of hitstop", () => {
    // The hitbox is out for three frames and hitstop is eleven. Anything that
    // deduplicates on time re-hits forever, and health drains to nothing off one
    // button — which is exactly what happened before the instance counter.
    const one = fight({ p1: [[5, ["MP"], 3]], p2: 5, frames: 200 });
    expect(one.match.hits).toHaveLength(1);
  });

  it("cannot block a low standing up", () => {
    // Ryu's 2MK is flagged low. Holding back while standing does not stop it;
    // holding down-back does. The rule is asserted, not read — the dump says the
    // attack is low, not what beats it.
    const standing = fight({ p1: [[2, ["MK"], 3]], p2: 6, distance: 150 });
    const crouching = fight({ p1: [[2, ["MK"], 3]], p2: 3, distance: 150 });
    expect(standing.match.hits[0]?.type).toBe("hit");
    expect(crouching.match.hits[0]?.type).toBe("block");
  });

  it("counters a defender caught in their own start-up", () => {
    // Both press at once from a range only Ryu's button reaches. The one that
    // gets there second is mid-move, which is a counter hit and not a plain one.
    const match = new Match("Ryu", "Ken", { distance: 130 });
    for (let i = 0; i < 60; i++) {
      const press = i < 3;
      match.advance(hold(5, press ? ["MP"] : []), hold(5, press ? ["HK"] : []));
    }
    expect(match.hits[0]?.type).toBe("counter");
  });

  it("leaves the advantage the scenario player computes", () => {
    // The invariant that pins two derivations of one number together. `src/sim`
    // plays a single action against a passive dummy; this plays two fighters
    // that move, block and get pushed around. Neither reads a published value,
    // and they have to agree — that is what makes the runtime a rewrite of the
    // scenario player rather than a second opinion about it.
    //
    // Deliberately *not* asserted against FAT here. Ryu's 2MK is one of the
    // rows `sf6 verify` already reports as a disagreement (the dump says −6,
    // FAT publishes −3), and that argument belongs to the grader.
    for (const [move, script] of [
      ["2MK", [[2, ["MK"], 3]] as [Direction, Button[], number][]],
      ["5MP", [[5, ["MP"], 3]] as [Direction, Button[], number][]],
    ] as const) {
      const played = fight({ p1: script, p2: 3, distance: 130, frames: 220 });
      expect(`${move}: ${played.match.hits[0]?.type}`).toBe(`${move}: block`);
      const sim = runScenario("Ryu", move, { guard: true, defenderStance: "crouch" });
      expect(played.free.defender).not.toBeNull();
      expect(played.free.attacker).not.toBeNull();
      expect(`${move}: ${played.free.defender! - played.free.attacker!}`).toBe(
        `${move}: ${sim.advantage}`,
      );
    }
  });

  it("keeps two bodies apart", () => {
    // Walking into the dummy shoves it; the two origins never come closer than
    // their pushboxes allow.
    const match = new Match("Ryu", "Ken", { distance: 120 });
    let closest = Infinity;
    for (let i = 0; i < 200; i++) {
      match.advance(hold(6), hold(5));
      closest = Math.min(closest, match.fighters[1].position().x - match.fighters[0].position().x);
    }
    expect(closest).toBeGreaterThan(50);
  });
});

describe("the reaction decode", () => {
  it("names an action that exists, on every hit row on the roster", () => {
    // The check that makes this a decode rather than a guess: `part` picks the
    // height letter and `strength` the suffix, and a wrong reading names a
    // `DMG_*` the fighter does not have.
    let rows = 0;
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      for (const row of Object.values(geo.hitData)) {
        for (const [condition, outcome] of Object.entries(row)) {
          if (!outcome) continue;
          rows++;
          for (const stance of ["stand", "crouch"] as const) {
            const found = reactionFor(geo, outcome, condition === "block", stance);
            expect(`${geo.character} ${condition} ${stance}: ${found?.name ?? "MISSING"}`).toMatch(
              /: (DMG|GRD)_[HMLCD][MH]$/,
            );
          }
        }
      }
    }
    expect(rows).toBeGreaterThan(3000);
  });

  it("puts a blocking defender in GRD and a hit one in DMG", () => {
    const blocked = fight({ p1: [[5, ["MP"], 3]], p2: 6, distance: 110 });
    const clean = fight({ p1: [[5, ["MP"], 3]], p2: 5, distance: 110 });
    expect(blocked.match.hits[0]?.reaction).toMatch(/^GRD_/);
    expect(clean.match.hits[0]?.reaction).toMatch(/^DMG_/);
  });
});
