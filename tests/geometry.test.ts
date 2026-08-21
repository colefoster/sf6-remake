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
  mirrored,
  originAt,
  worldHitboxes,
  overlaps,
  reach,
  cancelTargets,
  cancelOptions,
  affordable,
  armorDamage,
  armorHits,
  atemiRow,
  BAR,
  hurtPartsAt,
  stanceAt,
} from "../src/data/geometry.js";
import type { ArmorWindow, AtemiRow, GeometryFile } from "../src/data/geometry.js";
import type { GeometryAction } from "../src/data/geometry.js";
import type { Fighter } from "../src/game/index.js";
import {
  CAMERA_FLOOR,
  Camera,
  boundsOf,
  buildOf,
  drawStage,
  type Ctx,
  headRadius,
  poseOf,
  recoiled,
  shakeAt,
  viewFor,
  viewForAction,
  type Pose,
} from "../src/game/render.js";
import { loadGeometry } from "../src/data/load-geometry.js";
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
    // Supers are excluded: their action carries the cinematic freeze so FAT's
    // startup never agrees, and they are mapped by class rather than by frames.
    // See ADR-0018. This guards the ordinary mapping from degrading.
    const soft = geo.moves.filter((m) => m.match === "weak" && m.category !== "super");
    expect(soft.length).toBeLessThan(3);
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
    const g = geometryFor(loadGeometry(ryu.id), requireMove(ryu, "2MK"))!;
    expect(Object.keys(g.hitboxes!).map(Number)).toEqual([8, 9, 10]);
    expect(g.hurtboxes![1]!.length).toBeGreaterThan(0);
  });

  it("is undefined for a move with no mapped action", () => {
    const unmapped = ryu.moves.find((m) => m.input === "5MP > LK > HK > HP");
    if (unmapped) expect(geometryFor(loadGeometry(ryu.id), unmapped)).toBeUndefined();
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

describe("what a cancel costs", () => {
  const rosterTriggers = () =>
    listCharacters().flatMap((name) => {
      const g = loadGeometry(requireCharacter(name).id);
      return g ? Object.values(g.triggers) : [];
    });

  /**
   * The costs are denominated in gauge units and check themselves against the
   * game: Drive is six bars of 10000 and super three, so these are the numbers
   * every SF6 player already knows. See docs/adr/0009.
   */
  it("prices supers at exactly one bar per level", () => {
    // Filtered to the triggers that charge at all: a super's later parts are
    // free, because the first one already took the meter. Same for EX below.
    const byLevel = new Map<string, number[]>();
    for (const t of rosterTriggers()) {
      const level = t.kind?.find((k) => /^Lv[1-4]$/.test(k));
      if (!level || !t.super) continue;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level)!.push(t.super);
    }
    const only = (level: string, bars: number) => {
      const costs = byLevel.get(level)!;
      expect(costs.filter((c) => c === bars * BAR).length / costs.length).toBeGreaterThan(0.95);
    };
    only("Lv1", 1);
    // Terry's SAA_2_3 is the one exception: a later part of a level 2 that
    // charges another bar of its own.
    only("Lv2", 2);
    only("Lv3", 3);
    // Lv4 is the level 3 again at low health — the Critical Art — same price.
    only("Lv4", 3);
  });

  it("prices every EX special at two bars of Drive", () => {
    const ex = rosterTriggers().filter((t) => t.kind?.includes("Extra"));
    expect(ex.length).toBeGreaterThan(150);
    const priced = ex.filter((t) => t.drive);
    expect(priced.filter((t) => t.drive === 2 * BAR).length / priced.length).toBeGreaterThan(0.85);
    // The one-bar exceptions are the stock-spending moves — Juri's Fuha
    // releases, Guile's and Luke's charged variants — and there is nothing else.
    expect([...new Set(priced.map((t) => t.drive))].sort()).toEqual([1 * BAR, 2 * BAR]);
    // The free ones are the follow-up halves of a rekka whose first part paid.
    expect(ex.filter((t) => !t.drive).length / ex.length).toBeLessThan(0.5);
  });

  it("prices the Drive system the way the game does", () => {
    const cost = (flag: string) => {
      const found = rosterTriggers().filter((t) => t.kind?.includes(flag) && t.drive);
      return [...new Set(found.map((t) => t.drive))];
    };
    expect(cost("DImpact")).toEqual([1 * BAR]);
    expect(cost("DReversal")).toEqual([2 * BAR]);
    expect(cost("DriveDash")).toEqual([3 * BAR]);
    // Drive Parry and the parry-into-rush are the half-bar options.
    expect(cost("Parry")).toEqual([BAR / 2]);
  });

  it("buffers most inputs for 4 frames", () => {
    const buffers = rosterTriggers().map((t) => t.buffer);
    const four = buffers.filter((b) => b === 4).length;
    expect(four / buffers.length).toBeGreaterThan(0.7);
    expect(Math.max(...buffers)).toBeLessThanOrEqual(10);
  });

  it("resolves every cancel-list entry to a trigger", () => {
    let entries = 0;
    let unresolved = 0;
    for (const name of listCharacters()) {
      const g = loadGeometry(requireCharacter(name).id);
      if (!g) continue;
      for (const indices of Object.values(g.cancelGroups)) {
        for (const index of indices) {
          entries++;
          if (!g.triggers[String(index)]) unresolved++;
        }
      }
    }
    expect(entries).toBeGreaterThan(2000);
    expect(unresolved).toBe(0);
  });

  it("only offers what the gauges can pay for", () => {
    const move = geo.moves.find((m) => m.input === "2MK")!;
    const options = cancelOptions(geo, move);
    expect(affordable(options, {}).every((o) => !o.trigger.drive && !o.trigger.super)).toBe(true);
    expect(affordable(options, { drive: 2 * BAR }).length).toBeGreaterThan(affordable(options, {}).length);
    expect(affordable(options, { drive: 6 * BAR, super: 3 * BAR }).length).toBe(options.length);
  });
});

/**
 * The atemi table. See ADR-0042.
 *
 * The pinned dump predates MMDK's atemi dump, so `geo.atemi` is absent here and
 * every row below is synthesised: what is under test is the resolution and the
 * arithmetic, not the numbers, which only a tree extracted from a dump carrying
 * `common_atemi.json` has.
 */
describe("atemi rows", () => {
  const window = (index: number): ArmorWindow => ({
    start: 1,
    end: 27,
    index,
    covers: { head: true, body: true, leg: true },
  });
  const withTable = (rows: Record<string, AtemiRow>): GeometryFile =>
    ({ ...geo, atemi: rows }) as GeometryFile;
  const row = (over: Partial<AtemiRow> = {}): AtemiRow => ({
    hits: 2,
    damageRatio: 50,
    recoverRatio: 50,
    gaugeRatio: 50,
    ...over,
  });

  it("takes the hit count from the table where the dump ships one", () => {
    expect(armorHits(withTable({ 1: row({ hits: 3 }) }), window(1))).toBe(3);
  });

  it("falls back to the count FAT published, per ADR-0039, where there is no table", () => {
    // Every tree has the table since ADR-0045 re-pinned the dump onto a live one,
    // so the fallback is for a tree extracted from a dump that predates MMDK's
    // atemi button. Synthesised, because nothing on disk is that any more.
    const { atemi: _dropped, ...noTable } = geo;
    expect(armorHits(noTable as GeometryFile, window(1))).toBe(2);
    expect(armorHits(noTable as GeometryFile, window(4))).toBeUndefined();
    // And with the table, the row wins over the map.
    expect(geo.atemi).toBeDefined();
    expect(armorHits(geo, window(1))).toBe(2);
  });

  it("lets a fighter's own row win, which is why the index alone means nothing", () => {
    // Luke, Marisa and Zangief carry their own table, in the same index space
    // as the common one. Same index, different armor.
    const own = atemiRow(withTable({ 7: row({ hits: 1, damageRatio: 0 }) }), window(7));
    expect(own).toEqual(row({ hits: 1, damageRatio: 0 }));
  });

  it("halves an absorbed hit and makes half of what is left grey", () => {
    expect(armorDamage(row(), 800)).toEqual({ damage: 400, grey: 200 });
    // A row that takes no damage takes none, and there is nothing to recover.
    expect(armorDamage(row({ damageRatio: 0, recoverRatio: 0 }), 800)).toEqual({ damage: 0, grey: 0 });
    // No table is ADR-0037's behaviour: the whole number, and no grey health.
    expect(armorDamage(undefined, 800)).toEqual({ damage: 800, grey: 0 });
  });
});

/**
 * The shared rect tables. See ADR-0046.
 *
 * `common_rects.json` is dumped once for the roster and sits behind every
 * fighter's own tables. The one box the project needed from it for two years is
 * pushbox `BoxNo` 6, which every fighter's knockdown and tech actions reference
 * and no fighter's own tables carry.
 */
describe("the downed pushbox", () => {
  const DOWNED = /^BAS_(DN_STD|TECH_(FN|BR))_(AO|UT)$/;

  it("resolves BoxNo 6 for every fighter that has a knockdown", () => {
    const widths = new Map<string, number>();
    for (const name of listCharacters()) {
      const g = loadGeometry(requireCharacter(name).id);
      if (!g) continue;
      const keys = g.actions
        .filter((a) => DOWNED.test(a.name))
        .flatMap((a) => a.push.filter((p) => p.boxNo === 6));
      expect(keys.length).toBeGreaterThan(0);
      // One box per fighter, whichever table it came from.
      expect(new Set(keys.map((k) => k.box.width)).size).toBe(1);
      widths.set(g.character, keys[0]!.box.width);
    }
    expect(widths.size).toBe(24);
    // Twenty take the shared 70-wide default; the four who override it are the
    // four widest bodies in the game, which is the evidence that the shared
    // table is a default and the fighter's own table wins. See ADR-0046.
    const own = [...widths].filter(([, w]) => w !== 70).map(([c]) => c);
    expect(own.sort()).toEqual(["Blanka", "E.Honda", "Marisa", "Zangief"]);
    for (const c of own) expect(widths.get(c)!).toBeGreaterThan(70);
  });

  it("does not let a shared box displace a fighter's own", () => {
    // Ryu's standing pushbox is his own +/-33, not the shared +/-35. The fallback
    // is consulted only after every one of the fighter's own lists.
    const stand = geo.actions.find((a) => a.name === "BAS_STD_Loop")!;
    expect(stand.push[0]!.box.x).toBe(-33);
    expect(stand.push[0]!.box.width).toBe(66);
  });
});

/**
 * The figure derived from the boxes. See ADR-0049.
 *
 * `poseOf` takes only a fighter's `state` and position, so the derivation is
 * tested against a stub rather than through a match: what is under test is the
 * geometry read, not the state machine.
 */
describe("a pose derived from the boxes", () => {
  const named = (name: string) => geo.actions.find((a) => a.name === name)!;
  const stub = (action: GeometryAction, frame: number, facing: 1 | -1 = 1) =>
    ({ state: { action, frame, facing }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;
  const radius = headRadius(geo);

  it("takes the head's size from the idle pose and keeps it", () => {
    // The head hurtbox grows to cover a lean, so a skull sized to the current box
    // balloons over the torso exactly when the fighter attacks.
    const idle = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
    const punching = poseOf(stub(named("ATK_5HP"), 13), radius);
    expect(idle.head!.r).toBe(radius);
    expect(punching.head!.r).toBe(radius);
    expect(radius).toBeGreaterThan(8);
  });

  it("draws the active hitbox as the limb, and knows a kick from a punch", () => {
    const punch = poseOf(stub(named("ATK_5HP"), 13), radius);
    expect(punch.limbs).toHaveLength(1);
    expect(punch.limbs[0]!.kick).toBe(false);
    // Rooted at the shoulder, reaching the hitbox's far edge.
    expect(punch.limbs[0]!.root.y).toBeGreaterThan(punch.hips.y);
    expect(punch.limbs[0]!.tip.x).toBeGreaterThan(punch.neck.x);

    // A mid-height kick is still a kick: the action's own name says so, which is
    // why height alone is not the rule.
    const kick = poseOf(stub(named("ATK_5MK"), 10), radius);
    expect(kick.limbs[0]!.kick).toBe(true);
    expect(kick.limbs[0]!.root).toEqual(kick.hips);
  });

  it("bends a limb at a joint below the straight line, so a kick is not a beam", () => {
    // A limb drawn root-to-tip as one line reads as a laser fired through the
    // opponent: Ryu's roundhouse ran from his hip, across his own torso, to a
    // hitbox at head height. The joint is the knee.
    const kick = poseOf(stub(named("ATK_5HK"), 13), radius);
    const limb = kick.limbs[0]!;
    const straight = {
      x: (limb.root.x + limb.tip.x) / 2,
      y: (limb.root.y + limb.tip.y) / 2,
    };
    expect(limb.joint.y).toBeLessThan(straight.y);
    // On the limb, not off in space: the bend is a fraction of its own length.
    const length = Math.hypot(limb.tip.x - limb.root.x, limb.tip.y - limb.root.y);
    expect(Math.hypot(limb.joint.x - straight.x, limb.joint.y - straight.y)).toBeLessThan(length * 0.3);
  });

  it("holds a part whose hurtbox has gone, because that means invulnerable", () => {
    // ADR-0020: full invulnerability *is* the absence of a hurtbox. A rising
    // Shoryuken has no head or body box at all, and a figure that dropped them
    // would lose its torso on exactly the frames that matter.
    const rising = named("SPA_SYORYU_START(2)");
    const before = poseOf(stub(rising, 8), radius);
    const during = poseOf(stub(rising, 14), radius, before);
    expect(before.faded).toEqual({ head: false, body: false, leg: false });
    // Head and leg *keys* gone, body box still there and carried upward: the
    // figure rises with the move, and the parts with no key of their own are
    // held over from the last frame that had them rather than dropped — at their
    // distance below the torso, so the whole figure leaves the ground together.
    // Only the head reads as invulnerable, though: the body box covers where the
    // legs are drawn, and the hit test merges the keys, so a leg inside the body
    // box is hittable however it was tagged.
    expect(during.faded).toEqual({ head: true, body: false, leg: false });
    expect(during.head).not.toBeNull();
    expect(during.legs).toHaveLength(before.legs.length);
    expect(during.legs[0]!.tip.y).toBeGreaterThan(before.legs[0]!.tip.y + 100);
    expect(during.neck.y).toBeGreaterThan(before.neck.y + 100);
    // The stance is held at its *distance* below the hips, not at an absolute
    // height — but the action states itself airborne from frame 9 (`stance` 3),
    // so ADR-0059's tuck draws the legs in as well. Held over and then tucked:
    // still under the hips, still symmetric about the axis, and narrower and
    // shorter than the grounded stance rather than unchanged.
    const span = (p: Pose): number => Math.abs(p.legs[1]!.tip.x - p.legs[0]!.tip.x);
    expect(during.legs[0]!.tip.x + during.legs[1]!.tip.x).toBeCloseTo(2 * during.hips.x, 5);
    expect(span(during)).toBeLessThan(span(before));
    const drop = (p: Pose): number => p.hips.y - p.legs[0]!.tip.y;
    expect(drop(during)).toBeGreaterThan(drop(before) * 0.6);
    expect(drop(during)).toBeLessThanOrEqual(drop(before));
  });

  it("hangs the body on the pushbox axis, not on the drifting hurtbox unions", () => {
    // Issue 06. On 5LK the extended leg carries its own hurtbox, so the leg union
    // is 174 wide centred 47 units forward while the pushbox stays 66 wide at 0.
    // Read from that union the hips slide forward mid-move and the feet splay.
    const lk = named("ATK_5LK");
    const frames = [1, 3, 5, 8, 12, 16].map((f) => poseOf(stub(lk, f), radius));
    for (const p of frames) {
      expect(p.hips.x).toBe(0);
      expect(p.neck.x).toBe(0);
      expect(p.head!.x).toBe(0);
      // The standing foot inset on the pushbox's half-width, not the leg
      // union's. ADR-0060 widened the inset from 0.48 of the half-width to 0.78:
      // the old stance was 32 units on a fighter 166 tall and the two legs came
      // out of one hip point, so they drew as one thick zigzag rather than as a
      // pair. The foot is still on the pushbox and still symmetric about it.
      expect(p.legs[0]!.tip.x).toBeCloseTo(-25.74, 5);
      expect(p.legs[0]!.derived).toBe(false);
      expect(p.hips.y).toBe(frames[0]!.hips.y);
      expect(p.neck.y).toBe(frames[0]!.neck.y);
    }
    // The kick still reaches: only the body stopped moving with it.
    expect(frames[2]!.limbs.some((l) => l.tip.x > 100)).toBe(true);
    // And on the wind-up, before any hitbox is live, the leading leg is read off
    // the leg hurtbox out past the footprint rather than left in the stance.
    expect(frames[1]!.limbs).toEqual([]);
    expect(frames[1]!.legs[1]!.derived).toBe(true);
    expect(frames[1]!.legs[1]!.tip.x).toBeGreaterThan(60);
    expect(frames[1]!.legs[0]!.tip.x).toBeCloseTo(-25.74, 5);
  });

  it("holds a part at its distance from the one above, not at an absolute height", () => {
    // A jump keeps only its body box. Hips pinned to the height they last had
    // stay on the floor while the torso climbs three hundred units away.
    const air = named("BAS_JUMP_N_AIR");
    const grounded = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
    const spine = grounded.neck.y - grounded.hips.y;
    let last = grounded;
    for (const f of [1, 5, 10, 16]) last = poseOf(stub(air, f), radius, last);
    // The head is the only part nothing reaches — measured across the roster, a
    // body box covers the shin on 28,857 of the 38,165 frames with no leg key,
    // and the skull on 90 of 41,998 with no head key.
    expect(last.faded).toEqual({ head: true, body: false, leg: false });
    expect(last.neck.y - last.hips.y).toBeCloseTo(spine, 5);
    expect(last.hips.y).toBeGreaterThan(grounded.hips.y + 200);
  });

  it("does not let a box tagged to every part decide which part it is", () => {
    // Akuma's air fireball hangs one 80x120 box off head, body *and* leg at once.
    // Believed, it put the hips level with the neck and stood him on stilts.
    const akuma = loadGeometry("akuma")!;
    const zanku = akuma.actions.find((a) => a.name === "SPA_ZANKU_L")!;
    const p = poseOf(stub(zanku, 1), headRadius(akuma));
    expect(p.neck.y).toBeGreaterThan(p.hips.y + 20);
    expect(p.hips.y).toBeGreaterThan(p.legs[0]!.tip.y + 20);
    // The skull sits *on* the neck — its centre above it, its underside allowed
    // to overlap the shoulders rather than float clear of them.
    expect(p.head!.y).toBeGreaterThan(p.neck.y);
    expect(p.head!.y - p.neck.y).toBeLessThan(p.head!.r * 1.6);
  });

  it("holds a part whose every box is out on a limb, rather than merging them", () => {
    // Dee Jay's sweep tags both its leg boxes to the sweeping leg, 70 units in
    // front of a 66-wide pushbox. Falling back to their union drew his legs as a
    // tent above his head.
    const deejay = loadGeometry("deejay")!;
    const sweep = deejay.actions.find((a) => a.name === "ATK_2HK")!;
    const r = headRadius(deejay);
    const before = poseOf(stub(sweep, 1), r);
    const during = poseOf(stub(sweep, 20), r, before);
    expect(during.neck.y).toBeGreaterThan(during.hips.y);
    expect(during.hips.y).toBeGreaterThan(during.legs[0]!.tip.y);
    // The leg keys are live, so this is not invulnerability — just no body in them.
    expect(during.faded.leg).toBe(false);
  });

  it("hangs the figure upside down when the boxes are", () => {
    // Blanka's 5MK is a flip: the head key sits on the floor and the leg key at
    // 166. Only twelve actions on the roster do it, and all of them are somersaults.
    const blanka = loadGeometry("blanka")!;
    const flip = blanka.actions.find((a) => a.name === "ATK_5MK")!;
    const p = poseOf(stub(flip, 4), headRadius(blanka));
    expect(p.head!.y).toBeLessThan(p.hips.y);
    expect(p.legs[0]!.tip.y).toBeGreaterThan(p.hips.y);
  });

  it("reads an extended limb off the hurtbox the footprint filter isolates", () => {
    // The boxes out past the footprint are the only thing in the dump that says
    // where an arm or a leg is (ADR-0050 measured them and threw them away). The
    // part the box was tagged to is what names the limb: Dhalsim's 5HP hangs its
    // reaching arm off the *body* key, so the arm goes where the box is and both
    // legs stay in the stance.
    const dhalsim = loadGeometry("dhalsim")!;
    const reach = dhalsim.actions.find((a) => a.name === "ATK_5HP")!;
    const rd = headRadius(dhalsim);
    let p = poseOf(stub(reach, 1), rd);
    // Frame 1 is the stance: nothing is out past the footprint yet, so every
    // limb is the invented resting pose.
    expect(p.arms.every((l) => !l.derived)).toBe(true);
    expect(p.legs.every((l) => !l.derived)).toBe(true);
    for (let f = 1; f <= 30; f++) p = poseOf(stub(reach, f), rd, p);
    const out = p.arms.find((l) => l.derived)!;
    expect(out).toBeDefined();
    expect(out.tip.x).toBeGreaterThan(p.neck.x + 100);
    // Only one of the pair: the boxes are 2D and cannot tell a near arm from a
    // far one, so the other keeps the resting pose.
    expect(p.arms.filter((l) => l.derived)).toHaveLength(1);
    // And the elbow is off the straight line, so the arm is not a beam.
    expect(Math.abs(out.joint.y - (out.root.y + out.tip.y) / 2)).toBeGreaterThan(1);
  });

  it("invents the whole stance when no box is out past the footprint", () => {
    // Which is most of the time. Across the roster only 9.2% of 456,993 frames
    // carry one — 19.4% of `ATK_*`, 0.4% of `BAS_*` and none at all of the 646
    // reaction actions, whose boxes ADR-0057 measured as frozen for the whole
    // duration. On those the arms and legs are this project's invention, and
    // `derived` is what says so.
    for (const name of ["BAS_STD_Loop", "BAS_CRH_Loop", "DMG_MH"]) {
      const p = poseOf(stub(named(name), 1), radius);
      expect([...p.arms, ...p.legs].map((l) => l.derived)).toEqual([false, false, false, false]);
    }
    // Invented is not absent: a figure still has two of each.
    const idle = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
    expect(idle.arms).toHaveLength(2);
    expect(idle.legs).toHaveLength(2);
    expect(idle.arms[0]!.root.x).toBeLessThan(idle.neck.x);
    expect(idle.arms[1]!.root.x).toBeGreaterThan(idle.neck.x);
  });

  it("does not draw a hitbox as a limb when no hurtbox reaches it", () => {
    // A.K.I.'s EX snake is a 524-wide hitbox on an action with no hurtbox at all.
    // The rule that the attacking limb *is* the hitbox drew it as a 563-unit arm
    // out of a man who was not there. A limb is a body part, and a body part is
    // hittable — Dhalsim's arm carries hurtboxes the whole way out.
    const aki = loadGeometry("aki")!;
    const snake = aki.actions.find((a) => a.name === "SPA_Jatoben_EX_END")!;
    expect(hitboxesAt(snake, 13).length).toBeGreaterThan(0);
    expect(poseOf(stub(snake, 13), headRadius(aki)).limbs).toEqual([]);

    // The long arm that does carry hurtboxes is still an arm.
    const dhalsim = loadGeometry("dhalsim")!;
    const reach = dhalsim.actions.find((a) => a.name === "ATK_5HP")!;
    const rd = headRadius(dhalsim);
    let held = poseOf(stub(reach, 1), rd);
    let drawn = false;
    for (let f = 1; f <= 30; f++) {
      held = poseOf(stub(reach, f), rd, held);
      if (held.limbs.length) drawn = true;
    }
    expect(drawn).toBe(true);
  });

  it("holds the footprint through a frame that has no pushbox", () => {
    // The axis is the pushbox's centre, and it is not always centred on the
    // fighter. Snapping to the fighter's own x on a frame that has no pushbox
    // teleported the whole figure sideways and back.
    const aki = loadGeometry("aki")!;
    const r = headRadius(aki);
    let checked = 0;
    for (const action of aki.actions) {
      if (!action.hurt.length) continue;
      const end = Math.min(60, Math.max(...action.hurt.map((h) => h.end ?? h.start ?? 1)));
      let last = poseOf(stub(action, 1), r);
      for (let f = 2; f <= end; f++) {
        const had = pushboxesAt(action, f - 1).length > 0;
        const has = pushboxesAt(action, f).length > 0;
        const p = poseOf(stub(action, f), r, last);
        if (had && !has) {
          expect(p.hips.x).toBeCloseTo(last.hips.x, 5);
          checked++;
        }
        last = p;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("frames one action's own bounds, travel included", () => {
    // The box viewer's camera. It has to hold still while the frame is scrubbed,
    // so the bounds are the action's and not the frame's — and a move that steps
    // in sweeps its boxes forward with it.
    const dash = geo.actions.find((a) => a.name === "ATK_2MK_Y2")!;
    const bounds = boundsOf(dash);
    const travel = dash.motion?.travel;
    expect(bounds.maxX).toBeGreaterThanOrEqual(160);
    if (travel?.maxX) expect(bounds.maxX).toBeGreaterThan(travel.maxX);

    const view = viewForAction({ width: 1200, height: 620 }, bounds);
    // The ground is pinned and the content fits inside the padding.
    expect(view.y(0)).toBe(view.ground);
    expect(view.x(bounds.minX)).toBeGreaterThanOrEqual(0);
    expect(view.x(bounds.maxX)).toBeLessThanOrEqual(1200);
    expect(view.y(bounds.maxY)).toBeGreaterThanOrEqual(0);
  });

  it("mirrors with the fighter", () => {
    const right = poseOf(stub(named("ATK_5HP"), 13), radius, undefined);
    const left = poseOf(stub(named("ATK_5HP"), 13, -1), radius, undefined);
    expect(left.limbs[0]!.tip.x).toBeCloseTo(-right.limbs[0]!.tip.x, 5);
  });

  it("cannot find a recoil in the boxes, so it leans the figure instead", () => {
    // The measurement behind ADR-0057's one invented thing: every reaction
    // action on this fighter holds *one* hurtbox layout for its whole duration,
    // while its attacks move theirs frame to frame. The flinch is in the
    // animation clip, and MMDK dumps clip names, not bones.
    const layouts = (action: GeometryAction) =>
      new Set(
        Array.from({ length: Math.min(action.frames ?? 20, 24) }, (_, i) =>
          JSON.stringify(hurtPartsAt(action, i + 1)),
        ),
      ).size;
    const reactions = geo.actions.filter((a) => /^(DMG|GRD)_/.test(a.name) && a.hurt.length);
    expect(reactions.length).toBeGreaterThan(10);
    expect(reactions.every((a) => layouts(a) === 1)).toBe(true);
    expect(geo.actions.filter((a) => /^ATK_/.test(a.name) && a.hurt.length && layouts(a) > 1).length).toBeGreaterThan(20);

    // So the lean is drawn on: pivoting at the hips, feet planted.
    const pose = poseOf(stub(named("DMG_MH"), 4), radius);
    const back = recoiled(pose, 1, -1);
    expect(recoiled(pose, 0, -1)).toBe(pose);
    expect(back.hips).toEqual(pose.hips);
    expect(back.legs).toEqual(pose.legs);
    expect(back.neck.x).toBeLessThan(pose.neck.x);
    // The head carries further than the chest — the whiplash.
    expect(back.head!.x).toBeLessThan(back.neck.x);
    // Leaning is not shrinking: the spine keeps its length.
    const spine = (p: typeof pose) => Math.hypot(p.neck.x - p.hips.x, p.neck.y - p.hips.y);
    expect(spine(back)).toBeCloseTo(spine(pose), 6);
  });

  /**
   * The invented pose, and the three things in the dump it is keyed to.
   *
   * 90.8% of frames carry no extended-limb hurtbox (ADR-0058), so on almost all
   * of them the arms and legs are invention. ADR-0059 verified there is no pose
   * data anywhere in the dump to replace it with, and keyed the invention to what
   * *is* there: `motion.x`, `motion.y` and `PlData.Physique`.
   */
  describe("the invented pose, keyed to what the dump does say", () => {
    it("labels a jumping normal airborne and a crouching one crouching", () => {
      // `StatusKey.PoseStatus`, which the extractor threw away until ADR-0059.
      expect(stanceAt(named("ATK_8HK"), 1)).toBe(3);
      expect(stanceAt(named("ATK_2HK"), 1)).toBe(2);
      expect(stanceAt(named("ATK_5HK"), 1)).toBe(1);
      // The idle and the walk state no stance at all — 4,120 actions do not.
      expect(stanceAt(named("BAS_FORWARD_Loop"), 1)).toBeNull();
    });

    it("ranks the roster by the only proportions the dump carries", () => {
      // The idle hurtbox stack is 166 tall on 21 of the 24, so nothing else tells
      // Lily from Zangief. `Physique` does, and it agrees with how they look.
      const arm = (id: string) => buildOf(loadGeometry(id)!).arm;
      expect(arm("blanka")).toBeGreaterThan(arm("zangief"));
      expect(arm("zangief")).toBeGreaterThan(arm("ryu"));
      expect(arm("ryu")).toBeGreaterThan(arm("chunli"));
      // A ratio against the roster median, so the middle of the roster is ~1.
      expect(arm("ryu")).toBeCloseTo(1, 1);
      expect(buildOf(loadGeometry("chunli")!).leg).toBeGreaterThan(buildOf(loadGeometry("zangief")!).leg);
    });

    it("steps the walk off the ground it covers, not off a frame counter", () => {
      // `BAS_FORWARD_Loop` moves no hurtbox on any of its 114 frames, so the
      // figure held one pose. `motion.x` is the only thing in the action that
      // changes, and it is per-fighter: Ryu 4.7 units a frame, Dhalsim 2.8.
      const walk = named("BAS_FORWARD_Loop");
      const feet = (f: number): number[] => {
        let p = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
        for (let n = 1; n <= f; n++) p = poseOf(stub(walk, n), radius, p);
        return p.legs.map((l) => l.tip.x);
      };
      const start = feet(1);
      expect(feet(6)).not.toEqual(start);
      // The legs swap over: one stride is half the cycle.
      const spread = (xs: number[]) => xs[1]! - xs[0]!;
      const stride = walk.motion!.travel.x / Math.round(Math.abs(walk.motion!.travel.x) / (149 * 0.42));
      const step = Math.round(Math.abs(stride) / 4.7);
      expect(Math.sign(spread(feet(1 + step)))).not.toBe(Math.sign(spread(start)));
    });

    it("gives a slow walker a slower gait at the same frame", () => {
      // The cadence is a property of the fighter, not of the animation's length.
      const gait = (id: string): number => {
        const g = loadGeometry(id)!;
        const walk = g.actions.find((a) => a.name === "BAS_FORWARD_Loop")!;
        const r = headRadius(g), b = buildOf(g);
        const at = (f: number) =>
          ({ state: { action: walk, frame: f, facing: 1 as const }, position: () => ({ x: 0, y: 0 }) }) as unknown as Fighter;
        let p = poseOf(at(1), r, undefined, b);
        for (let n = 1; n <= 8; n++) p = poseOf(at(n), r, p, b);
        return Math.abs(p.legs[1]!.tip.x - p.legs[0]!.tip.x);
      };
      // Eight frames in, Akuma (5.2 a frame) is further through his stride than
      // Dhalsim (2.8), so his feet have closed further from the opening spread.
      expect(gait("akuma")).toBeLessThan(gait("dhalsim"));
    });

    it("tucks the legs at the top of a jump and puts them down for the landing", () => {
      // Keyed to `motion.y`: a neutral jump carries only a body box the whole way
      // up, so nothing in the hurtboxes says a jump is happening at all.
      const jump = named("BAS_JUMP_N_AIR");
      const drop = (f: number): number => {
        let p = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
        for (let n = 1; n <= f; n++) p = poseOf(stub(jump, n), radius, p);
        return p.hips.y - p.legs[0]!.tip.y;
      };
      const apex = jump.motion!.y!.indexOf(Math.max(...jump.motion!.y!)) + 1;
      expect(drop(apex)).toBeLessThan(drop(3));
      expect(drop(jump.motion!.y!.length - 2)).toBeGreaterThan(drop(apex));
    });

    it("does not let the tuck feed itself through the held-over stance", () => {
      // The jump has no leg box, so the stance is held at the last frame's
      // hip-to-foot distance. Reading that back off the *drawn* foot compounded
      // the tuck and wound the legs into nothing; `Pose.stand` is the untucked
      // distance, kept so the invention cannot eat itself.
      const jump = named("BAS_JUMP_N_AIR");
      let p = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
      const standing = p.stand;
      for (let n = 1; n < jump.motion!.y!.length; n++) {
        p = poseOf(stub(jump, n), radius, p);
        expect(p.stand).toBeCloseTo(standing, 6);
      }
    });

    it("puts the pelvis at half stature, not on the top of the leg hurtbox", () => {
      // ADR-0060. The leg/body hurtbox boundary is 54 of Ryu's 166-unit stack
      // standing and 41 of 119 crouching — 32.5% and 34.5%, the same fraction of
      // a smaller body, which is what a hit-height convention does and not what a
      // hip joint does. Read as a hip it drew a tower of torso on two stumps.
      const stack = 166;
      const p = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
      const hip = p.hips.y - p.legs[0]!.tip.y;
      expect(hip / stack).toBeGreaterThan(0.5);
      expect(hip / stack).toBeLessThan(0.56);
      // The pelvis is inside the *body* box (54-138), which is what makes it
      // honest to draw there: the thigh above the leg key is still hittable.
      expect(p.hips.y).toBeGreaterThan(54);
      expect(p.hips.y).toBeLessThan(138);
      // Crouching, the same rule folds the hips down with the neck.
      const crouch = poseOf(stub(named("BAS_CRH_Loop"), 1), radius);
      expect(crouch.hips.y).toBeLessThan(p.hips.y * 0.75);
      // The legs are rooted on a pelvis rather than on one point.
      expect(p.legs[0]!.root.x).toBeLessThan(p.hips.x);
      expect(p.legs[1]!.root.x).toBeGreaterThan(p.hips.x);
      expect(p.arms[0]!.root.x).toBeLessThan(p.legs[0]!.root.x);
    });

    it("cages an invented hand or foot inside the fighter's own hurtboxes", () => {
      // This is a training room, so what is drawn has to be hittable. A limb the
      // boxes place is on a box already; an invented one is placed by a
      // proportion, and a proportion put a resting hand or a striding foot
      // outside every live hurtbox on 102,831 of 1,344,077 limb-frames across the
      // roster (7.7%), by as much as 52 units. Caged it is 283 (0.02%), all of
      // them frames whose every box is out on a limb so there is no cage to use.
      for (const name of ["BAS_STD_Loop", "BAS_FORWARD_Loop", "5010_GRD_STD_Loop", "0010_DMG_HL_ST"]) {
        const action = named(name);
        let p = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
        for (let f = 1; f <= 20; f++) {
          p = poseOf(stub(action, f), radius, p);
          const live = hurtboxesAt(action, f);
          if (!live.length) continue;
          const lo = Math.min(...live.map((b) => b.x));
          const hi = Math.max(...live.map((b) => b.x + b.width));
          for (const limb of [...p.arms, ...p.legs].filter((l) => !l.derived)) {
            expect(limb.tip.x).toBeGreaterThanOrEqual(lo - 0.5);
            expect(limb.tip.x).toBeLessThanOrEqual(hi + 0.5);
          }
        }
      }
    });

    it("carries the arms differently guarding, recoiling and standing", () => {
      // The three cases the dump distinguishes and ADR-0058 drew identically.
      const hands = (name: string, f: number): number[] => {
        const idle = poseOf(stub(named("BAS_STD_Loop"), 1), radius);
        let p = idle;
        for (let n = 1; n <= f; n++) p = poseOf(stub(named(name), n), radius, p);
        return p.arms.map((l) => l.tip.x);
      };
      const idle = hands("BAS_STD_Loop", 1);
      // Idle: a hand on each side of the axis.
      expect(Math.min(...idle)).toBeLessThan(0);
      expect(Math.max(...idle)).toBeGreaterThan(0);
      // Guarding: both hands in front, between the fighter and the opponent.
      expect(Math.min(...hands("5000_GRD_STD_START", 3))).toBeGreaterThan(0);
      // Struck: both hands behind, thrown away from the opponent.
      expect(Math.max(...hands("0010_DMG_HL_ST", 4))).toBeLessThan(0);
      // And they are two arms, not one. ADR-0059 sent both hands the same way
      // with a 7% vertical nudge between them, so a guard and a reaction each
      // drew one arm and a smear on top of it; ADR-0060 gives the lead and the
      // rear arm their own offsets. A head's radius apart is the bar.
      for (const name of ["BAS_STD_Loop", "5000_GRD_STD_START", "0010_DMG_HL_ST"]) {
        const p = poseOf(stub(named(name), 3), radius);
        const [a, b] = p.arms;
        expect(Math.hypot(a!.tip.x - b!.tip.x, a!.tip.y - b!.tip.y)).toBeGreaterThan(radius);
      }
    });
  });

  /**
   * The stage camera. See ADR-0057: it used to frame a fixed 330 units of sky
   * whatever was happening, which on a wide canvas spent nearly half the frame
   * on air nobody was in.
   */
  describe("the camera that follows the action", () => {
    const canvas = { clientWidth: 1140, clientHeight: 820 };

    it("keeps both fighters and the ground in frame", () => {
      const view = viewFor(canvas, [-110, 110], 700, CAMERA_FLOOR);
      expect(view.y(0)).toBe(view.ground);
      for (const x of [-110, 110]) {
        expect(view.x(x)).toBeGreaterThan(0);
        expect(view.x(x)).toBeLessThan(canvas.clientWidth);
      }
      // The band it was asked for fits above the floor.
      expect(view.y(CAMERA_FLOOR)).toBeGreaterThanOrEqual(0);
    });

    it("zooms out as the fighters separate, and in as they close", () => {
      const near = viewFor(canvas, [-60, 60], 700, CAMERA_FLOOR);
      const far = viewFor(canvas, [-500, 500], 700, CAMERA_FLOOR);
      expect(far.scale).toBeLessThan(near.scale);
    });

    it("opens for a jump at once and closes behind it slowly", () => {
      const camera = new Camera();
      expect(camera.follow(120)).toBe(CAMERA_FLOOR);
      const open = camera.follow(400);
      expect(open).toBeGreaterThan(CAMERA_FLOOR * 2);
      // Landing does not snap the zoom back: that reads as a cut, not a camera.
      const next = camera.follow(120);
      expect(next).toBeLessThan(open);
      expect(next).toBeGreaterThan(open * 0.9);
    });

    it("shakes only while the hitstop runs, and the same way twice", () => {
      expect(shakeAt(0, 40)).toEqual({ x: 0, y: 0 });
      const a = shakeAt(9, 40, 900);
      // The frame stepper draws a frame more than once and must get one picture.
      expect(shakeAt(9, 40, 900)).toEqual(a);
      expect(Math.hypot(a.x, a.y)).toBeGreaterThan(0);
      expect(Math.abs(a.x)).toBeLessThanOrEqual(13);
      // A jab does not shake the screen as hard as a Super.
      expect(Math.abs(shakeAt(9, 40, 200).x)).toBeLessThan(Math.abs(shakeAt(9, 40, 4000).x));
    });
  });

  /**
   * The stage. See ADR-0062: everything it drew used to be a full-width
   * horizontal band, so the picture was identical at every camera position and
   * differed only in size at every zoom — a walk moved nothing and a zoom looked
   * like the fighters being resized.
   *
   * This is the whole reason {@link Ctx} is a structural interface: a fake is
   * five lines and it records what was asked for.
   */
  describe("the stage the camera moves over", () => {
    const canvas = { clientWidth: 1140, clientHeight: 820 };

    /** Records every call, in order. Nothing here needs a canvas. */
    const recorder = (): { ops: string[]; ctx: Ctx } => {
      const ops: string[] = [];
      const ctx = {
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        globalAlpha: 1,
        font: "",
        textAlign: "",
        beginPath: () => ops.push("begin"),
        moveTo: (x: number, y: number) => ops.push(`move ${x.toFixed(2)} ${y.toFixed(2)}`),
        lineTo: (x: number, y: number) => ops.push(`line ${x.toFixed(2)} ${y.toFixed(2)}`),
        arc: () => ops.push("arc"),
        stroke: () => ops.push("stroke"),
        fillRect: (x: number, y: number, w: number, h: number) =>
          ops.push(`rect ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`),
        strokeRect: () => ops.push("strokeRect"),
        setLineDash: () => ops.push("dash"),
        fillText: () => ops.push("text"),
      };
      return { ops, ctx };
    };

    const painted = (positions: [number, number], band: number): string[] => {
      const r = recorder();
      drawStage(r.ctx, viewFor(canvas, positions, 765, band), 765);
      return r.ops;
    };

    it("is a different picture from a different place on the same stage", () => {
      // Same separation, so the same zoom: only the camera has moved.
      const here = painted([-110, 110], CAMERA_FLOOR);
      const there = painted([-30, 190], CAMERA_FLOOR);
      expect(there.length).toBeGreaterThan(0);
      expect(there).not.toEqual(here);
      // Not a token difference either: most of what is drawn has moved.
      const same = there.filter((op, i) => op === here[i]).length;
      expect(same / here.length).toBeLessThan(0.5);
    });

    it("moves its layers at different rates, which is what makes a walk read", () => {
      // Rects are grouped between the two cameras by their shape — height,
      // width and how tall they are — and matched in order across x, so the
      // shift each layer took can be read off. A shift only counts if two rects
      // agree on it, which throws away the ones that scrolled off an edge.
      const shapes = (positions: [number, number]): Map<string, number[]> => {
        const by = new Map<string, number[]>();
        for (const op of painted(positions, CAMERA_FLOOR)) {
          if (!op.startsWith("rect")) continue;
          const [, x, ...rest] = op.split(" ");
          const key = rest.join(" ");
          by.set(key, [...(by.get(key) ?? []), Number(x)]);
        }
        for (const xs of by.values()) xs.sort((a, b) => a - b);
        return by;
      };
      const here = shapes([-110, 110]);
      const tally = new Map<number, number>();
      for (const [key, xs] of shapes([-190, 30])) {
        const was = here.get(key);
        if (!was || was.length !== xs.length) continue;
        for (const [i, x] of xs.entries()) {
          const dx = Math.round(Math.abs(x - was[i]!));
          if (dx > 0) tally.set(dx, (tally.get(dx) ?? 0) + 1);
        }
      }
      // One rate is a picture sliding; no rate at all is the treadmill ADR-0057
      // left behind. Three is parallax.
      expect([...tally.values()].filter((n) => n >= 2).length).toBeGreaterThan(2);
    });

    it("puts its horizon somewhere else at a different zoom, from the same place", () => {
      // The full-width bands are the ones that used to come off `ground` and
      // `height` alone — the canvas's numbers, not the camera's — so they were
      // in the same place at every zoom. They are anchored on the horizon now,
      // and the horizon is `EYE * scale` above a pinned floor.
      const bands = (band: number): string =>
        painted([-110, 110], band)
          .filter((op) => op.startsWith("rect") && op.endsWith(` ${canvas.clientWidth.toFixed(2)} 1.00`))
          .map((op) => op.split(" ")[2])
          .join(",");
      expect(bands(520)).not.toEqual(bands(CAMERA_FLOOR));
    });

    it("draws its distance marks at every zoom the camera reaches", () => {
      // They are how spacing is read, so "legible" starts with "drawn at all":
      // one 100-unit mark per 100 units of visible stage, at the floor line.
      for (const [positions, band] of [
        [[-33, 33], CAMERA_FLOOR],
        [[-110, 110], CAMERA_FLOOR],
        [[-110, 110], 520],
        [[-750, 750], 520],
      ] as [[number, number], number][]) {
        const view = viewFor(canvas, positions, 765, band);
        const marks = painted(positions, band).filter((op) => {
          const [, , y, w] = op.split(" ");
          return op.startsWith("rect") && Number(y) >= view.ground && Number(y) <= view.ground + 6 && Number(w) <= 2;
        });
        expect(marks.length).toBeGreaterThan(1);
      }
    });
  });
});
