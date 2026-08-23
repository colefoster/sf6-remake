import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { actionByName, activeWindows } from "../src/data/geometry.js";
import { loadGeometry } from "../src/data/load-geometry.js";
import { loadPose } from "../src/data/load-poses.js";
import {
  overreach,
  resolveKeys,
  shoulderHalfAt,
  TWIST_MAX,
  type AuthoredPose,
  type Normalised,
} from "../src/game/pose-library.js";
import {
  extensionPeak,
  fitPose,
  forwardKinematics,
  planeOf,
  projectPose,
  reachOf,
  overreachOf,
  displacement,
  retargetClip,
  retargetFrame,
  REACH,
  SMPLX_JOINTS,
  SMPLX_PARENTS,
  type SmplxClip,
} from "../src/game/retarget.js";

/**
 * Fitting an SMPL-X humanoid onto the seven-point figure.
 *
 * The one thing this has to hold is the gate: `overreach < 0.95`, which is what
 * stops a keyframe lying about a body. Every other property here — the plane,
 * the joint mapping, the clock — is a choice, and the choices are pinned so a
 * later change to any of them is visible. The gate is not a choice.
 *
 * There is no Kimodo in this repo, so the input is fixtures: four hand-built
 * 30fps clips at real human proportions, each a root translation and 22 local
 * XYZW rotations per frame. `.scratch/pose-library/retarget/make-fixtures.mjs`
 * is what wrote them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const clipOf = (name: string): SmplxClip =>
  JSON.parse(readFileSync(join(HERE, "fixtures", `smplx-${name}.json`), "utf8")) as SmplxClip;

const NAMES = ["straight-punch", "roundhouse-kick", "low-sweep", "lanky-punch"] as const;
const clips = Object.fromEntries(NAMES.map((n) => [n, clipOf(n)])) as Record<(typeof NAMES)[number], SmplxClip>;

const ryu = loadGeometry("ryu")!;
const span = (a: Normalised, b: Normalised): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Every frame of every fixture, projected but not fitted. */
const everyFrame = function* (): Generator<{ clip: SmplxClip; frame: number; naive: AuthoredPose }> {
  for (const clip of Object.values(clips)) {
    const plane = planeOf(clip);
    for (let f = 0; f < clip.frames.length; f++)
      yield {
        clip,
        frame: f,
        naive: projectPose(forwardKinematics(clip, f), plane, { travel: plane.travel[f] ?? 0 }).pose,
      };
  }
};

describe("the fixtures stand in for a motion model", () => {
  it("carries the 22 SMPL-X body joints and their parents", () => {
    expect(SMPLX_JOINTS.length).toBe(22);
    expect(SMPLX_PARENTS.length).toBe(22);
    expect(SMPLX_JOINTS[0]).toBe("pelvis");
    expect(SMPLX_JOINTS[21]).toBe("right_wrist");
    // Every joint's parent comes before it, which is what lets forward
    // kinematics run in one pass.
    for (let i = 1; i < SMPLX_PARENTS.length; i++) expect(SMPLX_PARENTS[i]!).toBeLessThan(i);
  });

  it("is a skeleton, so no rotation can change a bone's length", () => {
    // The property that separates a skeleton from a point cloud, and the reason
    // the input can be trusted to be a humanoid at all.
    for (const clip of Object.values(clips)) {
      const rest = clip.rest;
      for (let f = 0; f < clip.frames.length; f++) {
        const w = forwardKinematics(clip, f);
        for (let i = 1; i < SMPLX_PARENTS.length; i++) {
          const p = w[SMPLX_PARENTS[i]!]!;
          const c = w[i]!;
          const drawn = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
          // 5 places, not more: the fixture rounds its quaternions to 1e-6 and
          // an unnormalised quaternion scales the bone it rotates.
          expect(drawn).toBeCloseTo(Math.hypot(...rest[i]!), 5);
        }
      }
    }
  });

  it("is a body at human proportions, measured off its own rest pose", () => {
    const plane = planeOf(clips["straight-punch"]);
    expect(plane.stature).toBeCloseTo(1.723, 3);
    // Both are within a couple of percent of the anthropometric fractions, and
    // both are *shorter* than our own bones — which is exactly why a naive
    // projection still fails: the shoulder is the problem, not the arm.
    expect(0.58 / plane.stature).toBeCloseTo(0.337, 3); // shoulder to wrist
    expect(0.925 / plane.stature).toBeCloseTo(0.537, 3); // hip to sole
  });

  it("includes a clip that overreaches our bones on purpose", () => {
    const lanky = planeOf(clips["lanky-punch"]);
    const peak = extensionPeak(clips["lanky-punch"], lanky);
    const naive = retargetFrame(clips["lanky-punch"], peak, lanky).naive;
    expect(overreachOf(naive)).toBeGreaterThan(1);
    // And it overreaches on its *standing* frame too, not only at extension.
    expect(overreachOf(retargetFrame(clips["lanky-punch"], 0, lanky).naive)).toBeGreaterThan(1);
    // 1.386 is what the worst lanky frame read before ADR-0070 gave the figure
    // a torso twist, and forcing the twist back to 0 recovers 1.364 of it here
    // — the peak itself has moved, because it is measured on the projection and
    // the projection changed. The point stands: almost all of the number
    // ADR-0069 published was the welded shoulder, not the 12% longer arm.
    expect(overreachOf({ ...naive, twist: 0 })).toBeGreaterThan(1.36);
  });
});

describe("the bones this module measures against", () => {
  it("are the library's own, not a second opinion", () => {
    // `pose-library.ts` keeps ARM, LEG, SHOULDER_HALF and PELVIS_HALF private.
    // A pose built to sit at exactly REACH on all four limbs has to read as
    // REACH through the library's own `overreach`, or the mirror has drifted.
    const chest = { x: 0, y: 0.8 };
    const pelvis = { x: 0, y: 0.5 };
    const arm = REACH * 0.37;
    const leg = REACH * 0.53 * 1.02;
    const pose: AuthoredPose = {
      pelvis,
      chest,
      head: { x: 0, y: 0.88 },
      hands: [
        { x: chest.x + 0.133 + arm, y: chest.y },
        { x: chest.x - 0.133 - arm, y: chest.y },
      ],
      feet: [
        { x: pelvis.x + 0.072, y: pelvis.y - leg },
        { x: pelvis.x - 0.072, y: pelvis.y - leg },
      ],
    };
    expect(overreach([{ frame: 1, at: "start", pose }])).toBeCloseTo(REACH, 10);
    expect(overreachOf(pose)).toBeCloseTo(REACH, 10);
  });
});

describe("the projection", () => {
  const clip = clips["straight-punch"];
  const plane = planeOf(clip);

  it("puts the figure on the side-on plane the fighter faces", () => {
    // The plane is spanned by the fighter's forward and up; the axis thrown
    // away is the lateral one. It is fixed on frame 0, so a spin still spins.
    expect(plane.forward).toEqual([0, 1]);
    expect(plane.left[0]).toBeCloseTo(1, 6);
    expect(plane.leadIsLeft).toBe(true);
  });

  it("stands the figure on the floor with the anchors the library expects", () => {
    const p = projectPose(forwardKinematics(clip, 0), plane, { travel: 0 }).pose;
    // Shoulder line, head and hips land where the eleven shipped files put
    // theirs, which is the check that the joint mapping is the right one.
    expect(p.chest.y).toBeGreaterThan(0.76);
    expect(p.chest.y).toBeLessThan(0.84);
    expect(p.head.y).toBeGreaterThan(0.84);
    expect(p.pelvis.y).toBeGreaterThan(0.46);
    expect(p.pelvis.y).toBeLessThan(0.58);
    expect(Math.min(p.feet[0].y, p.feet[1].y)).toBeLessThan(0.01);
    // Lead foot forward, rear foot back: the stance the lead was chosen from.
    expect(p.feet[0].x).toBeGreaterThan(p.feet[1].x);
  });

  it("leaves the fighter's bulk travel to the action, not to the pose", () => {
    // The clip lunges 10cm into the punch. Carried in the pose it would be
    // counted twice, because the figure already hangs on the pushbox axis.
    const peak = extensionPeak(clip, plane);
    expect(plane.travel[peak]).toBeGreaterThan(0.05);
    const carried = projectPose(forwardKinematics(clip, peak), plane, { travel: 0 }).pose;
    const removed = retargetFrame(clip, peak, plane).naive;
    expect(carried.pelvis.x - removed.pelvis.x).toBeCloseTo(plane.travel[peak]!, 9);
    // Removing it changes no limb's reach, because it shifts root and tip alike.
    expect(overreachOf(carried)).toBeCloseTo(overreachOf(removed), 9);
  });

  it("keeps a strike thrown at the camera at its true length", () => {
    // The degenerate case. A hook is nearly all lateral, and dropping that
    // component turns it into a shrug. Kept, the reach survives the projection
    // and the fit is what decides how much of it our arm can have.
    const hook: SmplxClip = {
      ...clip,
      facing: [1, 0], // the fight runs across the clip's forward, so the punch
      // that went down +Z is now thrown straight at the camera
    };
    const hookPlane = planeOf(hook);
    const at = extensionPeak(clip, plane);
    const flat = projectPose(forwardKinematics(hook, at), hookPlane, { foldLateral: false, travel: 0 }).pose;
    const kept = projectPose(forwardKinematics(hook, at), hookPlane, { travel: 0 }).pose;
    const shoulder = (p: AuthoredPose): Normalised => ({ x: p.chest.x - shoulderHalfAt(p.twist), y: p.chest.y });
    expect(span(shoulder(flat), flat.hands[1])).toBeLessThan(span(shoulder(kept), kept.hands[1]));
    expect(reachOf(kept).hands[1]).toBeGreaterThan(reachOf(flat).hands[1]);
    // And it is reported, so the cost is never silent.
    expect(projectPose(forwardKinematics(hook, at), hookPlane).lateral.hands[1]).toBeGreaterThan(0.7);
  });
});

describe("the fit", () => {
  it("holds the gate on every frame of every fixture", () => {
    let worstNaive = 0;
    let worstFitted = 0;
    let frames = 0;
    for (const { naive } of everyFrame()) {
      const fitted = fitPose(naive);
      worstNaive = Math.max(worstNaive, fitted.before);
      worstFitted = Math.max(worstFitted, fitted.after);
      expect(overreachOf(fitted.pose)).toBeLessThan(0.95);
      frames++;
    }
    expect(frames).toBe(92);
    // 1.386 before ADR-0070. What is left of it is the *legs* — the twist moves
    // a shoulder and cannot move a hip, so the roundhouse's supporting leg is
    // now the worst frame in all four clips and the punches no longer are.
    expect(worstNaive).toBeGreaterThan(1.09);
    expect(worstFitted).toBeLessThanOrEqual(REACH + 1e-9);
  });

  it("fits an input that overreaches by a third, and still fits one that does not", () => {
    const lanky = clips["lanky-punch"];
    const plane = planeOf(lanky);
    const over = retargetFrame(lanky, extensionPeak(lanky, plane), plane);
    expect(over.fit.before).toBeGreaterThan(1);
    expect(over.fit.after).toBeCloseTo(REACH, 9);

    // A pose already inside the bones is returned untouched — the fit is not a
    // normaliser that pushes every limb out to the limit.
    const easy = fitPose({
      pelvis: { x: 0, y: 0.5 },
      chest: { x: 0, y: 0.8 },
      head: { x: 0, y: 0.88 },
      hands: [
        { x: 0.2, y: 0.7 },
        { x: -0.1, y: 0.65 },
      ],
      feet: [
        { x: 0.14, y: 0.02 },
        { x: -0.15, y: 0.02 },
      ],
    });
    expect(easy.sink).toBe(0);
    expect(easy.after).toBe(easy.before);
    expect(easy.after).toBeLessThan(REACH);
  });

  it("shortens a limb along its own line rather than clipping it to an axis", () => {
    // The failure this module exists to avoid: two days were lost remapping y
    // alone, which lengthens every diagonal and took eleven files to 1.02–1.36.
    for (const { naive } of everyFrame()) {
      const fitted = fitPose(naive).pose;
      for (const i of [0, 1] as const) {
        const half = (i === 0 ? 1 : -1) * shoulderHalfAt(fitted.twist);
        const shoulder = { x: fitted.chest.x + half, y: fitted.chest.y };
        const was = { x: naive.chest.x + half, y: naive.chest.y };
        const a = Math.atan2(naive.hands[i].y - was.y, naive.hands[i].x - was.x);
        const b = Math.atan2(fitted.hands[i].y - shoulder.y, fitted.hands[i].x - shoulder.x);
        // The torso can sink, which rotates the line a little; nothing else may.
        expect(Math.abs(a - b)).toBeLessThan(0.35);
      }
    }
  });

  it("bends the knees rather than narrowing the stance when the legs are short", () => {
    // A body whose legs cannot reach its own feet crouches. Shrinking the
    // stance instead would be the same axis-wise mistake in a different place.
    const tall: AuthoredPose = {
      pelvis: { x: 0, y: 0.62 },
      chest: { x: 0, y: 0.9 },
      head: { x: 0, y: 0.98 },
      hands: [
        { x: 0.1, y: 0.8 },
        { x: -0.1, y: 0.8 },
      ],
      feet: [
        { x: 0.16, y: 0 },
        { x: -0.16, y: 0 },
      ],
    };
    const fit = fitPose(tall);
    expect(fit.before).toBeGreaterThan(1);
    expect(fit.sink).toBeGreaterThan(0.07);
    expect(fit.narrowed).toEqual([0, 0]);
    // The feet did not move at all; the hips came down to them.
    expect(fit.pose.feet[0]).toEqual(tall.feet[0]);
    expect(fit.pose.feet[1]).toEqual(tall.feet[1]);
    // And the torso moved as one piece, so its shape is intact.
    expect(tall.chest.y - fit.pose.chest.y).toBeCloseTo(fit.sink, 9);
    expect(tall.head.y - fit.pose.head.y).toBeCloseTo(fit.sink, 9);
  });

  it("costs the cross nothing at all, now the shoulder can travel", () => {
    // ADR-0069's headline, reversed. Its contact frame cost `hand.rear` 0.164
    // of a stature — 27 units on Ryu — because the figure welded the punching
    // shoulder 0.162 behind where the body had it. With the twist derived the
    // frame is inside our bones before the fit is asked for anything.
    const clip = clips["straight-punch"];
    const plane = planeOf(clip);
    const at = retargetFrame(clip, extensionPeak(clip, plane), plane);
    expect(at.naive.twist!).toBeGreaterThan(90);
    expect(at.moved["hand.rear"]!).toBe(0);
    expect(at.moved["hand.lead"]!).toBe(0);
    expect(at.moved["foot.lead"]!).toBe(0);
    expect(at.moved["foot.rear"]!).toBe(0);
    expect(at.moved["pelvis"]!).toBeLessThan(0.03);
    // Untwisted, the same frame is the 1.345 ADR-0069 published.
    expect(reachOf({ ...at.naive, twist: 0 }).hands[1]).toBeGreaterThan(1.3);
    expect(reachOf(at.naive).hands[1]).toBeLessThan(0.95);
    // The measure is symmetric and zero on a pose that needed nothing.
    expect(displacement(at.fitted, at.fitted)["chest"]).toBe(0);
  });

  it("still spends the fit on the striking limb, on a clip the twist cannot save", () => {
    // A kick's cost is a hip's, and the twist moves shoulders. The sweep's
    // scything rear leg is still the one point the fit pays for.
    const clip = clips["low-sweep"];
    const plane = planeOf(clip);
    const at = retargetFrame(clip, extensionPeak(clip, plane), plane);
    expect(at.moved["foot.rear"]!).toBeGreaterThan(0.05);
    expect(at.moved["hand.lead"]!).toBe(0);
    expect(at.moved["hand.rear"]!).toBe(0);
  });
});

describe("the clip on the action's clock", () => {
  const jobs: [(typeof NAMES)[number], string, string][] = [
    ["straight-punch", "5MP", "ATK_5MP"],
    ["roundhouse-kick", "5HK", "ATK_5HK"],
    ["low-sweep", "2HK", "ATK_2HK"],
  ];

  it("binds the extension peak to contact, which is the first active frame", () => {
    for (const [name, move, actionName] of jobs) {
      const action = actionByName(ryu, actionName)!;
      const report = retargetClip(clips[name], action, { character: "ryu", move });
      const contact = report.keys.find((k) => k.at === "contact")!;
      // The whole architecture in one assertion: the pose is the model's, the
      // frame is the dump's, and the strike lands where the game says it does.
      expect(contact.frame).toBe(activeWindows(action)[0]!.start);
      expect(contact.frame).toBe(action.mainFrame! + 1);
      expect(contact.source).toBe(report.peak);
      // `contact` is drawn from the most extended frame of the clip, which is
      // what `before` being the clip's own maximum says. It is no longer always
      // past 1: with the twist derived the straight punch fits our bones as it
      // stands, and only the two kicks still need shortening.
      const naive = clips[name].frames.map((_, i) =>
        overreachOf(retargetFrame(clips[name], i, planeOf(clips[name])).naive),
      );
      expect(contact.before).toBeCloseTo(Math.max(...naive), 9);
      expect(contact.after).toBeLessThan(0.95);
    }
  });

  it("emits a file that binds to its action with nothing left over", () => {
    for (const [name, move, actionName] of jobs) {
      const action = actionByName(ryu, actionName)!;
      const report = retargetClip(clips[name], action, { character: "ryu", move });
      const bound = resolveKeys(report.file, action);
      expect(report.skipped).toEqual([]);
      expect(bound.problems).toEqual([]);
      expect(bound.keys.length).toBe(6);
      // Rounding to three places is the only thing between the fit and the
      // file, and it cannot cost more than a thousandth of the gate's margin.
      expect(overreach(bound.keys)).toBeLessThan(0.95);
      expect(overreach(bound.keys)).toBeGreaterThan(REACH);
      // Within a hair of the hand-authored file for the same action.
      expect(overreach(resolveKeys(loadPose("ryu", move)!, action).keys)).toBeLessThan(0.95);
    }
  });

  it("takes its timing from the action and never from the clip's 30fps", () => {
    // The same 21-frame clip driving two actions of different lengths gives two
    // different frame lists, and neither is 21 long.
    const clip = clips["straight-punch"];
    const short = retargetClip(clip, actionByName(ryu, "ATK_5LP")!, { character: "ryu", move: "5LP" });
    const long = retargetClip(clip, actionByName(ryu, "ATK_5HP")!, { character: "ryu", move: "5HP" });
    expect(clip.fps).toBe(30);
    expect(short.keys.map((k) => k.frame)).not.toEqual(long.keys.map((k) => k.frame));
    expect(short.keys.at(-1)!.frame).toBeLessThan(long.keys.at(-1)!.frame);
    for (const r of [short, long]) {
      expect(resolveKeys(r.file, actionByName(ryu, r.file.action)!).problems).toEqual([]);
      expect(r.keys.map((k) => k.frame)).toEqual([...r.keys.map((k) => k.frame)].sort((a, b) => a - b));
    }
  });

  it("names the anchors an airborne action cannot carry instead of guessing", () => {
    // `ATK_8HK` has `MarginFrame -1`: its recovery is the landing action's, on
    // the landing action's clock (ADR-0056). There is no frame here to name.
    const jump = actionByName(ryu, "ATK_8HK")!;
    const report = retargetClip(clips["roundhouse-kick"], jump, { character: "ryu", move: "jHK" });
    expect(report.skipped).toEqual([
      "recovery 0.4 does not resolve on ATK_8HK",
      "neutral does not resolve on ATK_8HK",
    ]);
    expect(resolveKeys(report.file, jump).problems).toEqual([]);
    expect(overreach(resolveKeys(report.file, jump).keys)).toBeLessThan(0.95);
  });
});
