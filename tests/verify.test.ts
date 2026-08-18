import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

import {
  CHECKS,
  PROJECTILE_CONTACT,
  disagreements,
  rate,
  verify,
  type CheckName,
} from "../src/verify/index.js";
import { invulnDisagreements, verifyInvuln, type InvulnKind } from "../src/verify/invuln.js";
import { verifyArmor, verifyArmorBreak } from "../src/verify/armor.js";
import {
  actionableFrame,
  activeWindows,
  airOnly,
  armoredAt,
  armorWindows,
  fullyInvulnerableWindows,
  hitCount,
  spawnsFrom,
  inFatFrames,
  hurtboxesAt,
  touchdownFrame,
  vulnerableTo,
} from "../src/data/geometry.js";
import { loadGeometry } from "../src/data/load-geometry.js";
import { listCharacters, requireCharacter } from "../src/data/index.js";
import { runScenario } from "../src/sim/index.js";

/**
 * The grader graded. These assert the *agreement between two independent
 * sources* — MMDK's dump of the game's tables and FAT's published frame data —
 * rather than anything the code computes about itself. If an extraction drifts,
 * these break before any feature does.
 */
const report = verify();

/**
 * FAT's own count of how many times a move hits, read off its `active` notation:
 * `2(13)3` is two windows with a gap, `1*3` two hits back to back, a bare `4` one
 * hit. Null for the notations that carry something else (`until land`, `~`).
 */
function fatHits(active: string | number | null): number | null {
  if (typeof active === "number") return 1;
  if (typeof active !== "string") return null;
  const parts = active.trim().split(/\(\d+\)|\*/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length || !parts.every((p) => /^\d+$/.test(p))) return null;
  return parts.length;
}

describe("the game's data against the published frame data", () => {
  it("agrees on every check, on the moves where a disagreement would mean something", () => {
    for (const check of Object.keys(CHECKS) as CheckName[]) {
      const { clean } = report.totals[check];
      expect(`${check} checked`).toBe(`${check} checked`);
      // The floor was 100 before ADR-0024 fixed the hit count; the clean
      // population is roughly two thirds larger now, and asserting that keeps a
      // regression in the count from reading as a quiet loss of coverage.
      //
      // `startScaling` is deliberately narrower than the rest: only the moves
      // FAT states as "N% Start" are gradeable at all, and there are 200 of
      // them on the roster. See ADR-0032.
      expect(clean.checked).toBeGreaterThanOrEqual(check === "startScaling" ? 200 : 201);
      // A shared floor; the tighter per-check ones are below. The residue is
      // the pre-Season-3 patch skew that ADR-0004 and ADR-0008 describe, and it
      // is per-character rather than per-check. `advantage` sits lowest of the
      // five because it compounds three extractions into one number.
      // Pooled across categories now (ADR-0019 and ADR-0021), so this is a coarse
      // regression guard; the per-category assertion below is the sharp one. The
      // floor sits at 0.80 rather than 0.85 because ADR-0021's 193 specials are
      // in the pool and the sim reproduces their advantage worst of any category.
      expect(`${check} ${rate(clean) > 0.8}`).toBe(`${check} true`);
    }
  });

  it("keeps each check honest per category, not just pooled", () => {
    // ADR-0019 let supers and the Drive moves into the clean population, so a
    // pooled floor no longer says much. Normals are the population every identity
    // in this project was measured on; they are asserted directly.
    for (const check of ["hitstun", "blockstun", "total", "cancelEnd", "advantage"] as const) {
      const rows = report.comparisons.filter((c) => c.check === check && c.clean && c.category === "normal");
      expect(rows.length).toBeGreaterThan(100);
      const ok = rows.filter((c) => c.agrees).length / rows.length;
      expect(`${check} ${ok > 0.85}`).toBe(`${check} true`);
    }
  });

  it("grades the specials ADR-0021 mapped, and says where they are weak", () => {
    // 234 specials map exact where none did before, so they are a graded
    // population now — and not an equal one. `total` says the mapping is right:
    // the action's own MarginFrame agrees with FAT on most of them. `advantage`
    // says the sim is wrong about them, which is a different problem and a real
    // one: a tatsu travels through the defender and a fireball leaves the screen.
    const of = (check: string) =>
      report.comparisons.filter((c) => c.check === check && c.clean && c.category === "special");
    const share = (check: string) => {
      const rows = of(check);
      return rows.filter((c) => c.agrees).length / rows.length;
    };
    expect(of("total").length).toBeGreaterThan(80);
    expect(share("total")).toBeGreaterThan(0.85);
    expect(share("blockstun")).toBeGreaterThan(0.75);
    // Deliberately a ceiling, not a floor: this is the number to beat, and it is
    // recorded so that improving the sim's special handling shows up as a break.
    expect(share("advantage")).toBeLessThan(0.6);
  });

  it("counts a move's hits by HitID per window, and the rival readings lose", () => {
    // FAT writes the hit count into its own `active` notation — `2(13)3` is two
    // windows, `1*3` two hits back to back, a bare `4` one hit — so the dump's
    // count can be graded against it like any other column. See ADR-0024.
    const population: { fat: number; keys: number; ids: number; windows: number; ours: number }[] = [];
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      for (const move of geo.moves) {
        if (move.match !== "exact" || move.startupDelta) continue;
        const action = geo.actions.find((a) => a.id === move.action)!;
        const strikes = action.hit.filter((h) => h.kind !== "proximity");
        if (!strikes.length) continue;
        const fat = fatHits(move.fat.active);
        if (fat === null) continue;
        const windows = activeWindows(action);
        population.push({
          fat,
          keys: strikes.length,
          ids: new Set(strikes.map((h) => h.hitId)).size,
          windows: windows.length,
          ours: hitCount(action),
        });
      }
    }
    expect(population.length).toBeGreaterThan(800);
    const share = (k: "keys" | "ids" | "windows" | "ours") =>
      population.filter((p) => p[k] === p.fat).length / population.length;
    // Counting keys is what the extractor used to do, and it is barely better
    // than a coin toss: the dump splits one active window into several boxes.
    expect(share("keys")).toBeLessThan(0.6);
    // Each half of the rule on its own gets most of the way and is beaten by both
    // of them together, which is the evidence that the rule is the pair.
    expect(share("ours")).toBeGreaterThan(share("ids"));
    expect(share("ours")).toBeGreaterThan(share("windows"));
    expect(share("ours")).toBeGreaterThan(0.95);
  });

  it("reads a single blow split across three boxes as one hit", () => {
    // The three anchors, one per shape the rule has to get right: a normal whose
    // one window is cut into three keys, a normal FAT writes `1*3` where the two
    // hits share a window and differ only in id, and a special with a gap.
    const at = (character: string, input: string) => {
      const geo = loadGeometry(requireCharacter(character).id)!;
      const move = geo.moves.find((m) => m.input === input)!;
      const action = geo.actions.find((a) => a.id === move.action)!;
      const strikes = action.hit.filter((h) => h.kind !== "proximity");
      return `${strikes.length} keys, ${activeWindows(action).length} windows, ${hitCount(action)} hits`;
    };
    expect(at("A.K.I.", "5HK")).toBe("3 keys, 1 windows, 1 hits");
    expect(at("Ryu", "6MP")).toBe("3 keys, 1 windows, 2 hits");
    expect(at("Akuma", "214KK")).toBe("7 keys, 5 windows, 5 hits");
  });

  it("finds a second guard-release constant on Drive Reversal, and it is uniform", () => {
    // Drive Reversal was `weak` until ADR-0019 explained its startup (a 5-frame
    // freeze), which promoted it into the clean population and immediately turned
    // up a new constant: its blockstun is FAT's published value plus 6, not the
    // plus 4 ADR-0006 measured on normals. Every fighter, the same 2 frames — a
    // structural difference rather than skew, and left in the pooled number rather
    // than curated out of it.
    const rows = report.comparisons.filter(
      (c) => c.check === "blockstun" && c.clean && c.input === "6HPHK",
    );
    expect(rows.length).toBeGreaterThan(15);
    for (const c of rows) expect(`${c.character}: ${c.dump - c.fat}`).toBe(`${c.character}: 2`);
  });

  it("confirms hitstun with no constant at all", () => {
    // The hit table and FAT agree outright: no offset, no fudge. This is the
    // control for the blockstun sweep below.
    expect(rate(report.totals.hitstun.clean)).toBeGreaterThan(0.9);
  });

  it("explains Drive Reversal's startup as its cinematic freeze", () => {
    // ADR-0017 left FAT's Drive Reversal startup 4 frames above the action's own
    // first active frame, on every fighter, unexplained. `ATK_CTA_4` carries a
    // `WorldKey` freeze of 5, and freeze - 1 is that 4. See ADR-0019.
    let checked = 0;
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      const move = geo?.moves.find((m) => m.input === "6HPHK");
      if (!geo || !move) continue;
      const action = geo.actions.find((a) => a.id === move.action)!;
      checked++;
      expect(`${geo.id}: freeze ${action.freeze} delta ${move.startupDelta}`).toBe(`${geo.id}: freeze 5 delta 0`);
    }
    expect(checked).toBeGreaterThan(20);
  });

  /**
   * ADR-0006 measured `GUARD_RELEASE = 4` against the game's hit table and
   * derived it from the engine's own identity — which is close to checking a
   * claim against itself. FAT publishes its own `blockstun` column, so the
   * constant can be swept: if 4 is real, it is the unique best offset, and
   * every neighbour is markedly worse.
   */
  it("puts the guard release at exactly 4, and nowhere else", () => {
    // Swept over normals, which is the population ADR-0006 measured it on. Drive
    // Reversal needs +6 and would otherwise blunt the spike by 18 rows — see the
    // per-category test above and ADR-0019.
    const scores = new Map<number, number>();
    for (let offset = 0; offset <= 8; offset++) {
      const rows = verify(undefined, { guardRelease: offset }).comparisons.filter(
        (c) => c.check === "blockstun" && c.clean && c.category === "normal",
      );
      scores.set(offset, rows.filter((c) => c.agrees).length / rows.length);
    }
    const best = [...scores].sort((a, b) => b[1] - a[1])[0]!;
    expect(best[0]).toBe(4);
    expect(best[1]).toBeGreaterThan(0.9);
    // A neighbouring offset should collapse, not merely score a little lower.
    expect(scores.get(3)!).toBeLessThan(0.1);
    expect(scores.get(5)!).toBeLessThan(0.1);
    expect(scores.get(0)!).toBeLessThan(0.1);
  });

  it("puts a fireball's published advantage 8 frames after the shot appears", () => {
    // A fireball's advantage is not one number: it depends on where the fireball
    // is blocked, and the sim reproduces that honestly. FAT publishes one number
    // anyway, and it turns out to be a fixed point on that curve.
    //
    // Swept the same way as the guard release, because a constant only ever
    // asserted at its own value is not being checked: if 8 is real it is the
    // unique best offset and its neighbours collapse rather than scoring nearby.
    const projectiles = new Set<string>();
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      for (const move of geo.moves) {
        const action = geo.actions.find((a) => a.id === move.action);
        if (action?.shots?.length && !action.hit.some((h) => h.kind !== "proximity")) {
          projectiles.add(`${geo.character} ${move.input}`);
        }
      }
    }
    const scores = new Map<number, number>();
    for (let offset = 0; offset <= 16; offset++) {
      const rows = verify(undefined, { projectileContact: offset }).comparisons.filter(
        (c) => c.check === "advantage" && c.clean && projectiles.has(`${c.character} ${c.input}`),
      );
      expect(rows.length).toBeGreaterThan(30);
      scores.set(offset, rows.filter((c) => c.agrees).length);
    }
    const best = [...scores].sort((a, b) => b[1] - a[1])[0]!;
    expect(best[0]).toBe(PROJECTILE_CONTACT);
    expect(best[1]).toBeGreaterThan(20);
    // A spike, not a trend. The offsets either side sit on a flat floor of four
    // to six: the projectiles the constant does not apply to, because their shot
    // does not travel — Ryu's Hashogeki, A.K.I.'s Jatoben — and which therefore
    // score the same whatever the offset is.
    for (const [offset, score] of scores) {
      if (offset !== PROJECTILE_CONTACT) expect(`${offset}: ${score <= 6}`).toBe(`${offset}: true`);
    }
  });

  it("confirms the cancel window's last frame against the published confirm window", () => {
    // ADR-0008 only checked that a window *exists* where FAT's `xx` says one
    // should. `hcWinSpCa` is a number, so it checks the boundary.
    const { clean } = report.totals.cancelEnd;
    expect(clean.checked).toBeGreaterThan(100);
    // Pooled, so ADR-0021's specials are in it; normals alone still clear 0.9,
    // which the per-category test above asserts.
    expect(rate(clean)).toBeGreaterThan(0.88);
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
    expect(clean.checked).toBeGreaterThan(400);
    expect(rate(clean)).toBeGreaterThan(0.9);
  });

  it("reproduces published advantage from the dump alone", () => {
    // The sim reads no published number at all now: stun from the hit table,
    // recovery from MarginFrame, contact from box overlap. Comparing its answer
    // to FAT's onBlock is therefore two sources agreeing rather than an
    // identity restated. See ADR-0011.
    const { clean } = report.totals.advantage;
    expect(clean.checked).toBeGreaterThan(400);
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
    // specifically, which is a bug rather than skew. Measured on normals: since
    // ADR-0021 a character with many specials scores lower for having more of
    // the category the sim models worst, which is not the failure this looks for.
    // Jamie reads 72.3% pooled and 95.9% on his normals.
    const rows = new Map<string, { n: number; ok: number }>();
    for (const c of report.comparisons) {
      if (!c.clean || c.category !== "normal") continue;
      const e = rows.get(c.character) ?? { n: 0, ok: 0 };
      e.n++;
      if (c.agrees) e.ok++;
      rows.set(c.character, e);
    }
    expect(rows.size).toBeGreaterThan(20);
    for (const [character, e] of rows) {
      expect(`${character} ${e.ok / e.n > 0.75}`).toBe(`${character} true`);
    }
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
      // Supers excluded, not `clean` — ADR-0011 measured this over every mapped
      // move, and a super's frames are in a different space (ADR-0018).
      const rows = report.comparisons.filter(
        (c) => c.check === "total" && c.category !== "super" && c.input.includes(">") === chained,
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

  it("reads full invulnerability as the absence of every hurtbox", () => {
    // The fourth check, and the one that finally answers "Fully invincible on
    // frames 1-N". There is no flag for it: the action carries no hurtbox at
    // all. See ADR-0020.
    const t = invuln.totals.full;
    expect(t.checked).toBeGreaterThan(60);
    expect(t.exact).toBeGreaterThan(50);
    // And no ±1 skew at all, which the other prose checks all carry. A window
    // bounded by the absence of keys has no edge to be off by one on.
    expect(t.within1).toBe(t.exact);
  });

  it("anchors full invulnerability on a super, through the freeze", () => {
    // Ryu's Shinshoryuken has no hurtbox on frames 1-71 of its own timeline.
    // Net of the 56-frame cinematic freeze that is FAT's 1-16, published as
    // "Fully invincible on frames 1-16" — the two decodes composing.
    const geo = loadGeometry("ryu")!;
    const action = geo.actions.find((a) => a.name === "SAA_SHINSYORYU_START")!;
    const [window] = fullyInvulnerableWindows(action);
    expect(window).toEqual({ start: 1, end: 71 });
    expect(action.freeze).toBe(56);
    expect(inFatFrames(action, window!.start)).toBe(-54);
    expect(inFatFrames(action, window!.end)).toBe(16);
  });

  it("finds the same mechanism outside supers", () => {
    // It is not a cinematic trick. Chun-Li's EX Tenshokyaku opens with seven
    // frames of nothing, and Terry's 5MP > MK has a window in the middle of
    // the move — both published as full invincibility on exactly those frames.
    const chun = loadGeometry("chun-li")!.actions.find((a) => a.name === "SPA_TENNSHOU_EX")!;
    expect(fullyInvulnerableWindows(chun)[0]).toEqual({ start: 1, end: 7 });
    const terry = loadGeometry("terry")!.actions.find((a) => a.name === "ATK_5MP_TC_MK")!;
    expect(fullyInvulnerableWindows(terry)).toContainEqual({ start: 20, end: 40 });
  });

  it("does not score a kinded claim the dump answers by absence", () => {
    // FAT writes "fully invincible 1-12" and "projectile invincible 13-41"
    // about Lily's Thunderbird, and the dump has no hurtbox until frame 41.
    // The second sentence is true; it is just not TypeFlag's doing, so the
    // projectile check counts it apart rather than as a failure.
    const rows = invuln.comparisons.filter(
      (c) => c.actionName === "SAA_THUNDERBIRD" && c.kind === "projectile",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.byAbsence).toBe(true);
    expect(invulnDisagreements(invuln)).not.toContain(rows[0]);
  });
});

describe("armor against the published notes", () => {
  const report = verifyArmor();

  it("reproduces every published armor window exactly", () => {
    // `AtemiDataListIndex` was extracted by nothing and points into a table the
    // dump does not ship. Where the armor sits *is* in the dump, and it agrees
    // with FAT on every claim the grader can reach. See ADR-0016.
    expect(report.totals.checked).toBeGreaterThan(28);
    // ADR-0021's special mapping reached Marisa's armored Phalanx, which ADR-0016
    // named as the caveat it could not grade. Three of the four land exactly and
    // the two that miss are both OD: the strength whose armor window FAT and the
    // dump disagree about. Named, rather than absorbed into a floor.
    const missed = report.claims.filter((c) => !c.agrees).map((c) => `${c.character} ${c.input}`);
    expect(missed.sort()).toEqual(["E.Honda 46PP", "Marisa 623PP"]);
  });

  it("grades Marisa's armored special, which ADR-0016 could not reach", () => {
    const phalanx = report.claims.filter((c) => c.actionName.startsWith("SPA_Phalanx"));
    expect(phalanx.length).toBe(4);
    for (const c of phalanx.filter((c) => c.input !== "623PP")) {
      expect(`${c.input}: ${c.dump?.join("-")}`).toBe(`${c.input}: ${c.fat?.join("-")}`);
    }
  });

  it("puts Drive Impact's two hits of armor on frames 1-27 for all 24 fighters", () => {
    // The roster-wide anchor, and the reason this decode needed no guessing:
    // `ATK_CTA` is the same action on every fighter and FAT publishes the same
    // sentence for every one of them.
    const di = report.claims.filter((c) => c.input === "HPHK");
    expect(di.length).toBe(24);
    for (const c of di) {
      expect(`${c.character}: ${c.dump?.join("-")} ${c.hits}hit idx${c.index.join()}`).toBe(
        `${c.character}: 1-27 2hit idx1`,
      );
    }
  });

  it("explains 'loses to Low attacks' by which hurtboxes the armor covers", () => {
    // The finding that armor is applied per box rather than per fighter. Every
    // claim FAT qualifies with "loses to Low" has a window that skips the leg
    // box, and every claim it does not qualify covers the leg box.
    const { losesToLow, holdsLow } = report.totals;
    expect(losesToLow.total).toBeGreaterThan(1);
    expect(losesToLow.bodyOnly).toBe(losesToLow.total);
    expect(holdsLow.total).toBeGreaterThan(20);
    expect(holdsLow.coversLeg).toBe(holdsLow.total);
  });

  it("partitions the atemi indices by what they cover, across the roster", () => {
    // Independent of FAT: the coverage is a property of the table row, not of the
    // move. Index 1 is Drive Impact and always covers everything; Marisa's
    // index 7 never covers the legs.
    const windows = listCharacters().flatMap((name) => {
      const geo = loadGeometry(requireCharacter(name).id);
      return geo ? geo.actions.flatMap((a) => armorWindows(a)) : [];
    });
    const full = (i: number) => windows.filter((w) => w.index === i && w.covers.leg).length;
    const partial = (i: number) => windows.filter((w) => w.index === i && !w.covers.leg).length;
    expect(windows.length).toBeGreaterThan(80);
    expect(full(1)).toBeGreaterThan(45);
    expect(partial(1)).toBe(0);
    expect(full(7)).toBe(0);
    expect(partial(7)).toBeGreaterThan(10);
  });

  it("has no attack-side armor field to read, and the dump says so", () => {
    // `ArmorPoint` on the hit-data entry is zero on all 79,175 occurrences in the
    // roster, so the extractor never emits `armor` at all. Asserted because the
    // field's *existence* is the thing that invites a decode that cannot happen.
    // See ADR-0017.
    let outcomes = 0;
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      for (const data of Object.values(geo.hitData ?? {})) {
        for (const outcome of Object.values(data)) {
          outcomes++;
          expect(outcome?.armor).toBeUndefined();
        }
      }
    }
    expect(outcomes).toBeGreaterThan(10000);
  });

  it("predicts Armor Break from the move's class, because nothing marks it", () => {
    // Armor Break is not a property of a move: every Super Art and every Drive
    // Reversal breaks armor and nothing else does. The dump classifies both — the
    // trigger `kind` flags from ADR-0009 and the Drive Reversal action — so FAT's
    // tag can be graded against a rule rather than a flag.
    const brk = verifyArmorBreak();
    expect(brk.checked).toBeGreaterThan(700);
    expect(brk.agreeing / brk.checked).toBeGreaterThan(0.98);
    // Most exceptions run one way — FAT declining to tag a move the dump calls a
    // super, which are the command-grab supers, where a grab beats armor without
    // needing to break it. ADR-0018 read that as the rule being intact and the
    // tag being editorial.
    //
    // ADR-0021 breaks that: with specials mapped, two OD specials are published
    // as Armor Break and the rule does not predict them. Two counterexamples in
    // the direction that means the rule is wrong, not the tag. Pinned by name
    // until something in the dump explains them. See ADR-0021.
    const counter = brk.rows.filter((r) => !r.agrees && r.published);
    expect(counter.map((r) => `${r.character} ${r.input}`).sort()).toEqual([
      "Marisa 236KK",
      "Marisa 623PP",
    ]);
  });

  it("reads a fireball's startup off the frame it spawns on", () => {
    // A projectile special's own action has no hitbox at all: `ShotKey` names a
    // separate action for the fireball, which starts its own timeline when it
    // appears. The spawn frame is what FAT publishes as the startup, and before
    // ADR-0022 there was no number on the parent to compare with anything.
    const ryu = loadGeometry("ryu")!;
    const hado = ryu.actions.find((a) => a.name === "SPA_HADO")!;
    expect(hado.hit.filter((h) => h.kind !== "proximity")).toEqual([]);
    expect(hado.shots).toEqual([{ action: 909, frame: 16, offset: { x: 79, y: 110 } }]);
    const [spawn] = spawnsFrom(ryu, hado);
    expect(spawn!.action.name).toBe("SPA_HADO PROJ");
    expect(ryu.moves.find((m) => m.input === "236LP")).toMatchObject({
      actionName: "SPA_HADO",
      match: "exact",
      startup: 16,
      startupDelta: 0,
    });

    // Roster-wide: every move whose action throws rather than hits, graded on
    // the spawn frame alone.
    let checked = 0;
    let exact = 0;
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      for (const move of geo.moves) {
        const action = geo.actions.find((a) => a.id === move.action);
        if (!action?.shots?.length) continue;
        if (action.hit.some((h) => h.kind !== "proximity")) continue;
        checked++;
        if (move.startupDelta === 0) exact++;
      }
    }
    expect(checked).toBeGreaterThan(60);
    expect(exact / checked).toBeGreaterThan(0.7);
  });

  it("prefers a rebalanced action only when the frames cannot separate them", () => {
    // The `_Y2` preference was a filter until ADR-0022 gave shot-only actions a
    // signature, at which point Juri's `ATK_5MP_TC2_SA1_Y2` — a super handoff,
    // and the only `_Y2` among her `ATK_5MP*` — captured her 5MP at a delta of
    // 73. It is a tie-break now, so the frames decide first.
    const juri = loadGeometry("juri")!;
    const move = juri.moves.find((m) => m.input === "5MP")!;
    const action = juri.actions.find((a) => a.id === move.action)!;
    expect(`${move.match} ${action.shots ? "throws" : "hits"}`).toBe("exact hits");
    expect(action.name).toMatch(/^ATK_5MP/);
    expect(action.name).not.toContain("SA1");
  });

  it("maps specials through the triggers' own family and strength", () => {
    // ADR-0018 had 0 specials solidly mapped: their actions carry Japanese move
    // names, so nothing matches by string. The triggers classify them —
    // `Special_<n>` for the family, Light/Middle/Heavy/Extra for the strength —
    // and a whole family assigned at once is a far stronger fingerprint than one
    // startup. See ADR-0021.
    let exact = 0;
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      exact += geo.moves.filter((m) => m.category === "special" && m.match === "exact").length;
    }
    expect(exact).toBeGreaterThan(220);

    // The family lands as a family: one dump stem, the strengths in order.
    const ryu = loadGeometry("ryu")!;
    for (const [input, action] of [
      ["623LP", "SPA_SYORYU_START"],
      ["623MP", "SPA_SYORYU_START(1)"],
      ["623HP", "SPA_SYORYU_START(2)"],
      ["623PP", "SPA_SYORYU_START(3)"],
    ] as const) {
      const move = ryu.moves.find((m) => m.input === input)!;
      expect(`${input}: ${move.actionName} ${move.match}`).toBe(`${input}: ${action} exact`);
    }
  });

  it("maps the Drive system's universal moves by name on every fighter", () => {
    // `HPHK` and `6HPHK` have no action name to match, so the mapper's frame
    // fingerprint used to land them on unrelated specials. See ADR-0017.
    let impact = 0, reversal = 0;
    for (const name of listCharacters()) {
      const geo = loadGeometry(requireCharacter(name).id);
      if (!geo) continue;
      const di = geo.moves.find((m) => m.input === "HPHK");
      const dr = geo.moves.find((m) => m.input === "6HPHK");
      if (di) {
        impact++;
        expect(`${geo.id}: ${di.actionName} ${di.match}`).toBe(`${geo.id}: ATK_CTA exact`);
      }
      if (dr) {
        reversal++;
        // The 4-frame gap ADR-0017 recorded here is now explained and netted out:
        // `ATK_CTA_4` carries a 5-frame freeze, and freeze - 1 is the 4. ADR-0019.
        expect(`${geo.id}: ${dr.actionName} delta ${dr.startupDelta}`).toBe(
          `${geo.id}: ATK_CTA_4 delta 0`,
        );
      }
    }
    expect(impact).toBe(24);
    expect(reversal).toBeGreaterThan(20);
  });

  it("answers the per-part question a low attack asks", () => {
    const phalanx = loadGeometry("marisa")!.actions.find((a) => a.name === "SPA_Phalanx")!;
    expect(armoredAt(phalanx, 9, "body")).toBe(true);
    expect(armoredAt(phalanx, 9, "leg")).toBe(false);
    // And outside the window nothing is armored, on any part.
    expect(armoredAt(phalanx, 20, "body")).toBe(false);
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
