/** Every number ADR-0070 quotes, measured. Read-only. */
import { readFileSync } from "node:fs";
import { loadGeometry } from "../../../src/data/load-geometry.js";
import { loadPose, authoredMoves } from "../../../src/data/load-poses.js";
import { buildOf } from "../../../src/game/render.js";
import { overreach, resolveKeys, shoulderHalfAt, type AuthoredPose } from "../../../src/game/pose-library.js";
import {
  displacement,
  extensionPeak,
  fitPose,
  forwardKinematics,
  overreachOf,
  planeOf,
  projectPose,
  reachOf,
  retargetClip,
  type SmplxClip,
} from "../../../src/game/retarget.js";

const ryu = loadGeometry("ryu")!;
const build = buildOf(ryu);
const byName = (n: string) => ryu.actions.find((a) => a.name === n)!;

console.log("## per-file overreach");
console.log("| move | action | Ryu build | even build | twist at contact |");
console.log("|---|---|---|---|---|");
for (const move of authoredMoves("ryu")) {
  const file = loadPose("ryu", move)!;
  const action = byName(file.action);
  const r = resolveKeys(file, action);
  const contact = file.keys.find((k) => k.at === "contact")?.pose.twist;
  console.log(
    `| ${move} | ${file.action} | ${overreach(r.keys, build).toFixed(3)} | ${overreach(r.keys).toFixed(3)} | ${contact ?? 0} |`,
  );
  if (r.problems.length) console.log("   PROBLEMS", r.problems);
}

console.log("\n## per-limb reach at each key of the three punches");
for (const move of ["5LP", "5MP", "5HP", "236LP"]) {
  const file = loadPose("ryu", move)!;
  console.log(`### ${move}`);
  for (const k of file.keys) {
    const r = reachOf(k.pose);
    console.log(
      `  ${JSON.stringify(k.at).padEnd(18)} tw=${String(k.pose.twist ?? 0).padStart(5)} half=${shoulderHalfAt(k.pose.twist).toFixed(3)}` +
        ` handL=${r.hands[0].toFixed(3)} handR=${r.hands[1].toFixed(3)} footL=${r.feet[0].toFixed(3)} footR=${r.feet[1].toFixed(3)}`,
    );
  }
}

/* ---- the fixtures -------------------------------------------------------- */

const clips: SmplxClip[] = ["straight-punch", "roundhouse-kick", "low-sweep", "lanky-punch"].map(
  (n) => JSON.parse(readFileSync(`tests/fixtures/smplx-${n}.json`, "utf8")) as SmplxClip,
);

console.log("\n## fixtures: naive and fitted, all frames");
console.log("| clip | frames | peak | naive p50 | naive max | fitted max |");
console.log("|---|---|---|---|---|---|");
for (const clip of clips) {
  const plane = planeOf(clip);
  const naive = clip.frames.map((_, i) =>
    projectPose(forwardKinematics(clip, i), plane, { travel: plane.travel[i] ?? 0 }),
  );
  const over = naive.map((p) => overreachOf(p.pose));
  const sorted = [...over].sort((a, b) => a - b);
  const fitted = naive.map((p) => overreachOf(fitPose(p.pose).pose));
  console.log(
    `| ${clip.name} | ${clip.frames.length} | ${extensionPeak(clip, plane)} | ${sorted[Math.floor(sorted.length / 2)]!.toFixed(3)} | ${Math.max(...over).toFixed(3)} | ${Math.max(...fitted).toFixed(3)} |`,
  );
}

console.log("\n## worst per-point cost of the fit, all 92 frames");
const worst: Record<string, number> = {};
let needed = 0;
let total = 0;
for (const clip of clips) {
  const plane = planeOf(clip);
  for (let i = 0; i < clip.frames.length; i++) {
    const p = projectPose(forwardKinematics(clip, i), plane, { travel: plane.travel[i] ?? 0 }).pose;
    total++;
    if (overreachOf(p) > 0.94) needed++;
    const f = fitPose(p);
    for (const [k, v] of Object.entries(displacement(p, f.pose))) worst[k] = Math.max(worst[k] ?? 0, v);
  }
}
console.log(`${needed} of ${total} frames need the fit at all`);
for (const [k, v] of Object.entries(worst).sort((a, b) => b[1] - a[1]))
  console.log(`| \`${k}\` | ${v.toFixed(3)} | ${(v * 166).toFixed(1)} |`);

console.log("\n## the punch contact frame, in detail");
{
  const clip = clips[0]!;
  const plane = planeOf(clip);
  const peak = extensionPeak(clip, plane);
  const joints = forwardKinematics(clip, peak);
  const p = projectPose(joints, plane, { travel: plane.travel[peak] ?? 0 }).pose;
  const s = plane.stature;
  const fwd = (j: number) =>
    ((joints[j]![0] - plane.origin[0]) * plane.forward[0] + (joints[j]![2] - plane.origin[1]) * plane.forward[1]) / s -
    (plane.travel[peak] ?? 0);
  const [leadSh, rearSh] = plane.leadIsLeft ? [16, 17] : [17, 16];
  const [leadHip, rearHip] = plane.leadIsLeft ? [1, 2] : [2, 1];
  console.log(`peak frame ${peak}, derived twist ${p.twist!.toFixed(1)}deg`);
  console.log(`chest.x ${p.chest.x.toFixed(3)}  real lead sh ${fwd(leadSh).toFixed(3)}  real rear sh ${fwd(rearSh).toFixed(3)}`);
  console.log(
    `figure lead sh ${(p.chest.x + shoulderHalfAt(p.twist)).toFixed(3)}  figure rear sh ${(p.chest.x - shoulderHalfAt(p.twist)).toFixed(3)}` +
      `  untwisted rear sh ${(p.chest.x - 0.133).toFixed(3)}`,
  );
  console.log(`pelvis.x ${p.pelvis.x.toFixed(3)}  real lead hip ${fwd(leadHip).toFixed(3)}  real rear hip ${fwd(rearHip).toFixed(3)}`);
  console.log(`  figure lead hip ${(p.pelvis.x + 0.072).toFixed(3)}  figure rear hip ${(p.pelvis.x - 0.072).toFixed(3)}`);
  const r = reachOf(p);
  const untwisted: AuthoredPose = { ...p, twist: 0 };
  const ru = reachOf(untwisted);
  console.log(`reach with twist  hands ${r.hands.map((v) => v.toFixed(3)).join(" ")}  feet ${r.feet.map((v) => v.toFixed(3)).join(" ")}`);
  console.log(`reach at twist 0  hands ${ru.hands.map((v) => v.toFixed(3)).join(" ")}  feet ${ru.feet.map((v) => v.toFixed(3)).join(" ")}`);
}

console.log("\n## the hip line, every frame of every fixture");
{
  let worstHip = 0;
  let where = "";
  const rows: number[] = [];
  for (const clip of clips) {
    const plane = planeOf(clip);
    for (let i = 0; i < clip.frames.length; i++) {
      const joints = forwardKinematics(clip, i);
      const t = plane.travel[i] ?? 0;
      const fwd = (j: number) =>
        ((joints[j]![0] - plane.origin[0]) * plane.forward[0] +
          (joints[j]![2] - plane.origin[1]) * plane.forward[1]) /
          plane.stature -
        t;
      const [leadHip, rearHip] = plane.leadIsLeft ? [1, 2] : [2, 1];
      const half = (fwd(leadHip) - fwd(rearHip)) / 2;
      const d = Math.abs(half - 0.072);
      rows.push(half);
      if (d > worstHip) {
        worstHip = d;
        where = `${clip.name} f${i}`;
      }
    }
  }
  rows.sort((a, b) => a - b);
  console.log(
    `real hip half-separation: min ${rows[0]!.toFixed(3)} p50 ${rows[Math.floor(rows.length / 2)]!.toFixed(3)} max ${rows[rows.length - 1]!.toFixed(3)}; figure holds 0.072`,
  );
  console.log(`worst disagreement ${worstHip.toFixed(3)} at ${where}`);
}

console.log("\n## clip to action");
console.log("| clip -> action | keys | problems | file overreach | hand-authored |");
console.log("|---|---|---|---|---|");
for (const [clipName, actionName, move] of [
  ["straight-punch", "ATK_5MP", "5MP"],
  ["roundhouse-kick", "ATK_5HK", "5HK"],
  ["low-sweep", "ATK_2HK", "2HK"],
  ["roundhouse-kick", "ATK_8HK", ""],
] as const) {
  const clip = clips.find((c) => c.name === clipName)!;
  const action = byName(actionName);
  const rep = retargetClip(clip, action, { character: "ryu", move: move || "8HK" });
  const r = resolveKeys(rep.file, action);
  const hand = move ? overreach(resolveKeys(loadPose("ryu", move)!, byName(loadPose("ryu", move)!.action)).keys) : NaN;
  console.log(
    `| ${clipName} -> ${actionName} | ${rep.file.keys.length} | ${rep.skipped.length ? rep.skipped.join("; ") : "none"} | ${overreach(r.keys).toFixed(3)} | ${Number.isNaN(hand) ? "—" : hand.toFixed(3)} |`,
  );
  console.log(
    `    twists ${rep.file.keys.map((k) => k.pose.twist).join(", ")}   contact naive ${rep.keys.find((k) => k.at === "contact")?.before.toFixed(3)}`,
  );
}
