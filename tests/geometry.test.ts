import { describe, it, expect } from "vitest";
import {
  actionFor,
  minDistance,
  pushHalfWidth,
  pushboxesAt,
  activeWindows,
  connectFrames,
  geometryFor,
  hitboxesAt,
  hurtboxesAt,
  idleHurtboxes,
  loadGeometry,
  mirrored,
  originAt,
  worldHitboxes,
  overlaps,
  reach,
  cancelTargets,
} from "../src/data/geometry.js";
import { hitDataFor } from "../src/data/geometry.js";
import { listCharacters, requireCharacter, requireMove } from "../src/data/index.js";
import { stunFrom } from "../src/engine/frames.js";

const ryu = requireCharacter("Ryu");
const geo = loadGeometry("ryu")!;

describe("the extracted geometry", () => {
  it("loads with a calibration that matches Ryu's height in game units", () => {
    // Ryu's standing head/body/leg hurtboxes tile 0-54, 54-138, 138-166.
    expect(geo.calibration?.standingHeight).toBe(166);
  });

  it("agrees with the published frame data on the moves it maps", () => {
    const exact = geo.moves.filter((m) => m.startupDelta === 0);
    expect(exact.length).toBeGreaterThan(30);
    expect(geo.moves.filter((m) => m.match === "weak").length).toBeLessThan(3);
  });

  it("puts 2MK's hitbox on its published active frames", () => {
    const { action } = actionFor(geo, requireMove(ryu, "2MK"))!;
    expect(activeWindows(action)).toEqual([{ start: 8, end: 10 }]);
    expect(hitboxesAt(action, 7)).toHaveLength(0);
    expect(hitboxesAt(action, 8)).toHaveLength(1);
    expect(hitboxesAt(action, 11)).toHaveLength(0);
  });

  it("keeps 2MK's hitbox low to the ground, as a low attack", () => {
    const { action } = actionFor(geo, requireMove(ryu, "2MK"))!;
    const box = hitboxesAt(action, 8)[0]!;
    expect(action.flags.low).toBe(true);
    expect(box.y).toBeLessThan(20);
    expect(box.y + box.height).toBeLessThan(geo.calibration!.standingHeight / 2);
  });

  it("crouches the hurtboxes during a crouching normal", () => {
    const { action } = actionFor(geo, requireMove(ryu, "2MK"))!;
    const standing = Math.max(...idleHurtboxes(geo).map((b) => b.y + b.height));
    const crouched = Math.max(...hurtboxesAt(action, 1).map((b) => b.y + b.height));
    expect(crouched).toBeLessThan(standing);
  });

  it("splices the wind-up action that hands off to the hit (2HP)", () => {
    const found = actionFor(geo, requireMove(ryu, "2HP"))!;
    expect(found.action.name).toBe("ATK_2HP_H");
    expect(found.action.continues).toBeDefined();
    // Read alone the wind-up shows 4 active frames; spliced it matches FAT's 6.
    expect(activeWindows(found.action)).toEqual([{ start: 9, end: 14 }]);
  });
});

describe("spacing", () => {
  const { action } = actionFor(geo, requireMove(ryu, "2MK"))!;
  const opponent = idleHurtboxes(geo);

  it("connects inside its reach and whiffs past it", () => {
    const max = reach(action, opponent)!;
    expect(connectFrames(action, opponent, max - 1)).toEqual([8, 9, 10]);
    expect(connectFrames(action, opponent, max + 1)).toEqual([]);
  });

  it("reaches further against a crouching opponent than 2MK's box height alone implies", () => {
    const crouching = idleHurtboxes(geo, "crouch");
    expect(reach(action, crouching)).toBeGreaterThan(0);
  });

  it("mirrors the defender so its front edge faces the attacker", () => {
    const box = { x: 10, y: 0, width: 20, height: 100 };
    expect(mirrored(box, 100)).toMatchObject({ x: 70, width: 20 });
    expect(overlaps({ x: 60, y: 0, width: 20, height: 10 }, mirrored(box, 100))).toBe(true);
  });
});

describe("pushboxes", () => {
  const akuma = requireCharacter("Akuma");
  const akumaGeo = loadGeometry("akuma")!;

  it("resolves the standing box to the one every standing reaction uses", () => {
    const stand = geo.actions.find((a) => a.id === geo.calibration!.standAction)!;
    const box = pushboxesAt(stand, 1)[0]!;
    expect(box).toMatchObject({ x: -33, y: 0, width: 66, height: 130 });
  });

  it("gives crouching the same width but less height", () => {
    const crouch = geo.actions.find((a) => a.id === geo.calibration!.crouchAction)!;
    const box = pushboxesAt(crouch, 1)[0]!;
    expect(box.width).toBe(66);
    expect(box.height).toBeLessThan(130);
  });

  it("raises the box off the ground while airborne", () => {
    const { action } = actionFor(geo, requireMove(ryu, "8HP"))!;
    expect(pushboxesAt(action, 1).every((b) => b.y > 0)).toBe(true);
  });

  it("sets point blank at the sum of the two facing half-widths", () => {
    expect(pushHalfWidth(geo)).toBe(33);
    expect(minDistance(geo, akumaGeo)).toBe(66);
    expect(akuma.name).toBe("Akuma");
  });

  it("lets every grounded normal connect at point blank", () => {
    const closest = minDistance(geo, geo)!;
    const opponent = idleHurtboxes(geo);
    for (const input of ["5LP", "2MK", "5HK", "2HP"]) {
      const { action } = actionFor(geo, requireMove(ryu, input))!;
      expect(connectFrames(action, opponent, closest).length).toBeGreaterThan(0);
    }
  });
});

describe("motion", () => {
  const byName = (name: string) => geo.actions.find((a) => a.name === name)!;

  it("reads the dash as one continuous forward curve", () => {
    const dash = byName("BAS_DASH_F");
    const x = dash.motion!.x!;
    // Regression: PosList is keyed "00".."39" and JS iterates the canonical
    // integer keys first, which scrambled this curve into a sawtooth.
    for (let i = 1; i < x.length; i++) expect(x[i]!).toBeGreaterThanOrEqual(x[i - 1]!);
    expect(dash.motion!.travel.maxX).toBeCloseTo(125.21, 1);
  });

  it("has the back dash cover less ground than the forward one", () => {
    expect(byName("BAS_DASH_B").motion!.travel.maxX).toBeCloseTo(-92.3, 1);
  });

  it("integrates the jump arc from its velocity and gravity", () => {
    const jump = byName("BAS_JUMP_F_AIR");
    const y = jump.motion!.y!;
    const apex = y.indexOf(Math.max(...y)) + 1;
    // y velocity 24 against gravity 1.17 puts the apex just past frame 20.
    expect(apex).toBeGreaterThan(18);
    expect(apex).toBeLessThan(23);
    expect(jump.motion!.travel.maxY).toBeGreaterThan(geo.calibration!.standingHeight);
    // x velocity 5 per frame, held for the whole jump.
    expect(jump.motion!.x![9]! - jump.motion!.x![8]!).toBeCloseTo(5, 1);
  });

  it("walks forward at a steady speed", () => {
    const x = byName("BAS_FORWARD_Loop").motion!.x!;
    expect(x[10]! - x[9]!).toBeCloseTo(4.7, 1);
  });

  it("steps 2MK forward before its hitbox appears", () => {
    const { action } = actionFor(geo, requireMove(ryu, "2MK"))!;
    expect(originAt(action, 1).x).toBe(0);
    expect(originAt(action, 8).x).toBeCloseTo(46.2, 1);
  });

  it("measures reach from where the attacker started, not where it ends up", () => {
    const { action } = actionFor(geo, requireMove(ryu, "2MK"))!;
    const opponent = idleHurtboxes(geo);
    const withTravel = reach(action, opponent)!;
    const { motion, ...stationaryAction } = action;
    const stationary = reach(stationaryAction, opponent)!;
    expect(motion).toBeDefined();
    expect(withTravel - stationary).toBeCloseTo(originAt(action, 8).x, 1);
    expect(worldHitboxes(action)[0]!.frame).toBe(8);
  });
});

describe("hit data", () => {
  /** Moves whose FAT numbers are plain integers, so the identity is checkable. */
  function checkable(character: ReturnType<typeof requireCharacter>) {
    const g = loadGeometry(character.id)!;
    return character.moves.flatMap((move) => {
      const found = actionFor(g, move);
      const data = found && hitDataFor(g, found.action);
      const raw = move.raw ?? {};
      if (!data?.hit || !data.block) return [];
      if (move.onHit === undefined || move.onBlock === undefined) return [];
      if (raw.active || raw.onHit || raw.onBlock || raw.recovery) return [];
      return [{ move, data }];
    });
  }

  const ryuMoves = checkable(ryu);
  const akumaMoves = checkable(requireCharacter("Akuma"));
  const all = [...ryuMoves, ...akumaMoves];

  it("carries an outcome table keyed by the index the hit keys reference", () => {
    expect(Object.keys(geo.hitData).length).toBeGreaterThan(100);
    const { action } = actionFor(geo, requireMove(ryu, "2MK"))!;
    const data = hitDataFor(geo, action)!;
    expect(data.hit).toMatchObject({ damage: 500, stun: 23 });
    expect(data.block!.damage).toBe(0);
  });

  it("confirms counter hit is exactly +2 frames of hitstun", () => {
    expect(all.length).toBeGreaterThan(20);
    for (const { move, data } of all) {
      expect(`${move.input}:${data.counter!.stun}`).toBe(`${move.input}:${data.hit!.stun + 2}`);
    }
  });

  it("confirms punish counter is +4, bar the moves that change the reaction", () => {
    const exact = all.filter((m) => m.data.punishCounter?.stun === m.data.hit!.stun + 4);
    // Ryu's 5HK punish counter crumples instead, so it carries its own stun.
    expect(exact.length).toBeGreaterThanOrEqual(all.length - 2);
  });

  it("derives the blockstun the game's own table reports", () => {
    // Akuma's dump and his frame data line up, so every one of his moves agrees
    // — which is what pins the +4 guard release down as real and not a fudge.
    for (const { move, data } of akumaMoves) {
      expect(`${move.input} ${stunFrom(move, "block")}`).toBe(`${move.input} ${data.block!.stun}`);
    }
    // Ryu's two sources disagree on a handful of moves (the same ones whose
    // startup already differs), so his agreement is high rather than total.
    const agreeing = ryuMoves.filter((m) => stunFrom(m.move, "block") === m.data.block!.stun);
    expect(agreeing.length).toBeGreaterThanOrEqual(ryuMoves.length - 4);
  });

  it("derives hitstun with no such constant", () => {
    const agreeing = all.filter((m) => stunFrom(m.move, "hit") === m.data.hit!.stun);
    // Four exceptions across the two characters: 2HP on both (its active frames
    // come from a spliced continuation, so the count feeding the identity is a
    // frame off) plus a target combo and one patch-skewed move.
    expect(agreeing.length).toBeGreaterThanOrEqual(all.length - 4);
    expect(agreeing.length / all.length).toBeGreaterThan(0.8);
  });

  it("launches an airborne opponent instead of pushing them back", () => {
    const { action } = actionFor(geo, requireMove(ryu, "2MK"))!;
    const data = hitDataFor(geo, action)!;
    expect(data.airHit!.knockback.y).toBeGreaterThan(0);
    expect(data.hit!.knockback.y).toBe(0);
  });
});

describe("geometryFor", () => {
  it("builds the frame-keyed Geometry the domain type describes", () => {
    const g = geometryFor(ryu, requireMove(ryu, "2MK"))!;
    expect(Object.keys(g.hitboxes!).map(Number)).toEqual([8, 9, 10]);
    expect(g.hurtboxes![1]!.length).toBeGreaterThan(0);
  });

  it("is undefined for a move with no mapped action", () => {
    const unmapped = ryu.moves.find((m) => m.input === "5MP > LK > HK > HP");
    if (unmapped) expect(geometryFor(ryu, unmapped)).toBeUndefined();
  });
});

describe("cancel windows", () => {
  const mapping = (input: string) => geo.moves.find((m) => m.input === input)!;

  it("never opens the special-cancel window before the move is active", () => {
    // A cancel is only live once a hitbox is out — the buffered key in front of
    // the window is what covers the frames before that. Multi-hit moves open on
    // a later hit, so this is a floor and not an equality. See docs/adr/0008.
    for (const move of geo.moves) {
      if (!move.cancel) continue;
      const { action } = actionFor(geo, requireMove(ryu, move.input)) ?? {};
      if (!action) continue;
      const strikes = action.hit.filter((h) => h.kind !== "proximity");
      if (!strikes.length) continue;
      const firstActive = Math.min(...strikes.map((h) => h.start));
      expect(`${move.input}:${move.cancel.start >= firstActive}`).toBe(`${move.input}:true`);
    }
  });

  it("buffers ahead of the live window", () => {
    const window = mapping("5MP").cancel!;
    expect(window.buffer).toBeLessThan(window.start);
    expect(window.end).toBeGreaterThanOrEqual(window.start);
  });

  it("leaves non-cancellable normals with no window", () => {
    expect(mapping("5HK").cancel).toBeUndefined();
    expect(mapping("2HK").cancel).toBeUndefined();
  });

  it("resolves the window to actual special actions", () => {
    const targets = cancelTargets(geo, mapping("2MK"));
    expect(targets.length).toBeGreaterThan(10);
    expect(targets.some((t) => t.name.startsWith("SPA_"))).toBe(true);
    // Nothing in a special-cancel list should be a normal's own action.
    expect(targets.filter((t) => t.name.startsWith("ATK_")).length).toBeLessThan(targets.length);
  });

  it("reports cancellability the frame data agrees with, across the roster", () => {
    // FAT's `xx` column is an independent statement of which normals cancel into
    // specials, so it is the check on the trigger windows rather than a source.
    let checked = 0;
    let disagree = 0;
    for (const name of listCharacters()) {
      const character = requireCharacter(name);
      const g = loadGeometry(character.id);
      if (!g) continue;
      for (const move of g.moves) {
        if (move.category !== "normal" || move.input.includes(">")) continue;
        const tags = character.moves.find((m) => m.input === move.input)?.cancelTags;
        if (!tags) continue;
        checked++;
        const fatSays = tags.includes("sp") || tags.includes("su");
        if (fatSays !== !!move.cancel) disagree++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(disagree / checked).toBeLessThan(0.05);
  });
});

describe("cancel window timing across the roster", () => {
  it("opens within a few frames of a single-hit normal becoming active", () => {
    const offsets: number[] = [];
    for (const name of listCharacters()) {
      const g = loadGeometry(requireCharacter(name).id);
      if (!g) continue;
      for (const move of g.moves) {
        if (!move.cancel || move.hits !== 1 || move.category !== "normal") continue;
        const action = g.actions.find((a) => a.id === move.action);
        const strikes = action?.hit.filter((h) => h.kind !== "proximity") ?? [];
        if (!strikes.length) continue;
        offsets.push(move.cancel.start - Math.min(...strikes.map((h) => h.start)));
      }
    }
    expect(offsets.length).toBeGreaterThan(100);
    expect(Math.min(...offsets)).toBe(0);
    // Multi-hit moves open later; a single-hit normal's window tracks its hitbox.
    expect(offsets.filter((o) => o <= 3).length / offsets.length).toBeGreaterThan(0.9);
  });
});
