/**
 * Fitting a 22-joint SMPL-X humanoid onto the seven-point authored figure.
 *
 * A text-to-motion model (NVIDIA's Kimodo, and every other SMPL-X emitter)
 * produces per-frame skeletal motion: a root translation and 22 local joint
 * rotations at 30fps. The authored library (ADR-0067) wants seven 2D points in
 * fractions of stature. The gap between those two is *not* a projection — it is
 * a **retarget**, because our figure is not a free skeleton:
 * `pose-library.ts` fixes the arm at 0.37 of stature and the leg at 0.5406, and
 * {@link overreach} is 1 when a key asks for a limb longer than its own bone.
 *
 * Copying joint positions in is the thing that fails. A real shoulder travels
 * forward when a body twists into a punch; ours is welded to the chest at
 * ±0.133. So a geometrically honest 3D punch projects to a hand that our arm
 * cannot reach, and any per-axis repair (the one tried on the eleven shipped
 * files, which came out 1.02–1.36) lengthens every diagonal it touches.
 *
 * The rule here is two steps and both are stated rather than tuned:
 *
 * 1. **Sink the pelvis** until the *grounded* feet can reach the floor. A body
 *    whose legs are too short for its stance bends its knees; it does not
 *    shorten its stance. The torso translates rigidly, so its lean is kept.
 * 2. **Clip every limb tip radially** to {@link REACH} of its bone, about its
 *    own root. Direction from the shoulder or hip is preserved exactly; only
 *    the distance changes. A hand at 1.3 arms lands at the bone's limit *on the
 *    same line*.
 *
 * Step 2 alone is what makes the gate a theorem rather than a hope: after it,
 * every span is `REACH * bone` or less, so `overreach` cannot exceed
 * {@link REACH}. Nothing here writes to the library, touches `poseOf`, or reads
 * a hurtbox.
 *
 * This module is browser-safe: no Node imports, same seam as `pose-library.ts`.
 */

import type { GeometryAction } from "../data/geometry.js";
import type { Anchor, AuthoredKey, AuthoredPose, Normalised, PoseFile } from "./pose-library.js";
import { TWIST_MAX, clockOf, resolveAnchor, shoulderHalfAt } from "./pose-library.js";

/* ---- the figure's bones, mirrored ---------------------------------------- */

/**
 * The constants `pose-library.ts` keeps private, restated so this module can
 * measure against them without editing that file.
 *
 * They are a mirror and not a second opinion: `retarget.test.ts` pins them by
 * building a pose at exactly {@link REACH} and asserting the library's own
 * {@link overreach} agrees to within a rounding error. If someone changes a
 * bone there and not here, that test fails.
 */
/**
 * The shoulder line's half-separation is **not** mirrored: since ADR-0070 it is
 * a function of the pose's own `twist`, so this module imports
 * {@link shoulderHalfAt} rather than restating 0.133. There is only one place
 * that number lives.
 */
const PELVIS_HALF = 0.072;
const ARM = 0.37;
const LEG = 0.53 * 1.02;

/**
 * How much of a bone a fitted limb is allowed to use.
 *
 * The gate is `overreach < 0.95`. Fitting to exactly 0.95 would sit on it, and
 * floating point would decide. 0.94 clears it by a margin wider than any error
 * the arithmetic here can produce, and costs 0.006 of stature — about a
 * centimetre on Ryu — off a fully extended limb.
 */
export const REACH = 0.94;

/** A foot this close to the floor is standing on it. Fractions of stature. */
const GROUNDED = 0.03;

/* ---- the input ----------------------------------------------------------- */

/** The 22 SMPL-X body joints, in the order every SMPL/SMPL-X emitter uses. */
export const SMPLX_JOINTS = [
  "pelvis",
  "left_hip",
  "right_hip",
  "spine1",
  "left_knee",
  "right_knee",
  "spine2",
  "left_ankle",
  "right_ankle",
  "spine3",
  "left_foot",
  "right_foot",
  "neck",
  "left_collar",
  "right_collar",
  "head",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
] as const;

/** Parent of each joint; the pelvis has none. */
export const SMPLX_PARENTS = [
  -1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19,
] as const;

const J = {
  pelvis: 0,
  leftHip: 1,
  rightHip: 2,
  leftKnee: 4,
  rightKnee: 5,
  leftAnkle: 7,
  rightAnkle: 8,
  leftFoot: 10,
  rightFoot: 11,
  neck: 12,
  head: 15,
  leftShoulder: 16,
  rightShoulder: 17,
  leftWrist: 20,
  rightWrist: 21,
} as const;

export type Vec3 = readonly [number, number, number];
/** A rotation as XYZW, which is what SMPL-X pipelines hand out. */
export type Quat = readonly [number, number, number, number];

/**
 * A motion clip in the shape a text-to-motion model emits.
 *
 * Axes are the SMPL convention: **+X to the character's left, +Y up, +Z the
 * character's forward** in the rest pose. Lengths are metres.
 */
export interface SmplxClip {
  name: string;
  /** Kimodo emits 30. Nothing here assumes it, but the resample reports it. */
  fps: number;
  /**
   * Rest-pose offsets, each joint relative to its parent. The pelvis's is
   * ignored — the per-frame root translation places it.
   */
  rest: Vec3[];
  frames: { root: Vec3; rot: Quat[] }[];
  /**
   * Sole-to-crown height in metres. SMPL-X carries no crown joint, so when this
   * is absent it is estimated from the rest pose — see {@link statureOf}.
   */
  stature?: number;
  /**
   * The horizontal direction the fighter faces, `[x, z]`. Absent, it is taken
   * from the hips on frame 0, which is wrong for a bladed stance and right for
   * everything else — so a fixture with a turned pelvis states it.
   */
  facing?: readonly [number, number];
}

/* ---- forward kinematics -------------------------------------------------- */

const rotate = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  // t = 2 * (q.xyz x v); v' = v + w*t + q.xyz x t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
};

const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/**
 * World positions of the 22 joints on one frame.
 *
 * Local rotations compose down the parent chain, which is what makes this a
 * skeleton rather than a point cloud: a bone's length is the rest offset's and
 * a rotation cannot change it.
 */
export function forwardKinematics(clip: SmplxClip, frame: number): Vec3[] {
  const f = clip.frames[frame];
  if (!f) throw new Error(`frame ${frame} is not in ${clip.name}`);
  const world: Vec3[] = new Array(SMPLX_PARENTS.length);
  const global: Quat[] = new Array(SMPLX_PARENTS.length);
  for (let i = 0; i < SMPLX_PARENTS.length; i++) {
    const parent = SMPLX_PARENTS[i]!;
    const local = f.rot[i] ?? ([0, 0, 0, 1] as Quat);
    if (parent === -1) {
      global[i] = local;
      world[i] = f.root;
      continue;
    }
    global[i] = mul(global[parent]!, local);
    const off = rotate(global[parent]!, clip.rest[i] ?? [0, 0, 0]);
    const p = world[parent]!;
    world[i] = [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
  }
  return world;
}

/** The rest skeleton laid out with no rotation, for measuring proportions. */
function restWorld(clip: SmplxClip): Vec3[] {
  const world: Vec3[] = new Array(SMPLX_PARENTS.length);
  for (let i = 0; i < SMPLX_PARENTS.length; i++) {
    const parent = SMPLX_PARENTS[i]!;
    if (parent === -1) {
      world[i] = [0, 0, 0];
      continue;
    }
    const p = world[parent]!;
    const off = clip.rest[i] ?? [0, 0, 0];
    world[i] = [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
  }
  return world;
}

/**
 * Sole-to-crown height in metres.
 *
 * SMPL-X's topmost body joint is `head`, which sits at the base of the skull —
 * about **0.885 of stature** on an adult, and 0.876 is where the eleven shipped
 * pose files put their head point, so the two agree. A clip that knows its own
 * height says so and this is not used.
 */
export function statureOf(clip: SmplxClip): number {
  if (clip.stature) return clip.stature;
  const rest = restWorld(clip);
  const sole = Math.min(rest[J.leftFoot]![1], rest[J.rightFoot]![1]);
  return (rest[J.head]![1] - sole) / 0.885;
}

/** Ankle joint to sole, in metres, read off the clip's own rest pose. */
function ankleRiseOf(clip: SmplxClip): number {
  const rest = restWorld(clip);
  const ankle = Math.min(rest[J.leftAnkle]![1], rest[J.rightAnkle]![1]);
  const sole = Math.min(rest[J.leftFoot]![1], rest[J.rightFoot]![1]);
  return Math.max(0, ankle - sole);
}

/* ---- the plane the figure lives in --------------------------------------- */

/**
 * The fight plane: where the clip's world is measured from, once per clip.
 *
 * The figure is a **side view**, so the plane is spanned by the fighter's own
 * forward direction and up. The axis discarded is the fighter's lateral one.
 * All three are fixed on frame 0 rather than tracked per frame, because a
 * spinning kick would otherwise carry the camera around with it and the spin
 * would vanish.
 */
export interface Plane {
  /** Unit horizontal forward, `[x, z]`. */
  forward: readonly [number, number];
  /** Unit horizontal left, `[x, z]`. `forward x up`. */
  left: readonly [number, number];
  /** World y of the floor: the lowest sole the clip ever reaches. */
  floor: number;
  /** World `[x, z]` the figure's own axis stands on: the frame-0 stance centre. */
  origin: readonly [number, number];
  stature: number;
  ankleRise: number;
  /** Which SMPL side is the lead limb: 0 for left, 1 for right. */
  leadIsLeft: boolean;
  /**
   * How far the clip's root has travelled along `forward` by each frame, from
   * frame 0, in fractions of stature.
   *
   * It is **subtracted** from every projected x, because in this engine a
   * fighter's bulk travel is the action's own origin track and the pushbox axis
   * the figure hangs on — not the pose. A lunging cross whose root moves 10cm
   * would otherwise carry that 10cm twice: once as the pose sliding forward
   * inside its own frame, and once as the fighter walking. The shipped files
   * agree: across all eleven, no pelvis x leaves ±0.02.
   */
  travel: number[];
}

const norm2 = (x: number, z: number): readonly [number, number] => {
  const d = Math.hypot(x, z) || 1;
  return [x / d, z / d];
};

export function planeOf(clip: SmplxClip): Plane {
  const first = forwardKinematics(clip, 0);
  const hipL = first[J.leftHip]!;
  const hipR = first[J.rightHip]!;
  // +X is the character's left in the rest pose, so left-hip minus right-hip is
  // the lateral axis, and forward is that crossed with up.
  const left = clip.facing
    ? norm2(clip.facing[1], -clip.facing[0])
    : norm2(hipL[0] - hipR[0], hipL[2] - hipR[2]);
  const forward = clip.facing ? norm2(clip.facing[0], clip.facing[1]) : norm2(left[1], -left[0]);

  const ankleRise = ankleRiseOf(clip);
  let floor = Infinity;
  for (let i = 0; i < clip.frames.length; i++) {
    const w = forwardKinematics(clip, i);
    floor = Math.min(floor, w[J.leftAnkle]![1] - ankleRise, w[J.rightAnkle]![1] - ankleRise);
  }

  const originX = (first[J.leftAnkle]![0] + first[J.rightAnkle]![0]) / 2;
  const originZ = (first[J.leftAnkle]![2] + first[J.rightAnkle]![2]) / 2;

  // The lead is a property of the stance, not of the strike: whichever foot is
  // further forward when the clip starts. It names both the lead hand and the
  // lead foot, because in our format index 0 is one side of one body.
  const fwdOf = (p: Vec3): number => (p[0] - originX) * forward[0] + (p[2] - originZ) * forward[1];
  const leadIsLeft = fwdOf(first[J.leftAnkle]!) >= fwdOf(first[J.rightAnkle]!);

  const stature = statureOf(clip);
  const root0 = clip.frames[0]!.root;
  const travel = clip.frames.map(
    (f) => ((f.root[0] - root0[0]) * forward[0] + (f.root[2] - root0[2]) * forward[1]) / stature,
  );

  return {
    forward,
    left,
    floor,
    origin: [originX, originZ],
    stature,
    ankleRise,
    leadIsLeft,
    travel,
  };
}

/* ---- the naive projection ------------------------------------------------ */

export interface Projected {
  pose: AuthoredPose;
  /**
   * How much of each limb's reach was pointing out of the fight plane, as a
   * fraction of its 3D length from the shoulder or hip. 0 is a strike thrown
   * exactly along the camera's plane; 1 is one thrown at the camera.
   */
  lateral: { hands: [number, number]; feet: [number, number] };
}

export interface ProjectOptions {
  /**
   * Keep a limb's 3D length when it is projected, by rescaling the in-plane
   * vector rather than letting the lateral component be dropped.
   *
   * This is the answer to *a punch thrown at the camera*. Dropped, that punch
   * projects to a hand still at the shoulder and the move becomes a shrug —
   * geometrically faithful to the plane and a lie about the motion. Kept, the
   * strike reads at its true extension along whatever in-plane direction it
   * had, and when it had none (a strike within 15% of purely lateral) it is
   * pointed straight forward, because a strike is a strike. Default on; the
   * cost is reported per limb in {@link Projected.lateral} so it stays visible.
   */
  foldLateral?: boolean;
  /**
   * Forward travel to subtract from every x, in fractions of stature — see
   * {@link Plane.travel}. Callers that go through {@link retargetFrame} get the
   * clip's own; pass 0 to see the pose where the clip actually put it.
   */
  travel?: number;
}

const LATERAL_FALLBACK = 0.15;

/**
 * The naive projection: 22 world joints to our seven points, no fitting.
 *
 * The mapping, and why each one:
 *
 * | ours | SMPL-X | |
 * |---|---|---|
 * | `pelvis` | midpoint of `left_hip`/`right_hip` (1, 2) | our legs hang from `pelvis.y ± 0.072`, so this point **is** the hip line — SMPL-X's `pelvis` (0) is the body root and sits ~0.035 of stature above it, which makes every standing leg read 4% overreached |
 * | `chest` | midpoint of `left_shoulder`/`right_shoulder` (16, 17) | our shoulders sit at `chest.y ± 0.133`, so chest **is** the shoulder line's centre — `neck` (12) sits a few cm above it and would shorten every arm |
 * | `head` | `head` (15) | base of skull, which is what our head circle is centred on |
 * | `hands` | `left_wrist`/`right_wrist` (20, 21) | our arm is shoulder-to-wrist by definition |
 * | `feet` | `left_ankle`/`right_ankle` (7, 8), dropped by the rest ankle rise | our leg is hip-to-**sole**; the ankle is not the sole, and `left_foot` (10) is a toe, forward of it |
 */
export function projectPose(joints: Vec3[], plane: Plane, options: ProjectOptions = {}): Projected {
  const fold = options.foldLateral ?? true;
  const { forward, left, origin, floor, stature } = plane;
  const travel = options.travel ?? 0;
  const fwd = (p: Vec3): number =>
    ((p[0] - origin[0]) * forward[0] + (p[2] - origin[1]) * forward[1]) / stature - travel;
  const lat = (p: Vec3): number => ((p[0] - origin[0]) * left[0] + (p[2] - origin[1]) * left[1]) / stature;
  const up = (p: Vec3): number => (p[1] - floor) / stature;
  const flat = (p: Vec3): Normalised => ({ x: fwd(p), y: up(p) });

  const shoulders: [number, number] = plane.leadIsLeft
    ? [J.leftShoulder, J.rightShoulder]
    : [J.rightShoulder, J.leftShoulder];
  const wrists: [number, number] = plane.leadIsLeft ? [J.leftWrist, J.rightWrist] : [J.rightWrist, J.leftWrist];
  const hips: [number, number] = plane.leadIsLeft ? [J.leftHip, J.rightHip] : [J.rightHip, J.leftHip];
  const ankles: [number, number] = plane.leadIsLeft ? [J.leftAnkle, J.rightAnkle] : [J.rightAnkle, J.leftAnkle];

  const mid = (a: number, b: number): Normalised => ({
    x: (fwd(joints[a]!) + fwd(joints[b]!)) / 2,
    y: (up(joints[a]!) + up(joints[b]!)) / 2,
  });
  const chest = mid(J.leftShoulder, J.rightShoulder);
  const pelvis = mid(J.leftHip, J.rightHip);

  /**
   * One limb tip, measured against the joint it actually hangs from, so the
   * lateral share is the limb's and not the whole body's.
   */
  const tip = (rootJoint: number, tipJoint: number, drop: number): { at: Normalised; lateral: number } => {
    const root = joints[rootJoint]!;
    const end = joints[tipJoint]!;
    const dx = fwd(end) - fwd(root);
    const dy = up(end) - up(root) - drop;
    const dz = lat(end) - lat(root);
    const inPlane = Math.hypot(dx, dy);
    const full = Math.hypot(dx, dy, dz);
    const share = full > 1e-9 ? Math.abs(dz) / full : 0;
    const base = { x: fwd(root), y: up(root) };
    if (!fold || full <= 1e-9) return { at: { x: base.x + dx, y: base.y + dy }, lateral: share };
    if (inPlane < LATERAL_FALLBACK * full) {
      // Thrown at the camera. There is no in-plane direction left to trust, so
      // it is pointed forward and the cost is on the record.
      return { at: { x: base.x + full, y: base.y }, lateral: share };
    }
    const k = full / inPlane;
    return { at: { x: base.x + dx * k, y: base.y + dy * k }, lateral: share };
  };

  /**
   * The twist the source body is actually in: the azimuth of its shoulder line,
   * measured from the fight's forward axis, in degrees.
   *
   * This is the one measurement that is taken as an **angle** and not as a
   * position, and it has to be, because the source's shoulders are not our
   * shoulders — a lanky fixture is 12% broader across the back and would hand
   * us a bigger offset for the same rotation. The angle is the body's and the
   * breadth is ours. `atan2` of the lateral component against the forward one
   * gives 0 for a fully bladed line, 90 for a square one and up to 180 for one
   * turned end for end; {@link clampTwist} then holds it to what a torso has.
   */
  const twistOf = (): number => {
    const lead = joints[shoulders[0]]!;
    const rear = joints[shoulders[1]]!;
    const along = fwd(lead) - fwd(rear);
    const across = lat(lead) - lat(rear);
    if (Math.hypot(along, across) < 1e-9) return 0;
    return Math.min(TWIST_MAX, Math.max(0, (Math.atan2(Math.abs(across), along) * 180) / Math.PI));
  };
  const twist = twistOf();

  const hand0 = tip(shoulders[0], wrists[0], 0);
  const hand1 = tip(shoulders[1], wrists[1], 0);
  const drop = plane.ankleRise / stature;
  const foot0 = tip(hips[0], ankles[0], drop);
  const foot1 = tip(hips[1], ankles[1], drop);

  return {
    pose: {
      twist,
      pelvis,
      chest,
      head: flat(joints[J.head]!),
      hands: [hand0.at, hand1.at],
      feet: [foot0.at, foot1.at],
    },
    lateral: { hands: [hand0.lateral, hand1.lateral], feet: [foot0.lateral, foot1.lateral] },
  };
}

/* ---- measuring ----------------------------------------------------------- */

const span = (a: Normalised, b: Normalised): number => Math.hypot(a.x - b.x, a.y - b.y);

const shoulderOf = (p: AuthoredPose, i: number): Normalised => ({
  x: p.chest.x + (i === 0 ? 1 : -1) * shoulderHalfAt(p.twist),
  y: p.chest.y,
});
const hipOf = (p: AuthoredPose, i: number): Normalised => ({
  x: p.pelvis.x + (i === 0 ? 1 : -1) * PELVIS_HALF,
  y: p.pelvis.y,
});

/** Each limb's reach as a multiple of its own bone. Lead first. */
export function reachOf(pose: AuthoredPose): { hands: [number, number]; feet: [number, number] } {
  return {
    hands: [span(shoulderOf(pose, 0), pose.hands[0]) / ARM, span(shoulderOf(pose, 1), pose.hands[1]) / ARM],
    feet: [span(hipOf(pose, 0), pose.feet[0]) / LEG, span(hipOf(pose, 1), pose.feet[1]) / LEG],
  };
}

/** The worst reach in one pose — the same number `overreach` reports per file. */
export function overreachOf(pose: AuthoredPose): number {
  const r = reachOf(pose);
  return Math.max(...r.hands, ...r.feet);
}

/** Per-point distance between two poses, in fractions of stature. */
export function displacement(a: AuthoredPose, b: AuthoredPose): Record<string, number> {
  return {
    pelvis: span(a.pelvis, b.pelvis),
    chest: span(a.chest, b.chest),
    head: span(a.head, b.head),
    "hand.lead": span(a.hands[0], b.hands[0]),
    "hand.rear": span(a.hands[1], b.hands[1]),
    "foot.lead": span(a.feet[0], b.feet[0]),
    "foot.rear": span(a.feet[1], b.feet[1]),
  };
}

/* ---- the fit ------------------------------------------------------------- */

export interface Fitted {
  pose: AuthoredPose;
  /** How far the pelvis (and with it the whole torso) was lowered. */
  sink: number;
  /** How far each grounded foot's stance was narrowed to stay reachable. */
  narrowed: [number, number];
  before: number;
  after: number;
}

/** Pull `tip` back along its own line until it is within `limit` of `root`. */
const clipTo = (root: Normalised, tip: Normalised, limit: number): Normalised => {
  const d = span(root, tip);
  if (d <= limit || d < 1e-9) return tip;
  const k = limit / d;
  return { x: root.x + (tip.x - root.x) * k, y: root.y + (tip.y - root.y) * k };
};

/**
 * Fit a projected pose onto our bones.
 *
 * The two steps are ordered because they interact one way only: sinking the
 * pelvis lowers the shoulders and so changes what the arms can reach, while
 * clipping a hand cannot change what a leg needs. So the legs decide the sink,
 * the sink moves the torso, and everything is clipped last.
 *
 * The pose that comes out is guaranteed `overreachOf <= REACH`, because the
 * final step measures every one of the four limbs against the same root the
 * gate does and shortens any that is over. That is why this holds for an input
 * of any shape, including one from a body with longer limbs than ours.
 */
export function fitPose(naive: AuthoredPose): Fitted {
  const before = overreachOf(naive);
  const limitArm = REACH * ARM;
  const limitLeg = REACH * LEG;

  // 1. The stance. A foot on the floor stays on the floor; if it is further
  //    from its hip than the leg is long, the hips come down to meet it, and
  //    only if it is out of reach *horizontally* is the stance narrowed at all.
  const feet: [Normalised, Normalised] = [{ ...naive.feet[0] }, { ...naive.feet[1] }];
  const narrowed: [number, number] = [0, 0];
  let sink = 0;
  for (const i of [0, 1] as const) {
    if (feet[i].y > GROUNDED) continue;
    const hip = hipOf(naive, i);
    const dx = feet[i].x - hip.x;
    if (Math.abs(dx) > limitLeg * 0.98) {
      const kept = Math.sign(dx) * limitLeg * 0.98;
      narrowed[i] = Math.abs(dx - kept);
      feet[i] = { ...feet[i], x: hip.x + kept };
    }
    const reach = feet[i].x - hip.x;
    const vertical = Math.sqrt(Math.max(0, limitLeg * limitLeg - reach * reach));
    sink = Math.max(sink, hip.y - feet[i].y - vertical);
  }

  // 2. The torso moves as one piece, so its lean and its crouch survive.
  const down = (p: Normalised): Normalised => ({ x: p.x, y: p.y - sink });
  const pose: AuthoredPose = {
    ...(naive.bend ? { bend: naive.bend } : {}),
    // The twist is the source body's own rotation and the fit has no business
    // changing it — it is *what makes the clip fit*, not a cost of fitting.
    ...(naive.twist !== undefined ? { twist: naive.twist } : {}),
    pelvis: down(naive.pelvis),
    chest: down(naive.chest),
    head: down(naive.head),
    hands: [naive.hands[0], naive.hands[1]],
    feet,
  };

  // 3. Radial clip. After this no span exceeds its bone, by construction.
  pose.hands = [
    clipTo(shoulderOf(pose, 0), pose.hands[0], limitArm),
    clipTo(shoulderOf(pose, 1), pose.hands[1], limitArm),
  ];
  pose.feet = [clipTo(hipOf(pose, 0), pose.feet[0], limitLeg), clipTo(hipOf(pose, 1), pose.feet[1], limitLeg)];

  return { pose, sink, narrowed, before, after: overreachOf(pose) };
}

/* ---- one frame, end to end ----------------------------------------------- */

export interface RetargetedFrame {
  naive: AuthoredPose;
  fitted: AuthoredPose;
  lateral: Projected["lateral"];
  fit: Fitted;
  /** Per-point cost of the fit, in fractions of stature. */
  moved: Record<string, number>;
}

export function retargetFrame(
  clip: SmplxClip,
  frame: number,
  plane: Plane = planeOf(clip),
  options: ProjectOptions = {},
): RetargetedFrame {
  const projected = projectPose(forwardKinematics(clip, frame), plane, {
    travel: plane.travel[frame] ?? 0,
    ...options,
  });
  const fit = fitPose(projected.pose);
  return {
    naive: projected.pose,
    fitted: fit.pose,
    lateral: projected.lateral,
    fit,
    moved: displacement(projected.pose, fit.pose),
  };
}

/* ---- the clip's clock, resampled onto the action's ----------------------- */

/**
 * The frame of the clip the move is *at its most extended*, measured on the
 * naive projection.
 *
 * It has to be the naive one: the fit caps every limb at {@link REACH}, so a
 * clip with three frames past full extension would have three tied maxima and
 * the peak would be whichever came first. Before fitting, extension is still a
 * real number and the peak is a real frame.
 */
export function extensionPeak(clip: SmplxClip, plane: Plane = planeOf(clip), options: ProjectOptions = {}): number {
  let best = 0;
  let worst = -Infinity;
  for (let i = 0; i < clip.frames.length; i++) {
    const r = overreachOf(
      projectPose(forwardKinematics(clip, i), plane, { travel: plane.travel[i] ?? 0, ...options }).pose,
    );
    if (r > worst) {
      worst = r;
      best = i;
    }
  }
  return best;
}

/** The six anchors the shipped files use. */
const ANCHORS: readonly Anchor[] = [
  "start",
  ["startup", 0.5],
  "contact",
  "activeEnd",
  ["recovery", 0.4],
  "neutral",
];

export interface RetargetOptions extends ProjectOptions {
  character: string;
  move: string;
  anchors?: readonly Anchor[];
  /** Decimal places kept in the emitted file. The shipped ones use 3. */
  precision?: number;
}

export interface RetargetReport {
  file: PoseFile;
  peak: number;
  plane: Plane;
  /** One row per emitted key. */
  keys: {
    at: Anchor;
    /** The action frame the anchor resolved to. */
    frame: number;
    /** The clip frame the time-warp drew it from. */
    source: number;
    before: number;
    after: number;
    sink: number;
    moved: Record<string, number>;
    lateral: Projected["lateral"];
  }[];
  /** Anchors the action does not carry, named rather than guessed at. */
  skipped: string[];
}

const round = (v: number, places: number): number => {
  const k = 10 ** places;
  return Math.round(v * k) / k;
};

const roundPose = (p: AuthoredPose, places: number): AuthoredPose => {
  const r = (n: Normalised): Normalised => ({ x: round(n.x, places), y: round(n.y, places) });
  return {
    ...(p.bend ? { bend: p.bend } : {}),
    // Degrees, and one decimal is finer than a body can hold a pose.
    ...(p.twist !== undefined ? { twist: round(p.twist, 1) } : {}),
    pelvis: r(p.pelvis),
    chest: r(p.chest),
    head: r(p.head),
    hands: [r(p.hands[0]), r(p.hands[1])],
    feet: [r(p.feet[0]), r(p.feet[1])],
  };
};

/**
 * A whole clip, bound to one action, as a pose file.
 *
 * **The timing is the action's and the clip's is thrown away.** That is the
 * architecture (ADR-0067) and it is also why a 30fps model can drive a 60fps
 * game without anybody resampling a motion curve: the file names anchors, the
 * anchors resolve against the dump's own `MainFrame` and `MarginFrame`, and the
 * only thing taken from the clip's clock is *which frame of it each anchor is
 * drawn from*.
 *
 * That map is a two-piece linear warp pinned at three points — the clip's first
 * frame to the action's first, the **extension peak to `contact`**, and the
 * clip's last frame to the action's last. So the strike lands on the frame the
 * game says it lands on, the wind-up is compressed or stretched to fit the real
 * startup, and the recovery likewise. A clip that is 40 frames long driving an
 * 11-frame jab simply samples fewer of them.
 *
 * Anchors the action does not carry are dropped and named in
 * {@link RetargetReport.skipped}, and a key whose frame duplicates an earlier
 * one is dropped too, so the file that comes out always binds with no problems.
 */
export function retargetClip(clip: SmplxClip, action: GeometryAction, options: RetargetOptions): RetargetReport {
  const plane = planeOf(clip);
  const peak = extensionPeak(clip, plane, options);
  const clock = clockOf(action);
  const last = clip.frames.length - 1;
  const places = options.precision ?? 3;
  const end = clock.neutral ?? clock.frames ?? action.frames ?? 1;

  /** An action frame to the clip frame that should draw it. */
  const sourceOf = (frame: number): number => {
    const contact = clock.contact;
    if (contact === null) return Math.round((frame / Math.max(1, end)) * last);
    if (frame <= contact) {
      const u = contact <= 1 ? 1 : (frame - 1) / (contact - 1);
      return Math.round(u * peak);
    }
    const u = end <= contact ? 1 : (frame - contact) / (end - contact);
    return Math.max(0, Math.min(last, Math.round(peak + u * (last - peak))));
  };

  const keys: AuthoredKey[] = [];
  const rows: RetargetReport["keys"] = [];
  const skipped: string[] = [];
  const seen = new Set<number>();
  for (const at of options.anchors ?? ANCHORS) {
    const frame = resolveAnchor(clock, at);
    const name = typeof at === "string" ? at : `${at[0]} ${at[1]}`;
    if (frame === null) {
      skipped.push(`${name} does not resolve on ${action.name}`);
      continue;
    }
    if (seen.has(frame)) {
      skipped.push(`${name} lands on frame ${frame}, already taken`);
      continue;
    }
    seen.add(frame);
    const source = Math.max(0, Math.min(last, sourceOf(frame)));
    const r = retargetFrame(clip, source, plane, options);
    keys.push({ at, pose: roundPose(r.fitted, places) });
    rows.push({
      at,
      frame,
      source,
      before: r.fit.before,
      after: r.fit.after,
      sink: r.fit.sink,
      moved: r.moved,
      lateral: r.lateral,
    });
  }

  return {
    file: { character: options.character, move: options.move, action: action.name, keys },
    peak,
    plane,
    keys: rows,
    skipped,
  };
}
