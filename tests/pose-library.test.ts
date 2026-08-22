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
import { buildOf, headRadius, poseOf, type Pose, type Posed } from "../src/game/render.js";

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
    // out at 0.442 of a stature where a linear blend would have it at 0.425.
    const mid = sampleAuthored(keys, 12)!;
    expect(mid.feet[0]!.x).toBeCloseTo(0.47 + (0.29 - 0.47) * 0.15625, 9);
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
    // fold draws two segments that no longer sum to the bone.
    //
    // Where the cap bites is the **arm**, not the leg. A guard hand sits about
    // 0.45 of an arm from its shoulder, which is deep enough to clip; over the
    // 29 frames of the kick the lead arm measures 55-56 against a 63-unit bone.
    // The leg never clips, because on the ADR-0060 skeleton a foot on the floor
    // is already 0.93 of the way out — the re-author's whole constraint — so the
    // leg chain comes out at exactly the bone on every frame. Never longer is
    // the property that matters and it holds for both.
    const LEG_BONE = 0.53 * 1.02 * buildOf(ryu).stature * buildOf(ryu).leg;
    const ARM_BONE = 0.37 * buildOf(ryu).stature * buildOf(ryu).arm;
    expect(LEG_BONE).toBeCloseTo(89.88, 2);
    expect(ARM_BONE).toBeCloseTo(63.33, 2);
    const legs: number[] = [];
    const arms: number[] = [];
    for (let frame = 1; frame <= 29; frame++) {
      legs.push(bone(drawn(frame).legs[1]!));
      arms.push(bone(drawn(frame).arms[1]!));
    }
    expect(Math.max(...legs)).toBeLessThanOrEqual(LEG_BONE + 1e-9);
    expect(Math.max(...arms)).toBeLessThanOrEqual(ARM_BONE + 1e-9);
    expect(Math.round(Math.max(...legs))).toBe(90);
    expect(Math.round(Math.min(...legs))).toBe(90);
    expect(Math.round(Math.max(...arms))).toBe(56);
    expect(Math.round(Math.min(...arms))).toBe(55);
  });

  it("refuses to draw a fighter it has no stature for", () => {
    expect(authoredPoseOf(file, posed(), 14, { arm: 1, leg: 1, stature: 0 })).toBeNull();
  });

  it("reports a file bound to the wrong action rather than drawing it silently", () => {
    const wrong: PoseFile = { ...file, action: "ATK_5LP" };
    expect(resolveKeys(wrong, kick).problems[0]).toContain("file names action ATK_5LP");
  });
});


/**
 * The neutral the library stands in, against the figure it has to stand beside.
 *
 * The two paths into `Pose` were composed independently and silently diverged:
 * the first seeded library put the pelvis at 0.340 of stature and the chest at
 * 0.550 while `pose-library.ts` had always assumed ADR-0060's 0.53 leg, so the
 * authored body was a third shorter in every vertical measure — a long torso on
 * short legs, exactly the defect ADR-0060 fixed in the derived figure. Nothing
 * checked it. This does.
 */
describe("the authored neutral against the derived idle", () => {
  const build = buildOf(ryu);
  const stature = build.stature;
  const idle = ryu.actions.find((a) => a.id === ryu.calibration!.standAction)!;
  const derived = poseOf(
    { state: { action: idle, frame: 1, facing: 1 }, position: () => ({ x: 0, y: 0 }) },
    headRadius(ryu),
    undefined,
    build,
  );
  const jab = actionByName(ryu, "ATK_5LP")!;
  const authored = authoredPoseOf(loadPose("ryu", "5LP")!, posed(jab, 1), headRadius(ryu), build)!;

  it("stands on the same body, within the tolerance the leg bone forces", () => {
    // 0.04 of stature — 6.6 world units on Ryu's 166 — and the size is not a
    // taste. The derived idle's lead hip sits 0.5373 of a stature from its lead
    // foot, which is 0.992 of the 0.5415 leg bone: an authored pose copying that
    // pelvis height would ship at 0.99 overreach, one nudge from a limb drawn
    // straight and stretched. Holding overreach under 0.95 caps a foot-on-floor
    // pelvis at 0.5144 even with the feet directly beneath the hips, so the
    // authored neutral is 0.500 and the gap is the bone's, not a mistake. The
    // seeded library it replaced missed by 0.19 of a stature — five times this.
    const tol = 0.04 * stature;
    expect(Math.abs(authored.hips.y - derived.hips.y)).toBeLessThan(tol);
    expect(Math.abs(authored.neck.y - derived.neck.y)).toBeLessThan(tol);
    expect(Math.abs(authored.head!.y - derived.head!.y)).toBeLessThan(tol);
  });

  it("splits that body between leg and torso the same way", () => {
    // The absolute check alone would pass a figure that was uniformly short.
    // What went wrong was the *proportion*: the seeded neutral put 51.5% of its
    // height below the pelvis where the derived figure puts 59.1%, and that —
    // not the total — is what read as a squat. 0.035 admits the 0.021 the
    // crouch costs and rejects the 0.076 the seeds were out by.
    const share = (p: Pose): number => p.hips.y / p.head!.y;
    expect(share(derived)).toBeCloseTo(0.5914, 3);
    expect(Math.abs(share(authored) - share(derived))).toBeLessThan(0.035);
  });

  it("keeps every authored file inside the bone, on Ryu's build and on an even one", () => {
    // The gate the whole re-author was held to. `jointOf` draws a chain straight
    // when its tip is further off than the chain is long, and that limb is a lie
    // about the body; 0.95 leaves room for the eased frames between two keys.
    for (const move of authoredMoves("ryu")) {
      const one = loadPose("ryu", move)!;
      const action = actionByName(ryu, one.action)!;
      const resolved = resolveKeys(one, action);
      expect(resolved.problems).toEqual([]);
      expect(overreach(resolved.keys, build)).toBeLessThan(0.95);
      expect(overreach(resolved.keys)).toBeLessThan(0.95);
    }
  });
});
