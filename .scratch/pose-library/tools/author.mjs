/**
 * Authoring the eleven Ryu pose files on the ADR-0060 skeleton.
 *
 * The numbers below are hand-composed; this script exists to emit them as JSON
 * and to fail loudly on the one constraint that is arithmetic rather than taste:
 * a hand within ARM of its shoulder, a foot within LEG of its hip.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = join(ROOT, "data", "poses", "ryu");

const SHOULDER_HALF = 0.133;
const PELVIS_HALF = 0.072;
const ARM = 0.37;
const LEG = 0.53 * 1.02;
// Ryu's build, from buildOf(geo).
const BUILD = { arm: 1, leg: 1 };
const LIMIT = 0.95;

const p = (x, y) => ({ x, y });

/* ---- the two stances everything else departs from ------------------------ */

/**
 * The standing neutral. The derived idle is pelvis 0.5308 / chest 0.8313 /
 * head 0.8976 and cannot be copied: its lead hip sits 0.5373 from its lead
 * foot, 0.992 of the 0.5415 leg bone. Under the 0.95 gate a foot-on-floor
 * pelvis caps at 0.5144 even with the feet directly beneath the hips, so this
 * neutral is 0.500 — a fighting stance that is slightly crouched because the
 * bone says it must be.
 */
const N = {
  pelvis: p(-0.005, 0.5),
  chest: p(-0.01, 0.808),
  head: p(0.012, 0.876),
  hands: [p(0.235, 0.668), p(-0.045, 0.618)],
  feet: [p(0.145, 0), p(-0.15, 0)],
};

/** The crouching neutral: the stance the three low normals start and end in. */
const C = {
  pelvis: p(-0.01, 0.3),
  chest: p(0.02, 0.585),
  head: p(0.05, 0.65),
  hands: [p(0.2, 0.47), p(-0.05, 0.44)],
  feet: [p(0.2, 0), p(-0.22, 0)],
};

/* ---- the eleven ---------------------------------------------------------- */

const moves = {
  "5LP": {
    action: "ATK_5LP",
    keys: [
      { at: "start", pose: N },
      {
        at: ["startup", 0.6],
        pose: {
          pelvis: p(0.0, 0.502),
          chest: p(-0.02, 0.808),
          head: p(0.005, 0.876),
          hands: [p(0.2, 0.68), p(-0.055, 0.625)],
          feet: [p(0.145, 0), p(-0.15, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(0.01, 0.5),
          chest: p(0.02, 0.808),
          head: p(0.03, 0.876),
          hands: [p(0.495, 0.775), p(-0.03, 0.64)],
          feet: [p(0.15, 0), p(-0.145, 0)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(0.01, 0.5),
          chest: p(0.02, 0.806),
          head: p(0.03, 0.874),
          hands: [p(0.49, 0.772), p(-0.03, 0.64)],
          feet: [p(0.15, 0), p(-0.145, 0)],
        },
      },
      {
        at: ["recovery", 0.45],
        pose: {
          pelvis: p(0.0, 0.501),
          chest: p(0.0, 0.807),
          head: p(0.02, 0.875),
          hands: [p(0.32, 0.7), p(-0.04, 0.625)],
          feet: [p(0.145, 0), p(-0.15, 0)],
        },
      },
      { at: "neutral", pose: N },
    ],
  },

  "5MP": {
    action: "ATK_5MP",
    keys: [
      { at: "start", pose: N },
      {
        at: ["startup", 0.5],
        pose: {
          pelvis: p(-0.015, 0.499),
          chest: p(-0.035, 0.806),
          head: p(-0.01, 0.874),
          hands: [p(0.14, 0.7), p(-0.075, 0.615)],
          feet: [p(0.14, 0), p(-0.16, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(0.015, 0.498),
          chest: p(0.03, 0.805),
          head: p(0.045, 0.872),
          hands: [p(0.51, 0.79), p(-0.04, 0.65)],
          feet: [p(0.175, 0), p(-0.15, 0)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(0.015, 0.497),
          chest: p(0.03, 0.803),
          head: p(0.045, 0.87),
          hands: [p(0.505, 0.786), p(-0.04, 0.65)],
          feet: [p(0.175, 0), p(-0.15, 0)],
        },
      },
      {
        at: ["recovery", 0.4],
        pose: {
          pelvis: p(0.005, 0.5),
          chest: p(0.005, 0.807),
          head: p(0.025, 0.875),
          hands: [p(0.31, 0.71), p(-0.045, 0.63)],
          feet: [p(0.155, 0), p(-0.15, 0)],
        },
      },
      { at: "neutral", pose: N },
    ],
  },

  "5HP": {
    action: "ATK_5HP",
    keys: [
      { at: "start", pose: N },
      {
        at: ["startup", 0.5],
        pose: {
          pelvis: p(-0.03, 0.495),
          chest: p(-0.05, 0.802),
          head: p(-0.025, 0.87),
          hands: [p(0.06, 0.76), p(-0.11, 0.6)],
          feet: [p(0.13, 0), p(-0.17, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(0.03, 0.475),
          chest: p(0.055, 0.785),
          head: p(0.075, 0.85),
          hands: [p(0.532, 0.762), p(-0.02, 0.64)],
          feet: [p(0.23, 0), p(-0.185, 0)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(0.03, 0.473),
          chest: p(0.055, 0.782),
          head: p(0.075, 0.847),
          hands: [p(0.527, 0.757), p(-0.02, 0.64)],
          feet: [p(0.23, 0), p(-0.185, 0)],
        },
      },
      {
        at: ["recovery", 0.4],
        pose: {
          pelvis: p(0.005, 0.495),
          chest: p(0.015, 0.802),
          head: p(0.035, 0.87),
          hands: [p(0.33, 0.72), p(-0.035, 0.63)],
          feet: [p(0.17, 0), p(-0.165, 0)],
        },
      },
      { at: "neutral", pose: N },
    ],
  },

  "2LK": {
    action: "ATK_2LK",
    keys: [
      { at: "start", pose: C },
      {
        at: ["startup", 0.6],
        pose: {
          pelvis: p(-0.02, 0.298),
          chest: p(0.01, 0.583),
          head: p(0.04, 0.648),
          hands: [p(0.19, 0.47), p(-0.055, 0.44)],
          feet: [p(0.21, 0.03), p(-0.22, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(-0.03, 0.295),
          chest: p(0.0, 0.58),
          head: p(0.03, 0.645),
          hands: [p(0.17, 0.47), p(-0.06, 0.44)],
          feet: [p(0.4, 0.045), p(-0.22, 0)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(-0.03, 0.295),
          chest: p(0.0, 0.58),
          head: p(0.03, 0.645),
          hands: [p(0.17, 0.47), p(-0.06, 0.44)],
          feet: [p(0.405, 0.045), p(-0.22, 0)],
        },
      },
      {
        at: ["recovery", 0.4],
        pose: {
          pelvis: p(-0.02, 0.298),
          chest: p(0.01, 0.583),
          head: p(0.04, 0.648),
          hands: [p(0.19, 0.47), p(-0.055, 0.44)],
          feet: [p(0.27, 0.02), p(-0.22, 0)],
        },
      },
      { at: "neutral", pose: C },
    ],
  },

  "2MK": {
    action: "ATK_2MK_Y2",
    keys: [
      { at: "start", pose: C },
      {
        at: ["startup", 0.6],
        pose: {
          pelvis: p(-0.02, 0.275),
          chest: p(0.005, 0.565),
          head: p(0.035, 0.63),
          hands: [p(0.175, 0.45), p(-0.09, 0.42)],
          feet: [p(0.23, 0.04), p(-0.225, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(-0.06, 0.25),
          chest: p(-0.02, 0.54),
          head: p(0.02, 0.605),
          hands: [p(0.15, 0.43), p(-0.13, 0.4)],
          feet: [p(0.475, 0.055), p(-0.235, 0)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(-0.06, 0.25),
          chest: p(-0.02, 0.54),
          head: p(0.02, 0.605),
          hands: [p(0.15, 0.43), p(-0.13, 0.4)],
          feet: [p(0.47, 0.055), p(-0.235, 0)],
        },
      },
      {
        at: ["recovery", 0.4],
        pose: {
          pelvis: p(-0.03, 0.285),
          chest: p(0.005, 0.572),
          head: p(0.035, 0.637),
          hands: [p(0.18, 0.46), p(-0.075, 0.43)],
          feet: [p(0.29, 0.02), p(-0.225, 0)],
        },
      },
      { at: "neutral", pose: C },
    ],
  },

  "2HK": {
    action: "ATK_2HK",
    keys: [
      { at: "start", pose: C },
      {
        at: ["startup", 0.55],
        pose: {
          pelvis: p(-0.05, 0.24),
          chest: p(-0.04, 0.53),
          head: p(0.0, 0.595),
          hands: [p(0.12, 0.42), p(-0.235, 0.29)],
          feet: [p(0.24, 0.02), p(-0.24, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(-0.1, 0.215),
          chest: p(-0.1, 0.5),
          head: p(-0.05, 0.565),
          hands: [p(0.06, 0.4), p(-0.3, 0.2)],
          feet: [p(0.425, 0.02), p(-0.25, 0)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(-0.1, 0.215),
          chest: p(-0.1, 0.5),
          head: p(-0.05, 0.565),
          hands: [p(0.06, 0.4), p(-0.3, 0.2)],
          feet: [p(0.42, 0.02), p(-0.25, 0)],
        },
      },
      {
        at: ["recovery", 0.4],
        pose: {
          pelvis: p(-0.04, 0.27),
          chest: p(-0.02, 0.558),
          head: p(0.02, 0.623),
          hands: [p(0.14, 0.44), p(-0.19, 0.35)],
          feet: [p(0.24, 0), p(-0.235, 0)],
        },
      },
      { at: "neutral", pose: C },
    ],
  },

  "5HK": {
    action: "ATK_5HK",
    keys: [
      { at: "start", pose: N },
      {
        at: ["startup", 0.5],
        pose: {
          pelvis: p(-0.02, 0.47),
          chest: p(-0.04, 0.79),
          head: p(-0.01, 0.858),
          hands: [p(0.18, 0.7), p(-0.1, 0.64)],
          feet: [p(0.15, 0.28), p(-0.16, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(-0.07, 0.47),
          chest: p(-0.11, 0.77),
          head: p(-0.15, 0.835),
          hands: [p(0.09, 0.66), p(-0.38, 0.66)],
          feet: [p(0.44, 0.68), p(-0.175, 0)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(-0.07, 0.47),
          chest: p(-0.11, 0.768),
          head: p(-0.15, 0.833),
          hands: [p(0.09, 0.655), p(-0.385, 0.655)],
          feet: [p(0.445, 0.665), p(-0.175, 0)],
        },
      },
      {
        at: ["recovery", 0.4],
        pose: {
          pelvis: p(-0.03, 0.48),
          chest: p(-0.05, 0.79),
          head: p(-0.03, 0.857),
          hands: [p(0.15, 0.68), p(-0.2, 0.65)],
          feet: [p(0.23, 0.18), p(-0.165, 0)],
        },
      },
      { at: "neutral", pose: N },
    ],
  },

  jHK: {
    action: "ATK_8HK",
    keys: [
      {
        at: "start",
        pose: {
          pelvis: p(0.0, 0.52),
          chest: p(0.01, 0.82),
          head: p(0.03, 0.888),
          hands: [p(0.2, 0.69), p(-0.1, 0.64)],
          feet: [p(0.13, 0.23), p(-0.13, 0.15)],
        },
      },
      {
        at: ["startup", 0.5],
        pose: {
          pelvis: p(-0.01, 0.52),
          chest: p(0.03, 0.815),
          head: p(0.06, 0.883),
          hands: [p(0.22, 0.71), p(-0.13, 0.66)],
          feet: [p(0.16, 0.36), p(-0.14, 0.16)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(-0.02, 0.52),
          chest: p(-0.04, 0.81),
          head: p(-0.02, 0.878),
          hands: [p(0.15, 0.68), p(-0.3, 0.7)],
          feet: [p(0.47, 0.25), p(-0.15, 0.17)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(-0.02, 0.52),
          chest: p(-0.045, 0.808),
          head: p(-0.03, 0.876),
          hands: [p(0.14, 0.675), p(-0.31, 0.695)],
          feet: [p(0.475, 0.235), p(-0.155, 0.17)],
        },
      },
    ],
  },

  "236LP": {
    action: "SPA_HADO",
    keys: [
      { at: "start", pose: N },
      {
        at: ["startup", 0.5],
        pose: {
          pelvis: p(-0.02, 0.495),
          chest: p(-0.05, 0.8),
          head: p(-0.03, 0.868),
          hands: [p(-0.09, 0.56), p(-0.15, 0.53)],
          feet: [p(0.15, 0), p(-0.16, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(0.03, 0.488),
          chest: p(0.075, 0.795),
          head: p(0.09, 0.86),
          hands: [p(0.545, 0.755), p(0.27, 0.74)],
          feet: [p(0.185, 0), p(-0.155, 0)],
        },
      },
      {
        at: ["recovery", 0.4],
        pose: {
          pelvis: p(0.01, 0.495),
          chest: p(0.03, 0.802),
          head: p(0.045, 0.869),
          hands: [p(0.36, 0.72), p(0.15, 0.68)],
          feet: [p(0.17, 0), p(-0.155, 0)],
        },
      },
      { at: "neutral", pose: N },
    ],
  },

  "623LP": {
    action: "SPA_SYORYU_START",
    keys: [
      {
        at: "start",
        pose: {
          pelvis: p(-0.01, 0.485),
          chest: p(-0.015, 0.793),
          head: p(0.005, 0.861),
          hands: [p(0.2, 0.66), p(-0.055, 0.61)],
          feet: [p(0.15, 0), p(-0.155, 0)],
        },
      },
      {
        at: ["startup", 0.5],
        pose: {
          pelvis: p(0.0, 0.42),
          chest: p(0.03, 0.725),
          head: p(0.055, 0.793),
          hands: [p(0.13, 0.52), p(-0.07, 0.56)],
          feet: [p(0.17, 0), p(-0.17, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(0.01, 0.52),
          chest: p(0.02, 0.825),
          head: p(0.035, 0.893),
          hands: [p(0.23, 1.13), p(-0.13, 0.64)],
          feet: [p(0.13, 0.08), p(-0.13, 0.03)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(-0.01, 0.52),
          chest: p(-0.02, 0.828),
          head: p(-0.01, 0.896),
          hands: [p(0.15, 1.17), p(-0.2, 0.7)],
          feet: [p(0.09, 0.17), p(-0.18, 0.06)],
        },
      },
    ],
  },

  "214LK": {
    action: "SPA_TATSUMAKI_END",
    keys: [
      { at: "start", pose: N },
      {
        at: ["startup", 0.55],
        pose: {
          pelvis: p(0.0, 0.47),
          chest: p(-0.03, 0.775),
          head: p(-0.01, 0.843),
          hands: [p(0.17, 0.66), p(-0.15, 0.64)],
          feet: [p(0.16, 0), p(-0.17, 0)],
        },
      },
      {
        at: "contact",
        pose: {
          pelvis: p(-0.02, 0.56),
          chest: p(-0.04, 0.86),
          head: p(-0.03, 0.928),
          hands: [p(0.29, 0.94), p(-0.4, 0.83)],
          feet: [p(0.51, 0.6), p(-0.13, 0.29)],
        },
      },
      {
        at: "activeEnd",
        pose: {
          pelvis: p(-0.02, 0.575),
          chest: p(-0.04, 0.875),
          head: p(-0.03, 0.943),
          hands: [p(0.25, 0.96), p(-0.42, 0.8)],
          feet: [p(0.5, 0.63), p(-0.16, 0.31)],
        },
      },
      {
        at: ["recovery", 0.4],
        pose: {
          pelvis: p(-0.01, 0.47),
          chest: p(-0.02, 0.775),
          head: p(0.0, 0.843),
          hands: [p(0.2, 0.67), p(-0.12, 0.63)],
          feet: [p(0.18, 0), p(-0.18, 0)],
        },
      },
      { at: "neutral", pose: N },
    ],
  },
};

/* ---- emit and check ------------------------------------------------------ */

const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let worstAll = 0;
let failed = false;

for (const [move, def] of Object.entries(moves)) {
  let worst = 0;
  let where = "";
  for (const key of def.keys) {
    const q = key.pose;
    for (const i of [0, 1]) {
      const s = i === 0 ? 1 : -1;
      const shoulder = { x: q.chest.x + s * SHOULDER_HALF, y: q.chest.y };
      const hip = { x: q.pelvis.x + s * PELVIS_HALF, y: q.pelvis.y };
      const arm = span(shoulder, q.hands[i]) / (ARM * BUILD.arm);
      const leg = span(hip, q.feet[i]) / (LEG * BUILD.leg);
      const at = JSON.stringify(key.at);
      if (arm > worst) ((worst = arm), (where = `${at} arm${i}`));
      if (leg > worst) ((worst = leg), (where = `${at} leg${i}`));
    }
  }
  worstAll = Math.max(worstAll, worst);
  const bad = worst >= LIMIT;
  if (bad) failed = true;
  console.log(`${move.padEnd(6)} overreach ${worst.toFixed(3)} ${bad ? "FAIL" : "ok  "} ${where}`);
  const file = { character: "ryu", move, action: def.action, keys: def.keys };
  writeFileSync(join(OUT, `${move}.json`), `${JSON.stringify(file, null, 2)}\n`);
}
console.log(`worst ${worstAll.toFixed(3)} ${failed ? "— FAILED" : ""}`);
