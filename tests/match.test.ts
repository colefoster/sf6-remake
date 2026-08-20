import { describe, it, expect } from "vitest";

import { hold, reactionFor } from "../src/game/match.js";
import { matchFor } from "../src/game/load.js";
import { DRIVE_MAX } from "../src/game/index.js";
import type { Button, Direction } from "../src/game/index.js";
import { BAR, actionFor, breaksArmor, driveRushCancelFrame, flightEnds, flightHitboxes, flightOrigin, hardKnockdown, hitDataFor } from "../src/data/geometry.js";
import { loadGeometry } from "../src/data/load-geometry.js";
import { listCharacters, requireCharacter, requireMove } from "../src/data/index.js";
import { runScenario } from "../src/sim/index.js";
import { verifyThrows } from "../src/verify/throws.js";
import { verifyArmor } from "../src/verify/armor.js";
import { verifyProjectiles } from "../src/verify/projectiles.js";
import { verify } from "../src/verify/index.js";

const report = verify();

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
  it("outlives its own action, which is why Ken's six-frame stub flies", () => {
    // ADR-0029 could not explain Ken's Hadoken: a six-frame shot action against
    // Ryu's seventy. Neither is as long as the flight it describes — Ryu's is
    // 385 units of a 1530-unit stage — so the action is the authored part and
    // the rest carries on at the launch speed. See ADR-0040.
    const ken = loadGeometry(requireCharacter("Ken").id)!;
    const shot = ken.actions.find((a) => a.name === "SPA_HADO PROJ")!;
    expect(shot.frames).toBe(6);
    expect(shot.motion?.launch).toBe(6);
    expect(flightEnds(shot)).toBe(false);
    // Frame 30 is far past the action; the box is still there and has travelled.
    expect(flightHitboxes(shot, 30)).not.toHaveLength(0);
    expect(flightOrigin(shot, 30).x).toBeGreaterThan(flightOrigin(shot, 6).x + 100);
    // And it now reaches a target no six-frame shot could.
    expect(runScenario("Ken", "236HP", { guard: true, distance: 500 }).contact).not.toBeNull();
  });

  it("stops with its action when it has nowhere to go", () => {
    // Ryu's Hashogeki is a shot that stays where it is put (ADR-0023). Letting
    // every projectile outlive its action would have left those on screen for ever.
    const ryu = loadGeometry(requireCharacter("Ryu").id)!;
    expect(flightEnds(ryu.actions.find((a) => a.name === "SPA_HADOSHO_L PROJ")!)).toBe(true);
    expect(flightEnds(ryu.actions.find((a) => a.name === "SPA_HADO PROJ")!)).toBe(false);
  });

  it("launches at the speed FAT publishes", () => {
    // A fraction times 100, the same conversion ADR-0034 found for throw range —
    // and the only check in the project that grades the special-move mapping
    // without going through frames. See ADR-0040.
    const { speed, rows } = verifyProjectiles();
    expect(speed.checked).toBeGreaterThan(30);
    expect(speed.agreeing / speed.checked).toBeGreaterThan(0.7);
    const ryuLp = rows.find((r) => r.character === "Ryu" && r.input === "236LP")!;
    expect(ryuLp.launch).toBe(5.5);
    expect(ryuLp.published).toBe(0.055);
  });

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
              // A knockdown names the `_DN` family instead, and those are the
              // one place the dump keeps the numeric prefix on the action name.
              // Every row still has to name something that exists. See ADR-0033.
              /: (\d+_)?(DMG|GRD)_[HMLCD][MH](_DN)?$/,
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

/**
 * The Drive and super gauges. See ADR-0031.
 *
 * The prices are the dump's, on the triggers. The gains are the dump's, on the
 * hit table. What is asserted here is that the runtime spends and banks the
 * numbers the grader has already checked against FAT — and that running out of
 * Drive takes the moves that cost Drive away.
 */
describe("the gauges", () => {
  it("charges an OD special exactly two bars, off the trigger", () => {
    const match = matchFor("Ryu", "Ken", { distance: 300, seconds: null });
    const ryu = match.fighters[0];
    const start = ryu.drive;
    const script = [hold(2), hold(3), hold(6, ["LP", "MP"])];
    for (let i = 0; i < 3; i++) match.advance(script[i]!, hold(5));
    expect(ryu.actionName).toBe("SPA_HADO(3)");
    expect(start - ryu.drive).toBe(2 * BAR);
  });

  it("will not sell what the gauge cannot pay for", () => {
    const match = matchFor("Ryu", "Ken", { distance: 300, seconds: null });
    const ryu = match.fighters[0];
    ryu.drive = BAR;
    const script = [hold(2), hold(3), hold(6, ["LP", "MP"])];
    for (let i = 0; i < 3; i++) match.advance(script[i]!, hold(5));
    // The OD version is unaffordable, so the same input reaches the ordinary
    // Hadoken instead of nothing at all.
    expect(ryu.actionName).not.toBe("SPA_HADO(3)");
    expect(ryu.actionName).toMatch(/^SPA_HADO/);
    expect(ryu.drive).toBeGreaterThanOrEqual(BAR);
  });

  it("drains the blocker's Drive by what FAT publishes for the move", () => {
    const match = matchFor("Ryu", "Ken", { distance: 110, seconds: null });
    const ken = match.fighters[1];
    ken.drive = DRIVE_MAX;
    const before = ken.drive;
    let landed = 0;
    for (let i = 0; i < 20; i++) {
      match.advance(i < 3 ? hold(5, ["MP"]) : hold(5), hold(6));
      if (match.hits.length && !landed) landed = match.frame;
    }
    expect(match.hits.map((h) => h.type)).toEqual(["block"]);
    // FAT's DDoB for Ryu's 5MP is 3000. Regen runs alongside, so the drain is
    // measured against the gauge's own ceiling rather than frame by frame.
    expect(before - ken.drive).toBeGreaterThan(2800);
    expect(before - ken.drive).toBeLessThanOrEqual(3000);
  });

  it("banks super for the attacker and hands some to the defender", () => {
    const match = matchFor("Ryu", "Ken", { distance: 110, seconds: null });
    const [ryu, ken] = match.fighters;
    for (let i = 0; i < 20; i++) match.advance(i < 3 ? hold(5, ["MP"]) : hold(5), hold(5));
    expect(match.hits.map((h) => h.type)).toEqual(["hit"]);
    // The hit row's SelfSoH and OppSoH: 500 to the attacker, 350 to the defender.
    expect(ryu.superMeter).toBe(500);
    expect(ken.superMeter).toBe(350);
    expect(ryu.superMeter).toBeLessThanOrEqual(ryu.superMax);
  });

  it("goes into burnout at zero and climbs back out at full", () => {
    const match = matchFor("Ryu", "Ken", { distance: 400, seconds: null });
    const ryu = match.fighters[0];
    expect(ryu.burnout).toBe(false);
    ryu.gain("drive", -DRIVE_MAX);
    expect(ryu.drive).toBe(0);
    expect(ryu.burnout).toBe(true);
    // Nothing that costs Drive is on the menu with an empty gauge.
    const script = [hold(2), hold(3), hold(6, ["LP", "MP"])];
    for (let i = 0; i < 3; i++) match.advance(script[i]!, hold(5));
    expect(ryu.actionName).not.toBe("SPA_HADO(3)");
    // `FocusRecoverIC` is 50 a frame, so an empty gauge is full again in 1,200.
    for (let i = 0; i < 1300 && ryu.burnout; i++) match.advance(hold(5), hold(5));
    expect(ryu.drive).toBe(DRIVE_MAX);
    expect(ryu.burnout).toBe(false);
  });
});

/**
 * Multi-hit contact, the combo counter, juggles and scaling. See ADR-0032.
 *
 * The juggle and scaling *numbers* are graded against FAT by `sf6 verify`
 * (96.4 / 96.9 / 95.0 / 98.0%). What is asserted here is that the runtime reads
 * them off the right rows and spends them — the rule they feed is this
 * project's assertion, and it is written down as one.
 */
describe("combos", () => {
  it("lands every HitID of a multi-hit move, not one per swing", () => {
    // Ryu's 6MP is two hits on one action. Keyed on the action instance it
    // landed once, which is what ADR-0027 and ADR-0029 both listed as open.
    const match = matchFor("Ryu", "Ken", { distance: 120, seconds: null });
    for (let i = 0; i < 80; i++) match.advance(i < 3 ? hold(6, ["MP"]) : hold(5), hold(5));
    expect(match.hits).toHaveLength(2);
    expect(match.hits.map((h) => h.action)).toEqual(["ATK_6MP", "ATK_6MP"]);
    expect(match.hits[0]!.frame).toBeLessThan(match.hits[1]!.frame);
  });

  it("counts them as one combo", () => {
    const match = matchFor("Ryu", "Ken", { distance: 120, seconds: null });
    for (let i = 0; i < 80; i++) match.advance(i < 3 ? hold(6, ["MP"]) : hold(5), hold(5));
    expect(match.combo[1].hits).toBe(2);
    expect(match.combo[1].damage).toBe(match.hits.reduce((n, h) => n + h.damage, 0));
  });

  it("still connects once per HitID, however long the hitstop", () => {
    // The original guard, restated for the new boundary: hitstop is eleven
    // frames and the box is out for three, so a time-based rule re-hits.
    const one = fight({ p1: [[5, ["MP"], 3]], p2: 5, frames: 200 });
    expect(one.match.hits).toHaveLength(1);
  });

  it("takes the combo's penalty from whatever opened it", () => {
    // `_StartScaling` is 20 on Ryu's 5LP and unset on 6MP. The dump states the
    // starter's penalty and nothing about the per-hit curve, so that is all the
    // runtime applies.
    const light = matchFor("Ryu", "Ken", { distance: 110, seconds: null });
    for (let i = 0; i < 40; i++) light.advance(i < 3 ? hold(5, ["LP"]) : hold(5), hold(5));
    expect(light.combo[1].scaling).toBe(80);

    const heavy = matchFor("Ryu", "Ken", { distance: 120, seconds: null });
    for (let i = 0; i < 40; i++) heavy.advance(i < 3 ? hold(6, ["MP"]) : hold(5), hold(5));
    expect(heavy.combo[1].scaling).toBe(100);
    // Unscaled, so both hits of 6MP are the table's own damage.
    expect(heavy.hits.map((h) => h.damage)).toEqual([300, 300]);
  });

  it("puts the defender on the juggle counter the row names", () => {
    const match = matchFor("Ryu", "Ken", { distance: 120, seconds: null });
    for (let i = 0; i < 80; i++) match.advance(i < 3 ? hold(6, ["MP"]) : hold(5), hold(5));
    const geo = loadGeometry(requireCharacter("Ryu").id)!;
    const action = geo.actions.find((a) => a.name === "ATK_6MP")!;
    const key = action.hit.find((h) => h.kind !== "proximity")!;
    const row = geo.hitData?.[String(key.attackData)];
    // Grounded, so the counter is the move's own starting value rather than an
    // accumulation — the same `Juggle1st` the grader checks against FAT.
    expect(match.combo[1].juggle).toBe(row!.hit!.juggle.start);
  });
});

/**
 * Knockdowns. See ADR-0033.
 *
 * `DmgType` is what says a hit knocks down, and it grades against FAT's own
 * "KD" at 92.8%. The chain the defender then walks is *not* wired in the dump —
 * `DMG_*_DN`, `BAS_DN_STD_*` and the `BAS_TECH_*` quick-rises carry no branches
 * at all — so the seam is asserted, and how long they lie there could not be
 * reconciled with FAT's published number. These check the parts that are read.
 */
describe("knockdowns", () => {
  it("plays the _DN reaction for a sweep and the ordinary one for a poke", () => {
    const swept = matchFor("Ryu", "Ken", { distance: 150, seconds: null });
    for (let i = 0; i < 20; i++) swept.advance(i < 3 ? hold(2, ["HK"]) : hold(5), hold(5));
    expect(swept.hits[0]?.reaction).toMatch(/_DN$/);

    const poked = matchFor("Ryu", "Ken", { distance: 110, seconds: null });
    for (let i = 0; i < 20; i++) poked.advance(i < 3 ? hold(5, ["MP"]) : hold(5), hold(5));
    expect(poked.hits[0]?.reaction).not.toMatch(/_DN$/);
  });

  it("leaves the defender on the floor and stands them back up", () => {
    const match = matchFor("Ryu", "Ken", { distance: 150, seconds: null });
    const ken = match.fighters[1];
    let down = 0;
    let up = 0;
    for (let i = 0; i < 200; i++) {
      match.advance(i < 3 ? hold(2, ["HK"]) : hold(5), hold(5));
      if (ken.down) { if (!down) down = match.frame; up = 0; }
      else if (down && !up) up = match.frame;
    }
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(down);
    // `DownTime` 10 for Ryu's 2HK plus the down action's own recovery — it is
    // actionable on `MarginFrame + 1`, which is 31 on every fighter.
    expect(up - down).toBe(10 + 30);
    expect(ken.down).toBe(false);
    expect(ken.actionable()).toBe(true);
  });

  it("does not knock down on block", () => {
    const match = matchFor("Ryu", "Ken", { distance: 150, seconds: null });
    for (let i = 0; i < 60; i++) match.advance(i < 3 ? hold(2, ["HK"]) : hold(5), hold(3));
    expect(match.hits[0]?.type).toBe("block");
    expect(match.fighters[1].down).toBe(false);
  });

  it("reports no advantage rather than inventing one, when the sim knocks down", () => {
    // The honest answer, and the same one the sim already gives for an air
    // normal: how long the defender is on the floor is not reconstructible.
    const swept = runScenario("Ryu", "2HK", { guard: false });
    expect(swept.knockedDown).toBe(true);
    expect(swept.defenderActionable).toBeNull();
    expect(swept.advantage).toBeNull();

    const poke = runScenario("Ryu", "5MP", { guard: false });
    expect(poke.knockedDown).toBe(false);
    expect(poke.advantage).not.toBeNull();
  });
});

/**
 * Throws. See ADR-0034.
 *
 * Before this a throw-kind hit key went through the ordinary strike path: it
 * connected against head/body/leg boxes, could be blocked, and worked on a
 * jumping opponent. All three are wrong, and the geometry says so — a throw
 * hitbox spans y 0 to 130 and the throwable box sits at y 132 to 166, so the
 * two are built never to intersect and the test is horizontal.
 */
describe("throws", () => {
  const throwAt = (distance: number, p2: (i: number) => ReturnType<typeof hold>, frames = 80) => {
    const match = matchFor("Ryu", "Ken", { distance, seconds: null });
    for (let i = 0; i < frames; i++) match.advance(i < 3 ? hold(5, ["LP", "LK"]) : hold(5), p2(i));
    return match;
  };

  it("comes out from the two-button trigger", () => {
    // Three frames in it is still the catch; by frame four it has taken the
    // type-36 branch into the animation that carries the opponent.
    const caught = throwAt(90, () => hold(5), 2);
    expect(caught.fighters[0].actionName).toMatch(/^NGS/);
    const carried = throwAt(90, () => hold(5), 10);
    expect(carried.fighters[0].actionName).toBe("NGA_6");
    expect(carried.fighters[1].actionName).toBe("NGD_6");
  });

  it("does its damage off the LockKey, not off a hitbox", () => {
    // `NGA_6` has no hit keys at all. The 1200 FAT publishes rides a `LockKey`
    // naming hit-data row 116, which no hit key anywhere references.
    const match = throwAt(90, () => hold(5));
    expect(match.hits.map((h) => `${h.action} ${h.damage}`)).toEqual(["NGA_6 1200"]);
    expect(match.health[1]).toBe(10000 - 1200);
  });

  it("connects in range and whiffs past it", () => {
    // Ryu's throw box reaches 80 and Ken's throwable box extends 33, so the two
    // meet up to 113 units apart and not beyond. Both numbers are the dump's.
    expect(throwAt(105, () => hold(5)).hits).toHaveLength(1);
    expect(throwAt(120, () => hold(5)).hits).toHaveLength(0);
  });

  it("cannot be blocked", () => {
    const blocked = throwAt(90, () => hold(6));
    expect(blocked.hits.map((h) => h.type)).toEqual(["hit"]);
  });

  it("misses an airborne opponent", () => {
    const jumped = throwAt(90, (i) => (i < 2 ? hold(8) : hold(5)));
    expect(jumped.hits).toHaveLength(0);
  });

  it("does not connect against ordinary hurtboxes", () => {
    // The throwable box is a separate array the dump keeps apart from
    // head/body/leg. A throw that tested the ordinary ones would reach much
    // further — Ken's hurtboxes are wider than his throwable box.
    const far = throwAt(140, () => hold(5));
    expect(far.hits).toHaveLength(0);
  });
});

describe("the throw geometry against the published stats", () => {
  it("puts the throw box's reach at exactly FAT's throwRange, times 100", () => {
    const report = verifyThrows();
    expect(report.reach.checked).toBe(24);
    expect(report.reach.agreeing).toBe(report.reach.checked);
  });
});

/**
 * Drive Rush cancels. See ADR-0036.
 *
 * The rush is an action of its own with no hitboxes, reached from a normal's
 * cancel window at three bars. What it does to the advantage is the finding:
 * the attacker's own recovery is discarded and replaced by the rush's `freeze`.
 */
describe("drive rush", () => {
  it("cancels a normal into the rush, at three bars", () => {
    const match = matchFor("Ryu", "Ken", { distance: 200, seconds: null });
    const ryu = match.fighters[0];
    const start = ryu.drive;
    for (let i = 0; i < 20; i++) {
      match.advance(i < 3 ? hold(2, ["MK"]) : i === 6 || i === 8 ? hold(6) : hold(5), hold(5));
    }
    expect(ryu.actionName).toBe("ATK_CTA_DASH");
    // Three bars, less whatever regenerated over those frames.
    expect(start - ryu.drive).toBeGreaterThan(3 * BAR - 3000);
    expect(start - ryu.drive).toBeLessThanOrEqual(3 * BAR);
  });

  it("replaces the move's recovery with the rush's own freeze", () => {
    // The whole point of a Drive Rush cancel: a heavy and a light end up
    // leaving nearly the same advantage, because neither one's recovery is
    // spent. The freeze is 10 on all 24 fighters and comes off the trigger.
    const plain = runScenario("Ryu", "2MK", { guard: true });
    const rushed = runScenario("Ryu", "2MK", { guard: true, driveRush: true });
    expect(rushed.recoverySource).toBe("drive-rush");
    expect(rushed.advantage!).toBeGreaterThan(plain.advantage!);
    // 2MK's ungated rush key opens two frames after contact, so the wait is the
    // freeze plus those two. A move whose window opens on the contact frame
    // waits the freeze alone. See ADR-0038.
    expect(rushed.attackerActionable).toBe(12);
    expect(runScenario("Ryu", "5MP", { guard: true, driveRush: true }).attackerActionable).toBe(10);
  });

  it("opens where the ungated cancel key opens, not on the contact frame", () => {
    // The gate is the finding: taking the earlier, `_Other`-gated twin of the
    // window is what put a third of the roster one or two frames too plus.
    const geo = loadGeometry(requireCharacter("Ryu").id)!;
    const action = actionFor(geo, requireMove(requireCharacter("Ryu"), "2MK"))!.action;
    expect(driveRushCancelFrame(geo, action)).toBe(10);
    expect((action.cancels ?? []).some((k) => ((k.other ?? 0) & (1 << 17)) !== 0 && k.start === 8)).toBe(true);
  });

  it("is graded against FAT, and the residual is small", () => {
    // Kept as a measurement rather than hidden. ADR-0036 left this at 64%;
    // reading the window's own opening frame takes it to 95%. See ADR-0038.
    const rows = report.comparisons.filter((c) => c.check === "driveRushBlock" && c.clean);
    expect(rows.length).toBeGreaterThan(150);
    const agreed = rows.filter((c) => c.agrees).length / rows.length;
    expect(agreed).toBeGreaterThan(0.9);
  });
});

/**
 * Armor. See ADR-0037.
 *
 * The windows themselves have been graded since ADR-0016 (93.1% against FAT's
 * published armor frames) and the runtime ignored them entirely. What is added
 * here is the consequence: an armored hurtbox absorbs the hit instead of taking
 * it, and a Super Art or Drive Reversal breaks through — ADR-0017's rule, which
 * grades at 98.3% and is read off the triggers rather than any flag.
 */
describe("armor", () => {
  const versusDriveImpact = (p1: (i: number) => ReturnType<typeof hold>) => {
    const match = matchFor("Ryu", "Ken", { distance: 130, seconds: null });
    for (let i = 0; i < 60; i++) match.advance(p1(i), i < 3 ? hold(5, ["HP", "HK"]) : hold(5));
    return match;
  };

  it("absorbs a poke instead of taking it", () => {
    const match = versusDriveImpact((i) => (i > 3 && i < 7 ? hold(5, ["MP"]) : hold(5)));
    const absorbed = match.hits[0]!;
    expect(absorbed.reaction).toBe("ARMOR");
    // Absorbed, not ignored: the health still goes, and the defender is not
    // interrupted — Drive Impact carries on and lands.
    expect(absorbed.damage).toBeGreaterThan(0);
    expect(absorbed.stun).toBe(0);
    expect(match.fighters[1].actionName).toBe("ATK_CTA");
    expect(match.hits.some((h) => h.action === "ATK_CTA")).toBe(true);
  });

  it("covers the legs, so a low does not go under Drive Impact", () => {
    // ADR-0016's measurement: DI's window covers head, body and leg. A move
    // whose armor skipped the leg box would let this through.
    const low = versusDriveImpact((i) => (i > 3 && i < 7 ? hold(2, ["MK"]) : hold(5)));
    expect(low.hits[0]?.reaction).toBe("ARMOR");
  });

  it("absorbs a fireball too", () => {
    // Drive Impact eating a projectile is the reason the armor check has to run
    // on the boxes that actually connected: a shot's are its own, and computing
    // them from the thrower's position silently missed every one.
    const match = matchFor("Ryu", "Ken", { distance: 130, seconds: null });
    const script = [hold(2), hold(3), hold(6, ["HP"])];
    for (let i = 0; i < 60; i++) match.advance(script[i] ?? hold(5), i < 3 ? hold(5, ["HP", "HK"]) : hold(5));
    expect(match.hits[0]?.action).toMatch(/PROJ$/);
    expect(match.hits[0]?.reaction).toBe("ARMOR");
  });

  it("runs out: Drive Impact absorbs two hits and no more", () => {
    // Two, from the atemi row's `ResistLimit` where the tree has the table and
    // from ADR-0039's FAT-derived map where it does not — the pinned tree's
    // case. Mash a light into the window and the third one lands for real.
    // See ADR-0042.
    const mashed = versusDriveImpact((i) => (i % 4 < 2 ? hold(5, ["LP"]) : hold(5)));
    const mine = mashed.hits.filter((h) => h.attacker === 0);
    expect(mine.filter((h) => h.reaction === "ARMOR")).toHaveLength(2);
    expect(mine.length).toBeGreaterThan(2);
    expect(mine[2]!.reaction).not.toBe("ARMOR");
  });

  it("costs the absorbing side Drive", () => {
    // `DriveNorm` on the row that landed, the field a block already reads.
    const match = matchFor("Ryu", "Ken", { distance: 130, seconds: null });
    const before = match.fighters[1].drive;
    for (let i = 0; i < 12; i++) match.advance(i > 3 && i < 7 ? hold(5, ["MP"]) : hold(5), i < 3 ? hold(5, ["HP", "HK"]) : hold(5));
    expect(match.hits[0]?.reaction).toBe("ARMOR");
    expect(match.fighters[1].drive).toBeLessThan(before);
  });

  it("has its hit count named by the atemi index, on every published claim", () => {
    // On the pinned tree this grades ADR-0039's map against the source it came
    // from, which is circular; a tree with the atemi table grades `ResistLimit`
    // against FAT instead, and disagrees once (E.Honda's 46PP). See ADR-0042.
    const { totals } = verifyArmor();
    expect(totals.hitCount.total).toBe(29);
    expect(totals.hitCount.agreeing).toBe(29);
  });

  it("deals a Drive Reversal's recoverable damage, which is all it has", () => {
    // `DmgValue` is 0 and `DmgRecover` is 500; FAT publishes 500. Reading only
    // the first made a Drive Reversal a free hit. See ADR-0041.
    const geo = loadGeometry(requireCharacter("Ryu").id)!;
    const data = hitDataFor(geo, geo.actions.find((a) => a.name === "ATK_CTA_4")!)!;
    expect(data.hit?.damage).toBe(0);
    expect(data.hit?.recoverable).toBe(500);
  });

  it("is broken by a Super Art and a Drive Reversal, and by nothing else", () => {
    // ADR-0017's rule, asserted directly rather than through an input: what
    // breaks armor is what a move *is*, read off the triggers that reach it.
    const geo = loadGeometry(requireCharacter("Ryu").id)!;
    const named = (name: string) => geo.actions.find((a) => a.name === name)!;
    expect(breaksArmor(geo, named("SAA_HADOUKEN"))).toBe(true);
    expect(breaksArmor(geo, named("ATK_CTA_4"))).toBe(true);
    expect(breaksArmor(geo, named("ATK_5MP"))).toBe(false);
    expect(breaksArmor(geo, named("SPA_HADO"))).toBe(false);
    expect(breaksArmor(geo, named("ATK_CTA"))).toBe(false);
  });
});

/**
 * Wake-up and throw teching. See ADR-0041.
 *
 * Both are cases where the dump holds one half of the mechanic and the input is
 * asserted: there is one down action and it does not come in two lengths, and
 * `NGE`/`NGF` are two equal-length actions with nothing routing into them.
 */
describe("wake-up and teching", () => {
  /** Drive Impact knocks down soft: `DownTime` 12 and no `_no_rolling`. */
  const impact = (p2: (i: number) => ReturnType<typeof hold>) => {
    const match = matchFor("Ryu", "Ken", { distance: 120, seconds: null });
    let up: number | null = null;
    for (let i = 0; i < 240; i++) {
      match.advance(i < 3 ? hold(5, ["HP", "HK"]) : hold(5), p2(i));
      if (!match.hits.length) continue;
      if (up === null && match.fighters[1].actionable() && match.fighters[1].stunned === 0) up = match.frame;
    }
    return { match, up };
  };

  it("lets a soft knockdown be quick-risen out of, and it is faster", () => {
    const lying = impact(() => hold(5));
    const rising = impact(() => hold(2));
    expect(lying.up).not.toBeNull();
    expect(rising.up).not.toBeNull();
    // The `DownTime` is the refusable part; the get-up itself is not.
    expect(rising.up!).toBe(lying.up! - 12);
  });

  it("refuses a hard knockdown", () => {
    // The rule, asserted directly: `_no_rolling` or a `DownTime` of 0. Ryu's
    // sweep carries `_no_rolling` on every condition, so it is never soft.
    const geo = loadGeometry(requireCharacter("Ryu").id)!;
    const sweepData = hitDataFor(geo, geo.actions.find((a) => a.name === "ATK_2HK")!)!;
    expect(hardKnockdown(sweepData.hit!)).toBe(true);
    const impactData = hitDataFor(geo, geo.actions.find((a) => a.name === "ATK_CTA")!)!;
    expect(hardKnockdown(impactData.hit!)).toBe(false);
  });

  it("techs a throw when the defender is going for one too", () => {
    // `NGE` and `NGF` have existed in every fighter's list since the geometry was
    // first extracted with nothing routing into them.
    const teched = matchFor("Ryu", "Ken", { distance: 90, seconds: null });
    for (let i = 0; i < 40; i++) {
      const press = i < 3 ? (["LP", "LK"] as Button[]) : [];
      teched.advance(hold(5, press), hold(5, press));
    }
    expect(teched.hits[0]?.reaction).toBe("TECH");
    expect(teched.health).toEqual([10000, 10000]);
    expect(teched.fighters[0].actionName).toBe("NGE");
    expect(teched.fighters[1].actionName).toBe("NGF");
  });

  it("does not tech when only the thrower presses", () => {
    const thrown = matchFor("Ryu", "Ken", { distance: 90, seconds: null });
    for (let i = 0; i < 40; i++) {
      thrown.advance(hold(5, i < 3 ? (["LP", "LK"] as Button[]) : []), hold(5));
    }
    expect(thrown.hits[0]?.reaction).not.toBe("TECH");
  });
});
