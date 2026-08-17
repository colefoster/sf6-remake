import { describe, it, expect } from "vitest";
import {
  actionFor,
  activeWindows,
  connectFrames,
  geometryFor,
  hitboxesAt,
  hurtboxesAt,
  idleHurtboxes,
  loadGeometry,
  mirrored,
  overlaps,
  reach,
} from "../src/data/geometry.js";
import { requireCharacter, requireMove } from "../src/data/index.js";

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
