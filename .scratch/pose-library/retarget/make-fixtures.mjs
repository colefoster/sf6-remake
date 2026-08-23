/**
 * Hand-building the SMPL-X clips that stand in for Kimodo output.
 *
 * There is no Kimodo here — it needs a gated download and a GPU — so the input
 * side of the retarget is fixtures. They are built the way a motion model's
 * output is *shaped*: a rest skeleton at real human proportions, a root
 * translation per frame, and 22 local XYZW rotations per frame, at 30fps. The
 * poses are authored as sparse keys in degrees and slerped between, so what
 * lands in `tests/fixtures/` is a dense clip with no straight-line joint paths.
 *
 *   node .scratch/pose-library/retarget/make-fixtures.mjs
 */
import { writeFileSync } from "node:fs";

const D = Math.PI / 180;

/* ---- quaternions --------------------------------------------------------- */

const axis = (x, y, z, deg) => {
  const h = (deg * D) / 2;
  const s = Math.sin(h);
  return [x * s, y * s, z * s, Math.cos(h)];
};
const rx = (d) => axis(1, 0, 0, d);
const ry = (d) => axis(0, 1, 0, d);
const rz = (d) => axis(0, 0, 1, d);
const I = [0, 0, 0, 1];

const mul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const chain = (...qs) => qs.reduce(mul, I);

const slerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let c = b;
  if (d < 0) {
    d = -d;
    c = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (d > 0.9995) {
    const o = a.map((v, i) => v + (c[i] - v) * t);
    const n = Math.hypot(...o) || 1;
    return o.map((v) => v / n);
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + c[i] * wb);
};

/* ---- the rest skeleton --------------------------------------------------- */

/**
 * Parent-relative offsets in metres, +X to the character's left, +Y up, +Z
 * forward. Proportions are adult anthropometric: sole-to-crown works out to
 * 1.723 m, hip-to-sole 0.537 of that, shoulder-to-wrist 0.337, shoulder line at
 * 0.804. The last three are the numbers the retarget is judged against.
 */
const REST = [
  [0, 0, 0], // 0 pelvis
  [0.085, -0.06, 0], // 1 left_hip
  [-0.085, -0.06, 0], // 2 right_hip
  [0, 0.1, 0], // 3 spine1
  [0, -0.43, 0], // 4 left_knee
  [0, -0.43, 0], // 5 right_knee
  [0, 0.12, 0], // 6 spine2
  [0, -0.42, 0], // 7 left_ankle
  [0, -0.42, 0], // 8 right_ankle
  [0, 0.05, 0], // 9 spine3
  [0, -0.075, 0.14], // 10 left_foot
  [0, -0.075, 0.14], // 11 right_foot
  [0, 0.18, 0], // 12 neck
  [0.075, 0.1, 0], // 13 left_collar
  [-0.075, 0.1, 0], // 14 right_collar
  [0, 0.09, 0], // 15 head
  [0.105, 0.03, 0], // 16 left_shoulder
  [-0.105, 0.03, 0], // 17 right_shoulder
  [0.32, 0, 0], // 18 left_elbow
  [-0.32, 0, 0], // 19 right_elbow
  [0.26, 0, 0], // 20 left_wrist
  [-0.26, 0, 0], // 21 right_wrist
];

/** The same body with 12% longer limbs — a taller model's output. */
const LANKY = REST.map((o, i) => ([4, 5, 7, 8, 18, 19, 20, 21].includes(i) ? o.map((v) => v * 1.12) : o));

const N = {
  pelvis: 0,
  lhip: 1,
  rhip: 2,
  spine1: 3,
  lknee: 4,
  rknee: 5,
  spine2: 6,
  lankle: 7,
  rankle: 8,
  spine3: 9,
  lfoot: 10,
  rfoot: 11,
  neck: 12,
  lcollar: 13,
  rcollar: 14,
  head: 15,
  lshoulder: 16,
  rshoulder: 17,
  lelbow: 18,
  relbow: 19,
  lwrist: 20,
  rwrist: 21,
};

/* ---- pose vocabulary ----------------------------------------------------- */

// A hip rotation about +X swings the knee towards -Z, so forward flexion is -X.
const hip = (flex, abduct = 0, twist = 0) => chain(ry(twist), rx(-flex), rz(abduct));
const knee = (bend) => rx(bend);
const ankle = (flex) => rx(-flex);
// The left arm rests along +X and the right along -X, so a swing that reads the
// same on both sides has to be mirrored in Y and Z.
const larm = (yaw, lift) => chain(ry(yaw), rz(lift));
const rarm = (yaw, lift) => chain(ry(-yaw), rz(-lift));
const lelbow = (bend) => ry(-bend);
const relbow = (bend) => ry(bend);

const pose = (parts) => {
  const rot = REST.map(() => I);
  for (const [k, q] of Object.entries(parts)) rot[N[k]] = q;
  return rot;
};

/** Sparse keys -> a dense clip, slerped joint by joint. */
const densify = (keys, frames) => {
  const out = [];
  for (let f = 0; f < frames; f++) {
    const u = (f / (frames - 1)) * (keys.length - 1);
    const i = Math.min(keys.length - 2, Math.floor(u));
    const t = u - i;
    const a = keys[i];
    const b = keys[i + 1];
    out.push({
      root: a.root.map((v, k) => v + (b.root[k] - v) * t),
      rot: a.rot.map((q, k) => slerp(q, b.rot[k], t)),
    });
  }
  return out;
};

/* ---- the guard ----------------------------------------------------------- */

/**
 * An orthodox stance: the body bladed 35 degrees so the left side leads, both
 * knees bent, hands up. `facing` is stated on every clip because a bladed
 * pelvis is exactly the case where reading the fight's forward off the hips is
 * wrong.
 */
const guard = () =>
  pose({
    pelvis: ry(-35),
    lhip: hip(18, -4),
    rhip: hip(-14, 4),
    lknee: knee(26),
    rknee: knee(30),
    lankle: ankle(-8),
    rankle: ankle(-16),
    spine1: ry(-6),
    spine2: ry(-8),
    spine3: ry(-4),
    neck: ry(20),
    lcollar: ry(-4),
    rcollar: ry(4),
    lshoulder: larm(-62, -52),
    rshoulder: rarm(-40, -58),
    lelbow: lelbow(88),
    relbow: relbow(96),
  });

const GUARD_ROOT = [0, 0.855, 0];

/* ---- clip 1: a straight rear-hand punch ---------------------------------- */

const punch = (rest = REST, name = "straight-punch") => {
  const keys = [
    { root: GUARD_ROOT, rot: guard() },
    // Load: the rear hip coils, the torso winds away.
    {
      root: [0, 0.895, -0.02],
      rot: pose({
        pelvis: ry(-44),
        lhip: hip(20, -4),
        rhip: hip(-18, 4),
        lknee: knee(30),
        rknee: knee(34),
        lankle: ankle(-8),
        rankle: ankle(-18),
        spine1: ry(-8),
        spine2: ry(-10),
        spine3: ry(-5),
        neck: ry(26),
        lshoulder: larm(-60, -50),
        rshoulder: rarm(-30, -62),
        lelbow: lelbow(90),
        relbow: relbow(104),
      }),
    },
    // Contact: the rear side drives through, the hips square up past the plane,
    // and the arm is straight along the fight's forward.
    {
      root: [0, 0.885, 0.1],
      rot: pose({
        pelvis: ry(-6),
        lhip: hip(14, -4),
        rhip: hip(-24, 6, 8),
        lknee: knee(24),
        rknee: knee(16),
        lankle: ankle(-4),
        rankle: ankle(-30),
        spine1: ry(6),
        spine2: ry(8),
        spine3: ry(4),
        neck: ry(-12),
        rcollar: ry(14),
        lshoulder: larm(-52, -62),
        rshoulder: rarm(-84, -4),
        lelbow: lelbow(104),
        relbow: relbow(4),
      }),
    },
    // Held one beat at extension.
    {
      root: [0, 0.884, 0.1],
      rot: pose({
        pelvis: ry(-8),
        lhip: hip(14, -4),
        rhip: hip(-24, 6, 8),
        lknee: knee(24),
        rknee: knee(17),
        lankle: ankle(-4),
        rankle: ankle(-30),
        spine1: ry(5),
        spine2: ry(7),
        spine3: ry(4),
        neck: ry(-10),
        rcollar: ry(13),
        lshoulder: larm(-52, -62),
        rshoulder: rarm(-80, -6),
        lelbow: lelbow(102),
        relbow: relbow(8),
      }),
    },
    { root: [0, 0.853, 0.03], rot: guard() },
    { root: GUARD_ROOT, rot: guard() },
  ];
  return {
    name,
    fps: 30,
    facing: [0, 1],
    rest,
    frames: densify(keys, 21),
  };
};

/* ---- clip 2: a rear-leg roundhouse --------------------------------------- */

const roundhouse = () => {
  const keys = [
    { root: GUARD_ROOT, rot: guard() },
    // Chamber: the rear knee comes up and across, the support foot pivots.
    {
      root: [0, 0.9, 0],
      rot: pose({
        pelvis: ry(-30),
        lhip: hip(10, -4),
        rhip: hip(56, 26, -10),
        lknee: knee(20),
        rknee: knee(104),
        lankle: ankle(-6),
        rankle: ankle(-24),
        spine1: ry(-4),
        spine2: rz(-8),
        neck: ry(24),
        lshoulder: larm(-70, -40),
        rshoulder: rarm(-52, -44),
        lelbow: lelbow(92),
        relbow: relbow(92),
      }),
    },
    // Contact: hips rotated fully over, the shin whips out, the torso leans
    // back to counterweight it. The leg is close to straight — this is the
    // pose that asks our leg bone for nearly all of itself.
    {
      root: [0, 0.94, 0.02],
      rot: pose({
        pelvis: chain(ry(52), rz(-24)),
        lhip: hip(-6, -6, 0),
        rhip: hip(92, 34, -46),
        lknee: knee(12),
        rknee: knee(14),
        lankle: ankle(4),
        rankle: ankle(-34),
        spine1: chain(ry(-14), rz(10)),
        spine2: chain(ry(-16), rz(12)),
        spine3: rz(6),
        neck: chain(ry(-26), rz(-14)),
        lshoulder: larm(-96, -18),
        rshoulder: rarm(-140, -30),
        lelbow: lelbow(60),
        relbow: relbow(70),
      }),
    },
    // Retract along the same arc.
    {
      root: [0, 0.92, 0.01],
      rot: pose({
        pelvis: chain(ry(20), rz(-14)),
        lhip: hip(2, -6),
        rhip: hip(60, 28, -22),
        lknee: knee(18),
        rknee: knee(76),
        lankle: ankle(0),
        rankle: ankle(-28),
        spine1: ry(-8),
        spine2: chain(ry(-8), rz(6)),
        neck: ry(-8),
        lshoulder: larm(-84, -30),
        rshoulder: rarm(-100, -36),
        lelbow: lelbow(76),
        relbow: relbow(84),
      }),
    },
    { root: [0, 0.857, 0], rot: guard() },
    { root: GUARD_ROOT, rot: guard() },
  ];
  return { name: "roundhouse-kick", fps: 30, facing: [0, 1], rest: REST, frames: densify(keys, 24) };
};

/* ---- clip 3: a low sweep ------------------------------------------------- */

const sweep = () => {
  const keys = [
    { root: GUARD_ROOT, rot: guard() },
    // Drop into the squat, hands down for balance.
    {
      root: [0, 0.7, -0.04],
      rot: pose({
        pelvis: ry(-32),
        lhip: hip(56, -6),
        rhip: hip(40, 10),
        lknee: knee(80),
        rknee: knee(94),
        lankle: ankle(24),
        rankle: ankle(20),
        spine1: rx(-14),
        spine2: chain(rx(-10), ry(-6)),
        neck: chain(rx(14), ry(20)),
        lshoulder: larm(-40, -70),
        rshoulder: rarm(-30, -74),
        lelbow: lelbow(60),
        relbow: relbow(70),
      }),
    },
    // Contact: the rear leg scythes out flat along the floor, nearly straight,
    // from a pelvis that is already low.
    {
      root: [0, 0.5, 0.02],
      rot: pose({
        pelvis: chain(ry(4), rz(-10)),
        lhip: hip(96, -12),
        rhip: hip(96, 16, -34),
        lknee: knee(122),
        rknee: knee(8),
        lankle: ankle(30),
        rankle: ankle(-10),
        spine1: chain(rx(-24), ry(-6)),
        spine2: chain(rx(-16), ry(-8)),
        neck: chain(rx(26), ry(4)),
        lshoulder: larm(-14, -84),
        rshoulder: rarm(-96, -46),
        lelbow: lelbow(24),
        relbow: relbow(40),
      }),
    },
    {
      root: [0, 0.62, 0],
      rot: pose({
        pelvis: ry(-20),
        lhip: hip(70, -8),
        rhip: hip(56, 10, -12),
        lknee: knee(96),
        rknee: knee(60),
        lankle: ankle(26),
        rankle: ankle(10),
        spine1: rx(-18),
        spine2: chain(rx(-12), ry(-6)),
        neck: chain(rx(18), ry(14)),
        lshoulder: larm(-30, -76),
        rshoulder: rarm(-50, -60),
        lelbow: lelbow(48),
        relbow: relbow(62),
      }),
    },
    { root: [0, 0.84, -0.01], rot: guard() },
    { root: GUARD_ROOT, rot: guard() },
  ];
  return { name: "low-sweep", fps: 30, facing: [0, 1], rest: REST, frames: densify(keys, 26) };
};

/* ---- write --------------------------------------------------------------- */

const round = (v) => Math.round(v * 1e6) / 1e6;
const tidy = (clip) => ({
  ...clip,
  rest: clip.rest.map((o) => o.map(round)),
  frames: clip.frames.map((f) => ({ root: f.root.map(round), rot: f.rot.map((q) => q.map(round)) })),
});

const dir = "tests/fixtures";
const clips = [punch(), roundhouse(), sweep(), punch(LANKY, "lanky-punch")];
for (const clip of clips) {
  writeFileSync(`${dir}/smplx-${clip.name}.json`, `${JSON.stringify(tidy(clip))}\n`);
  console.log(`${dir}/smplx-${clip.name}.json  ${clip.frames.length} frames`);
}
