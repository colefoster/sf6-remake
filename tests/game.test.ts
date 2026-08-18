import { describe, it, expect } from "vitest";

import { type Direction, type InputFrame } from "../src/game/index.js";
import { fighterFor } from "../src/game/load.js";
import { actionByName} from "../src/data/geometry.js";
import { loadGeometry } from "../src/data/load-geometry.js";
import { listCharacters, requireCharacter } from "../src/data/index.js";

/**
 * The runtime, checked against the data it is built out of.
 *
 * There is no published column for "how fast does Ryu walk", so these do not
 * grade against FAT. They grade the loop against the dump: a walk has to cover
 * the ground the motion curve states, a jump has to reach the height the arc
 * states, and a dash has to travel exactly `motion.travel.x`. If the loop is
 * banking positions wrongly it shows up here as a number that drifts.
 * See ADR-0026.
 */

const hold = (dir: Direction): InputFrame => ({ dir, buttons: [] });

/** Run a script of [direction, frames] pairs and report where it ended up. */
function play(character: string, script: [Direction, number][]) {
  const fighter = fighterFor(character);
  const seen: string[] = [];
  const log: { name: string; x: number; y: number }[] = [];
  let peakY = 0;
  for (const [dir, frames] of script) {
    for (let i = 0; i < frames; i++) {
      fighter.advance(hold(dir));
      if (seen[seen.length - 1] !== fighter.actionName) seen.push(fighter.actionName);
      const at = fighter.position();
      log.push({ name: fighter.actionName, ...at });
      peakY = Math.max(peakY, at.y);
    }
  }
  return { fighter, seen, log, peakY, ...fighter.position() };
}

const ryu = loadGeometry(requireCharacter("Ryu").id)!;
const travel = (name: string) => actionByName(ryu, name)!.motion!.travel;

describe("a fighter moving under its own power", () => {
  it("walks at the speed the motion curve states", () => {
    // BAS_FORWARD_Loop covers 531.1 units over 114 frames. Walking for two full
    // loops has to cover two of those, plus the START's own 89.3 — the loop
    // re-entering must bank the travel rather than restart the position.
    const loop = travel("BAS_FORWARD_Loop");
    const start = travel("BAS_FORWARD_START");
    const walked = play("Ryu", [[6, 20 + 114 * 2]]);
    // Within one frame of walk speed: the handover banks the `START`'s last
    // position and the `Loop` begins at its own frame 1, so the two overlap by
    // exactly one frame at each seam.
    const perFrame = loop.x / 114;
    expect(Math.abs(walked.x - (start.x + loop.x * 2))).toBeLessThan(perFrame * 2);
    expect(walked.seen).toEqual(["BAS_FORWARD_START", "BAS_FORWARD_Loop"]);
  });

  it("jumps to the height and distance the arc states", () => {
    const arc = travel("BAS_JUMP_F_AIR");
    const jump = play("Ryu", [[9, 5], [5, 80]]);
    expect(jump.peakY).toBeCloseTo(arc.maxY, 1);
    expect(jump.x).toBeCloseTo(arc.x, 1);
    // And comes back down. `_AIR` stops 23 units up and `_LAND` is the
    // touchdown, so a fighter that banked the arc's last frame would end each
    // jump a little higher than it started.
    expect(jump.y).toBe(0);
    expect(jump.seen).toEqual([
      "BAS_JUMP_F_START",
      "BAS_JUMP_F_AIR",
      "BAS_JUMP_F_LAND",
      "BAS_STD_Loop",
    ]);
  });

  it("stands still for ten thousand frames without wandering off", () => {
    // The idle loop is 396 frames long and branches to a fidget and back. If any
    // of that leaked position or fell into an undefined action it would show up
    // over 10,000 frames rather than over 60.
    const idle = play("Ryu", [[5, 10000]]);
    expect(idle.fighter.actionName).toBe("BAS_STD_Loop");
    expect(idle.x).toBe(0);
    expect(idle.y).toBe(0);
  });

  it("crouches and stands back up through the game's own transitions", () => {
    const down = play("Ryu", [[2, 80], [5, 60]]);
    expect(down.seen).toEqual(["BAS_STD_CRH", "BAS_CRH_Loop", "BAS_CRH_STD", "BAS_STD_Loop"]);
    expect(down.x).toBe(0);
  });
});

describe("the motion recogniser", () => {
  it("dashes on a double tap and walks on a hold", () => {
    // The same direction, twice, and the difference is entirely in whether it
    // was released. That is what the edge history is for: against a per-frame
    // history the table's wildcard steps would let a held forward dash.
    const tapped = play("Ryu", [[6, 3], [5, 3], [6, 3], [5, 50]]);
    expect(tapped.seen).toContain("BAS_DASH_F");
    const held = play("Ryu", [[6, 60]]);
    expect(held.seen).not.toContain("BAS_DASH_F");
    expect(held.seen).toContain("BAS_FORWARD_Loop");
  });

  it("covers exactly the ground the dash action states", () => {
    const dashed = play("Ryu", [[6, 3], [5, 3], [6, 3], [5, 60]]);
    const began = dashed.log.findIndex((f) => f.name === "BAS_DASH_F");
    expect(began).toBeGreaterThan(-1);
    // From the frame the dash starts to the frame it ends, exactly its own
    // travel — the walk in front of it neither adds to nor eats into it.
    const from = dashed.log[began - 1]!.x;
    expect(dashed.x - from).toBeCloseTo(travel("BAS_DASH_F").x, 1);
  });

  it("honours the command's own window, so a slow double tap is not a dash", () => {
    // Ryu's dash command states an 8-frame window per step. Thirty frames
    // between the taps has to fail, or the window is not being read at all.
    const slow = play("Ryu", [[6, 3], [5, 30], [6, 3], [5, 50]]);
    expect(slow.seen).not.toContain("BAS_DASH_F");
  });

  it("dashes backward too, and the back dash is the shorter one", () => {
    const back = play("Ryu", [[4, 3], [5, 3], [4, 3], [5, 60]]);
    expect(back.seen).toContain("BAS_DASH_B");
    expect(Math.abs(travel("BAS_DASH_B").x)).toBeLessThan(travel("BAS_DASH_F").x);
  });
});

describe("every fighter can be played", () => {
  it("has each action the movement table names, on all 24", () => {
    const needed = [
      "BAS_STD_Loop",
      "BAS_CRH_Loop",
      "BAS_STD_CRH",
      "BAS_CRH_STD",
      "BAS_FORWARD_START",
      "BAS_FORWARD_Loop",
      "BAS_FORWARD_END",
      "BAS_BACKWARD_START",
      "BAS_BACKWARD_Loop",
      "BAS_BACKWARD_END",
      "BAS_JUMP_N_START",
      "BAS_JUMP_N_AIR",
      "BAS_JUMP_N_LAND",
      "BAS_JUMP_F_AIR",
      "BAS_JUMP_B_AIR",
    ];
    let checked = 0;
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      checked++;
      const missing = needed.filter((n) => !actionByName(geo, n));
      expect(`${geo.character}: ${missing.join(",")}`).toBe(`${geo.character}: `);
    }
    expect(checked).toBe(24);
  });

  it("survives a long random-ish script on every fighter", () => {
    // Not a fuzz test — a fixed sweep of every direction, on everyone, checking
    // that no path through the table reaches an action the fighter does not
    // have and that nobody ends up airborne with no way down.
    const dirs: Direction[] = [5, 6, 6, 5, 4, 2, 8, 9, 7, 3, 1, 5];
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      const fighter = fighterFor(name);
      for (let i = 0; i < 600; i++) fighter.advance(hold(dirs[i % dirs.length]!));
      for (let i = 0; i < 120; i++) fighter.advance();
      expect(`${geo.character} ${fighter.state.stance} y=${fighter.position().y}`).toBe(
        `${geo.character} stand y=0`,
      );
    }
  });
});
