import { describe, it, expect } from "vitest";

import { hold, reactionFor } from "../src/game/match.js";
import { matchFor } from "../src/game/load.js";
import type { Button, Direction } from "../src/game/index.js";
import {} from "../src/data/geometry.js";
import { loadGeometry } from "../src/data/load-geometry.js";
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
  const match = matchFor("Ryu", "Ken", { distance });
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
    const match = matchFor("Ryu", "Ken", { distance: 130 });
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
    const match = matchFor("Ryu", "Ken", { distance: 120 });
    let closest = Infinity;
    for (let i = 0; i < 200; i++) {
      match.advance(hold(6), hold(5));
      closest = Math.min(closest, match.fighters[1].position().x - match.fighters[0].position().x);
    }
    expect(closest).toBeGreaterThan(50);
  });
});

describe("fireballs", () => {
  /** A quarter-circle-forward and a punch, in world directions for the left side. */
  const hadoken = (button: Button): [Direction, Button[], number][] => [
    [2, [], 2],
    [3, [], 2],
    [6, [button], 3],
  ];

  it("throws one, and it crosses the screen on its own clock", () => {
    // Nothing the fighter does reaches 350 units. The shot leaves on the frame
    // `ShotKey` names and arrives twenty-odd frames later, while Ryu stands
    // still recovering — which is exactly the curve ADR-0023 measured.
    const thrown = fight({ p1: hadoken("HP"), p2: 5, distance: 350, frames: 200 });
    const hit = thrown.match.hits[0];
    expect(hit?.action).toMatch(/PROJ$/);
    expect(hit?.type).toBe("hit");
    expect(hit!.frame).toBeGreaterThan(25);
    expect(thrown.match.health[1]).toBeLessThan(10000);
  });

  it("is a body in the air, not a hitbox on the thrower", () => {
    const match = matchFor("Ryu", "Ken", { distance: 400 });
    const script = hadoken("HP").flatMap(([dir, buttons, n]) =>
      Array.from({ length: n }, () => hold(dir, buttons)),
    );
    let seen = 0;
    let travelled = 0;
    for (let i = 0; i < 60; i++) {
      match.advance(script[i] ?? hold(5), hold(5));
      for (const shot of match.projectiles) {
        seen++;
        // Distance from where it spawned — the stage has a centre now, so the
        // shot's own x is a world position and not a travel any more.
        travelled = Math.max(travelled, Math.abs(shot.action.motion?.x?.[shot.frame - 1] ?? 0));
      }
    }
    expect(seen).toBeGreaterThan(20);
    // It gets a long way from where it was thrown, which a hitbox bolted to the
    // attacker could not do.
    expect(travelled).toBeGreaterThan(200);
  });

  it("two of them meet and both stop", () => {
    // ADR-0023 listed this as unmodelled: "two projectiles never meet". They do
    // now, and neither reaches anybody — a mirror match at full screen where the
    // one-sided version of the same script connects.
    const clash = matchFor("Ryu", "Ryu", { distance: 500 });
    const mine = hadoken("HP").flatMap(([dir, buttons, n]) =>
      Array.from({ length: n }, () => hold(dir, buttons)),
    );
    // Mirrored left-to-right for the right-hand fighter: their forward is world
    // back, but down is still down.
    const flip: Record<number, Direction> = { 1: 3, 2: 2, 3: 1, 4: 6, 5: 5, 6: 4, 7: 9, 8: 8, 9: 7 };
    const theirs = mine.map((f) => hold(flip[f.dir]!, f.buttons));
    for (let i = 0; i < 200; i++) clash.advance(mine[i] ?? hold(5), theirs[i] ?? hold(5));
    expect(clash.hits).toHaveLength(0);
    expect(clash.health).toEqual([10000, 10000]);

    const alone = matchFor("Ryu", "Ryu", { distance: 500 });
    for (let i = 0; i < 200; i++) alone.advance(mine[i] ?? hold(5), hold(5));
    expect(alone.hits).toHaveLength(1);
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

/**
 * The stage, its two walls and the round clock. See ADR-0030.
 *
 * The half-width is the one number here that is not in either dump; what these
 * check is not the 765 but that the rules built on it hold — a fighter cannot
 * walk through a wall, a cornered defender's pushback goes into the attacker
 * instead, and a fireball dies at the corner rather than sailing on forever.
 */
describe("the stage", () => {
  it("stops a fighter at the wall, body first", () => {
    const match = matchFor("Ryu", "Ken", { distance: 400 });
    // Walk forward long enough to cross the whole stage twice over.
    for (let i = 0; i < 600 && !match.over; i++) match.advance(hold(4), hold(5));
    const left = match.fighters[0].position().x;
    expect(left).toBeGreaterThan(-match.half);
    // The pushbox is against the wall, so the origin stops short of it by its
    // own half-width rather than reaching it.
    expect(left).toBeLessThan(-match.half + 60);
    expect(match.cornered(0)).toBe(true);
    expect(match.cornered(1)).toBe(false);
  });

  it("hands a cornered defender's pushback to the attacker", () => {
    const roomy = matchFor("Ryu", "Ken", { distance: 110 });
    const corner = matchFor("Ryu", "Ken", { distance: 110, stageHalfWidth: 120 });
    const run = (m: ReturnType<typeof matchFor>) => {
      for (let i = 0; i < 60; i++) m.advance(i < 3 ? hold(5, ["MP"]) : hold(5), hold(6));
      return { attacker: m.fighters[0].position().x, defender: m.fighters[1].position().x };
    };
    const open = run(roomy);
    const walled = run(corner);
    expect(roomy.cornered(1)).toBe(false);
    expect(corner.cornered(1)).toBe(true);
    // Off a wall the attacker holds their ground and the defender takes all of
    // the pushback. Against one the defender has nowhere to go, so the same
    // pushback moves the attacker instead.
    expect(open.attacker).toBeCloseTo(-55, 1);
    expect(walled.attacker).toBeLessThan(-56);
    expect(walled.defender).toBeLessThan(open.defender);
  });

  it("kills a fireball at the wall", () => {
    const match = matchFor("Ryu", "Ryu", { distance: 200, stageHalfWidth: 300 });
    const script = [hold(2), hold(3), hold(6, ["HP"])];
    let airborne = 0;
    for (let i = 0; i < 120; i++) {
      match.advance(script[i] ?? hold(5), hold(5));
      airborne = Math.max(airborne, match.projectiles.length);
      for (const shot of match.projectiles) {
        expect(Math.abs(shot.x)).toBeLessThan(match.half + 400);
      }
    }
    expect(airborne).toBe(1);
    // Its action runs 70 frames and it travels 586 units; on a 600-unit stage
    // the wall retires it well before either of those runs out.
    expect(match.projectiles).toHaveLength(0);
  });
});

describe("the round clock", () => {
  it("counts down in frames, holds still in hitstop, and times out on health", () => {
    const match = matchFor("Ryu", "Ken", { distance: 110, seconds: 2 });
    expect(match.clock).toBe(2);
    while (!match.hits.length) match.advance(match.frame < 3 ? hold(5, ["MP"]) : hold(5), hold(5));
    // Eleven frames of hitstop are eleven frames the clock does not spend.
    const stopped = match.timer;
    match.advance(hold(5), hold(5));
    expect(match.timer).toBe(stopped);
    for (let i = 0; i < 200 && !match.over; i++) match.advance(hold(5), hold(5));
    expect(match.timer).toBe(0);
    expect(match.result).toEqual({ winner: 0, by: "timeout" });
  });

  it("runs without one when asked", () => {
    const match = matchFor("Ryu", "Ken", { seconds: null });
    for (let i = 0; i < 40; i++) match.advance();
    expect(match.clock).toBeNull();
    expect(match.over).toBe(false);
  });
});
