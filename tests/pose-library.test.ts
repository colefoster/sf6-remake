import { describe, it, expect } from "vitest";

import { actionByName, activeWindows } from "../src/data/geometry.js";
import { loadGeometry } from "../src/data/load-geometry.js";
import { loadPose, authoredMoves } from "../src/data/load-poses.js";
import {
  authoredPoseOf,
  clockOf,
  overreach,
  resolveAnchor,
  resolveKeys,
  sampleAuthored,
  type PoseFile,
} from "../src/game/pose-library.js";
import { buildOf, headRadius, type Posed } from "../src/game/render.js";

/**
 * The authored pose library (ADR-0067).
 *
 * Two things are being pinned. The **clock** — an anchor lands on the frame the
 * action's own frame data names, and `contact` lands exactly on the first active
 * frame, because the hitstop plays over it. And the **honesty** — every limb an
 * authored file produces reports `derived: false`, because nothing in it was
 * read off a box.
 */

const ryu = loadGeometry("ryu")!;
const zangief = loadGeometry("zangief")!;
const kick = actionByName(ryu, "ATK_2MK_Y2")!;
const file = loadPose("ryu", "2MK")!;

const posed = (action = kick, frame = 1, facing: 1 | -1 = 1, x = 0): Posed => ({
  state: { action, frame, facing },
  position: () => ({ x, y: 0 }),
});

const drawn = (frame: number, facing: 1 | -1 = 1, x = 0, geo = ryu, action = kick) =>
  authoredPoseOf(file, posed(action, frame, facing, x), headRadius(geo), buildOf(geo))!;

describe("the pose file", () => {
  it("is committed source, not generated", () => {
    expect(authoredMoves("ryu")).toContain("2MK");
    expect(file.character).toBe("ryu");
    expect(file.action).toBe("ATK_2MK_Y2");
  });

  it("binds to its action with nothing left over", () => {
    const resolved = resolveKeys(file, kick);
    expect(resolved.problems).toEqual([]);
    expect(resolved.keys.map((k) => k.frame)).toEqual([1, 5, 8, 10, 18, 29]);
  });

  it("never asks a limb to reach further than the bone is long", () => {
    // 1 is full extension. Past it `jointOf` draws the chain straight, which is
    // a stretched limb — the one way a keyframe can still lie about a body.
    expect(overreach(resolveKeys(file, kick).keys)).toBeLessThanOrEqual(1);
  });
});

describe("the clock", () => {
  it("puts contact exactly on the first active frame", () => {
    const clock = clockOf(kick);
    const active = activeWindows(kick);
    expect(kick.mainFrame).toBe(7);
    expect(clock.contact).toBe(8);
    expect(clock.contact).toBe(active[0]!.start);
    expect(clock.contact).toBe(kick.mainFrame! + 1);
    const key = resolveKeys(file, kick).keys.find((k) => k.at === "contact")!;
    expect(key.frame).toBe(active[0]!.start);
  });

  it("resolves the phases against the action's own frame data", () => {
    const clock = clockOf(kick);
    expect(clock).toMatchObject({ start: 1, main: 7, contact: 8, activeEnd: 10, neutral: 29 });
    expect(resolveAnchor(clock, ["startup", 0])).toBe(1);
    expect(resolveAnchor(clock, ["startup", 1])).toBe(7);
    expect(resolveAnchor(clock, ["recovery", 0])).toBe(10);
    expect(resolveAnchor(clock, ["recovery", 1])).toBe(29);
  });

  it("moves with the frame data rather than with the file", () => {
    // The same anchors against a longer action land later, untouched. Ryu's 5HK
    // is startup 1-11, active 12-15, recovery to 35.
    const heavy = actionByName(ryu, "ATK_5HK")!;
    const clock = clockOf(heavy);
    expect(clock).toMatchObject({ main: 11, contact: 12, activeEnd: 15, neutral: 35 });
    expect(resolveKeys({ ...file, action: heavy.name }, heavy).keys.map((k) => k.frame)).toEqual([
      1, 7, 12, 15, 23, 35,
    ]);
  });

  it("takes a fireball's contact from the shot, because the caster has no hitbox", () => {
    // SPA_HADO carries MainFrame -1 and no active window at all: the fireball is
    // its own action (ADR-0022). ADR-0067 records this as a spec correction.
    const hado = actionByName(ryu, "SPA_HADO")!;
    expect(hado.mainFrame).toBe(-1);
    expect(activeWindows(hado)).toEqual([]);
    expect(clockOf(hado)).toMatchObject({ contact: 16, activeEnd: 16, neutral: 47 });
  });

  it("reports, rather than guesses, when an airborne action has no recovery", () => {
    // ATK_8HK and SPA_SYORYU_START are both MarginFrame -1: their recovery is
    // the landing action's, on a clock this action does not share (ADR-0056).
    for (const name of ["ATK_8HK", "SPA_SYORYU_START"]) {
      const air = actionByName(ryu, name)!;
      expect(air.marginFrame).toBe(-1);
      const clock = clockOf(air);
      expect(clock.neutral).toBeNull();
      expect(resolveAnchor(clock, "neutral")).toBeNull();
      expect(resolveAnchor(clock, ["recovery", 0.5])).toBeNull();
      const resolved = resolveKeys({ ...file, action: name }, air);
      expect(resolved.problems).toContain(`neutral does not resolve on ${name}`);
    }
  });
});

describe("the figure it draws", () => {
  it("never reports derived geometry, on any frame", () => {
    // The whole point. In this mode the figure is invention entire; a limb that
    // claimed a box put it somewhere would be a lie, and `drawFigure` would ink
    // it in the body colour.
    for (let frame = 1; frame <= kick.frames!; frame++) {
      const pose = drawn(frame);
      for (const limb of [...pose.arms, ...pose.legs]) expect(limb.derived).toBe(false);
      // The warm hitbox limb is derived by construction, so there is never one.
      expect(pose.limbs).toEqual([]);
    }
  });

  it("lands the authored key on the frame its anchor names", () => {
    const stature = buildOf(ryu).stature;
    const key = file.keys.find((k) => k.at === "contact")!.pose;
    const pose = drawn(8);
    // Lead foot is `feet[0]`; `Pose` orders each pair trailing-then-leading.
    expect(pose.legs[1]!.tip.x).toBeCloseTo(key.feet[0]!.x * stature, 6);
    expect(pose.legs[1]!.tip.y).toBeCloseTo(key.feet[0]!.y * stature, 6);
    expect(pose.hips.y).toBeCloseTo(key.pelvis.y * stature, 6);
  });

  it("eases between keys and sits exactly on them", () => {
    const keys = resolveKeys(file, kick).keys;
    for (const key of keys) expect(sampleAuthored(keys, key.frame)).toBe(key.pose);
    // Frame 12 is a quarter of the way from `activeEnd` (10) to the recovery
    // key (18). Smoothstep of 0.25 is 0.15625, so the retracting leg is still
    // out at 0.447 of a stature where a linear blend would have it at 0.415.
    const mid = sampleAuthored(keys, 12)!;
    expect(mid.feet[0]!.x).toBeCloseTo(0.5 + (0.16 - 0.5) * 0.15625, 9);
  });

  it("mirrors by facing and hangs on the fighter's axis", () => {
    const right = drawn(8, 1, 100);
    const left = drawn(8, -1, 100);
    expect(left.hips.x - 100).toBeCloseTo(-(right.hips.x - 100), 6);
    expect(left.legs[1]!.tip.x - 100).toBeCloseTo(-(right.legs[1]!.tip.x - 100), 6);
  });

  it("scales to another fighter's stature from the same file", () => {
    // Zangief's idle stack is 178 against Ryu's 166. Nothing in the file
    // changes; every height comes out in the same proportion.
    const ryuBuild = buildOf(ryu);
    const gief = buildOf(zangief);
    expect(ryuBuild.stature).toBe(166);
    expect(gief.stature).toBe(178);
    const giefKick = actionByName(zangief, "ATK_2MK")!;
    const a = drawn(8);
    const b = authoredPoseOf(
      { ...file, character: "zangief", action: giefKick.name },
      posed(giefKick, resolveAnchor(clockOf(giefKick), "contact")!),
      headRadius(zangief),
      gief,
    )!;
    const ratio = gief.stature / ryuBuild.stature;
    expect(b.hips.y / a.hips.y).toBeCloseTo(ratio, 6);
    expect(b.head!.y / a.head!.y).toBeCloseTo(ratio, 6);
    // Horizontally the figure hangs on the **axis** — the pushbox's centre —
    // which is a place on the stage and not a multiple of a stature. So x
    // transfers relative to the axis, not absolutely: Ryu's crouching pushbox is
    // centred on 0 and Zangief's on 8.
    expect((b.legs[1]!.tip.x - b.footprint) / (a.legs[1]!.tip.x - a.footprint)).toBeCloseTo(ratio, 6);
    expect(a.footprint).toBe(0);
    expect(b.footprint).toBe(8);
  });

  it("never draws a limb longer than the bone, and folds it shorter", () => {
    const bone = (l: { root: { x: number; y: number }; joint: { x: number; y: number }; tip: { x: number; y: number } }) =>
      Math.hypot(l.joint.x - l.root.x, l.joint.y - l.root.y) +
      Math.hypot(l.tip.x - l.joint.x, l.tip.y - l.joint.y);
    // The spec says a re-solved joint keeps the bone length constant. It does
    // not, and the reason is in `jointOf`: a deep fold is capped at 42% of the
    // bone so a guard's elbow does not stick out past the torso, and a capped
    // fold draws two segments that no longer sum to the bone. Over the 29 frames
    // of the kick the leg chain measures 82-90 against a 90-unit bone — never
    // longer, up to 9% shorter. See ADR-0067.
    const LEG_BONE = 0.53 * 1.02 * buildOf(ryu).stature * buildOf(ryu).leg;
    expect(LEG_BONE).toBeCloseTo(89.88, 2);
    const lengths: number[] = [];
    for (let frame = 1; frame <= 29; frame++) lengths.push(bone(drawn(frame).legs[1]!));
    expect(Math.max(...lengths)).toBeLessThanOrEqual(LEG_BONE + 1e-9);
    expect(Math.round(Math.max(...lengths))).toBe(90);
    expect(Math.round(Math.min(...lengths))).toBe(82);
  });

  it("refuses to draw a fighter it has no stature for", () => {
    expect(authoredPoseOf(file, posed(), 14, { arm: 1, leg: 1, stature: 0 })).toBeNull();
  });

  it("reports a file bound to the wrong action rather than drawing it silently", () => {
    const wrong: PoseFile = { ...file, action: "ATK_5LP" };
    expect(resolveKeys(wrong, kick).problems[0]).toContain("file names action ATK_5LP");
  });
});
