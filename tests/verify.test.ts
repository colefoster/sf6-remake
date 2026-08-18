import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

import { CHECKS, disagreements, rate, verify, type CheckName } from "../src/verify/index.js";
import { verifyInvuln, type InvulnKind } from "../src/verify/invuln.js";
import {
  actionableFrame,
  airOnly,
  hurtboxesAt,
  loadGeometry,
  touchdownFrame,
  vulnerableTo,
} from "../src/data/geometry.js";
import { listCharacters, requireCharacter } from "../src/data/index.js";
import { runScenario } from "../src/sim/index.js";

/**
 * The grader graded. These assert the *agreement between two independent
 * sources* — MMDK's dump of the game's tables and FAT's published frame data —
 * rather than anything the code computes about itself. If an extraction drifts,
 * these break before any feature does.
 */
const report = verify();

describe("the game's data against the published frame data", () => {
  it("agrees on every check, on the moves where a disagreement would mean something", () => {
    for (const check of Object.keys(CHECKS) as CheckName[]) {
      const { clean } = report.totals[check];
      expect(`${check} checked`).toBe(`${check} checked`);
      expect(clean.checked).toBeGreaterThan(100);
      // A shared floor; the tighter per-check ones are below. The residue is
      // the pre-Season-3 patch skew that ADR-0004 and ADR-0008 describe, and it
      // is per-character rather than per-check. `advantage` sits lowest of the
      // five because it compounds three extractions into one number.
      expect(`${check} ${rate(clean) > 0.8}`).toBe(`${check} true`);
    }
  });

  it("confirms hitstun with no constant at all", () => {
    // The hit table and FAT agree outright: no offset, no fudge. This is the
    // control for the blockstun sweep below.
    expect(rate(report.totals.hitstun.clean)).toBeGreaterThan(0.9);
  });

  /**
   * ADR-0006 measured `GUARD_RELEASE = 4` against the game's hit table and
   * derived it from the engine's own identity — which is close to checking a
   * claim against itself. FAT publishes its own `blockstun` column, so the
   * constant can be swept: if 4 is real, it is the unique best offset, and
   * every neighbour is markedly worse.
   */
  it("puts the guard release at exactly 4, and nowhere else", () => {
    const scores = new Map<number, number>();
    for (let offset = 0; offset <= 8; offset++) {
      scores.set(offset, rate(verify(undefined, { guardRelease: offset }).totals.blockstun.clean));
    }
    const best = [...scores].sort((a, b) => b[1] - a[1])[0]!;
    expect(best[0]).toBe(4);
    expect(best[1]).toBeGreaterThan(0.9);
    // A neighbouring offset should collapse, not merely score a little lower.
    expect(scores.get(3)!).toBeLessThan(0.1);
    expect(scores.get(5)!).toBeLessThan(0.1);
    expect(scores.get(0)!).toBeLessThan(0.1);
  });

  it("confirms the cancel window's last frame against the published confirm window", () => {
    // ADR-0008 only checked that a window *exists* where FAT's `xx` says one
    // should. `hcWinSpCa` is a number, so it checks the boundary.
    const { clean } = report.totals.cancelEnd;
    expect(clean.checked).toBeGreaterThan(100);
    expect(rate(clean)).toBeGreaterThan(0.9);
  });

  it("matches the special-cancel confirm window and not the target-combo one", () => {
    // FAT publishes two confirm windows and they differ on 13 plain moves. If the
    // extracted window is the special-cancel list, as ADR-0008 claims, it tracks
    // `hcWinSpCa` on those and `hcWinTc` on none of them — and it does, 13 to 0.
    const spca = verify(undefined, { confirmColumn: "hcWinSpCa" });
    const tc = verify(undefined, { confirmColumn: "hcWinTc" });
    const rowsOf = (r: typeof spca) =>
      new Map(
        r.comparisons
          .filter((c) => c.check === "cancelEnd" && c.clean && !c.input.includes(">"))
          .map((c) => [`${c.character} ${c.input}`, c]),
      );
    const a = rowsOf(spca);
    const b = rowsOf(tc);
    const differ = [...a].filter(([k, c]) => b.has(k) && b.get(k)!.fat !== c.fat);
    expect(differ.length).toBeGreaterThan(10);
    expect(differ.filter(([, c]) => c.agrees).length).toBe(differ.length);
    expect(differ.filter(([k]) => b.get(k)!.agrees).length).toBe(0);
  });

  it("cannot grade the cancel window of a chained input at all", () => {
    // The same structural difference ADR-0011 found on `total`: FAT measures a
    // target combo from the start of the whole string and the dump measures the
    // action alone. On `total` that left the chained population merely worse; on
    // `hcWinSpCa` it is total, and pooling the two is what made the headline
    // read low. Asserted so the two populations are never silently merged again.
    const rows = report.comparisons.filter((c) => c.check === "cancelEnd" && c.clean);
    const chained = rows.filter((c) => c.input.includes(">"));
    const plain = rows.filter((c) => !c.input.includes(">"));
    expect(chained.length).toBeGreaterThan(4);
    expect(chained.filter((c) => c.agrees).length).toBe(0);
    expect(plain.filter((c) => c.agrees).length / plain.length).toBeGreaterThan(0.93);
  });

  it("confirms MarginFrame is the action's published total", () => {
    const { clean } = report.totals.total;
    expect(clean.checked).toBeGreaterThan(150);
    expect(rate(clean)).toBeGreaterThan(0.9);
  });

  it("reproduces published advantage from the dump alone", () => {
    // The sim reads no published number at all now: stun from the hit table,
    // recovery from MarginFrame, contact from box overlap. Comparing its answer
    // to FAT's onBlock is therefore two sources agreeing rather than an
    // identity restated. See ADR-0011.
    const { clean } = report.totals.advantage;
    expect(clean.checked).toBeGreaterThan(150);
    expect(rate(clean)).toBeGreaterThan(0.8);
  });

  it("keeps the disagreements concentrated rather than spread thin", () => {
    // Patch skew hits whole moves, so a move that disagrees tends to disagree on
    // more than one check. If the disagreements were evenly scattered across
    // distinct moves, that would suggest noise in the extraction instead.
    const bad = disagreements(report, { cleanOnly: true });
    const moves = new Set(bad.map((c) => `${c.character} ${c.input}`));
    expect(bad.length).toBeGreaterThan(0);
    expect(moves.size).toBeLessThan(bad.length);
  });

  it("has no character that fails wholesale", () => {
    // A character far below the rest means the extraction broke for them
    // specifically, which is a bug rather than skew.
    const worst = report.byCharacter[0]!;
    expect(`${worst.character} ${rate(worst.clean) > 0.75}`).toBe(`${worst.character} true`);
  });
});

describe("the grader stays out of both derivations", () => {
  it("is imported by neither the engine nor the sim", () => {
    // The engine answers from FAT alone and the sim plays out from the dump
    // alone; the whole value of comparing them is that neither knows the other.
    const sources = globSync("src/{engine,sim,data,domain}/**/*.ts");
    expect(sources.length).toBeGreaterThan(4);
    for (const path of sources) {
      expect(`${path}:${readFileSync(path, "utf8").includes("verify/index.js")}`).toBe(`${path}:false`);
    }
  });
});

describe("MarginFrame is recovery, not animation length", () => {
  const withGeometry = listCharacters()
    .map((name) => loadGeometry(requireCharacter(name).id))
    .filter((g): g is NonNullable<typeof g> => !!g);

  it("always falls strictly inside the action it belongs to", () => {
    // The distinguishing fact. If MarginFrame were the animation's length it
    // would equal `frames`; it is below it on every action in the roster, which
    // is what "you can act while the animation plays on" looks like.
    let checked = 0;
    for (const geo of withGeometry) {
      for (const action of geo.actions) {
        if (!action.marginFrame || action.marginFrame <= 0 || !action.frames) continue;
        checked++;
        expect(`${geo.id}#${action.id}:${action.marginFrame < action.frames}`).toBe(
          `${geo.id}#${action.id}:true`,
        );
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("agrees with the published total far better on a move than on a string", () => {
    // FAT measures a target combo's `total` from the start of the whole string;
    // MarginFrame measures the action alone. That gap is structural, not error,
    // and it is why the sim is *more* right than FAT for a follow-up.
    const score = (chained: boolean) => {
      const rows = report.comparisons.filter(
        (c) => c.check === "total" && c.input.includes(">") === chained,
      );
      return rows.filter((c) => c.agrees).length / rows.length;
    };
    expect(score(false)).toBeGreaterThan(0.9);
    expect(score(true)).toBeLessThan(0.75);
  });

  it("is what the sim actually uses", () => {
    const result = runScenario("Ryu", "2MK", { guard: true });
    expect(result.recoverySource).toBe("action");
    expect(result.advantage).toBe(-6);
  });
});

describe("airborne actions recover on landing", () => {
  const geo = loadGeometry("ryu")!;
  const byName = (name: string) => geo.actions.find((a) => a.name === name)!;

  it("hands the Shoryuken off to its landing at the frame it touches down", () => {
    const dp = byName("SPA_SYORYU_START");
    // No margin of its own: there is nothing to recover from until you land.
    expect(dp.marginFrame).toBeLessThanOrEqual(0);
    expect(touchdownFrame(dp)).toBe(dp.frames);
    expect(dp.lands).toEqual({ action: byName("SPA_SYORYU_END").id, margin: 12 });
  });

  it("composes to the recovery FAT publishes as two numbers", () => {
    // FAT writes Ryu's 623LP recovery "21+12". The 12 is the landing action's
    // own margin, and 35 - (5 + 10 - 1) is the 21. See ADR-0012.
    const move = geo.moves.find((m) => m.input === "623LP")!;
    const dp = byName("SPA_SYORYU_START");
    expect(move.fat.recovery).toBe("21+12");
    expect(dp.frames! - (move.startup + move.active - 1)).toBe(21);
    expect(dp.lands!.margin).toBe(12);
    // And end to end: touchdown + landing margin is FAT's own total.
    expect(actionableFrame(dp)).toEqual({ frame: 48, source: "landing" });
  });

  it("reproduces published advantage for a move that lands", () => {
    const result = runScenario("Ryu", "623LP", { guard: true, distance: 80 });
    expect(result.recoverySource).toBe("landing");
    expect(result.advantage).toBe(-23);
  });

  it("refuses to answer for an air normal rather than inventing a number", () => {
    // ATK_8HP inherits the jump's arc and carries none of its own, so when it
    // lands depends on when it was pressed. FAT publishes no recovery either.
    const jump = byName("ATK_8HP");
    expect(jump.lands).toBeDefined();
    expect(touchdownFrame(jump)).toBeUndefined();
    expect(actionableFrame(jump)).toBeUndefined();
    const result = runScenario("Ryu", "8HP", { guard: true, distance: 100 });
    expect(result.contact).not.toBeNull();
    expect(result.advantage).toBeNull();
    expect(result.note).toMatch(/ends in the air/);
  });

  it("only claims a landing recovery where the action really leaves the ground", () => {
    let landing = 0;
    for (const name of listCharacters()) {
      const g = loadGeometry(requireCharacter(name).id);
      if (!g) continue;
      for (const action of g.actions) {
        const free = actionableFrame(action);
        if (free?.source !== "landing") continue;
        landing++;
        // A landing answer requires a curve that actually goes up and comes down.
        expect(Math.max(...(action.motion?.y ?? [0]))).toBeGreaterThan(0);
      }
    }
    expect(landing).toBeGreaterThan(50);
  });
});

describe("per-frame invulnerability against the published notes", () => {
  const invuln = verifyInvuln();
  const share = (kind: InvulnKind) => {
    const t = invuln.totals[kind];
    return t.exact / t.checked;
  };

  it("reproduces the strike-invincible limb extension exactly, every time", () => {
    // The hardest of the three, and it comes out clean: FAT documents a brief
    // extended hurtbox a frame or two before a heavy's active frames that a
    // strike passes through, and `TypeFlag` marks precisely those frames.
    const t = invuln.totals.strike;
    expect(t.checked).toBeGreaterThan(20);
    expect(t.exact).toBe(t.checked);
  });

  it("reads projectile and airborne-strike invulnerability off the dump", () => {
    expect(invuln.totals.projectile.checked).toBeGreaterThan(50);
    expect(invuln.totals["airborne-strike"].checked).toBeGreaterThan(50);
    expect(share("projectile")).toBeGreaterThan(0.75);
    expect(share("airborne-strike")).toBeGreaterThan(0.75);
  });

  it("puts the airborne gate on Immune bit 2, and nowhere else", () => {
    // The same shape as the guard-release sweep: if bit 2 is the airborne gate
    // it is the unique best of the eight, and its neighbours collapse rather
    // than scoring a little lower.
    const scores = new Map<number, number>();
    for (let bit = 0; bit <= 7; bit++) {
      const t = verifyInvuln(undefined, { airborneBit: bit }).totals["airborne-strike"];
      scores.set(bit, t.exact / t.checked);
    }
    const best = [...scores].sort((a, b) => b[1] - a[1])[0]!;
    expect(best[0]).toBe(2);
    expect(best[1]).toBeGreaterThan(0.75);
    // And every other bit scores nothing at all, not merely less.
    for (const [bit, score] of scores) {
      if (bit !== 2) expect(`bit ${bit}: ${score}`).toBe(`bit ${bit}: 0`);
    }
  });

  it("anchors on the move the whole decode started from", () => {
    // Ryu's 623LP: FAT says "Invincible to airborne strikes on frames 1-14" and
    // the dump's bit-2 keys cover exactly frames 1-14. See ADR-0014.
    const dp = loadGeometry("ryu")!.actions.find((a) => a.name === "SPA_SYORYU_START")!;
    const immune = dp.hurt.filter((h) => ((h.immune ?? 0) & 4) !== 0);
    expect(Math.min(...immune.map((h) => h.start))).toBe(1);
    expect(Math.max(...immune.map((h) => h.end))).toBe(14);
    expect(hurtboxesAt(dp, 10, { to: "airborne-strike" })).toEqual([]);
    expect(hurtboxesAt(dp, 10, { to: "strike" }).length).toBeGreaterThan(0);
  });

  it("keeps a strike-invincible box vulnerable to projectiles", () => {
    // FAT's own gloss on these boxes is "cannot counter-poke projectiles", so
    // the two gates have to stay separate: the box is skipped for a strike and
    // still counted for a fireball. A single "invulnerable" flag would lose it.
    const key = { start: 1, end: 1, head: [], body: [], leg: [], throw: [], typeFlag: 2 };
    expect(vulnerableTo(key, "strike")).toBe(false);
    expect(vulnerableTo(key, "projectile")).toBe(true);
    // And the ordinary box, with nothing recorded, answers to everything.
    const plain = { start: 1, end: 1, head: [], body: [], leg: [], throw: [] };
    for (const kind of ["strike", "projectile", "airborne-strike"] as const) {
      expect(vulnerableTo(plain, kind)).toBe(true);
    }
  });

  it("leaves the rest of the Immune mask undecoded and says so", () => {
    // 128 is on every character's light normals and 239 on every jump's
    // start-up, and no published column separates either from bit 2. What can
    // be said is structural: 128 and the strike-invincible TypeFlag never occur
    // on the same action, across the whole roster. See ADR-0014.
    let seen128 = 0;
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      for (const action of geo.actions) {
        const has128 = action.hurt.some((h) => h.immune === 128);
        if (has128) seen128++;
        expect(`${geo.id}#${action.id}:${has128 && action.hurt.some((h) => h.typeFlag === 2)}`).toBe(
          `${geo.id}#${action.id}:false`,
        );
      }
    }
    expect(seen128).toBeGreaterThan(150);
  });
});

describe("ConditionFlag: what reads and what does not", () => {
  const keys = listCharacters().flatMap((name) => {
    const g = loadGeometry(requireCharacter(name).id);
    if (!g) return [];
    return g.actions.flatMap((action) =>
      (action.cancels ?? []).map((key) => ({
        key,
        airborne: (action.motion?.travel.maxY ?? 0) > 20 || /_AIR|^ATK_[789]/.test(action.name),
      })),
    );
  });

  it("reads the airborne gate out of _State", () => {
    // Measured against the actions the keys sit on rather than assumed: the
    // marked keys land on an airborne action almost always, where the base rate
    // across all cancel keys is under a tenth. A 10x lift is the decode.
    const base = keys.filter((k) => k.airborne).length / keys.length;
    const marked = keys.filter((k) => airOnly(k.key));
    expect(base).toBeLessThan(0.15);
    expect(marked.length).toBeGreaterThan(200);
    expect(marked.filter((k) => k.airborne).length / marked.length).toBeGreaterThan(0.95);
  });

  it("keeps the whole flag, not just the part that reads", () => {
    // ADR-0013 is a negative result on the low nibble. Storing the other three
    // fields is what makes a later attempt a re-read rather than a re-extract.
    expect(keys.some((k) => k.key.state !== undefined)).toBe(true);
    expect(keys.some((k) => k.key.input !== undefined)).toBe(true);
    expect(keys.some((k) => k.key.other !== undefined)).toBe(true);
  });

  it("still partitions the low nibble by phase, which is all we can say", () => {
    // Nibble 7 occurs almost only before the move is active and nibble 4 almost
    // only after. Real structure, but not a decode: see ADR-0013 for why no
    // available source can distinguish the readings that fit it.
    const withPhase = keys
      .map(({ key }) => key)
      .filter((k) => k.cond !== undefined);
    const nib = (k: (typeof withPhase)[number]) => k.cond & 15;
    const counts = new Map<number, number>();
    for (const k of withPhase) counts.set(nib(k), (counts.get(nib(k)) ?? 0) + 1);
    // The five values that carry the roster; anything else is a handful.
    for (const value of [4, 7, 11, 15]) expect(counts.get(value)!).toBeGreaterThan(100);
    expect([...counts.keys()].every((v) => v < 16)).toBe(true);
  });
});
