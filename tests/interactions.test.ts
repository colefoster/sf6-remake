import { describe, it, expect } from "vitest";
import {
  punishAssessment,
  fastestPunish,
  blockGap,
  cancelInto,
  canCancelInto,
  analyzeSequence,
} from "../src/engine/interactions.js";
import type { Move } from "../src/domain/types.js";

const mk = (over: Partial<Move>): Move => ({
  id: "x",
  name: "X",
  input: "X",
  category: "normal",
  startup: 5,
  active: 3,
  recovery: 10,
  ...over,
});

describe("punishAssessment", () => {
  it("a -39 move is punishable by a 5f move (window 39)", () => {
    const dp = mk({ name: "HP DP", onBlock: -39 });
    const jab = mk({ name: "Jab", startup: 5 });
    const r = punishAssessment(dp, jab);
    expect(r.window).toBe(39);
    expect(r.punishable).toBe(true);
    expect(r.punishCounter).toBe(true);
  });

  it("a -3 move is NOT punishable by a 5f move", () => {
    const di = mk({ name: "DI", onBlock: -3 });
    const jab = mk({ startup: 5 });
    expect(punishAssessment(di, jab).punishable).toBe(false);
  });

  it("is not applicable when onBlock is missing", () => {
    expect(punishAssessment(mk({ onBlock: undefined }), mk({})).applicable).toBe(false);
  });
});

describe("fastestPunish", () => {
  it("picks the fastest move within the punish window", () => {
    const blocked = mk({ onBlock: -8 });
    const candidates = [
      mk({ name: "5MP", startup: 6 }),
      mk({ name: "5LP", startup: 4 }),
      mk({ name: "5HP", startup: 9 }), // too slow (>8)
    ];
    const r = fastestPunish(blocked, candidates);
    expect(r.best?.move.name).toBe("5LP");
    expect(r.options.map((o) => o.move.name)).toEqual(["5LP", "5MP"]);
  });
});

describe("blockGap", () => {
  it("gap = B.startup − A.onBlock", () => {
    const a = mk({ name: "A", onBlock: -2 });
    const b = mk({ name: "B", startup: 5 });
    // 5 − (−2) = 7
    expect(blockGap(a, b).gap).toBe(7);
    expect(blockGap(a, b).trueBlockstring).toBe(false);
  });

  it("is a true blockstring when the follow-up is fast enough", () => {
    const a = mk({ name: "A", onBlock: 2 }); // +2 on block
    const b = mk({ name: "B", startup: 2 });
    const r = blockGap(a, b); // 2 − 2 = 0
    expect(r.gap).toBe(0);
    expect(r.trueBlockstring).toBe(true);
  });
});

describe("cancel legality", () => {
  const normal = mk({ category: "normal", cancelTags: ["sp", "su"] });
  const special = mk({ id: "236lp", name: "Hadoken", category: "special", onBlock: -5, onHit: 2 });

  it("a special-cancelable normal can cancel into a special", () => {
    expect(canCancelInto(normal, special)).toBe(true);
    const r = cancelInto(normal, special, "block");
    expect(r.cancelable).toBe(true);
    expect(r.endingAdvantage).toBe(-5);
    expect(r.endingSign).toBe("minus");
  });

  it("a normal with no cancel tags cannot cancel", () => {
    expect(canCancelInto(mk({ cancelTags: [] }), special)).toBe(false);
  });

  it("honours a known cancel-advantage override", () => {
    const withOverride = mk({
      category: "normal",
      cancelTags: ["sp"],
      comboAdvantage: { "236lp": { onBlock: -2 } },
    });
    expect(cancelInto(withOverride, special, "block").endingAdvantage).toBe(-2);
  });
});

describe("analyzeSequence — the flagship", () => {
  const twomk = mk({ name: "2MK", category: "normal", startup: 8, onBlock: -6, cancelTags: ["sp"] });
  const hadoken = mk({ id: "236lp", name: "Hadoken", category: "special", startup: 16, onBlock: -5, onHit: 2 });

  it("treats X xx special as a cancel (no gap) and ends on the special's advantage", () => {
    const r = analyzeSequence([twomk, hadoken], "block");
    expect(r.steps[0]!.connection).toBe("cancel");
    expect(r.endingAdvantage).toBe(-5);
    expect(r.endingSign).toBe("minus");
    expect(r.trueBlockstring).toBe(true);
  });

  it("treats two non-cancel normals as a link and reports the gap", () => {
    const jab = mk({ name: "5LP", category: "normal", startup: 4, onBlock: -1, cancelTags: [] });
    const r = analyzeSequence([jab, jab], "block");
    expect(r.steps[0]!.connection).toBe("link");
    // gap = 4 − (−1) = 5
    expect(r.steps[0]!.gap.gap).toBe(5);
  });

  it("carries the ending reaction on hit", () => {
    const sweep = mk({ name: "Sweep", onHit: 40, hitReaction: "knockdown" });
    const r = analyzeSequence([sweep], "hit");
    expect(r.endingReaction).toBe("knockdown");
  });
});
